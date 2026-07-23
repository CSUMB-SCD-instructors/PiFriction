import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function modePicker(pi: ExtensionAPI): void {
  pi.registerCommand("pifriction-help", {
    description: "Show PiFriction modes and commands",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `PiFriction modes:\n\n/chat — tutoring-only mode. Pi cannot run commands or edit files, and may read only files you @mention in the current message.\n/plan — read-only project planning. Pi maps the project and compares approaches; choose and justify one to enter guided coding.\n/guided — guided coding mode. Pi works on one small unit at a time; explain its purpose, mechanism, and a risk or alternative before edits unlock.\n\nMore help:\n/chat-help — chat mode details\n/plan-help — planning mode details\n/guided-help — guided coding details\n\nYou can switch modes at any time with /chat, /plan, or /guided.`,
        "info",
      );
    },
  });

  pi.on("session_start", async (event, ctx) => {
    // A CLI-selected mode is useful for automation and should not be replaced
    // by a prompt. The picker is for normal interactive starts only.
    if (event.reason !== "startup" || ctx.mode !== "tui") return;
    if (pi.getFlag("guided") || pi.getFlag("plan")) return;

    const choice = await ctx.ui.select("Choose a PiFriction mode", [
      "Chat — ask questions; Pi cannot inspect files unless you @mention one, run commands, or edit",
      "Planning — inspect the project and compare approaches; no edits",
      "Guided coding — work one small unit at a time; explain it before Pi edits",
    ]);

    if (choice?.startsWith("Planning")) {
      pi.events.emit("plan:set-enabled", { enabled: true });
    } else if (choice?.startsWith("Guided coding")) {
      pi.events.emit("guided:set-enabled", { enabled: true });
    } else {
      // Cancel/default intentionally means the safer, tutoring-only mode.
      pi.events.emit("chat:set-enabled", { enabled: true });
    }
  });
}
