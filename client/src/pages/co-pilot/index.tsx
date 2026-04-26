// client/src/pages/co-pilot/index.tsx
// Barrel export for all co-pilot pages

export { default as StrategyPage } from "./StrategyPage";
// 2026-01-09: Renamed from BarsPage for disambiguation
export { default as VenueManagerPage } from "./VenueManagerPage";
export { default as BriefingPage } from "./BriefingPage";
// 2026-04-26 PHASE B: MapPage removed — embedded inside StrategyPage now.
export { default as IntelPage } from "./IntelPage";
export { default as AboutPage } from "./AboutPage";
export { default as PolicyPage } from "./PolicyPage";
export { default as SettingsPage } from "./SettingsPage";
// 2026-03-16: Real-time rider translation for FIFA World Cup
export { default as TranslationPage } from "./TranslationPage";
