// tests/translation-prompt.test.js
// 2026-04-10: Tests for the 3-attempt translation response parser
import { parseTranslationResponse } from '../server/api/translate/translation-prompt.js';

describe('parseTranslationResponse', () => {
  it('parses valid JSON directly', () => {
    const input = '{"translatedText":"bonjour","detectedLang":"en","targetLang":"fr","confidence":95}';
    const result = parseTranslationResponse(input);
    expect(result.translatedText).toBe('bonjour');
    expect(result.confidence).toBe(95);
  });

  it('parses markdown-wrapped JSON', () => {
    const input = '```json\n{"translatedText":"hola","detectedLang":"en","targetLang":"es","confidence":90}\n```';
    const result = parseTranslationResponse(input);
    expect(result.translatedText).toBe('hola');
  });

  it('extracts JSON embedded in prose text', () => {
    const input = 'Here is the translation:\n{"translatedText":"ciao","detectedLang":"en","targetLang":"it","confidence":88}\nHope this helps!';
    const result = parseTranslationResponse(input);
    expect(result.translatedText).toBe('ciao');
  });

  it('throws on input with no JSON structure', () => {
    const input = 'This is just plain text with no JSON anywhere.';
    expect(() => parseTranslationResponse(input)).toThrow('Failed to parse translation response');
  });

  it('handles JSON with markdown link artifacts (attempt 3 aggressive cleanup)', () => {
    const input = '{"translatedText":"hello","detectedLang":"es","targetLang":"en","confidence":85,"note":"see (example.com)"}';
    const result = parseTranslationResponse(input);
    expect(result.translatedText).toBe('hello');
  });
});
