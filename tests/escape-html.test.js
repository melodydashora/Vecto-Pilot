// tests/escape-html.test.js
// 2026-04-10: Tests for XSS prevention in ConciergeMap InfoWindow
// escapeHtml is an inline function in ConciergeMap.tsx — copied here for unit testing
import { describe, it, expect } from '@jest/globals';

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

describe('escapeHtml (XSS prevention)', () => {
  it('escapes < and > characters', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes & character', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe("it&#039;s");
  });

  it('prevents script injection', () => {
    const input = '<script>alert("xss")</script>';
    const result = escapeHtml(input);
    expect(result).not.toContain('<script>');
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('prevents event handler injection', () => {
    const input = '<img src=x onerror="fetch(\'http://evil.com\')">';
    const result = escapeHtml(input);
    // The < and > are escaped so the browser won't parse it as an HTML tag
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
    // Quotes are escaped so even if parsed, attribute values are broken
    expect(result).toContain('&quot;');
  });

  it('passes normal text through unchanged', () => {
    const input = 'Hilton Dallas/Plano Granite Park';
    expect(escapeHtml(input)).toBe(input);
  });

  it('passes numbers and normal punctuation through', () => {
    const input = 'Rating: 4.5 stars, 200+ reviews!';
    expect(escapeHtml(input)).toBe(input);
  });
});
