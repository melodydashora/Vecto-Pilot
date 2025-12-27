
/// <reference types="vite/client" />

declare global {
  interface Window {
    google: typeof google;
  }
}

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY: string;
  readonly VITE_UBER_CLIENT_ID: string;
  // REMOVED: VITE_UBER_CLIENT_SECRET - secrets must stay on server
  readonly VITE_UBER_REDIRECT_URI: string;
  readonly VITE_LYFT_CLIENT_ID: string;
  // REMOVED: VITE_LYFT_CLIENT_SECRET - secrets must stay on server
  readonly VITE_BOLT_CLIENT_ID: string;
  // REMOVED: VITE_BOLT_CLIENT_SECRET - secrets must stay on server
  readonly VITE_SHOW_IDENTITY_STRIPS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
