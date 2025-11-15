export async function handleAction(action: any, ctx: any) {
  switch (action.action) {
    case "edit_file":
      await ctx.fs.write(action.path, action.content);
      return `Edited ${action.path}`;
    case "append_file":
      const existing = await ctx.fs.read(action.path);
      await ctx.fs.write(action.path, existing + "\n" + action.content);
      return `Appended to ${action.path}`;
    case "run_command":
      const term = await ctx.terminal.create();
      term.run(action.command);
      return `Executed ${action.command}`;
    case "remember":
      const mem = (await ctx.repldb.get("memory")) || [];
      mem.push(action.note);
      await ctx.repldb.set("memory", mem);
      return `Stored note: ${action.note}`;
    case "call_mode":
      const res = await fetch(`http://localhost:5000/${action.mode}`, {
        method: "POST",
        body: JSON.stringify(action.payload)
      });
      return await res.text();
    case "finish":
      return "Task completed";
    default:
      return `Unknown action: ${action.action}`;
  }
}
