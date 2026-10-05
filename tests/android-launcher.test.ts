import { describe, expect, test } from '@jest/globals';
import { createAndroidLauncher } from '../client/src/lib/android-launcher';

describe('HTTP Shortcuts Android launcher export', () => {
  test('uses the pinned import model and routes into the guarded browser capture flow', () => {
    const exported = JSON.parse(createAndroidLauncher('https://driver.example.test'));
    expect(exported.version).toBe(91);
    expect(exported.compatibilityVersion).toBe(90);
    const shortcut = exported.categories[0].shortcuts[0];
    expect(shortcut.name).toBe('Offer Analyzer');
    expect(shortcut.executionType).toBe('browser');
    expect(shortcut.url).toBe('https://driver.example.test/co-pilot/analyze');
    expect(shortcut.launcherShortcut).toBe(true);
    expect(shortcut.quickSettingsTileShortcut).toBe(true);
    expect(shortcut.id).toBeUndefined();
    expect(exported.categories[0].id).toBeUndefined();
    expect(exported.variables).toEqual([]);
    expect(shortcut.headers).toBeUndefined();
    expect(shortcut.codeOnPrepare).toBeUndefined();
    expect(shortcut.codeOnSuccess).toBeUndefined();
  });

  test.each([
    'https://driver.example.test/?token=PRIVATE',
    'https://driver.example.test/#PRIVATE',
    'https://PRIVATE@driver.example.test',
    'https://driver.example.test/PRIVATE',
    'http://driver.example.test',
    'javascript:alert(1)',
  ])('rejects account-bearing or insecure deployment input %s', origin => {
    expect(() => createAndroidLauncher(origin)).toThrow();
  });

  test('preserves a loopback preview port without redirecting to production', () => {
    const exported = JSON.parse(createAndroidLauncher('http://127.0.0.1:5264'));
    expect(exported.categories[0].shortcuts[0].url).toBe('http://127.0.0.1:5264/co-pilot/analyze');
  });
});
