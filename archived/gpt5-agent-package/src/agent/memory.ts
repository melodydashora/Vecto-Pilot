export async function loadMemory(ctx: any) {
  return (await ctx.repldb.get("memory")) || [];
}

export async function saveMemory(ctx: any, note: string) {
  const m = (await loadMemory(ctx)) || [];
  m.push(note);
  await ctx.repldb.set("memory", m);
}
