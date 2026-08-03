import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type PracticePhase = "idle" | "selecting" | "awaiting-attempt" | "assessing" | "scaffolding" | "accepted";

const CODE_PRACTICE_TOOLS = ["read", "ls", "find", "grep", "code_practice_accept_attempt"];
const BLOCKED_TOOLS = new Set(["bash", "edit", "write"]);

// Classroom tuning lives here. This policy is intentionally stronger than an
// ordinary tutor: Code Practice never supplies a blank's completed code.
const EXERCISE_INSTRUCTIONS = `
Inspect only the context needed for the student's requested function or behavior. Choose ONE small, consequential implementation decision: normally one expression or one line, never a whole function. Do not edit files or run commands.

Present a short skeleton with exactly one uniquely named placeholder such as /* BLANK: bounds check */. Keep all surrounding code visible and correct. State what the blank must accomplish at a conceptual level, but do not describe the required expression, API call, comparison, variable name, or exact implementation logic.

Ask the student to replace only that named blank. Require this exact submission format:

\`\`\`c
// BLANK: <name>
<their replacement code>
\`\`\`

Tell them that Shift+Enter inserts a newline in Pi's editor and triple backticks preserve their code block. Do not show a completed version of the blank or function.`;

const ASSESSMENT_INSTRUCTIONS = `
The student submitted an attempt for the current Code Practice blank. Evaluate semantic correctness against the function's contract and local invariants, not exact text matching.

If the attempt is substantively correct, call code_practice_accept_attempt. A correct answer may use equivalent syntax or naming. Minor mechanical issues—spelling, a missing semicolon, formatting, or similarly small notation—are not grounds to reveal or rewrite the answer. Identify only the mechanical issue and ask the student to resubmit their own code.

If the attempt is not substantively correct, do NOT provide the missing code, a completed line, a completed function, a near-verbatim expression, a comparison/operator, an API call, or a worked solution. Do NOT reveal the answer after repeated failed attempts, if the student asks for it, or if they say they give up.

Instead, give one conceptual scaffold about one missing idea, then ask the student to replace the SAME blank again. Good scaffolds ask the student to reason from a small concrete case, identify an invariant, distinguish valid/invalid states, or reread one relevant contract/comment. Do not advance to another exercise until their own submitted code is substantively correct, they choose a different exercise, or they leave Code Practice mode.`;

const ACCEPTANCE_INSTRUCTIONS = `
The student has submitted substantively correct code for the current blank. Briefly acknowledge the concept they demonstrated without pasting, quoting, or reconstructing their code. Do not show a completed function. Offer a neutral choice: practice another small blank, discuss the concept in chat mode, explore tests, or move to guided coding. Do not edit files in this mode.`;

let enabled = false;
let phase: PracticePhase = "idle";
let activeContext: ExtensionContext | undefined;

function setCodePracticeTools(pi: ExtensionAPI): void {
  pi.setActiveTools(CODE_PRACTICE_TOOLS);
}

function setCodePracticeHeader(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  ctx.ui.setHeader((_tui, theme) => ({
    render() {
      return [
        theme.fg("accent", theme.bold("PiFriction Code Practice mode")),
        theme.fg("muted", "Write one named blank yourself; Pi gives conceptual hints but never the completed answer."),
        theme.fg("muted", "Submit fenced C code. Shift+Enter adds a newline. /code-practice-help or /pifriction-help"),
      ];
    },
    invalidate() {},
  }));
}

function updateUi(ctx: ExtensionContext): void {
  if (!enabled) {
    ctx.ui.setStatus("code-practice-mode", undefined);
    ctx.ui.setWidget("code-practice-mode", undefined);
    return;
  }

  const label: Record<PracticePhase, string> = {
    idle: "PRACTICE · ready",
    selecting: "PRACTICE · preparing one blank",
    "awaiting-attempt": "PRACTICE · write the blank",
    assessing: "PRACTICE · checking attempt",
    scaffolding: "PRACTICE · try the same blank again",
    accepted: "PRACTICE · blank complete",
  };

  ctx.ui.setStatus("code-practice-mode", ctx.ui.theme.fg("accent", label[phase]));
  ctx.ui.setWidget("code-practice-mode", [
    ctx.ui.theme.fg("muted", "Code Practice · read-only"),
    phase === "awaiting-attempt" || phase === "assessing" || phase === "scaffolding"
      ? "Submit your replacement in a fenced code block. Pi gives hints, never the completed answer."
      : "Pi will select one small implementation decision for you to write.",
  ]);
}

function setEnabled(next: boolean, ctx: ExtensionContext, pi: ExtensionAPI, notify = true): void {
  enabled = next;
  phase = "idle";

  if (enabled) {
    setCodePracticeTools(pi);
    setCodePracticeHeader(ctx);
    if (notify) ctx.ui.notify("Code Practice enabled. You write the missing code; Pi will not reveal completed answers.", "info");
  } else if (notify) {
    ctx.ui.notify("Code Practice disabled.", "info");
  }

  updateUi(ctx);
}

export default function codePracticeMode(pi: ExtensionAPI): void {
  pi.registerFlag("code-practice", {
    description: "Start in read-only Code Practice mode",
    type: "boolean",
    default: false,
  });

  pi.events.on("pifriction:mode:activate", (event: { mode: string }) => {
    if (activeContext) setEnabled(event.mode === "code-practice", activeContext, pi, false);
  });

  pi.events.on("pifriction:mode:blocked", (event: { requestedMode: string; assignedMode: string }) => {
    if (activeContext && event.requestedMode === "code-practice") {
      activeContext.ui.notify(`This session is locked to ${event.assignedMode} mode.`, "warning");
    }
  });

  pi.registerCommand("code-practice", {
    description: "Switch to Code Practice: write one named code blank yourself",
    handler: async () => {
      pi.events.emit("pifriction:mode:request", { mode: "code-practice", source: "student" });
    },
  });

  pi.registerCommand("code-practice-help", {
    description: "Show Code Practice mode help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Code Practice mode:\n\n1. Name a function or behavior to practice.\n2. Pi shows one small skeleton with exactly one named blank.\n3. Replace that blank in a fenced code block:\n\n\`\`\`c\n// BLANK: name\n<your code>\n\`\`\`\n\nShift+Enter adds a newline in Pi's editor. Pi gives conceptual hints and will not provide the completed answer or function—even if you ask for it. It can only accept your own substantively correct attempt. Use /code-practice to leave this mode.`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "code_practice_accept_attempt",
    label: "Accept Code Practice Attempt",
    description:
      "Mark the current Code Practice blank complete only after the student submitted substantively correct code. Never call this for a partial, guessed, or merely acknowledged answer.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!enabled || phase !== "assessing") {
        return {
          content: [{ type: "text", text: "Keep the current Code Practice blank active until the student submits a substantively correct attempt." }],
          details: {},
          isError: true,
        };
      }

      phase = "accepted";
      updateUi(ctx);
      return {
        content: [{ type: "text", text: "The student wrote a substantively correct solution for this blank. Acknowledge the concept without reproducing their code or the completed function." }],
        details: {},
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    phase = "idle";
    const state: { mode?: string } = {};
    pi.events.emit("pifriction:mode:get-state", state);
    setEnabled(state.mode === "code-practice", ctx, pi, false);
  });

  pi.on("input", async (event, ctx) => {
    if (!enabled || event.source === "extension") return { action: "continue" };

    if (phase === "idle" || phase === "accepted") {
      phase = "selecting";
      setCodePracticeTools(pi);
    } else if (phase === "awaiting-attempt" || phase === "scaffolding") {
      phase = "assessing";
    }

    updateUi(ctx);
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;

    const phaseInstructions: Record<PracticePhase, string> = {
      idle: "Wait for the student to name a function or behavior they want to practice.",
      selecting: EXERCISE_INSTRUCTIONS,
      "awaiting-attempt": "Wait for the student's fenced replacement code for the current named blank. Do not show the answer.",
      assessing: ASSESSMENT_INSTRUCTIONS,
      scaffolding: "Wait for the student to retry the SAME named blank after a conceptual hint. Do not show the answer or advance.",
      accepted: ACCEPTANCE_INSTRUCTIONS,
    };

    return {
      systemPrompt: `${event.systemPrompt}\n\nPiFriction Code Practice mode is active.\n${phaseInstructions[phase]}`,
    };
  });

  pi.on("tool_call", async (event) => {
    if (enabled && BLOCKED_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: "Code Practice is read-only. The student submits code in chat; Pi cannot run commands or change files in this mode.",
      };
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled) return;

    if (phase === "selecting") {
      phase = "awaiting-attempt";
    } else if (phase === "assessing") {
      // Without the acceptance tool, the student needs another attempt at the
      // same blank after a targeted conceptual scaffold.
      phase = "scaffolding";
    }

    updateUi(ctx);
  });
}
