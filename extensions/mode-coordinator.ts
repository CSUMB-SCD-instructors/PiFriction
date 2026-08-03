import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PIFRICTION_MODES = ["chat", "plan", "guided", "detective", "test-explorer"] as const;
export type PiFrictionMode = (typeof PIFRICTION_MODES)[number];
type ModeSource = "startup" | "student" | "picker" | "instructor" | "remote-policy";

type ModeRequest = { mode: string; source?: ModeSource };
type ModeActivation = { mode: PiFrictionMode; previousMode?: PiFrictionMode; source: ModeSource; locked: boolean };
type ModeStateQuery = { mode?: PiFrictionMode; locked?: boolean; assignedMode?: PiFrictionMode };

const MODE_CHOICES: Array<{ mode: PiFrictionMode; label: string }> = [
  { mode: "chat", label: "Chat — tutoring; @mention files to let Pi read them; no commands or edits" },
  { mode: "plan", label: "Planning — inspect the project and compare approaches; no edits" },
  { mode: "guided", label: "Guided coding — explain one small unit before Pi edits it" },
  { mode: "detective", label: "Change Detective — review every proposed concrete edit" },
  { mode: "test-explorer", label: "Test Explorer — read tests one at a time and predict their behavior" },
];

function isMode(value: string): value is PiFrictionMode {
  return (PIFRICTION_MODES as readonly string[]).includes(value);
}

export default function modeCoordinator(pi: ExtensionAPI): void {
  let activeMode: PiFrictionMode = "chat";
  let assignedMode: PiFrictionMode | undefined;
  let locked = false;
  let thinkingLevelBeforePiFriction: ReturnType<ExtensionAPI["getThinkingLevel"]> | undefined;
  let restoringThinkingLevel = false;

  function enforceHiddenThinking(): void {
    if (pi.getThinkingLevel() !== "off") pi.setThinkingLevel("off");
  }

  pi.registerFlag("assigned-mode", {
    description: "Assign PiFriction mode: chat, plan, guided, detective, or test-explorer",
    type: "string",
  });
  pi.registerFlag("lock-mode", {
    description: "Prevent students from switching away from the assigned PiFriction mode",
    type: "boolean",
    default: false,
  });

  function activate(mode: PiFrictionMode, source: ModeSource): void {
    if (thinkingLevelBeforePiFriction === undefined) {
      thinkingLevelBeforePiFriction = pi.getThinkingLevel();
    }
    enforceHiddenThinking();

    const previousMode = activeMode;
    activeMode = mode;
    pi.events.emit("pifriction:mode:activate", {
      mode,
      previousMode,
      source,
      locked,
    } satisfies ModeActivation);
  }

  pi.events.on("pifriction:mode:get-state", (query: ModeStateQuery) => {
    query.mode = activeMode;
    query.locked = locked;
    query.assignedMode = assignedMode;
  });

  pi.events.on("pifriction:mode:request", (request: ModeRequest) => {
    if (!isMode(request.mode)) return;
    const source = request.source ?? "student";

    if (locked && source !== "startup" && source !== "instructor" && source !== "remote-policy") {
      pi.events.emit("pifriction:mode:blocked", {
        requestedMode: request.mode,
        assignedMode: assignedMode ?? activeMode,
      });
      return;
    }

    activate(request.mode, source);
  });

  // Future course-policy extensions can use this event after fetching a policy.
  pi.events.on("pifriction:mode:set-policy", (policy: { mode: string; locked?: boolean; source?: ModeSource }) => {
    if (!isMode(policy.mode)) return;
    assignedMode = policy.mode;
    locked = Boolean(policy.locked);
    activate(policy.mode, policy.source ?? "remote-policy");
  });

  pi.on("thinking_level_select", (event) => {
    // All PiFriction modes are learning exercises. Visible model scratch work
    // leaks solutions, hidden exercise directives, and answer rubrics.
    if (!restoringThinkingLevel && event.level !== "off") enforceHiddenThinking();
  });

  pi.on("session_shutdown", () => {
    if (thinkingLevelBeforePiFriction !== undefined) {
      restoringThinkingLevel = true;
      pi.setThinkingLevel(thinkingLevelBeforePiFriction);
      restoringThinkingLevel = false;
      thinkingLevelBeforePiFriction = undefined;
    }
  });

  pi.registerCommand("mode", {
    description: "Choose a PiFriction mode",
    handler: async (_args, ctx) => {
      if (locked) {
        ctx.ui.notify(`This session is locked to ${assignedMode ?? activeMode} mode.`, "warning");
        return;
      }

      const choices = MODE_CHOICES.map(({ mode, label }) =>
        mode === activeMode ? `● ${mode}: ${label} (current)` : `○ ${mode}: ${label}`,
      );
      const choice = await ctx.ui.select("Choose a PiFriction mode", choices);
      if (!choice) return;

      const selected = MODE_CHOICES.find(({ mode }) => choice.includes(`${mode}:`));
      if (selected) pi.events.emit("pifriction:mode:request", { mode: selected.mode, source: "student" });
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const configuredMode =
      process.env.PIFRICTION_MODE ??
      (pi.getFlag("assigned-mode") as string | undefined);
    const configuredLock =
      process.env.PIFRICTION_MODE_LOCK === "1" ||
      process.env.PIFRICTION_MODE_LOCK === "true" ||
      Boolean(pi.getFlag("lock-mode"));

    if (configuredMode && isMode(configuredMode)) {
      assignedMode = configuredMode;
      locked = configuredLock;
      activate(configuredMode, "startup");
      if (locked) ctx.ui.notify(`This session is assigned to ${configuredMode} mode. Mode switching is locked.`, "info");
      return;
    }

    // Explicit individual mode flags remain useful for scripts.
    const flaggedMode: PiFrictionMode = pi.getFlag("test-explorer")
      ? "test-explorer"
      : pi.getFlag("detective")
        ? "detective"
        : pi.getFlag("plan")
          ? "plan"
          : pi.getFlag("guided")
            ? "guided"
            : "chat";
    activate(flaggedMode, "startup");
  });
}
