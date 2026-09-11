// 2026-04-26 PHASE A: Singleton Google Maps JS API loader.
//
// Why: Each map component used to inject its own <script> tag, and MapTab's
// cleanup called document.head.removeChild(script) on unmount. When two maps
// co-existed (e.g., Strategy MapTab + the disabled TacticalStagingMap), one
// component's unmount yanked the shared script out from under the other,
// causing google.maps.* to vanish mid-call and producing the well-known
// `removeChild` errors. The fix is to load the script exactly once per page
// lifecycle, share the resulting Promise, and never remove the tag.

export type GoogleMapsLibrary =
  | 'core'
  | 'maps'
  | 'marker'
  | 'geometry'
  | 'places'
  | 'drawing'
  | 'visualization'
  | 'routes'
  | 'geocoding';

export interface LoadGoogleMapsOptions {
  libraries?: GoogleMapsLibrary[];
}

const DEFAULT_LIBRARIES: GoogleMapsLibrary[] = ['maps', 'marker', 'geometry'];

let loaderPromise: Promise<typeof google> | null = null;
const libraryPromises = new Map<GoogleMapsLibrary, Promise<void>>();
const readinessPromises = new Map<string, Promise<typeof google>>();

function isLibraryReady(api: typeof google, library: GoogleMapsLibrary): boolean {
  const maps = api.maps;
  switch (library) {
    case 'core': return typeof maps.LatLng === 'function';
    case 'maps': return typeof maps.Map === 'function';
    case 'marker': return typeof maps.marker?.AdvancedMarkerElement === 'function';
    case 'geometry': return typeof maps.geometry?.spherical?.computeDistanceBetween === 'function';
    case 'places': return typeof maps.places?.Place === 'function' || typeof maps.places?.PlacesService === 'function';
    case 'drawing': return typeof maps.drawing?.DrawingManager === 'function';
    case 'visualization': return typeof maps.visualization?.HeatmapLayer === 'function';
    case 'routes': return typeof maps.DirectionsService === 'function';
    case 'geocoding': return typeof maps.Geocoder === 'function';
  }
}

function ensureLibrary(api: typeof google, library: GoogleMapsLibrary): Promise<void> {
  if (isLibraryReady(api, library)) return Promise.resolve();
  const existing = libraryPromises.get(library);
  if (existing) return existing;

  const pending = Promise.resolve().then(async () => {
    if (typeof api.maps.importLibrary !== 'function') {
      throw new Error(`Google Maps ${library} library is missing and importLibrary is unavailable`);
    }
    await api.maps.importLibrary(library);
    // Consumers use qualified namespaces, so a resolved import alone is not
    // enough: in particular StrategyMap immediately uses AdvancedMarkerElement.
    if (!isLibraryReady(api, library)) {
      throw new Error(`Google Maps ${library} library did not expose its required API`);
    }
  }).catch((error: unknown) => {
    if (libraryPromises.get(library) === pending) libraryPromises.delete(library);
    throw error;
  });
  libraryPromises.set(library, pending);
  return pending;
}

function loadMapsScript(libraries: GoogleMapsLibrary[]): Promise<typeof google> {
  if (loaderPromise) return loaderPromise;

  if (typeof window !== 'undefined' && window.google?.maps) {
    loaderPromise = Promise.resolve(window.google);
    return loaderPromise;
  }

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not configured'));
  }

  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
  const pending = new Promise<typeof google>((resolve, reject) => {
    const callbackName = '__vectoGoogleMapsLoaded__';
    const callbacks = window as unknown as Record<string, (() => void) | undefined>;
    const clearCallback = () => {
      if (callbacks[callbackName] === onLoaded) delete callbacks[callbackName];
    };

    const onLoaded = () => {
      clearCallback();
      if (window.google?.maps) {
        resolve(window.google);
      } else {
        reject(new Error('Google Maps script ran but window.google.maps is missing'));
      }
    };
    callbacks[callbackName] = onLoaded;

    const params = new URLSearchParams({
      key: apiKey,
      libraries: libraries.join(','),
      loading: 'async',
      callback: callbackName,
      v: 'weekly',
    });
    if (mapId) params.set('map_ids', mapId);

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      clearCallback();
      reject(new Error('Google Maps script failed to load'));
    };

    // Note: intentionally no removal on unmount. Multiple consumers share
    // this script. Removal is what caused the original removeChild bug.
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    if (loaderPromise === pending) loaderPromise = null;
    throw error;
  });
  loaderPromise = pending;
  return loaderPromise;
}

export function loadGoogleMaps(options: LoadGoogleMapsOptions = {}): Promise<typeof google> {
  const libraries = [...new Set(options.libraries ?? DEFAULT_LIBRARIES)];
  const key = [...libraries].sort().join(',');
  const existing = readinessPromises.get(key);
  if (existing) return existing;

  // Script ownership is shared, but readiness belongs to each requested set.
  // A later marker consumer must not inherit an earlier maps-only result.
  const pending = loadMapsScript(libraries).then(async (api) => {
    await Promise.all(libraries.map((library) => ensureLibrary(api, library)));
    return api;
  }).catch((error: unknown) => {
    if (readinessPromises.get(key) === pending) readinessPromises.delete(key);
    throw error;
  });
  readinessPromises.set(key, pending);
  return pending;
}

export function getMapId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
}
