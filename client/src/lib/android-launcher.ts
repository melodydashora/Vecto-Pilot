// HTTP Shortcuts v4.6.0's public import model: version 91, compatibility 90.
// Its Importer accepts a JSON document directly as well as shortcuts.json in ZIP.
// Source/limits: docs/architecture/MOBILE_CONCIERGE_2026-09-11.md.
export function createAndroidLauncher(origin: string): string {
  const deployment = new URL(origin);
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(deployment.hostname);
  if (deployment.username || deployment.password || deployment.search || deployment.hash || deployment.pathname !== '/') {
    throw new Error('The launcher needs a deployment origin without account details.');
  }
  if (deployment.protocol !== 'https:' && !(localPreview && deployment.protocol === 'http:')) {
    throw new Error('The launcher needs HTTPS so precise location is available.');
  }

  return JSON.stringify({
    version: 91,
    compatibilityVersion: 90,
    categories: [{
      name: 'Vecto',
      // IDs are omitted intentionally: the importer assigns new IDs, preserving
      // existing shortcuts. No account token or driver identity is exported.
      shortcuts: [{
        name: 'Offer Analyzer',
        description: 'Open Offer Analyzer, choose a current offer screenshot, and hear the verified decision.',
        executionType: 'browser',
        url: `${deployment.origin}/co-pilot/analyze`,
        launcherShortcut: true,
        quickSettingsTileShortcut: true,
        excludeFromHistory: true,
      }],
    }],
    variables: [],
  }, null, 2);
}
