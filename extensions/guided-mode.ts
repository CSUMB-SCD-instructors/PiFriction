import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type GuidedPhase = "idle" | "proposing" | "awaiting-explanation" | "assessing" | "implementing" | "complete";

// Keep bash out of this first beta: otherwise it can bypass the edit/write
// gate by changing files with shell commands. Testing can be added later with
// a narrowly allowlisted command runner.
const EXPLORE_TOOLS = ["read", "guided_begin_implementation"];
const IMPLEMENT_TOOLS = ["read", "edit", "write", "guided_begin_implementation"];
const EDIT_TOOLS = new Set(["edit", "write"]);

// Classroom tuning lives here. Change these strings to adjust the exercise
// without changing the state machine or tool enforcement below.
const PROPOSAL_INSTRUCTIONS = `
First inspect only the code and files needed to understand the student's request. Do not edit yet.

Choose ONE SMALL IMPLEMENTATION UNIT. This should normally be one function or one tightly coupled helper plus its direct caller; never an entire assignment, feature, or list of functions. If the request contains many TODOs, choose a sensible first unit and say that later units will require separate explain-backs.

Give a compact CHANGE OUTLINE for that one unit only, not a worked solution or full rationale:
- the exact function(s) or small unit being considered
- likely file(s) to change
- concrete operations the unit must perform
- one way to verify this unit

Then ask the student to explain, in their own words:
1. the purpose and intended behavior of THIS implementation unit; and
2. how its operations accomplish that behavior; and
3. one risk, edge case, or reasonable alternative specific to this unit.

Do not mark an option as recommended. Do not write code, provide a patch, or use edit/write tools in this phase.`;

const ASSESSMENT_INSTRUCTIONS = `
The student is responding to the explain-back exercise for one specific implementation unit. Assess whether they can explain that exact unit rather than merely repeat labels from the outline.

A sufficient answer must describe the unit's intended behavior, connect its operations to that behavior, and identify a plausible unit-specific risk, edge case, or alternative.

Uncertainty is a reason NOT to unlock implementation. If the student says they do not understand any relevant part, or their answer leaves a core operation unexplained, do not accept a generally good answer. Briefly teach only the missing concept without giving a complete implementation or patch, then ask one focused follow-up question about that concept. Remain in this phase until they answer it.

Do not reveal a model answer. If something else is missing, ask one short, targeted follow-up question and remain in this phase.

Only if the explanation is sufficient, briefly acknowledge it and call the guided_begin_implementation tool. Do not call that tool merely because the student says "yes", "go ahead", or "I understand".`;

const IMPLEMENTATION_INSTRUCTIONS = `
The student's explain-back was accepted for one small implementation unit. Modify ONLY that agreed unit; do not opportunistically implement neighboring TODOs, an entire feature, or later steps. Work carefully, verify this unit when appropriate, and summarize what changed and what the student should check next. Then stop: a later unit needs a new guided cycle and a new explain-back.`;

let enabled = false;
let phase: GuidedPhase = "idle";
let activeContext: ExtensionContext | undefined;

function setExploreTools(pi: ExtensionAPI): void {
  pi.setActiveTools(EXPLORE_TOOLS);
}

function setImplementationTools(pi: ExtensionAPI): void {
  pi.setActiveTools(IMPLEMENT_TOOLS);
}

function setGuidedHeader(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  ctx.ui.setHeader((_tui, theme) => ({
    render() {
      return [
        theme.fg("accent", theme.bold("PiFriction guided coding mode")),
        theme.fg("muted", "Pi will work on one small function or implementation unit at a time."),
        theme.fg("muted", "Explain that unit and name a risk or alternative to unlock implementation. /guided-help for help."),
      ];
    },
    invalidate() {},
  }));
}

function updateUi(ctx: ExtensionContext): void {
  if (!enabled) {
    ctx.ui.setStatus("guided-mode", undefined);
    ctx.ui.setWidget("guided-mode", undefined);
    return;
  }

  const label: Record<GuidedPhase, string> = {
    idle: "guided: ready",
    proposing: "guided: planning",
    "awaiting-explanation": "guided: explain-back required",
    assessing: "guided: checking explanation",
    implementing: "guided: implementing",
    complete: "guided: complete",
  };

  ctx.ui.setStatus("guided-mode", ctx.ui.theme.fg("accent", label[phase]));
  ctx.ui.setWidget("guided-mode", [
    ctx.ui.theme.fg("muted", "Guided coding mode"),
    phase === "awaiting-explanation" || phase === "assessing"
      ? "Explain this implementation unit and name a unit-specific risk or alternative before edits unlock."
      : "Pi will plan one small implementation unit before it can edit.",
  ]);
}

function setEnabled(next: boolean, ctx: ExtensionContext, pi: ExtensionAPI): void {
  enabled = next;
  phase = "idle";

  if (enabled) {
    // Chat mode owns the restrictive tutoring-only tool set. Tell it to yield,
    // then install guided mode's read/explore set.
    pi.events.emit("chat:set-enabled", { enabled: false });
    setExploreTools(pi);
    setGuidedHeader(ctx);
    ctx.ui.notify("Guided coding enabled. Pi handles one small implementation unit at a time and checks your explanation before editing.", "info");
  } else {
    ctx.ui.notify("Guided coding disabled. Returning to chat mode.", "info");
    pi.events.emit("chat:set-enabled", { enabled: true });
  }

  updateUi(ctx);
}

export default function guidedMode(pi: ExtensionAPI): void {
  pi.events.on("guided:set-enabled", (data: { enabled?: boolean }) => {
    if (activeContext && !data.enabled && enabled) {
      enabled = false;
      phase = "idle";
      updateUi(activeContext);
    }
  });

  pi.registerCommand("guided", {
    description: "Toggle guided coding: inspect, explain-back, then implementation",
    handler: async (_args, ctx) => setEnabled(!enabled, ctx, pi),
  });

  pi.registerCommand("guided-help", {
    description: "Show guided coding mode help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Guided coding mode:\n\n1. Ask Pi to investigate a coding task.\n2. Pi chooses one small function or implementation unit and gives a concise outline.\n3. Explain that unit's purpose, mechanism, and one risk or alternative.\n4. If you say a relevant part is confusing, Pi should teach it and ask again rather than edit.\n5. Pi checks your explanation before it can edit that one unit.\n6. Later functions require another guided cycle.\n\nUse /guided to leave this mode.`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "guided_begin_implementation",
    label: "Begin Guided Implementation",
    description:
      "Unlock editing only after the student has adequately explained the single proposed implementation unit: its purpose, mechanism, and a unit-specific risk or alternative. Call only after assessing the student's explanation.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!enabled || phase !== "assessing") {
        return {
          content: [{ type: "text", text: "Implementation remains locked. First obtain and assess the student's explain-back response." }],
          details: {},
          isError: true,
        };
      }

      phase = "implementing";
      setImplementationTools(pi);
      updateUi(ctx);
      return {
        content: [{ type: "text", text: "Student explanation accepted. Editing tools are now available for the agreed change only." }],
        details: {},
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    enabled = false;
    phase = "idle";
    updateUi(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (!enabled || event.source === "extension") return { action: "continue" };

    if (phase === "awaiting-explanation") {
      phase = "assessing";
      updateUi(ctx);
      return { action: "continue" };
    }

    if (phase === "idle" || phase === "complete") {
      phase = "proposing";
      setExploreTools(pi);
      updateUi(ctx);
    }

    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;

    const phaseInstructions: Record<GuidedPhase, string> = {
      idle: "Wait for a student coding request.",
      proposing: PROPOSAL_INSTRUCTIONS,
      "awaiting-explanation": "Wait for the student's explain-back response. Do not edit.",
      assessing: ASSESSMENT_INSTRUCTIONS,
      implementing: IMPLEMENTATION_INSTRUCTIONS,
      complete: "Wait for the next student request; it will begin a new guided cycle.",
    };

    return {
      systemPrompt: `${event.systemPrompt}\n\nGuided coding mode is active.\n${phaseInstructions[phase]}`,
    };
  });

  pi.on("tool_call", async (event) => {
    if (enabled && EDIT_TOOLS.has(event.toolName) && phase !== "implementing") {
      return {
        block: true,
        reason: "Guided coding requires a proposed single implementation unit and an accepted student explain-back before files can be changed.",
      };
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled) return;

    if (phase === "proposing") {
      phase = "awaiting-explanation";
    } else if (phase === "implementing") {
      phase = "complete";
      setExploreTools(pi);
    }

    updateUi(ctx);
  });
}
