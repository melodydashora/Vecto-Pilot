import type { UUID } from "./ids";
import type { Coord } from "./location";

export type SnapshotV1 = {
  schema_version: 1;
  snapshot_id: UUID;
  user_id: UUID | null;
  device_id: UUID;
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
    day_part_key: "overnight" | "morning" | "late_morning_noon" | "afternoon" | "early_evening" | "evening" | "late_evening";
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
