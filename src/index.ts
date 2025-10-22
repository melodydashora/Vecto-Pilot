import { init } from "@replit/extensions";
import { runAgent } from "./agent/core.js";

export async function activate() {
  const replit = await init();
  const panel = replit.createPanel({ title: "GPT-5 Agent", icon: "🧠" });
  panel.show();

  const mode = await replit.settings.get("serverMode");

  panel.onDidReceiveMessage(async (msg: any) => {
    if (msg.type === "prompt") {
      const ctx = { 
        panel, 
        replit, 
        fs: replit.fs, 
        terminal: replit.experimental.terminal, 
        repldb: replit.data, 
        settings: replit.settings 
      };
      await runAgent(msg.text, ctx, mode);
    }
  });
}

// Auto-activate
activate().catch(console.error);
