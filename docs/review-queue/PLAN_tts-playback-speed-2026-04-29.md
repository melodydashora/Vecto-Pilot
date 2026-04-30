# PLAN — TTS Playback Speed (1.0× / 1.25× / 1.5× / 2.0×)

**Date:** 2026-04-29
**Author:** Claude Opus 4.7 (1M context)
**Status:** DRAFT — awaiting Melody approval

---

## Objective

User-controllable read-aloud speed for the Coach voice (Rideshare Coach surfaces). Default 1.0×, with 1.25 / 1.5 / 2.0× chips. Persisted per-device via the existing `useCoachAudioState` localStorage pattern.

## Approach: client-side `audio.playbackRate`

Server-side OpenAI TTS supports a `speed` parameter, but client-side `playbackRate` is the better fit:

| Property | Client-side `playbackRate` (chosen) | Server-side OpenAI `speed` (rejected) |
|---|---|---|
| Quality at 1.5× | Browser timestretch preserves pitch cleanly | Model-level baked-in (also clean) |
| Per-user customization | Free — change at any time, no API call | Costs an extra TTS API call to regenerate audio |
| Mid-playback change | Instant | Requires re-fetching |
| Cost | Zero | Linear in re-generations |
| Match to existing pattern | Yes — slots into `useCoachAudioState` | No — would require new server-side toggle plumbing |

## Files affected (4)

| File | Change |
|---|---|
| `client/src/hooks/coach/useCoachAudioState.ts` | Add `playbackSpeed: 1.0 \| 1.25 \| 1.5 \| 2.0` state; localStorage key `'coach.playbackSpeed'`; idempotent migration (default 1.0 if unset/invalid) — same pattern as the existing `readAloudEnabled` migration |
| `client/src/hooks/coach/useStreamingReadAloud.ts` | When dequeueing each audio chunk and calling `audio.play()`, set `audio.playbackRate = playbackSpeed` first. Sentence-chunked TTS means this applies per chunk; mid-playback speed changes take effect on the next chunk (acceptable — chunks are short) |
| `client/src/hooks/useTTS.ts` | Same one-liner for non-coach TTS surfaces (e.g., translation overlay, quick phrases) |
| `client/src/components/RideshareCoach.tsx` | Add speed-selector chip group near the read-aloud toggle. 4 chips: `1×` (default), `1.25×`, `1.5×`, `2×`. Active chip styled per existing chip pattern |

## UI sketch

```
[ Read aloud: ON ]   [ 1× ] [1.25×] [ 1.5× ] [ 2× ]
                                     ^^^^^^
                                     active
```

The speed selector is enabled only when read-aloud is ON (greyed out when read-aloud is OFF, since speed has no effect with audio disabled). Selection persists across reload.

## Test plan (Melody to verify)

| # | Test | Expected |
|---|---|---|
| 1 | Open Coach, toggle read-aloud ON | Speed chips appear, 1× selected by default |
| 2 | Send a chat message that triggers a coach response | Audio plays at 1× speed |
| 3 | Click 1.5× chip | Chip becomes active |
| 4 | Send next chat message | Audio plays at 1.5× speed (audibly faster, pitch preserved) |
| 5 | Mid-playback, click 2× | Current chunk continues at previous speed; next chunk plays at 2× |
| 6 | Reload page | 2× chip is still selected (localStorage persistence) |
| 7 | Toggle read-aloud OFF | Speed chips become disabled/greyed |
| 8 | Toggle read-aloud back ON | Last-selected speed (2×) re-applies |
| 9 | Verify 2× quality | Speech remains intelligible without obvious distortion |
| 10 | Verify non-coach TTS surfaces | Translation overlay / quick phrases also respect the speed setting |

## Risks

- **Pitch drift at 2×** — modern browsers handle 2× cleanly for speech via timestretch, but this is OS/browser-dependent. If a user reports distortion at 2×, we have the option to add server-side `speed: 2` as a fallback for that tier specifically. Not implementing it preemptively to avoid speculative complexity.
- **Mid-playback speed change perception** — user might expect speed change to take effect within the currently-playing chunk. Sentence-chunked TTS makes that hard; the chunk boundary is the natural commit point. Acceptable.
- **Default-1× regression** — must verify the default-1× path still plays normally and that there's no unintended speedup. Test #1-2 cover this.

## Out of scope

- Continuous speed slider (e.g., 1.0–3.0 step 0.05) — fixed-chip choice is cleaner UX for in-car use
- Server-side `speed` parameter — held as a fallback option if browser quality is inadequate at 2×
- Voice selection (alloy / echo / fable / etc.) — separate feature, not bundled
