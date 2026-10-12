# Retired Coach navigation link instructions

October 12, 2026 (UTC), Codex/Astra. Melody clarified that Coach's chat
recommendations need directions links rather than venue websites. This preserves
replaced instructions and rendering source from baseline
`380bdb619dfdea77be9b357f02e3ef62bc5a8e43`. Venue-card helpers are unchanged.

The current chat contract distinguishes driving Directions, optional requested
Website links and research Sources. Saved destination coordinates and place IDs
supply deterministic URLs; missing evidence does not justify an invented address.
This is source preservation, not a deployment or device navigation receipt.

## Prior chat prompt

Source: `server/api/chat/chat.js`, task pre-edit copy, lines 927–933. The search
action opens a map result rather than directions. The old citation restriction
also conflicted with the adapter's appended search-source links.

```text
- Do NOT list sources or citations at the end of your responses - just provide the information naturally

🗺️ **Navigation links (2026-08-14 — Melody request):**
- When you recommend a SPECIFIC venue, staging spot, or destination — or the driver asks for a link/directions — include the full street address AND a Google Maps link built deterministically from it:
  \`https://www.google.com/maps/search/?api=1&query=<URL-encoded address or "venue name, city">\`
- Example: \`https://www.google.com/maps/search/?api=1&query=1%20Cowboys%20Way%2C%20Frisco%2C%20TX\`
- Links render tappable in the chat (and voice mode surfaces them on screen while the voice says "the link's in the chat") — one link per recommended destination, never a bare "I'll send it" promise.
```

## Prior link renderer

Source: `client/src/utils/coach/linkify.tsx`. The replacement retains escaped text
and HTTP(S)-only links, supports Markdown link labels, and does not let a website
be labeled as directions.

```tsx
// client/src/utils/coach/linkify.tsx
// Minimal XSS-safe URL linkifier for chat transcript text. Deliberately not a
// markdown renderer: the thread renders plain text (whitespace-pre-wrap) and
// only https?:// URLs become anchors. Safe because React escapes text nodes
// and href only ever receives a regex-matched http(s) URL — no javascript:
// vector, no dangerouslySetInnerHTML.

import React from 'react';

// Capture group makes String.split alternate [text, url, text, url, ...].
const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;
// Trailing sentence punctuation that shouldn't be swallowed into the URL.
const TRAILING_PUNCT = /[.,;:!?)]+$/;

export function linkifyText(text: string): React.ReactNode[] {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part; // even indexes are plain text
    const trailing = part.match(TRAILING_PUNCT)?.[0] ?? '';
    const url = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <React.Fragment key={i}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 break-all text-blue-600 dark:text-blue-400"
        >
          {url}
        </a>
        {trailing}
      </React.Fragment>
    );
  });
}
```

