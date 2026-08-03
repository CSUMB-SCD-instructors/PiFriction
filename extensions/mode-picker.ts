import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function modePicker(pi: ExtensionAPI): void {
  pi.registerCommand("pifriction-help", {
    description: "Show PiFriction modes and commands",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `PiFriction modes:\n\n/chat — tutoring-only mode. Pi cannot run commands or edit files, and may read only files you @mention in the current message.\n/plan — read-only project planning. Pi maps the project and compares approaches; choose and justify one to enter guided coding.\n/guided — guided coding mode. Pi works on one small unit at a time; explain its purpose, mechanism, and a risk or alternative before edits unlock.\n/detective — Change Detective mode. Review every concrete edit; identify problems or allow the exact reviewed change.\n/test-explorer — read tests one at a time: predict setup, action, expected result, and bug caught.\n/code-practice — write one small named code blank yourself; Pi gives hints but never the completed answer.\n\nUse /mode to choose among available modes. More help:\n/chat-help — chat mode details\n/plan-help — planning mode details\n/guided-help — guided coding details\n/detective-help — Change Detective mode details\n/test-help — Test Explorer details\n/code-practice-help — Code Practice details`,
        "info",
      );
    },
  });

  pi.on("session_start", async (event, ctx) => {
    // A CLI-selected mode is useful for automation and should not be replaced
    // by a prompt. The picker is for normal interactive starts only.
    if (event.reason !== "startup" || ctx.mode !== "tui") return;
    if (pi.getFlag("guided") || pi.getFlag("plan") || pi.getFlag("detective") || pi.getFlag("test-explorer") || pi.getFlag("code-practice") || pi.getFlag("assigned-mode")) return;

    const choice = await ctx.ui.select("Choose a PiFriction mode", [
      "Chat — ask questions; Pi cannot inspect files unless you @mention one, run commands, or edit",
      "Planning — inspect the project and compare approaches; no edits",
      "Guided coding — work one small unit at a time; explain it before Pi edits",
      "Change Detective — review every proposed concrete file edit",
      "Test Explorer — read tests one at a time and predict their behavior",
      "Code Practice — write one small named code blank yourself",
    ]);

    if (choice?.startsWith("Code Practice")) {
      pi.events.emit("pifriction:mode:request", { mode: "code-practice", source: "picker" });
    } else if (choice?.startsWith("Test Explorer")) {
      pi.events.emit("pifriction:mode:request", { mode: "test-explorer", source: "picker" });
    } else if (choice?.startsWith("Change Detective")) {
      pi.events.emit("pifriction:mode:request", { mode: "detective", source: "picker" });
    } else if (choice?.startsWith("Planning")) {
      pi.events.emit("pifriction:mode:request", { mode: "plan", source: "picker" });
    } else if (choice?.startsWith("Guided coding")) {
      pi.events.emit("pifriction:mode:request", { mode: "guided", source: "picker" });
    } else {
      // Cancel/default intentionally means the safer, tutoring-only mode.
      pi.events.emit("pifriction:mode:request", { mode: "chat", source: "picker" });
    }
  });
}
