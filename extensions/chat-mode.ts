import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { isAbsolute, normalize, relative, resolve } from "node:path";

const CHAT_MODE_TOOLS = ["read"];
const BLOCKED_TOOLS = new Set(["bash", "edit", "write", "grep", "find", "ls"]);

let enabled = true;
let toolsBeforeChatMode: string[] | undefined;
let allowedFiles = new Set<string>();

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

function updateUi(ctx: ExtensionContext): void {
  if (!enabled) {
    ctx.ui.setStatus("chat-mode", undefined);
    ctx.ui.setWidget("chat-mode-files", undefined);
    return;
  }

  ctx.ui.setStatus("chat-mode", ctx.ui.theme.fg("accent", "chat"));

  if (allowedFiles.size === 0) {
    ctx.ui.setWidget("chat-mode-files", [ctx.ui.theme.fg("muted", "Chat mode: no files allowed")]);
  } else {
    ctx.ui.setWidget("chat-mode-files", [
      ctx.ui.theme.fg("muted", "Chat mode allowed files:"),
      ...[...allowedFiles].map((file) => `• ${displayPath(ctx.cwd, file)}`),
    ]);
  }
}

function addAllowedFiles(ctx: ExtensionContext, paths: string[]): number {
  const normalizedPaths = paths.map((s) => s.trim()).filter(Boolean);

  for (const path of normalizedPaths) {
    allowedFiles.add(normalizeForCwd(ctx.cwd, path));
  }

  return normalizedPaths.length;
}

export default function chatMode(pi: ExtensionAPI): void {
  pi.registerFlag("chat", {
    description: "Start in classroom chat mode: no edits, commands, search, or unapproved file reads",
    type: "boolean",
    default: true,
  });

  pi.on("session_start", (_event, ctx) => {
    enabled = Boolean(pi.getFlag("chat"));
    if (enabled) setChatTools(pi);
    updateUi(ctx);
  });

  pi.registerCommand("chat", {
    description: "Toggle classroom chat mode",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      if (enabled) {
        setChatTools(pi);
        ctx.ui.notify("Chat mode enabled. Only explicitly allowed files can be read.", "info");
      } else {
        restoreTools(pi);
        ctx.ui.notify("Chat mode disabled. Normal tools restored.", "warning");
      }
      updateUi(ctx);
    },
  });

  pi.registerCommand("chat-allow", {
    description: "Allow chat mode to read one or more explicit files",
    handler: async (args, ctx) => {
      const count = addAllowedFiles(ctx, args.split(/\s+/));
      updateUi(ctx);
      ctx.ui.notify(count === 0 ? "Usage: /chat-allow <file> [file...]" : `Allowed ${count} file(s) for chat mode.`, "info");
    },
  });

  pi.registerCommand("chat-clear", {
    description: "Clear chat mode's allowed file list",
    handler: async (_args, ctx) => {
      allowedFiles = new Set();
      updateUi(ctx);
      ctx.ui.notify("Chat mode file allowlist cleared.", "info");
    },
  });

  pi.on("input", async (event, ctx) => {
    if (!enabled) return { action: "continue" };

    const references = extractAtFileReferences(event.text);
    if (references.length === 0) return { action: "continue" };

    addAllowedFiles(ctx, references);
    updateUi(ctx);

    return {
      action: "transform",
      text: `${event.text}\n\n[Chat mode note: The student explicitly referenced these files, so they may be read if needed: ${references.join(", ")}]`,
    };
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\nClassroom chat mode is active.\n- Behave like a tutoring chat assistant, not an autonomous coding agent.\n- Do not inspect the project, search the repository, run shell commands, edit files, or write files.\n- You may only read files that the user explicitly references with @path, explicitly allows with /chat-allow, or explicitly provides as pasted content.\n- If you need to see code, ask the student to paste the relevant snippet or reference the exact file with @path.\n- Help students understand errors, debug symptoms they describe, and suggest changes they should make themselves.\n- Prefer explanations, questions, hypotheses, and small suggested snippets over performing actions.`,
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
      if (!allowedFiles.has(requested)) {
        return {
          block: true,
          reason: `Chat mode blocks reading ${displayPath(ctx.cwd, requested)} because it was not explicitly allowed. Ask the student to run /chat-allow ${displayPath(ctx.cwd, requested)} or paste the relevant snippet.`,
        };
      }
    }
  });
}
