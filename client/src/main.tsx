import { createRoot } from 'react-dom/client'
import App from './App'
import { COACH_STREAMING_TTS_ENABLED } from './constants/featureFlags';
import './index.css'

// 2026-04-27: Boot diagnostic — visible at top of console on every reload so we
// can verify which bundle is loaded and which feature flags are baked in without
// digging through DevTools Network. Add new feature flags to the `flags` argument
// as they land; keep this to ONE console.log call so it stays at the top of the
// log and isn't lost in routing/auth/SSE noise.
console.log(
  '%c[VectoPilot Boot]%c bundle=%s mode=%s flags=%o',
  'color:#3b82f6;font-weight:bold',
  'color:inherit',
  new URL(import.meta.url).pathname.split('/').pop() ?? '(unknown)',
  import.meta.env.MODE,
  {
    COACH_STREAMING_TTS: COACH_STREAMING_TTS_ENABLED,
    COACH_STREAMING_TTS_envRaw: import.meta.env.VITE_COACH_STREAMING_TTS ?? '(unset)',
  },
);

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(<App />);