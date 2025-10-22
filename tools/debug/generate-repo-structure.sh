
#!/bin/bash

# Generate comprehensive repository structure
echo "🌳 Generating repository structure..."

# Output file
OUTPUT_FILE="repo-structure.txt"

# Create header with timestamp
echo "Repository Structure - $(date)" > "$OUTPUT_FILE"
echo "===========================================" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Generate tree structure with various options
echo "📁 Complete Directory Tree:" >> "$OUTPUT_FILE"
echo "----------------------------" >> "$OUTPUT_FILE"
tree -a -I '.git|node_modules|.next|dist|build|coverage|.nyc_output|*.log' >> "$OUTPUT_FILE" 2>/dev/null || {
    echo "tree command not available, using find as fallback..." >> "$OUTPUT_FILE"
    find . -type d -name '.git' -prune -o -name 'node_modules' -prune -o -name 'dist' -prune -o -name 'build' -prune -o -print | sort >> "$OUTPUT_FILE"
}

echo "" >> "$OUTPUT_FILE"
echo "📊 File Count Summary:" >> "$OUTPUT_FILE"
echo "----------------------" >> "$OUTPUT_FILE"
echo "Total files: $(find . -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './dist/*' -not -path './build/*' | wc -l)" >> "$OUTPUT_FILE"
echo "Total directories: $(find . -type d -not -path './.git/*' -not -path './node_modules/*' -not -path './dist/*' -not -path './build/*' | wc -l)" >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "📄 File Types Distribution:" >> "$OUTPUT_FILE"
echo "---------------------------" >> "$OUTPUT_FILE"
find . -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './dist/*' -not -path './build/*' | sed 's/.*\.//' | sort | uniq -c | sort -nr | head -20 >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "📂 Large Directories (by file count):" >> "$OUTPUT_FILE"
echo "--------------------------------------" >> "$OUTPUT_FILE"
for dir in $(find . -type d -not -path './.git/*' -not -path './node_modules/*' | head -20); do
    count=$(find "$dir" -maxdepth 1 -type f | wc -l)
    if [ "$count" -gt 0 ]; then
        echo "$count files in $dir" >> "$OUTPUT_FILE"
    fi
done | sort -nr | head -10 >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "🔍 Key Configuration Files:" >> "$OUTPUT_FILE"
echo "---------------------------" >> "$OUTPUT_FILE"
find . -maxdepth 3 -name "*.json" -o -name "*.config.*" -o -name ".*rc" -o -name "Dockerfile*" -o -name "*.env*" -o -name "*.md" | grep -v node_modules | sort >> "$OUTPUT_FILE"

echo "✅ Repository structure saved to: $OUTPUT_FILE"
echo "📊 Summary:"
echo "   - Complete directory tree"
echo "   - File count statistics" 
echo "   - File type distribution"
echo "   - Large directories analysis"
echo "   - Key configuration files"

# Also display a quick preview
echo ""
echo "🔍 Quick Preview (first 50 lines):"
head -50 "$OUTPUT_FILE"
