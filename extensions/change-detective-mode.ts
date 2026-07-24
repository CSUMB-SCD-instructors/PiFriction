import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const DETECTIVE_TOOLS = ["read", "grep", "find", "ls", "edit", "write"];
const BLOCKED_TOOLS = new Set(["bash"]);

type ProposedChange = {
  signature: string;
  summary: string;
};

let enabled = false;
let activeContext: ExtensionContext | undefined;
let approvedChange: ProposedChange | undefined;

function editSignature(input: { path: string; oldText: string; newText: string }): string {
  return JSON.stringify({ tool: "edit", path: input.path, oldText: input.oldText, newText: input.newText });
}

function writeSignature(input: { path: string; content: string }): string {
  return JSON.stringify({ tool: "write", path: input.path, content: input.content });
}

function truncate(text: string, max = 3000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… [truncated for review]`;
}

function describeEdit(input: { path: string; oldText: string; newText: string }): string {
  return `File: ${input.path}\n\nReplace:\n${truncate(input.oldText)}\n\nWith:\n${truncate(input.newText)}`;
}

function describeWrite(input: { path: string; content: string }): string {
  return `File: ${input.path}\n\nWrite/replace its entire contents with:\n${truncate(input.content)}`;
}

function setDetectiveTools(pi: ExtensionAPI): void {
  pi.setActiveTools(DETECTIVE_TOOLS);
}

function setDetectiveHeader(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  ctx.ui.setHeader((_tui, theme) => ({
    render() {
      return [
        theme.fg("accent", theme.bold("PiFriction Change Detective mode")),
        theme.fg("muted", "Review every proposed file change. Treat each candidate as potentially flawed."),
        theme.fg("muted", "Choose “looks good” or identify a problem before Pi can apply it. /detective-help or /pifriction-help"),
      ];
    },
    invalidate() {},
  }));
}

function updateUi(ctx: ExtensionContext): void {
  if (!enabled) {
    ctx.ui.setStatus("detective-mode", undefined);
    ctx.ui.setWidget("detective-mode", undefined);
    return;
  }

  ctx.ui.setStatus("detective-mode", ctx.ui.theme.fg("accent", "DETECTIVE · review every change"));
  ctx.ui.setWidget("detective-mode", [
    ctx.ui.theme.fg("muted", "Change Detective mode"),
    approvedChange
      ? "A reviewed change is ready for Pi to retry and apply."
      : "Every edit is paused for your review before it can be applied.",
  ]);
}

function setEnabled(next: boolean, ctx: ExtensionContext, pi: ExtensionAPI, notify = true): void {
  enabled = next;
  approvedChange = undefined;

  if (enabled) {
    pi.events.emit("chat:set-enabled", { enabled: false });
    pi.events.emit("plan:set-enabled", { enabled: false });
    pi.events.emit("guided:set-enabled", { enabled: false });
    setDetectiveTools(pi);
    setDetectiveHeader(ctx);
    if (notify) ctx.ui.notify("Change Detective enabled. Every file change requires your review.", "info");
  } else if (notify) {
    ctx.ui.notify("Change Detective disabled. Returning to chat mode.", "info");
    pi.events.emit("chat:set-enabled", { enabled: true });
  }

  updateUi(ctx);
}

export default function changeDetectiveMode(pi: ExtensionAPI): void {
  pi.registerFlag("detective", {
    description: "Start in Change Detective mode",
    type: "boolean",
    default: false,
  });

  pi.events.on("detective:set-enabled", (data: { enabled?: boolean }) => {
    if (activeContext && Boolean(data.enabled) !== enabled) {
      setEnabled(Boolean(data.enabled), activeContext, pi, false);
    }
  });

  pi.registerCommand("detective", {
    description: "Toggle Change Detective mode: review every file change",
    handler: async (_args, ctx) => setEnabled(!enabled, ctx, pi),
  });

  pi.registerCommand("detective-help", {
    description: "Show Change Detective mode help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Change Detective mode:\n\nPi can inspect a project and propose changes, but every edit is paused with the exact file change for your review. Choose:\n1. Looks good — Pi must retry the same reviewed change before it is applied.\n2. Something is wrong — explain the mismatch, missing case, or other concern; Pi will explain and propose a corrected change.\n\nTreat every proposal as potentially flawed. Pi may deliberately offer plausible but incorrect candidates as a review exercise. This beta blocks shell commands so edits cannot bypass review. Use /detective to leave this mode.`,
        "info",
      );
    },
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    approvedChange = undefined;

    if (pi.getFlag("detective")) {
      setEnabled(true, ctx, pi);
    } else {
      enabled = false;
      updateUi(ctx);
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\nPiFriction Change Detective mode is active.\n- You may inspect, search, and propose file changes, but every edit/write call is intercepted for student review.\n- Before proposing a change, state briefly what goal it is intended to accomplish. Keep changes focused and make one concrete edit at a time.\n- After an edit/write is paused, the tool result reports the student's review choice.\n- If the student selected “looks good,” retry the EXACT same tool call to apply it. Do not combine it with other changes.\n- If the student identified a problem, explain whether their diagnosis is correct. Do not apply that candidate. Revise the proposal and let it be reviewed again.\n- For review practice, occasionally offer a subtle but plausible flawed candidate (wrong scope, missing edge case, violated invariant, or incorrect boundary). Never disclose that it is intentionally flawed before review. If the student approves such a candidate, do NOT retry/apply it: explain the missed issue and propose a corrected candidate for another review.\n- Do not use bash. Do not bypass the review loop.`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!enabled) return;

    if (BLOCKED_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: "Change Detective blocks shell commands so file changes cannot bypass the review gate.",
      };
    }

    let signature: string | undefined;
    let summary: string | undefined;

    if (isToolCallEventType("edit", event)) {
      signature = editSignature(event.input);
      summary = describeEdit(event.input);
    } else if (isToolCallEventType("write", event)) {
      signature = writeSignature(event.input);
      summary = describeWrite(event.input);
    } else {
      return;
    }

    if (approvedChange?.signature === signature) {
      approvedChange = undefined;
      updateUi(ctx);
      return;
    }

    // A different candidate invalidates any prior approval; the student must
    // review the exact bytes that will actually be changed.
    approvedChange = undefined;
    ctx.ui.notify(`Proposed change:\n\n${summary}`, "info");

    const choice = await ctx.ui.select("Review the proposed file change", [
      "1. Looks good — allow Pi to apply this exact change",
      "2. Something is wrong — I want to identify the problem",
    ]);

    if (choice?.startsWith("1.")) {
      approvedChange = { signature, summary };
      updateUi(ctx);
      return {
        block: true,
        reason: "The student marked this candidate as looking good. Retry the EXACT same edit/write call, with no changes, to apply it. If this was an intentionally flawed review candidate, do not retry it: explain the missed issue and propose a corrected candidate instead.",
      };
    }

    const diagnosis = await ctx.ui.input(
      "What is wrong with this proposed change?",
      "Describe a mismatch, missing case, invariant, boundary issue, or concern…",
    );
    updateUi(ctx);

    return {
      block: true,
      reason: diagnosis?.trim()
        ? `The student rejected this candidate and wrote: ${diagnosis.trim()}\nDo not apply it. Evaluate their diagnosis, explain it, then propose a corrected change for another review.`
        : "The student rejected this candidate. Do not apply it. Ask them what concern they see, or explain a relevant concern and propose a corrected change for another review.",
    };
  });
}
