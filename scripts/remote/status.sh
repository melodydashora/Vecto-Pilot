#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Vecto-Pilot Quick Status — lightweight service health check
# Usage: ./status.sh        (one-shot)
#        ./status.sh -w     (watch mode, refreshes every 5s)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

RST='\033[0m'; BOLD='\033[1m'
FG_OK='\033[38;5;82m'; FG_ERR='\033[38;5;196m'
FG_DIM='\033[38;5;245m'; FG_CYAN='\033[38;5;51m'
FG_WHITE='\033[38;5;255m'; FG_ACCENT='\033[38;5;214m'

check() {
  local port=$1 name=$2
  if ss -tlnp 2>/dev/null | grep -q ":${port} " 2>/dev/null || \
     lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    printf "  ${FG_OK}●${RST}  %-18s ${FG_DIM}:%-6s${RST} ${FG_OK}UP${RST}\n" "$name" "$port"
  else
    printf "  ${FG_ERR}○${RST}  %-18s ${FG_DIM}:%-6s${RST} ${FG_ERR}DOWN${RST}\n" "$name" "$port"
  fi
}

status_report() {
  echo -e "\n  ${FG_CYAN}${BOLD}VECTO-PILOT STATUS${RST}  ${FG_DIM}$(date '+%H:%M:%S')${RST}\n"

  check 5000  "Gateway"
  check 43717 "Agent Server"
  check 5173  "Vite Dev"
  check 5432  "PostgreSQL"
  echo ""

  # Git
  cd /home/runner/workspace 2>/dev/null || true
  local branch; branch=$(git branch --show-current 2>/dev/null || echo "?")
  local dirty=""; git diff --quiet 2>/dev/null || dirty=" ${FG_ACCENT}*${RST}"
  echo -e "  ${FG_WHITE}Branch:${RST} ${FG_CYAN}${branch}${RST}${dirty}"

  # Resources
  local node_count; node_count=$(pgrep -c node 2>/dev/null || echo "0")
  local mem; mem=$(free -h 2>/dev/null | awk '/^Mem:/{printf "%s/%s", $3, $2}' || echo "N/A")
  echo -e "  ${FG_WHITE}Memory:${RST} ${mem}  ${FG_WHITE}Node PIDs:${RST} ${node_count}"
  echo ""
}

if [[ "${1:-}" == "-w" ]]; then
  trap 'echo -e "\n${FG_DIM}Stopped.${RST}"; exit 0' INT TERM
  while true; do
    clear
    status_report
    echo -e "  ${FG_DIM}Refreshing every 5s... (Ctrl+C to stop)${RST}"
    sleep 5
  done
else
  status_report
fi
