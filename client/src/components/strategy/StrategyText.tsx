import React from 'react';

/** Render advice as text, preserving its line breaks and simple bold emphasis. */
export function StrategyText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-line break-words ${className}`}>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
          : <React.Fragment key={index}>{part}</React.Fragment>
      )}
    </p>
  );
}
