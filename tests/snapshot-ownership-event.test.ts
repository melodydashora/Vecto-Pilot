/**
 * Test: Snapshot Ownership Error Event Flow
 *
 * Verifies that when a snapshot-ownership-error event is dispatched,
 * the location context listener responds correctly.
 */

import { describe, it, expect } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// 2026-09-10: this suite runs under ts-jest ESM (jest.client.config.js); CommonJS __dirname
// does not exist there, so derive it from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Snapshot Ownership Error Event', () => {
  it('should have event listener registered in location-context-clean.tsx', async () => {
    // This is a code verification test - checks the event flow exists
    const fs = await import('fs');
    const path = await import('path');

    const locationContextPath = path.join(__dirname, '../client/src/contexts/location-context-clean.tsx');
    const content = fs.readFileSync(locationContextPath, 'utf-8');

    // Verify event listener exists
    expect(content).toContain("window.addEventListener('snapshot-ownership-error'");
    expect(content).toContain('handleOwnershipError');
    // 2026-09-10: the handler calls refreshGPS through a ref (refreshGPSRef.current) since the
    // 2026-01-07 infinite-loop fix; assert the call shape, not the January literal.
    expect(content).toMatch(/refreshGPS(Ref\.current)?\??\.?\s*\(/);
  });

  it('should have event dispatcher in useBriefingQueries.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const briefingQueriesPath = path.join(__dirname, '../client/src/hooks/useBriefingQueries.ts');
    const content = fs.readFileSync(briefingQueriesPath, 'utf-8');

    // Verify event dispatcher exists
    expect(content).toContain("window.dispatchEvent(new CustomEvent('snapshot-ownership-error'))");
  });

  it('should dispatch event on 404 response', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const briefingQueriesPath = path.join(__dirname, '../client/src/hooks/useBriefingQueries.ts');
    const content = fs.readFileSync(briefingQueriesPath, 'utf-8');

    // Verify 404 triggers the dispatch
    expect(content).toContain('response.status === 404');
    expect(content).toMatch(/dispatchSnapshotOwnershipError\s*\(/); // call form drifted since January
  });
});
