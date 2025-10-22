import { OpenAI } from "openai";
import { handleAction } from "./actions.js";
import { loadMemory, saveMemory } from "./memory.js";

const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function runAgent(prompt: string, ctx: any, mode: string) {
  const memory = await loadMemory(ctx);
  let thoughts = "";
  let step = 0;

  while (step < 5) {
    const completion = await api.chat.completions.create({
      model: "gpt-5",
      temperature: 0.7,
      messages: [
        { role: "system", content: `You are GPT-5 acting as an autonomous Replit Agent. 
Server mode: ${mode}. You can plan, execute, and verify actions.
Return JSON when acting.` },
        ...memory.map(m => ({ role: "system", content: m })),
        { role: "assistant", content: thoughts },
        { role: "user", content: prompt }
      ]
    });

    const reply = completion.choices[0].message?.content?.trim() || "";
    ctx.panel.postMessage({ type: "response", text: reply });

    try {
      const action = JSON.parse(reply);
      const result = await handleAction(action, ctx);
      thoughts += `\nAction ${step + 1} result:\n${result}`;
      await saveMemory(ctx, `Action: ${action.action} → ${result}`);
      if (action.action === "finish") break;
    } catch {
      thoughts += `\n${reply}`;
    }

    step++;
  }
}
