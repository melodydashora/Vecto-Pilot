# Browser Translator retirement — 2026-09-13

Melody explicitly requested removal of the broken Translator tab during the codebase audit. Codex/Astra removed its client screen/navigation and the dedicated browser API: POST /api/translate and GET /api/translate/languages (server/api/translate/index.js). The gateway no longer mounts that router.

The independent Siri endpoint, POST /api/hooks/translate, remains. It still uses the shared translation prompt/parser, translationLimiter and UTIL_TRANSLATION role. No Siri shortcut identity or provider contract was changed. Coach speech recognition, live voice and TTS remain because they have separate active consumers.

Current browser callers were traced before removal. Historical plans/audits remain historical evidence; TRANSLATION.md is marked accordingly. No schema or data change was required.
