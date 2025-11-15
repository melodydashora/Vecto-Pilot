
#!/bin/bash
set -e

echo "🔨 Building GPT-5 Agent Package..."

# Clean previous build
rm -rf dist
mkdir -p dist

# Compile TypeScript
echo "📦 Compiling TypeScript..."
tsc -p tsconfig.agent.json

# Copy HTML and other assets
echo "📋 Copying assets..."
if [ -f "src/panel.html" ]; then
  cp src/panel.html dist/panel.html
fi

# Copy extension manifest
if [ -f "extension.json" ]; then
  cp extension.json dist/extension.json
fi

echo "✅ Build complete!"
echo "📂 Output: dist/"
ls -lh dist/
