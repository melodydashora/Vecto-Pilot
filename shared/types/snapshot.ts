import type { UUID } from "./ids.js";
import type { Coord } from "./location.js";

export type SnapshotV1 = {
  schema_version: 1;
  snapshot_id: UUID;
  user_id: UUID | null;
  session_id: UUID;
  created_at: string;
  coord: Coord;
  resolved: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
    timezone?: string | null;
    formattedAddress?: string | null;  // Full street address from Google Geocoding
  };
  time_context: {
    local_iso: string;
    dow: number;
    hour: number;
    is_weekend: boolean;
    // Canonical taxonomy from shared/dayparts.js (2026-07-06 rename).
    // Legacy stored rows may still contain late_morning_noon/afternoon —
    // normalize on read via normalizeDayPartKey().
    day_part_key: "overnight" | "morning" | "early_afternoon" | "late_afternoon" | "early_evening" | "evening";
  };
  weather?: Record<string, any>;
  air?: Record<string, any>;
  device: {
    ua?: string | null;
    platform?: "ios" | "android" | "web" | "desktop";
  };
  permissions: {
    geolocation: "granted" | "denied" | "prompt" | "unknown";
  };
  extras?: Record<string, unknown>;
};
