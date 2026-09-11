/// <reference types="google.maps" />
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Loader = typeof import('../../client/src/lib/maps/google-maps-loader');
type TestWindow = Window & {
  google?: typeof google;
  __vectoGoogleMapsLoaded__?: () => void;
};
const testWindow = window as unknown as TestWindow;
const testGlobals = globalThis as unknown as { __VITE_ENV__: Record<string, unknown> };

function installMaps(maps: Record<string, unknown>) {
  const api = { maps } as unknown as typeof google;
  testWindow.google = api;
  return api;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function readyMaps(): Record<string, unknown> {
  return {
    Map: class Map {},
    marker: { AdvancedMarkerElement: class AdvancedMarkerElement {} },
    geometry: { spherical: { computeDistanceBetween: () => 0 } },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('Google Maps requested-library readiness', () => {
  let loader: Loader;
  let scripts: HTMLScriptElement[];
  let previousEnv: Record<string, unknown>;

  beforeEach(async () => {
    jest.resetModules();
    delete testWindow.google;
    delete testWindow.__vectoGoogleMapsLoaded__;
    previousEnv = testGlobals.__VITE_ENV__;
    testGlobals.__VITE_ENV__ = {
      VITE_GOOGLE_MAPS_API_KEY: 'synthetic-loader-key',
      VITE_GOOGLE_MAPS_MAP_ID: 'synthetic-map-id',
    };
    scripts = [];
    // Capture every script instead of inserting it: no external resource runs.
    jest.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      scripts.push(node as unknown as HTMLScriptElement);
      return node;
    });
    loader = await import('../../client/src/lib/maps/google-maps-loader');
  });

  afterEach(() => {
    delete testWindow.google;
    delete testWindow.__vectoGoogleMapsLoaded__;
    testGlobals.__VITE_ENV__ = previousEnv;
    jest.restoreAllMocks();
  });

  it('does not resolve a cached partial namespace before the requested marker import finishes', async () => {
    const imported = deferred();
    const maps: Record<string, unknown> = { Map: class Map {} };
    maps.importLibrary = jest.fn((_library: string) => imported.promise);
    const api = installMaps(maps);
    let settled = false;
    const loading = loader.loadGoogleMaps({ libraries: ['maps', 'marker'] });
    void loading.then(() => { settled = true; });
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(maps.importLibrary).toHaveBeenCalledWith('marker');
    maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
    imported.resolve();
    await expect(loading).resolves.toBe(api);
    expect(scripts).toHaveLength(0);
  });

  it('does not treat the direct script callback as marker readiness', async () => {
    const imported = deferred();
    let settled = false;
    const loading = loader.loadGoogleMaps({ libraries: ['maps', 'marker'] });
    void loading.then(() => { settled = true; });
    expect(scripts).toHaveLength(1);
    const maps: Record<string, unknown> = {
      Map: class Map {},
      importLibrary: jest.fn((_library: string) => imported.promise),
    };
    const api = installMaps(maps);
    testWindow.__vectoGoogleMapsLoaded__!();
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(maps.importLibrary).toHaveBeenCalledWith('marker');
    maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
    imported.resolve();
    await expect(loading).resolves.toBe(api);
  });

  it('keeps the already-loaded fast path without a key, script, or unnecessary import', async () => {
    testGlobals.__VITE_ENV__ = {};
    const importLibrary = jest.fn(async () => ({}));
    const api = installMaps({ ...readyMaps(), importLibrary });
    await expect(loader.loadGoogleMaps()).resolves.toBe(api);
    expect(importLibrary).not.toHaveBeenCalled();
    expect(scripts).toHaveLength(0);
  });

  it('accepts a fully loaded direct-script namespace without importLibrary', async () => {
    const api = installMaps(readyMaps());
    await expect(loader.loadGoogleMaps()).resolves.toBe(api);
    expect(scripts).toHaveLength(0);
  });

  it('rejects missing marker capabilities honestly and allows a deliberate later retry', async () => {
    const maps: Record<string, unknown> = { Map: class Map {} };
    const api = installMaps(maps);
    await expect(loader.loadGoogleMaps({ libraries: ['maps', 'marker'] }))
      .rejects.toThrow('marker library is missing and importLibrary is unavailable');
    maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
    await expect(loader.loadGoogleMaps({ libraries: ['maps', 'marker'] })).resolves.toBe(api);
    expect(scripts).toHaveLength(0);
  });

  it('retries a rejected library import without injecting or removing the shared script', async () => {
    const maps: Record<string, unknown> = { Map: class Map {} };
    const importLibrary = jest.fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('synthetic marker failure'))
      .mockImplementationOnce(async () => {
        maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
        return maps.marker;
      });
    maps.importLibrary = importLibrary;
    const api = installMaps(maps);
    const remove = jest.spyOn(document.head, 'removeChild');
    await expect(loader.loadGoogleMaps({ libraries: ['marker'] })).rejects.toThrow('synthetic marker failure');
    await expect(loader.loadGoogleMaps({ libraries: ['marker'] })).resolves.toBe(api);
    expect(importLibrary).toHaveBeenCalledTimes(2);
    expect(scripts).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects a resolved import that still lacks AdvancedMarkerElement instead of caching success', async () => {
    const maps: Record<string, unknown> = { Map: class Map {}, marker: {} };
    const importLibrary = jest.fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({})
      .mockImplementationOnce(async () => {
        maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
        return maps.marker;
      });
    maps.importLibrary = importLibrary;
    const api = installMaps(maps);
    await expect(loader.loadGoogleMaps({ libraries: ['marker'] }))
      .rejects.toThrow('marker library did not expose its required API');
    await expect(loader.loadGoogleMaps({ libraries: ['marker'] })).resolves.toBe(api);
    expect(importLibrary).toHaveBeenCalledTimes(2);
  });

  it('shares one import for concurrent identical and overlapping requested library sets', async () => {
    const imported = deferred();
    const maps: Record<string, unknown> = { Map: class Map {} };
    const importLibrary = jest.fn((_library: string) => imported.promise);
    maps.importLibrary = importLibrary;
    const api = installMaps(maps);
    const first = loader.loadGoogleMaps({ libraries: ['maps', 'marker'] });
    const equivalent = loader.loadGoogleMaps({ libraries: ['marker', 'maps', 'marker'] });
    const overlapping = loader.loadGoogleMaps({ libraries: ['marker'] });
    expect(equivalent).toBe(first);
    await flushMicrotasks();
    expect(importLibrary).toHaveBeenCalledTimes(1);
    maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
    imported.resolve();
    await expect(Promise.all([first, equivalent, overlapping])).resolves.toEqual([api, api, api]);
    expect(scripts).toHaveLength(0);
  });

  it('does not let a later marker request inherit an earlier maps-only result', async () => {
    const imported = deferred();
    const maps: Record<string, unknown> = { Map: class Map {} };
    const importLibrary = jest.fn((_library: string) => imported.promise);
    maps.importLibrary = importLibrary;
    const api = installMaps(maps);
    await expect(loader.loadGoogleMaps({ libraries: ['maps'] })).resolves.toBe(api);
    expect(importLibrary).not.toHaveBeenCalled();
    let settled = false;
    const marker = loader.loadGoogleMaps({ libraries: ['marker'] });
    void marker.then(() => { settled = true; });
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(importLibrary).toHaveBeenCalledWith('marker');
    maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
    imported.resolve();
    await expect(marker).resolves.toBe(api);
  });

  it('shares the in-flight script while honoring libraries added by a second caller', async () => {
    const first = loader.loadGoogleMaps({ libraries: ['maps'] });
    const second = loader.loadGoogleMaps({ libraries: ['maps', 'marker'] });
    expect(scripts).toHaveLength(1);
    expect(new URL(scripts[0].src).searchParams.get('libraries')).toBe('maps');
    const maps: Record<string, unknown> = { Map: class Map {} };
    const importLibrary = jest.fn(async (library: string) => {
      expect(library).toBe('marker');
      maps.marker = { AdvancedMarkerElement: class AdvancedMarkerElement {} };
      return maps.marker;
    });
    maps.importLibrary = importLibrary;
    const api = installMaps(maps);
    testWindow.__vectoGoogleMapsLoaded__!();
    await expect(Promise.all([first, second])).resolves.toEqual([api, api]);
    expect(importLibrary).toHaveBeenCalledTimes(1);
    expect(scripts).toHaveLength(1);
  });

  it('waits for requested geometry and does not force unrequested marker loading', async () => {
    const imported = deferred();
    const maps: Record<string, unknown> = { Map: class Map {} };
    const importLibrary = jest.fn((_library: string) => imported.promise);
    maps.importLibrary = importLibrary;
    const api = installMaps(maps);
    let settled = false;
    const loading = loader.loadGoogleMaps({ libraries: ['geometry'] });
    void loading.then(() => { settled = true; });
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(importLibrary).toHaveBeenCalledTimes(1);
    expect(importLibrary).toHaveBeenCalledWith('geometry');
    maps.geometry = { spherical: { computeDistanceBetween: () => 0 } };
    imported.resolve();
    await expect(loading).resolves.toBe(api);
    expect(maps.marker).toBeUndefined();
  });

  it('preserves default script options and never removes a successfully shared script', async () => {
    const remove = jest.spyOn(document.head, 'removeChild');
    const first = loader.loadGoogleMaps();
    expect(loader.loadGoogleMaps()).toBe(first);
    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    const url = new URL(script.src);
    expect(url.origin).toBe('https://maps.googleapis.com');
    expect(url.searchParams.get('libraries')).toBe('maps,marker,geometry');
    expect(url.searchParams.get('loading')).toBe('async');
    expect(url.searchParams.get('v')).toBe('weekly');
    expect(url.searchParams.get('key')).toBe('synthetic-loader-key');
    expect(url.searchParams.get('map_ids')).toBe('synthetic-map-id');
    expect(script.async).toBe(true);
    expect(script.defer).toBe(true);
    expect(loader.getMapId()).toBe('synthetic-map-id');
    const api = installMaps(readyMaps());
    testWindow.__vectoGoogleMapsLoaded__!();
    await expect(first).resolves.toBe(api);
    await expect(loader.loadGoogleMaps()).resolves.toBe(api);
    expect(testWindow.__vectoGoogleMapsLoaded__).toBeUndefined();
    expect(scripts).toHaveLength(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('allows one new script after load failure and fences the old script error callback', async () => {
    const first = loader.loadGoogleMaps();
    const failed = expect(first).rejects.toThrow('Google Maps script failed to load');
    scripts[0].dispatchEvent(new Event('error'));
    await failed;
    expect(testWindow.__vectoGoogleMapsLoaded__).toBeUndefined();
    const second = loader.loadGoogleMaps();
    expect(scripts).toHaveLength(2);
    const currentCallback = testWindow.__vectoGoogleMapsLoaded__;
    scripts[0].dispatchEvent(new Event('error'));
    expect(testWindow.__vectoGoogleMapsLoaded__).toBe(currentCallback);
    const api = installMaps(readyMaps());
    currentCallback!();
    await expect(second).resolves.toBe(api);
    expect(loader.loadGoogleMaps()).toBe(second);
  });

  it('rejects a callback without maps and permits a deliberate script retry', async () => {
    const first = loader.loadGoogleMaps();
    const failed = expect(first).rejects.toThrow('window.google.maps is missing');
    testWindow.__vectoGoogleMapsLoaded__!();
    await failed;
    const second = loader.loadGoogleMaps();
    expect(scripts).toHaveLength(2);
    const api = installMaps(readyMaps());
    testWindow.__vectoGoogleMapsLoaded__!();
    await expect(second).resolves.toBe(api);
  });

  it('does not cache a missing-key rejection or inject a script until configured', async () => {
    testGlobals.__VITE_ENV__ = {};
    await expect(loader.loadGoogleMaps()).rejects.toThrow('VITE_GOOGLE_MAPS_API_KEY is not configured');
    expect(scripts).toHaveLength(0);
    testGlobals.__VITE_ENV__ = { VITE_GOOGLE_MAPS_API_KEY: 'synthetic-retry-key' };
    const retried = loader.loadGoogleMaps();
    expect(scripts).toHaveLength(1);
    expect(new URL(scripts[0].src).searchParams.has('map_ids')).toBe(false);
    const api = installMaps(readyMaps());
    testWindow.__vectoGoogleMapsLoaded__!();
    await expect(retried).resolves.toBe(api);
  });

  it('honors an explicit empty library list without substituting defaults', async () => {
    const importLibrary = jest.fn(async () => ({}));
    const api = installMaps({ importLibrary });
    await expect(loader.loadGoogleMaps({ libraries: [] })).resolves.toBe(api);
    expect(importLibrary).not.toHaveBeenCalled();
    expect(scripts).toHaveLength(0);
  });
});
