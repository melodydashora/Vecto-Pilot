// tests/transformers/import-meta-env.cjs
// 2026-09-10 (VP-016): ts-jest AST transformer. Vite injects `import.meta.env` at build
// time; under Jest it is undefined and every client module that reads a VITE_* flag
// throws at import. This rewrites `import.meta.env` → `(globalThis.__VITE_ENV__ ?? {})`
// so tests/setup/vite-env.ts can supply the values. Source files stay Vite-only.
const ts = require('typescript');

function isImportMetaEnv(node) {
  return ts.isPropertyAccessExpression(node)
    && ts.isMetaProperty(node.expression)
    && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.name.text === 'env';
}

module.exports = {
  name: 'import-meta-env',
  version: 1,
  factory: () => (context) => (sourceFile) => {
    const visit = (node) => {
      if (isImportMetaEnv(node)) {
        const f = ts.factory;
        return f.createParenthesizedExpression(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(f.createIdentifier('globalThis'), f.createIdentifier('__VITE_ENV__')),
            ts.SyntaxKind.QuestionQuestionToken,
            f.createObjectLiteralExpression([], false),
          ),
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(sourceFile, visit);
  },
};
