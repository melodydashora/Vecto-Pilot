// tests/setup/vite-env.ts — values `import.meta.env` resolves to under Jest
// (see tests/transformers/import-meta-env.cjs). Keep this to what tests need;
// a flag missing here reads as undefined, exactly as an unset VITE_* does in Vite.
(globalThis as any).__VITE_ENV__ = {
  MODE: 'test',
  DEV: false,
  PROD: false,
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_'))),
};

// 2026-09-15: jsdom does not define TextEncoder/TextDecoder; react-router's init needs them.
import { TextEncoder, TextDecoder } from 'node:util';
const g = globalThis as any;
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = TextEncoder;
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = TextDecoder;
