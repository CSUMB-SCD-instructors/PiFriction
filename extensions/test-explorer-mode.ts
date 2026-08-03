import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type TestPhase = "idle" | "discovering" | "awaiting-prediction" | "assessing" | "scaffolding" | "explaining" | "complete";

const TEST_EXPLORER_TOOLS = ["read", "ls", "find", "grep", "test_explorer_next_test"];
const BLOCKED_TOOLS = new Set(["bash", "edit", "write"]);

// Classroom tuning lives here. The central rule is that uncertainty produces
// a smaller question and another attempt, not a complete answer and advance.
const DISCOVERY_INSTRUCTIONS = `
Explore the project read-only to find tests relevant to the student's requested function or behavior. Use ls/find/grep to locate test files and direct usages, then read only focused excerpts. Do not edit, run tests, or provide code changes.

State how many direct usages or likely behavior tests you found, without claiming certainty about indirect tests. Select ONE approachable focused test excerpt. Show its file and line range, its test name if available, and only the setup/action/assertion needed to reason about it. Do not explain what the test proves yet.

Ask the student to identify all four parts in their own words:
1. Setup: what state or inputs exist before the behavior under test?
2. Action: what operation does the test perform?
3. Expected result: what does the assertion require?
4. Bug caught: what incorrect implementation would this test expose?

Never move to another test until the student can reason through the current one.`;

const ASSESSMENT_INSTRUCTIONS = `
The student is predicting the meaning of the current test. Assess their setup → action → expected result → bug-caught explanation.

If it is adequate, briefly confirm or correct it, explain the current test in no more than four concise sentences, then call test_explorer_next_test to continue. Do not dump the rest of the suite.

If it is incomplete or the student says they do not understand, do NOT give a complete explanation and do NOT advance. Instead:
1. identify one missing or unfamiliar piece (one assertion, setup line, test idiom, or state transition);
2. give the minimum needed definition, hint, or concrete question about only that piece; and
3. ask the student to try the SAME four-part prediction again.

For example, define what a test assertion checks, ask what a variable contains after setup, or ask what would make one assertion true. Do not answer all four parts for them. Repeat this scaffold cycle as needed.`;

const NEXT_TEST_INSTRUCTIONS = `
The student successfully explained the previous test. Select the next focused test excerpt, preferably one that adds a distinct behavior or edge case. Show only its relevant setup/action/assertion and ask for setup, action, expected result, and bug caught. If no useful tests remain, summarize the behavior categories the student has interpreted and stop.`;

let enabled = false;
let phase: TestPhase = "idle";
let activeContext: ExtensionContext | undefined;

function setTestExplorerTools(pi: ExtensionAPI): void {
  pi.setActiveTools(TEST_EXPLORER_TOOLS);
}

function setTestExplorerHeader(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;

  ctx.ui.setHeader((_tui, theme) => ({
    render() {
      return [
        theme.fg("accent", theme.bold("PiFriction Test Explorer mode")),
        theme.fg("muted", "Read tests one at a time: setup → action → expected result → bug caught."),
        theme.fg("muted", "If something is unclear, Pi should scaffold one piece and ask you to try again. /test-help or /pifriction-help"),
      ];
    },
    invalidate() {},
  }));
}

function updateUi(ctx: ExtensionContext): void {
  if (!enabled) {
    ctx.ui.setStatus("test-explorer-mode", undefined);
    ctx.ui.setWidget("test-explorer-mode", undefined);
    return;
  }

  const label: Record<TestPhase, string> = {
    idle: "TESTS · ready",
    discovering: "TESTS · locating tests",
    "awaiting-prediction": "TESTS · predict this test",
    assessing: "TESTS · checking prediction",
    scaffolding: "TESTS · try again",
    explaining: "TESTS · explaining current test",
    complete: "TESTS · exploration complete",
  };

  ctx.ui.setStatus("test-explorer-mode", ctx.ui.theme.fg("accent", label[phase]));
  ctx.ui.setWidget("test-explorer-mode", [
    ctx.ui.theme.fg("muted", "Test Explorer · read-only"),
    phase === "awaiting-prediction" || phase === "assessing" || phase === "scaffolding"
      ? "Explain: setup → action → expected result → bug caught. Uncertainty means a smaller question, not a skipped test."
      : "Pi will locate and examine one focused test at a time.",
  ]);
}

function setEnabled(next: boolean, ctx: ExtensionContext, pi: ExtensionAPI, notify = true): void {
  enabled = next;
  phase = "idle";

  if (enabled) {
    setTestExplorerTools(pi);
    setTestExplorerHeader(ctx);
    if (notify) ctx.ui.notify("Test Explorer enabled. Pi will help you reason through one test at a time.", "info");
  } else if (notify) {
    ctx.ui.notify("Test Explorer disabled.", "info");
  }

  updateUi(ctx);
}

export default function testExplorerMode(pi: ExtensionAPI): void {
  pi.registerFlag("test-explorer", {
    description: "Start in read-only Test Explorer mode",
    type: "boolean",
    default: false,
  });

  pi.events.on("pifriction:mode:activate", (event: { mode: string }) => {
    if (activeContext) setEnabled(event.mode === "test-explorer", activeContext, pi, false);
  });

  pi.events.on("pifriction:mode:blocked", (event: { requestedMode: string; assignedMode: string }) => {
    if (activeContext && event.requestedMode === "test-explorer") {
      activeContext.ui.notify(`This session is locked to ${event.assignedMode} mode.`, "warning");
    }
  });

  pi.registerCommand("test-explorer", {
    description: "Switch to read-only Test Explorer mode",
    handler: async (_args, _ctx) => {
      pi.events.emit("pifriction:mode:request", { mode: "test-explorer", source: "student" });
    },
  });

  pi.registerCommand("test-help", {
    description: "Show Test Explorer mode help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Test Explorer mode:\n\n1. Name a function or behavior you want to understand.\n2. Pi finds relevant tests and shows one focused excerpt.\n3. Explain its setup, action, expected result, and the bug it would catch.\n4. If one piece is confusing, Pi gives a smaller hint and asks you to try the same test again.\n5. Only after you can explain it does Pi move to another test.\n\nTest Explorer can browse and search, but cannot run commands or change files. Use /test-explorer to leave this mode.`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "test_explorer_next_test",
    label: "Next Test",
    description:
      "Advance Test Explorer only after the student adequately explains the current test's setup, action, expected result, and bug caught.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!enabled || phase !== "assessing") {
        return {
          content: [{ type: "text", text: "Stay with the current test until the student explains its setup, action, expected result, and bug caught." }],
          details: {},
          isError: true,
        };
      }

      phase = "explaining";
      updateUi(ctx);
      return {
        content: [{ type: "text", text: "The student explained the current test. Present one next focused test, or finish if none remain." }],
        details: {},
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    phase = "idle";
    const state: { mode?: string } = {};
    pi.events.emit("pifriction:mode:get-state", state);
    setEnabled(state.mode === "test-explorer", ctx, pi, false);
  });

  pi.on("input", async (event, ctx) => {
    if (!enabled || event.source === "extension") return { action: "continue" };

    if (phase === "idle" || phase === "complete") {
      phase = "discovering";
      setTestExplorerTools(pi);
    } else if (phase === "awaiting-prediction" || phase === "scaffolding") {
      phase = "assessing";
    }

    updateUi(ctx);
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;

    const phaseInstructions: Record<TestPhase, string> = {
      idle: "Wait for the student to name a function or behavior whose tests they want to explore.",
      discovering: DISCOVERY_INSTRUCTIONS,
      "awaiting-prediction": "Wait for the student's four-part prediction of the current test. Do not explain or advance yet.",
      assessing: ASSESSMENT_INSTRUCTIONS,
      scaffolding: "Wait for the student to retry the same test after the focused scaffold. Do not advance.",
      explaining: NEXT_TEST_INSTRUCTIONS,
      complete: "Wait for the student to name another function or behavior to explore.",
    };

    return {
      systemPrompt: `${event.systemPrompt}\n\nPiFriction Test Explorer mode is active.\n${phaseInstructions[phase]}`,
    };
  });

  pi.on("tool_call", async (event) => {
    if (enabled && BLOCKED_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: "Test Explorer is read-only. It can browse/search/read tests but cannot run commands or change files.",
      };
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled) return;

    if (phase === "discovering") {
      phase = "awaiting-prediction";
    } else if (phase === "assessing") {
      // If the model did not call the advance tool, it should have scaffolded
      // and must keep the student on this same test.
      phase = "scaffolding";
    } else if (phase === "explaining") {
      phase = "awaiting-prediction";
    }

    updateUi(ctx);
  });
}
