// server/eidolon/memory/compactor.js
// Hourly compaction; respects policy TTL days by simply deleting expired rows.

import { memoryCompact } from "./pg.js";

export function startMemoryCompactor(policy) {
  const run = async () => {
    try {
      await memoryCompact({ table: policy?.memory?.override_assistant?.table || "assistant_memory" });
      await memoryCompact({ table: policy?.memory?.eidolon?.tables?.memory || "eidolon_memory" });
      // snapshots are append-only; no compaction needed unless you add a TTL
      console.info("[memory] compaction complete");
    } catch (e) {
      console.error("[memory] compaction error:", e?.message || e);
    }
  };
  run(); // run at boot
  const hour = 60 * 60 * 1000;
  setInterval(run, hour);
}
