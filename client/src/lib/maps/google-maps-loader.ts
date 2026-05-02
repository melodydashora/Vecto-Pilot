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

export function loadGoogleMaps(options: LoadGoogleMapsOptions = {}): Promise<typeof google> {
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
  const libraries = options.libraries ?? DEFAULT_LIBRARIES;

  loaderPromise = new Promise<typeof google>((resolve, reject) => {
    const callbackName = '__vectoGoogleMapsLoaded__';

    (window as unknown as Record<string, () => void>)[callbackName] = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (window.google?.maps) {
        resolve(window.google);
      } else {
        loaderPromise = null;
        reject(new Error('Google Maps script ran but window.google.maps is missing'));
      }
    };

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
      delete (window as unknown as Record<string, unknown>)[callbackName];
      loaderPromise = null;
      reject(new Error('Google Maps script failed to load'));
    };

    // Note: intentionally no removal on unmount. Multiple consumers share
    // this script. Removal is what caused the original removeChild bug.
    document.head.appendChild(script);
  });

  return loaderPromise;
}

export function getMapId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
}
