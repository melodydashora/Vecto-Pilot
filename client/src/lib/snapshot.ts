import { getIdentity } from "@/../../shared/identity";
import type { SnapshotV1 } from "@/../../shared/types/snapshot";
import type { Coord } from "@/../../shared/types/location";

export function createSnapshot({
  coord,
  resolved,
  timeContext,
  weather,
  air,
  user_id: providedUserId,
}: {
  coord: Coord;
  resolved: { city?: string | null; state?: string | null; country?: string | null; timezone?: string | null; formattedAddress?: string | null };
  timeContext: {
    local_iso: string;
    dow: number;
    hour: number;
    is_weekend: boolean;
    day_part_key: "overnight" | "morning" | "late_morning_noon" | "afternoon" | "early_evening" | "evening" | "late_evening";
  };
  weather?: { tempF?: number | null; conditions?: string | null; description?: string | null };
  air?: { aqi?: number | null; category?: string | null };
  user_id?: string | null;
}): SnapshotV1 {
  const identity = getIdentity();
  const snapshot_id = crypto.randomUUID();
  
  // CRITICAL: Use user_id from location/resolve if provided, otherwise fall back to identity
  // This ensures the snapshot references the same user record that has formattedAddress, timezone, etc.
  const effectiveUserId = providedUserId || identity.user_id;

  const ua = navigator.userAgent;
  let platform: "ios" | "android" | "web" | "desktop" = "web";
  if (/iPhone|iPad|iPod/i.test(ua)) platform = "ios";
  else if (/Android/i.test(ua)) platform = "android";
  else if (!/Mobile/i.test(ua)) platform = "desktop";

  let geoPermission: "granted" | "denied" | "prompt" | "unknown" = "unknown";
  if (navigator.permissions) {
    navigator.permissions.query({ name: "geolocation" }).then((result) => {
      geoPermission = result.state as "granted" | "denied" | "prompt";
    });
  }

  return {
    schema_version: 1,
    snapshot_id,
    user_id: effectiveUserId,
    device_id: identity.device_id,
    session_id: identity.session_id,
    created_at: new Date().toISOString(),
    coord,
    resolved,
    time_context: timeContext,
    weather,
    air,
    device: {
      ua,
      platform,
    },
    permissions: {
      geolocation: geoPermission,
    },
  };
}

/**
 * Persist snapshot to backend database
 * @param {SnapshotV1} snapshot - Snapshot to persist
 * @returns {Promise<{snapshot_id: string} | null>} Persisted snapshot ID or null on error
 */
export async function persistSnapshot(snapshot: SnapshotV1): Promise<{ snapshot_id: string } | null> {
  try {
    const response = await fetch("/api/location/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(snapshot),
    });
    
    console.log("📡 Snapshot response status:", response.status, response.ok);
    
    if (response.ok) {
      const data = await response.json();
      const snapshotId = data.snapshot_id || snapshot.snapshot_id;
      
      console.log("✅ Snapshot saved successfully! Dispatching event...", snapshotId);
      
      // Dispatch event to notify UI that snapshot is complete and ready
      window.dispatchEvent(
        new CustomEvent("vecto-snapshot-saved", {
          detail: {
            snapshotId,
            lat: snapshot.coord.lat,
            lng: snapshot.coord.lng,
          },
        })
      );
      console.log("🎉 Event 'vecto-snapshot-saved' dispatched!");
      
      return { snapshot_id: snapshotId };
    } else {
      console.warn("⚠️ Snapshot save response not OK:", response.status);
      return null;
    }
  } catch (err) {
    console.error("❌ Failed to persist snapshot:", err);
    return null;
  }
}
