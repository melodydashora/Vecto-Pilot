import { init, messages, fs, data } from "@replit/extensions";
import { runAgent } from "./agent/core.js";

export async function activate() {
  try {
    await init();
    
    console.log("GPT-5 Agent initialized");
    messages.showNotice("GPT-5 Agent loaded successfully");
    
    // Context object compatible with our agent code
    const ctx = {
      panel: {
        postMessage: (msg: any) => {
          console.log("Agent response:", msg);
          if (msg.type === "response") {
            messages.showNotice(msg.text);
          }
        }
      },
      fs: {
        read: async (path: string) => {
          const content = await fs.readFile(path);
          return content;
        },
        write: async (path: string, content: string) => {
          await fs.writeFile(path, content);
        }
      },
      terminal: {
        create: async () => ({
          run: async (cmd: string) => {
            console.log("Terminal command:", cmd);
            return { stdout: "", stderr: "" };
          }
        })
      },
      repldb: data,
      settings: {
        get: async (key: string) => "dev"
      }
    };
    
    console.log("GPT-5 Agent ready - context configured");
    
  } catch (error) {
    console.error("Agent initialization failed:", error);
  }
}

activate().catch(console.error);
