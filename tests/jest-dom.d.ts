// 2026-09-10: the client suites import `expect` from '@jest/globals' (repo pattern), so the
// jest-dom matcher types must be registered against @jest/expect — the plain
// '@testing-library/jest-dom' types only augment the legacy global `jest` namespace.
import '@testing-library/jest-dom/jest-globals';
