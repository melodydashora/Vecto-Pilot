#!/usr/bin/env bash
# verify-models.sh — Query all LLM provider APIs to list available models
#
# Usage: bash scripts/verify-models.sh
#        bash scripts/verify-models.sh --raw    # Full JSON output
#        bash scripts/verify-models.sh openai   # Single provider
#
# Reads API keys from environment (Replit Secrets):
#   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
#
# 2026-03-28: Created from Melody's curl+jq commands
set -euo pipefail

RAW_MODE=false
PROVIDER_FILTER=""

for arg in "$@"; do
  case "$arg" in
    --raw) RAW_MODE=true ;;
    anthropic|openai|gemini) PROVIDER_FILTER="$arg" ;;
  esac
done

# ── Anthropic ────────────────────────────────────────────────────────────────
query_anthropic() {
  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "  SKIP: ANTHROPIC_API_KEY not set"
    return
  fi

  local result
  result=$(curl -sS \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" \
    -H "anthropic-version: 2023-06-01" \
    "https://api.anthropic.com/v1/models")

  if $RAW_MODE; then
    echo "$result" | jq '.data[]'
    return
  fi

  echo "$result" | jq -r '
    .data
    | sort_by(.created_at) | reverse
    | .[] | [
        .id,
        .display_name,
        (.created_at | split("T")[0]),
        "in:\(.max_input_tokens) out:\(.max_tokens)",
        (if .capabilities.effort.supported then "effort:yes" else "effort:no" end),
        (if .capabilities.thinking.types.adaptive.supported then "adaptive" else "thinking" end),
        (if .capabilities.structured_outputs.supported then "structured" else "" end)
      ] | join("  |  ")
  '
}

# ── OpenAI ───────────────────────────────────────────────────────────────────
query_openai() {
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    echo "  SKIP: OPENAI_API_KEY not set"
    return
  fi

  local result
  result=$(curl -sS \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    "https://api.openai.com/v1/models")

  if $RAW_MODE; then
    echo "$result" | jq '.data[]'
    return
  fi

  # Filter to chat/reasoning models only (skip embedding, tts, whisper, dall-e, sora, imagen, moderation)
  echo "$result" | jq -r '
    .data
    | map(select(
        (.id | startswith("gpt-5")) or
        (.id | startswith("gpt-4")) or
        (.id | startswith("o1")) or
        (.id | startswith("o3")) or
        (.id | startswith("o4"))
      ))
    | sort_by(.created) | reverse
    | .[] | [
        .id,
        (.created | todate | split("T")[0]),
        .owned_by
      ] | join("  |  ")
  '
}

# ── Google Gemini ────────────────────────────────────────────────────────────
query_gemini() {
  if [[ -z "${GEMINI_API_KEY:-}" ]]; then
    echo "  SKIP: GEMINI_API_KEY not set"
    return
  fi

  local result
  result=$(curl -sS \
    "https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}")

  if $RAW_MODE; then
    echo "$result" | jq '.models[]'
    return
  fi

  # Filter to gemini generation models only (skip gemma, embedding, imagen, veo, lyria, aqa)
  echo "$result" | jq -r '
    .models
    | map(select(.name | startswith("models/gemini-")))
    | sort_by(.version) | reverse
    | .[] | [
        (.name | sub("models/"; "")),
        .displayName,
        "in:\(.inputTokenLimit) out:\(.outputTokenLimit)",
        (if .thinking then "thinking:yes" else "thinking:no" end),
        (.supportedGenerationMethods | join(","))
      ] | join("  |  ")
  '
}

# ── Main ─────────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "  MODEL INVENTORY — $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════════"

if [[ -z "$PROVIDER_FILTER" || "$PROVIDER_FILTER" == "anthropic" ]]; then
  echo ""
  echo "┌─── Anthropic ──────────────────────────────────────────────┐"
  query_anthropic
  echo "└────────────────────────────────────────────────────────────┘"
fi

if [[ -z "$PROVIDER_FILTER" || "$PROVIDER_FILTER" == "openai" ]]; then
  echo ""
  echo "┌─── OpenAI (chat/reasoning only) ──────────────────────────┐"
  query_openai
  echo "└────────────────────────────────────────────────────────────┘"
fi

if [[ -z "$PROVIDER_FILTER" || "$PROVIDER_FILTER" == "gemini" ]]; then
  echo ""
  echo "┌─── Google Gemini (generation only) ───────────────────────┐"
  query_gemini
  echo "└────────────────────────────────────────────────────────────┘"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Done. Use --raw for full JSON. Use 'openai' etc to filter."
echo "═══════════════════════════════════════════════════════════════"
