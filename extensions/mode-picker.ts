import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function modePicker(pi: ExtensionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    // A CLI-selected mode is useful for automation and should not be replaced
    // by a prompt. The picker is for normal interactive starts only.
    if (event.reason !== "startup" || ctx.mode !== "tui") return;
    if (pi.getFlag("guided")) return;

    const choice = await ctx.ui.select("Choose a PiFriction mode", [
      "Chat — ask questions; Pi cannot inspect files unless you @mention one, run commands, or edit",
      "Guided coding — work one small unit at a time; explain it before Pi edits",
    ]);

    if (choice?.startsWith("Guided coding")) {
      pi.events.emit("guided:set-enabled", { enabled: true });
    } else {
      // Cancel/default intentionally means the safer, tutoring-only mode.
      pi.events.emit("chat:set-enabled", { enabled: true });
    }
  });
}
