/**
 * Prettier Configuration
 * @see https://prettier.io/docs/en/configuration.html
 *
 * This configuration ensures consistent code formatting across the entire
 * Vecto Pilot codebase for both client (React/TypeScript) and server (Node.js).
 */

export default {
  // Line width before wrapping
  printWidth: 100,

  // Use 2 spaces for indentation (matches ESLint and EditorConfig)
  tabWidth: 2,
  useTabs: false,

  // Use single quotes for strings (JavaScript convention)
  singleQuote: true,

  // Use single quotes in JSX attributes
  jsxSingleQuote: true,

  // Add trailing commas for cleaner git diffs
  trailingComma: 'es5',

  // Add semicolons at the end of statements
  semi: true,

  // Add spaces inside object braces: { foo: bar }
  bracketSpacing: true,

  // Put the closing bracket of JSX on its own line
  bracketSameLine: false,

  // Arrow functions with single parameters always have parentheses
  arrowParens: 'always',

  // Unix line endings (LF)
  endOfLine: 'lf',

  // Only quote object properties when necessary
  quoteProps: 'as-needed',

  // Don't format embedded code in template literals
  embeddedLanguageFormatting: 'off',

  // Preserve prose wrapping in markdown
  proseWrap: 'preserve',

  // HTML whitespace sensitivity
  htmlWhitespaceSensitivity: 'css',

  // Enforce single attribute per line in HTML/JSX when multiple attributes
  singleAttributePerLine: false,
};
