import type { UUID } from "./ids";

export type ActionV1 = {
  schema_version: 1;
  action_id: UUID;
  ranking_id: UUID;
  snapshot_id: UUID;
  user_id: UUID | null;
  created_at: string;
  action: "block_click" | "navigate_to_block" | "dismiss" | "start_shift" | "end_shift";
  block_id?: string;
  dwell_ms?: number;
  from_rank?: number;
};
