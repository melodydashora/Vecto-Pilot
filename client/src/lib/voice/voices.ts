// client/src/lib/voice/voices.ts
// 2026-08-14: Gemini Live prebuilt voices for the Coach. Lives in the Coach
// header (Melody: "put the voice selector in the heading of the ai chat
// window instead of preferences — the first two voices were slightly noisy
// and it will be difficult to keep going back and forth"). Device-level
// preference (localStorage COACH_VOICE_NAME); applied at session connect —
// changing it while live restarts the session so the new voice speaks now.
// An invalid name fails loudly at connect, never silently.

export const COACH_VOICE_OPTIONS = [
  { value: '', label: 'Default voice' },
  { value: 'Aoede', label: 'Aoede — warm, breezy' },
  { value: 'Kore', label: 'Kore — firm, neutral' },
  { value: 'Puck', label: 'Puck — upbeat' },
  { value: 'Charon', label: 'Charon — deep, informative' },
  { value: 'Leda', label: 'Leda — youthful' },
  { value: 'Orus', label: 'Orus — confident' },
  { value: 'Zephyr', label: 'Zephyr — bright' },
  { value: 'Fenrir', label: 'Fenrir — excitable' },
] as const;
