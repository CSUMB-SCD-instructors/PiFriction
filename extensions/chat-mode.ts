import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";

const CHAT_MODE_TOOLS = ["read"];
const BLOCKED_TOOLS = new Set(["bash", "edit", "write", "grep", "find", "ls"]);

let enabled = true;
let toolsBeforeChatMode: string[] | undefined;
let allowedFilesForCurrentPrompt = new Set<string>();
let activeContext: ExtensionContext | undefined;

function extractAtFileReferences(text: string): string[] {
  const matches = text.matchAll(/(?:^|\s)@([^\s`'"<>|;&]+)(?=$|\s)/g);
  return [...matches].map((match) => match[1].replace(/[),.:;!?]+$/, ""));
}

function normalizeForCwd(cwd: string, path: string): string {
  return normalize(isAbsolute(path) ? path : resolve(cwd, path));
}

function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

function setChatTools(pi: ExtensionAPI): void {
  if (toolsBeforeChatMode === undefined) toolsBeforeChatMode = pi.getActiveTools();
  pi.setActiveTools(CHAT_MODE_TOOLS);
}

function restoreTools(pi: ExtensionAPI): void {
  pi.setActiveTools(toolsBeforeChatMode ?? ["read", "bash", "edit", "write"]);
  toolsBeforeChatMode = undefined;
}

function setEnabled(next: boolean, ctx: ExtensionContext, pi: ExtensionAPI, notify = true): void {
  enabled = next;
  allowedFilesForCurrentPrompt = new Set();

  if (enabled) {
    setChatTools(pi);
    if (notify) ctx.ui.notify("Chat mode enabled. Only explicitly referenced files can be read.", "info");
  } else {
    restoreTools(pi);
    if (notify) ctx.ui.notify("Chat mode disabled.", "warning");
  }

  if (enabled) setChatHeader(ctx);
  updateUi(ctx);
}

function setChatHeader(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  ctx.ui.setHeader((_tui, theme) => ({
    render() {
      return [
        theme.fg("accent", theme.bold("PiFriction chat mode")),
        theme.fg("muted", "Ask questions normally. Use @file when you want Pi to read one specific file."),
        theme.fg("muted", "Pi will not search, run commands, edit, or write files. /chat-help or /pifriction-help"),
      ];
    },
    invalidate() {},
  }));
}

function updateUi(ctx: ExtensionContext): void {
  if (!enabled) {
    ctx.ui.setStatus("chat-mode", undefined);
    ctx.ui.setWidget("chat-mode-files", undefined);
    return;
  }

  ctx.ui.setStatus("chat-mode", ctx.ui.theme.fg("accent", "CHAT · @files only · no edits"));

  if (allowedFilesForCurrentPrompt.size === 0) {
    ctx.ui.setWidget("chat-mode-files", [ctx.ui.theme.fg("muted", "Chat mode: no files allowed for current prompt")]);
  } else {
    ctx.ui.setWidget("chat-mode-files", [
      ctx.ui.theme.fg("muted", "Chat mode files allowed for current prompt:"),
      ...[...allowedFilesForCurrentPrompt].map((file) => `• ${displayPath(ctx.cwd, file)}`),
    ]);
  }
}

function allowFilesForCurrentPrompt(ctx: ExtensionContext, paths: string[]): { allowed: string[]; rejected: string[] } {
  const allowed: string[] = [];
  const rejected: string[] = [];

  for (const rawPath of paths.map((s) => s.trim()).filter(Boolean)) {
    const path = normalizeForCwd(ctx.cwd, rawPath);

    if (!existsSync(path) || !statSync(path).isFile()) {
      rejected.push(rawPath);
      continue;
    }

    allowedFilesForCurrentPrompt.add(path);
    allowed.push(rawPath);
  }

  return { allowed, rejected };
}

function chatHelpText(): string {
  return `PiFriction chat mode is active.

How to use it:
- Ask questions normally, like you would in chat.
- Paste error messages or terminal output directly when possible.
- Reference a specific file with @path/to/file when you want Pi to look at it.
- Pi can read only files explicitly mentioned in your current message.
- Pi will not search your project, run commands, edit files, or write files.
- Pi will suggest code changes for you to make yourself.
- Screenshots are useful, but paste exact error text too when details matter.`;
}

export default function chatMode(pi: ExtensionAPI): void {
  pi.registerFlag("chat", {
    description: "Start in classroom chat mode: no edits, commands, search, or unapproved file reads",
    type: "boolean",
    default: true,
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    enabled = Boolean(pi.getFlag("chat"));
    allowedFilesForCurrentPrompt = new Set();
    if (enabled) setChatTools(pi);
    updateUi(ctx);

    setChatHeader(ctx);
  });

  pi.events.on("chat:set-enabled", (data: { enabled?: boolean }) => {
    if (activeContext) setEnabled(Boolean(data.enabled), activeContext, pi, false);
  });

  pi.registerCommand("chat", {
    description: "Toggle classroom chat mode",
    handler: async (_args, ctx) => {
      setEnabled(!enabled, ctx, pi);
      if (enabled) pi.events.emit("guided:set-enabled", { enabled: false });
    },
  });

  pi.registerCommand("chat-help", {
    description: "Show PiFriction chat mode help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(chatHelpText(), "info");
    },
  });

  pi.registerCommand("chat-allow", {
    description: "Allow chat mode to read one or more explicit files for the current prompt",
    handler: async (args, ctx) => {
      allowedFilesForCurrentPrompt = new Set();
      const result = allowFilesForCurrentPrompt(ctx, args.split(/\s+/));
      updateUi(ctx);

      if (result.allowed.length === 0) {
        ctx.ui.notify(
          result.rejected.length > 0
            ? `No files allowed. These paths do not exist or are not files: ${result.rejected.join(", ")}`
            : "Usage: /chat-allow <file> [file...]",
          "warning",
        );
        return;
      }

      const suffix = result.rejected.length > 0 ? ` Rejected non-files: ${result.rejected.join(", ")}` : "";
      ctx.ui.notify(`Allowed ${result.allowed.length} file(s) for the current prompt.${suffix}`, "info");
    },
  });

  pi.registerCommand("chat-clear", {
    description: "Clear chat mode's allowed file list",
    handler: async (_args, ctx) => {
      allowedFilesForCurrentPrompt = new Set();
      updateUi(ctx);
      ctx.ui.notify("Chat mode file allowlist cleared.", "info");
    },
  });

  pi.on("input", async (event, ctx) => {
    if (!enabled) return { action: "continue" };

    const references = extractAtFileReferences(event.text);
    allowedFilesForCurrentPrompt = new Set();

    if (references.length > 0) {
      const result = allowFilesForCurrentPrompt(ctx, references);
      if (result.rejected.length > 0) {
        ctx.ui.notify(
          `Chat mode ignored @ references that are not readable files: ${result.rejected.join(", ")}`,
          "warning",
        );
      }
    }

    updateUi(ctx);
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!enabled) return;

    const allowedList = [...allowedFilesForCurrentPrompt].map((file) => `- ${displayPath(ctx.cwd, file)}`).join("\n") || "- none";
    const imageGuidance = event.images && event.images.length > 0
      ? "\n- The student attached image(s). Use them as user-provided context, but ask for pasted text when exact code, commands, or error messages matter."
      : "";

    return {
      systemPrompt: `${event.systemPrompt}\n\nClassroom chat mode is active.\n- Behave like a tutoring chat assistant, not an autonomous coding agent.\n- Do not inspect the project, search the repository, run shell commands, edit files, or write files.\n- You may only read files that the user explicitly references with @path, explicitly allows with /chat-allow, or explicitly provides as pasted content.\n- If you need to see code, ask the student to paste the relevant snippet or reference the exact file with @path.\n- Help students understand errors, debug symptoms they describe, and suggest changes they should make themselves.\n- Prefer explanations, questions, hypotheses, and small suggested snippets over performing actions.${imageGuidance}\n\nFiles allowed for reading for this user prompt only:\n${allowedList}`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!enabled) return;

    if (BLOCKED_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Chat mode blocks ${event.toolName}. Ask the student to paste relevant output/code instead.`,
      };
    }

    if (isToolCallEventType("read", event)) {
      const requested = normalizeForCwd(ctx.cwd, event.input.path);
      if (!allowedFilesForCurrentPrompt.has(requested)) {
        return {
          block: true,
          reason: `Chat mode blocks reading ${displayPath(ctx.cwd, requested)} because it was not explicitly allowed. Ask the student to run /chat-allow ${displayPath(ctx.cwd, requested)} or paste the relevant snippet.`,
        };
      }
    }
  });
}
