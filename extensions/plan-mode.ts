import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type PlanPhase = "idle" | "investigating" | "awaiting-choice" | "assessing-choice";

// Plan mode is deliberately read-only, but project-level planning requires
// navigation and search. `read` reads file contents; `ls`, `find`, and `grep`
// map directories and locate relevant code. Keep bash unavailable because it
// can bypass the no-edit rule and tempt the model to implement rather than plan.
const PLAN_TOOLS = ["read", "ls", "find", "grep", "plan_begin_guided_coding"];
const BLOCKED_TOOLS = new Set(["bash", "edit", "write"]);

// Classroom tuning lives here. This mode deliberately separates choosing an
// approach from implementing it; guided mode owns implementation.
const PLAN_INSTRUCTIONS = `
Explore the project and task as needed, but do not edit files or provide a patch. Use ls/find/grep to map directories and locate relevant files; use read only for file contents, not directories.

Produce a PROJECT PLAN that first briefly explains the relevant architecture: the components, data flow, and constraints that matter for the student's request. Then offer 2 or 3 genuinely plausible approaches. Do not label one as "recommended" and do not present intentionally broken or deceptive options.

For each approach include:
- a short name;
- the intended behavior and high-level mechanism;
- likely files/functions affected;
- a meaningful tradeoff, limitation, or pitfall; and
- a verification strategy.

Keep the alternatives concrete enough to compare, but do not give implementation-level code, a patch, or a full worked solution. Ask the student to choose one approach and explain why it fits the task better than at least one alternative. Tell them that their chosen approach will transition into guided mode, where implementation happens one small unit at a time.`;

const CHOICE_ASSESSMENT_INSTRUCTIONS = `
The student is choosing among the proposed project approaches. Assess whether they gave a reasoned choice: they should connect the selected approach to the task and identify at least one tradeoff relative to another approach.

Do not accept a bare preference such as "Option A" or "that seems easiest." If their reasoning is missing or uncertain, ask one focused comparison question and remain in plan mode. Do not reveal a model answer or begin implementation.

If their choice is sufficient, briefly acknowledge the reasoning and call plan_begin_guided_coding. That tool hands the work to guided coding mode; do not edit files yourself.`;

let enabled = false;
let phase: PlanPhase = "idle";
let activeContext: ExtensionContext | undefined;

function setPlanTools(pi: ExtensionAPI): void {
  pi.setActiveTools(PLAN_TOOLS);
}

function setPlanHeader(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  ctx.ui.setHeader((_tui, theme) => ({
    render() {
      return [
        theme.fg("accent", theme.bold("PiFriction planning mode")),
        theme.fg("muted", "Pi can browse and inspect the project, but cannot run shell commands or edit."),
        theme.fg("muted", "Choose and justify an approach to continue in guided coding mode. /plan-help or /pifriction-help"),
      ];
    },
    invalidate() {},
  }));
}

function updateUi(ctx: ExtensionContext): void {
  if (!enabled) {
    ctx.ui.setStatus("plan-mode", undefined);
    ctx.ui.setWidget("plan-mode", undefined);
    return;
  }

  const label: Record<PlanPhase, string> = {
    idle: "PLAN · ready",
    investigating: "PLAN · exploring project",
    "awaiting-choice": "PLAN · choose an approach",
    "assessing-choice": "PLAN · checking reasoning",
  };

  ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", label[phase]));
  ctx.ui.setWidget("plan-mode", [
    ctx.ui.theme.fg("muted", "Planning mode · read-only"),
    phase === "awaiting-choice" || phase === "assessing-choice"
      ? "Choose an approach and compare its tradeoff with an alternative."
      : "Pi will map the project and offer approaches before guided implementation.",
  ]);
}

function setEnabled(next: boolean, ctx: ExtensionContext, pi: ExtensionAPI, notify = true): void {
  enabled = next;
  phase = "idle";

  if (enabled) {
    // Other modes may restore their own tools while yielding; install the plan
    // set last so the final state is read-only.
    pi.events.emit("guided:set-enabled", { enabled: false });
    pi.events.emit("chat:set-enabled", { enabled: false });
    pi.events.emit("detective:set-enabled", { enabled: false });
    setPlanTools(pi);
    setPlanHeader(ctx);
    if (notify) ctx.ui.notify("Planning mode enabled. Pi can inspect and compare approaches, but cannot edit.", "info");
  } else if (notify) {
    ctx.ui.notify("Planning mode disabled.", "info");
  }

  updateUi(ctx);
}

export default function planMode(pi: ExtensionAPI): void {
  pi.registerFlag("plan", {
    description: "Start in read-only planning mode",
    type: "boolean",
    default: false,
  });

  pi.events.on("plan:set-enabled", (data: { enabled?: boolean }) => {
    if (activeContext && Boolean(data.enabled) !== enabled) {
      setEnabled(Boolean(data.enabled), activeContext, pi, false);
    }
  });

  pi.registerCommand("plan", {
    description: "Toggle read-only project planning mode",
    handler: async (_args, ctx) => setEnabled(!enabled, ctx, pi),
  });

  pi.registerCommand("plan-help", {
    description: "Show planning mode help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Planning mode:\n\n1. Ask Pi to understand a project-level change or decision.\n2. Pi can list directories, find files, search code, and read relevant files.\n3. Pi maps relevant components and offers 2–3 plausible approaches.\n4. Choose one and explain why it fits better than an alternative.\n5. Pi then transitions to guided coding mode, where implementation proceeds one small unit at a time.\n\nPlanning mode cannot run shell commands or edit files. Use /plan to leave this mode.`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "plan_begin_guided_coding",
    label: "Begin Guided Coding",
    description:
      "Transition the student's reasoned, selected plan into guided coding mode. Call only after they choose an approach and compare its tradeoff with an alternative.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!enabled || phase !== "assessing-choice") {
        return {
          content: [{ type: "text", text: "Stay in planning mode until the student has selected and justified an approach." }],
          details: {},
          isError: true,
        };
      }

      enabled = false;
      phase = "idle";
      updateUi(ctx);
      pi.events.emit("guided:set-enabled", { enabled: true });

      return {
        content: [{ type: "text", text: "The chosen approach has been handed to guided coding mode. Continue with one small implementation unit at a time; do not implement the entire plan at once." }],
        details: {},
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    phase = "idle";

    if (pi.getFlag("plan")) {
      setEnabled(true, ctx, pi);
    } else {
      enabled = false;
      updateUi(ctx);
    }
  });

  pi.on("input", async (event, ctx) => {
    if (!enabled || event.source === "extension") return { action: "continue" };

    if (phase === "awaiting-choice") {
      phase = "assessing-choice";
      updateUi(ctx);
    } else if (phase === "idle") {
      phase = "investigating";
      setPlanTools(pi);
      updateUi(ctx);
    }

    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;

    const phaseInstructions: Record<PlanPhase, string> = {
      idle: "Wait for a student project-planning request.",
      investigating: PLAN_INSTRUCTIONS,
      "awaiting-choice": "Wait for the student to choose and justify an approach. Do not edit.",
      "assessing-choice": CHOICE_ASSESSMENT_INSTRUCTIONS,
    };

    return {
      systemPrompt: `${event.systemPrompt}\n\nPiFriction planning mode is active.\n${phaseInstructions[phase]}`,
    };
  });

  pi.on("tool_call", async (event) => {
    if (enabled && BLOCKED_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: "Planning mode permits read-only browsing and search, but blocks shell commands and file changes. Compare approaches and transition to guided coding before implementation.",
      };
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (enabled && phase === "investigating") {
      phase = "awaiting-choice";
      updateUi(ctx);
    }
  });
}
