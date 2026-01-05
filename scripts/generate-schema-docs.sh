#!/bin/bash
# Generate comprehensive database schema documentation in Markdown format
# Usage: ./scripts/generate-schema-docs.sh [output_file]
# Example: ./scripts/generate-schema-docs.sh docs/DATABASE_SCHEMA.md

set -e

OUTPUT_FILE="${1:-docs/DATABASE_SCHEMA.md}"
TEMP_FILE="/tmp/schema_data_$$.tsv"

# Fetch schema data
psql "$DATABASE_URL" -t -A -F$'\t' << 'SQL' > "$TEMP_FILE"
SELECT
    t.table_name,
    c.column_name,
    c.ordinal_position,
    c.data_type,
    c.udt_name,
    COALESCE(c.character_maximum_length::text, '') as max_length,
    c.is_nullable,
    COALESCE(c.column_default, '') as column_default,
    CASE WHEN pk.column_name IS NOT NULL THEN 'PK' ELSE '' END AS is_pk,
    COALESCE(fk.foreign_table || '(' || fk.foreign_column || ')', '') AS fk_ref,
    CASE WHEN uq.column_name IS NOT NULL THEN 'UNIQUE' ELSE '' END AS is_unique
FROM information_schema.tables t
JOIN information_schema.columns c
    ON t.table_name = c.table_name AND t.table_schema = c.table_schema
LEFT JOIN (
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
LEFT JOIN (
    SELECT kcu.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
) fk ON c.table_name = fk.table_name AND c.column_name = fk.column_name
LEFT JOIN (
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'UNIQUE'
) uq ON c.table_name = uq.table_name AND c.column_name = uq.column_name
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.ordinal_position;
SQL

# Generate Markdown output
{
    GENERATED_DATE=$(date '+%Y-%m-%d %H:%M:%S')
    TABLE_COUNT=$(awk -F'\t' '{ tables[$1]++ } END { print length(tables) }' "$TEMP_FILE")
    COLUMN_COUNT=$(wc -l < "$TEMP_FILE")

    cat << HEADER
# Database Schema Reference

> Auto-generated database schema documentation for Vecto Pilot.

| Metric | Value |
|--------|-------|
| **Generated** | $GENERATED_DATE |
| **Tables** | $TABLE_COUNT |
| **Total Columns** | $COLUMN_COUNT |
| **Database** | PostgreSQL |

---

## Table of Contents

HEADER

    # Generate TOC
    awk -F'\t' '{ tables[$1]++ } END { for (t in tables) print "- [" t "](#" t ")" }' "$TEMP_FILE" | sort

    echo ""
    echo "---"
    echo ""

    # Generate table documentation
    current_table=""
    while IFS=$'\t' read -r table_name column_name ordinal data_type udt_name max_length is_nullable column_default is_pk fk_ref is_unique; do
        if [ "$table_name" != "$current_table" ]; then
            if [ -n "$current_table" ]; then
                echo ""
            fi
            current_table="$table_name"
            col_count=$(grep -c "^${table_name}	" "$TEMP_FILE" || echo "0")

            echo "## $table_name"
            echo ""
            echo "**Columns:** $col_count"
            echo ""
            echo "| # | Column | Type | Null | Default | Constraints |"
            echo "|--:|--------|------|:----:|---------|-------------|"
        fi

        # Build type string
        type_str="$data_type"
        if [ -n "$max_length" ]; then
            type_str="${type_str}($max_length)"
        fi

        # Build constraints string
        constraints=""
        if [ "$is_pk" = "PK" ]; then
            constraints="🔑 PK"
        fi
        if [ -n "$fk_ref" ]; then
            [ -n "$constraints" ] && constraints="$constraints, "
            constraints="${constraints}→ $fk_ref"
        fi
        if [ "$is_unique" = "UNIQUE" ]; then
            [ -n "$constraints" ] && constraints="$constraints, "
            constraints="${constraints}🔒 UNIQUE"
        fi

        # Nullable indicator
        nullable_icon="✓"
        [ "$is_nullable" = "NO" ] && nullable_icon="✗"

        # Clean up default value for display (truncate long values)
        default_display="$column_default"
        if [ ${#default_display} -gt 25 ]; then
            default_display="${default_display:0:22}..."
        fi
        # Escape pipes in default values
        default_display="${default_display//|/\\|}"

        echo "| $ordinal | \`$column_name\` | $type_str | $nullable_icon | \`$default_display\` | $constraints |"

    done < "$TEMP_FILE"

    echo ""
    echo "---"
    echo ""
    echo "## Legend"
    echo ""
    echo "| Symbol | Meaning |"
    echo "|--------|---------|"
    echo "| 🔑 PK | Primary Key |"
    echo "| → table(col) | Foreign Key reference |"
    echo "| 🔒 UNIQUE | Unique constraint |"
    echo "| ✓ | Nullable (YES) |"
    echo "| ✗ | Not Nullable (NO) |"
    echo ""
    echo "---"
    echo ""
    echo "*Generated by \`scripts/generate-schema-docs.sh\`*"

} > "$OUTPUT_FILE"

# Cleanup
rm -f "$TEMP_FILE"

echo "✅ Generated: $OUTPUT_FILE ($TABLE_COUNT tables, $COLUMN_COUNT columns)"
