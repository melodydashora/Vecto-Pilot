import type { UUID } from "./ids";
import type { Coord } from "./location";

export type Block = {
  block_id: string;
  name: string;
  coord: Coord;
  driveTimeMinutes: number | null;
  straightLineKm: number | null;
  estEarningsPerRide: number | null;
  features?: Record<string, number | string | boolean>;
};

export type RankingV1 = {
  schema_version: 1;
  ranking_id: UUID;
  snapshot_id: UUID;
  user_id: UUID | null;
  created_at: string;
  city: string | null;
  candidate_blocks: Array<{
    block: Block;
    rank: number;
    model_score: number;
    model_name: string;
    exploration: {
      policy: "none" | "epsilon_greedy" | "thompson" | "ucb";
      epsilon?: number;
      was_forced?: boolean;
      propensity?: number;
    };
  }>;
  ui: {
    maxDistance: number;
  };
};
