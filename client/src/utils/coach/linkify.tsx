// client/src/utils/coach/linkify.tsx
// Chat supports HTTP(S) links and their optional Markdown labels. Other markup
// remains escaped text. A website cannot acquire a Directions label.

import React from 'react';
import { navigationLinkKind } from '@shared/navigation-links.js';

const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s<>"')\]]+)\)|(https?:\/\/[^\s<>"')\]]+)/g;
// Trailing sentence punctuation that shouldn't be swallowed into the URL.
const TRAILING_PUNCT = /[.,;:!?)]+$/;
const NAVIGATION_LABEL = /^(?:get\s+)?(?:directions?|navigation|navigate|driving|drive|route)(?:\s|$)/i;

export function linkifyText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const rawUrl = match[2] ?? match[3];
    const trailing = match[2] ? '' : rawUrl.match(TRAILING_PUNCT)?.[0] ?? '';
    const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    const kind = navigationLinkKind(url);
    let preceding = text.slice(cursor, match.index);
    // Correct an old plain-text "Navigate: <website>" without inventing a route.
    if (kind !== 'directions') preceding = preceding.replace(
      /\b(?:Directions?|Navigation|Navigate)(?:\s+link)?\s*:\s*$/i,
      kind === 'map' ? 'Map: ' : 'Website: ',
    );
    parts.push(preceding);
    const suppliedLabel = match[1]?.trim();
    const label = kind === 'directions' ? (suppliedLabel && !NAVIGATION_LABEL.test(suppliedLabel)
      ? `Directions — ${suppliedLabel}` : suppliedLabel || 'Directions')
      : suppliedLabel && NAVIGATION_LABEL.test(suppliedLabel)
        ? kind === 'map' ? 'Map' : 'Website'
        : suppliedLabel || url;
    parts.push(
      <React.Fragment key={match.index}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 break-all text-blue-600 dark:text-blue-400"
        >
          {label}
        </a>
        {trailing}
      </React.Fragment>
    );
    cursor = match.index! + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}
