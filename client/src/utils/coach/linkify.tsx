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
