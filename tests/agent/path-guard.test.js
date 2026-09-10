// tests/agent/path-guard.test.js
// 2026-09-10: security finding [7] — `/agent/memory/../shell` skipped the IP allowlist via the
// raw-prefix memory exemption and was normalized upstream into /agent/shell.

import { describe, it, expect } from '@jest/globals';
import { hasDotSegments } from '../../server/agent/path-guard.js';

describe('hasDotSegments', () => {
  it('flags raw and percent-encoded dot segments anywhere in the URL', () => {
    for (const u of ['/memory/../shell', '/memory/%2e%2e/shell', '/memory/%2E%2E/shell', '/memory/..', '/a/..?x=1', '/..', '/memory/%2e./x']) {
      expect(hasDotSegments(u)).toBe(true);
    }
  });
  it('accepts ordinary agent paths', () => {
    for (const u of ['/memory/list', '/memory', '/shell', '/fs/read?path=README.md', '/memory/conversations?limit=5', '/a.b/c..d']) {
      expect(hasDotSegments(u)).toBe(false);
    }
  });
  it('treats undecodable or non-string input as unsafe', () => {
    expect(hasDotSegments('/memory/%E0%A4%A')).toBe(true);
    expect(hasDotSegments(undefined)).toBe(true);
  });
});
