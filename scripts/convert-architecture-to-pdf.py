
import markdown
import os
import sys

# Configuration
INPUT_FILE = 'ARCHITECTURE.md'
OUTPUT_FILE = 'VectoPilot_Architecture.html'

# Enhanced CSS Styling (GitHub-like + Printer Friendly + Strikethrough support)
CSS = """
<style>
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        line-height: 1.6;
        color: #24292e;
        max-width: 1000px;
        margin: 0 auto;
        padding: 40px;
    }
    h1, h2, h3 { 
        border-bottom: 1px solid #eaecef; 
        padding-bottom: 0.3em;
        margin-top: 24px;
    }
    h1 { font-size: 2em; margin-bottom: 16px; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    
    /* Strikethrough support */
    del, s {
        text-decoration: line-through;
        color: #6a737d;
    }
    
    /* Code Blocks */
    pre {
        background-color: #f6f8fa;
        border-radius: 6px;
        padding: 16px;
        overflow: auto;
        font-size: 13px;
        line-height: 1.45;
        border: 1px solid #e1e4e8;
        margin: 16px 0;
    }
    code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
        background-color: rgba(27,31,35,0.05);
        padding: 0.2em 0.4em;
        border-radius: 3px;
        font-size: 85%;
    }
    pre code {
        background-color: transparent;
        padding: 0;
    }

    /* Tables */
    table {
        border-collapse: collapse;
        width: 100%;
        margin: 16px 0;
        display: table;
        overflow-x: auto;
    }
    th, td {
        border: 1px solid #dfe2e5;
        padding: 8px 13px;
        text-align: left;
    }
    tr:nth-child(2n) { background-color: #f6f8fa; }
    th { font-weight: 600; background-color: #f6f8fa; }

    /* Lists */
    ul, ol {
        padding-left: 2em;
    }
    li {
        margin: 0.25em 0;
    }

    /* Blockquotes */
    blockquote {
        border-left: 4px solid #dfe2e5;
        padding-left: 16px;
        margin-left: 0;
        color: #6a737d;
    }

    /* ASCII Art & Diagrams */
    .ascii-art, pre.diagram {
        font-family: monospace;
        white-space: pre;
        line-height: 1.2;
        overflow-x: auto;
        font-size: 11px;
    }

    /* Status badges */
    strong {
        font-weight: 600;
    }

    /* Print Specifics */
    @media print {
        body { 
            max-width: 100%; 
            padding: 20px;
        }
        pre { 
            white-space: pre-wrap; 
            word-wrap: break-word;
            page-break-inside: avoid;
        }
        a { 
            text-decoration: none; 
            color: black;
        }
        h1, h2, h3 { 
            page-break-after: avoid;
        }
        tr { 
            page-break-inside: avoid;
        }
        table {
            page-break-inside: auto;
        }
    }

    /* Table of Contents */
    .toc {
        background-color: #f6f8fa;
        border: 1px solid #e1e4e8;
        border-radius: 6px;
        padding: 16px;
        margin: 24px 0;
    }
    .toc ul {
        list-style: none;
        padding-left: 1em;
    }
</style>
"""

def convert_to_html():
    if not os.path.exists(INPUT_FILE):
        print(f"❌ Error: Could not find {INPUT_FILE}")
        print(f"   Make sure you're running this script from the project root directory.")
        sys.exit(1)

    print(f"📖 Reading {INPUT_FILE}...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        text = f.read()

    print("🔄 Converting Markdown to HTML...")
    # Convert Markdown to HTML with extensions for tables, code blocks, and strikethrough
    html_content = markdown.markdown(
        text, 
        extensions=['tables', 'fenced_code', 'toc', 'sane_lists', 'nl2br', 'codehilite']
    )

    # Wrap in full HTML structure
    full_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vecto Pilot™ - Architecture & Constraints Reference</title>
    {CSS}
</head>
<body>
    {html_content}
</body>
</html>
"""

    print(f"💾 Writing to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(full_html)
    
    print(f"\n✅ Successfully created {OUTPUT_FILE}")
    print("\n📄 To convert to PDF:")
    print("   1. Open VectoPilot_Architecture.html in your browser")
    print("   2. Press Ctrl+P (or Cmd+P on Mac)")
    print("   3. Set Destination to 'Save as PDF'")
    print("   4. (Optional) Adjust margins and uncheck 'Headers and footers'")
    print("   5. Click 'Save'\n")

if __name__ == "__main__":
    convert_to_html()
