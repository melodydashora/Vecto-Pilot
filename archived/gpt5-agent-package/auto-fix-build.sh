
#!/bin/bash

echo "🔨 Building with auto-fix..."

# Try to build
npm run agent:build 2>&1 | tee /tmp/build-output.txt

# Check if build failed
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "⚠️ Build failed, checking for missing files..."
  
  # Parse errors for missing files
  grep "Cannot find module" /tmp/build-output.txt | while read -r line; do
    # Extract the missing file path
    missing=$(echo "$line" | grep -oP "Cannot find module '\K[^']+")
    
    if [ -n "$missing" ]; then
      echo "🔍 Looking for: $missing"
      
      # Find the file anywhere in the repo
      found=$(find . -name "$(basename $missing)" -type f | head -1)
      
      if [ -n "$found" ]; then
        # Get the target directory
        target_dir=$(dirname "$missing")
        
        echo "📋 Copying: $found → $missing"
        mkdir -p "$target_dir"
        cp "$found" "$missing"
      fi
    fi
  done
  
  # Try building again
  echo "🔄 Retrying build..."
  npm run agent:build
fi

echo "✅ Done!"
