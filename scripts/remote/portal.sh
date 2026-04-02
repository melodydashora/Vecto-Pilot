#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Vecto-Pilot Remote Portal — SSH TUI for remote access
# 2026-03-31: Built for Melody to develop remotely via SSH (Termius, Blink, etc.)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors & Symbols ──────────────────────────────────────────────
RST='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
ITAL='\033[3m'
ULINE='\033[4m'

# Palette — deep blues + electric accents (looks great on dark terminal themes)
BG_HEADER='\033[48;5;17m'   # deep navy
FG_TITLE='\033[38;5;39m'    # electric blue
FG_ACCENT='\033[38;5;214m'  # amber/gold
FG_OK='\033[38;5;82m'       # green
FG_WARN='\033[38;5;208m'    # orange
FG_ERR='\033[38;5;196m'     # red
FG_DIM='\033[38;5;245m'     # grey
FG_CYAN='\033[38;5;51m'     # bright cyan
FG_PURPLE='\033[38;5;141m'  # soft purple
FG_WHITE='\033[38;5;255m'   # bright white

# ── Helpers ───────────────────────────────────────────────────────
term_width() { tput cols 2>/dev/null || echo 80; }
center() {
  local w; w=$(term_width)
  local text="$1"
  local stripped; stripped=$(echo -e "$text" | sed 's/\x1b\[[0-9;]*m//g')
  local pad=$(( (w - ${#stripped}) / 2 ))
  [[ $pad -lt 0 ]] && pad=0
  printf "%${pad}s" ""
  echo -e "$text"
}
hr() {
  local w; w=$(term_width)
  local ch="${1:-─}"
  printf "${FG_DIM}"
  printf '%*s' "$w" '' | tr ' ' "$ch"
  printf "${RST}\n"
}
hr_accent() {
  local w; w=$(term_width)
  printf "${FG_ACCENT}"
  printf '%*s' "$w" '' | tr ' ' '═'
  printf "${RST}\n"
}

# ── Service Health ────────────────────────────────────────────────
check_port() {
  local port=$1 name=$2
  if ss -tlnp 2>/dev/null | grep -q ":${port} " 2>/dev/null || \
     lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo -e "  ${FG_OK}●${RST} ${FG_WHITE}${name}${RST} ${FG_DIM}:${port}${RST}"
  else
    echo -e "  ${FG_ERR}○${RST} ${FG_DIM}${name}${RST} ${FG_DIM}:${port}${RST}"
  fi
}

show_services() {
  echo -e "\n${FG_CYAN}${BOLD}  SERVICES${RST}"
  hr
  check_port 5000 "Gateway"
  check_port 43717 "Agent Server"
  check_port 5173 "Vite Dev"
  check_port 5432 "PostgreSQL"
  echo ""
}

# ── Git Status ────────────────────────────────────────────────────
show_git() {
  cd /home/runner/workspace
  local branch; branch=$(git branch --show-current 2>/dev/null || echo "detached")
  local dirty=""
  if ! git diff --quiet 2>/dev/null; then dirty=" ${FG_WARN}*modified*${RST}"; fi
  local staged=""
  if ! git diff --cached --quiet 2>/dev/null; then staged=" ${FG_ACCENT}+staged${RST}"; fi
  local ahead; ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
  local behind; behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo "?")

  echo -e "  ${FG_PURPLE}${BOLD}GIT${RST}"
  hr
  echo -e "  ${FG_WHITE}Branch:${RST}  ${FG_CYAN}${branch}${RST}${dirty}${staged}"

  if [[ "$ahead" != "?" && "$behind" != "?" ]]; then
    echo -e "  ${FG_WHITE}Sync:${RST}    ${FG_OK}↑${ahead}${RST} ${FG_WARN}↓${behind}${RST}"
  fi

  local last_msg; last_msg=$(git log -1 --pretty=format:'%s' 2>/dev/null || echo "none")
  local last_time; last_time=$(git log -1 --pretty=format:'%ar' 2>/dev/null || echo "unknown")
  echo -e "  ${FG_WHITE}Latest:${RST}  ${FG_DIM}${last_msg:0:50}${RST}"
  echo -e "           ${FG_DIM}${last_time}${RST}"
  echo ""
}

# ── Header ────────────────────────────────────────────────────────
show_header() {
  clear
  echo ""
  hr_accent
  center "${FG_TITLE}${BOLD}  V E C T O - P I L O T${RST}"
  center "${FG_ACCENT}Remote Development Portal${RST}"
  center "${FG_DIM}$(date '+%a %b %d, %Y  %H:%M %Z')${RST}"
  hr_accent
  echo ""

  # Connection info
  local ip_info=""
  if [[ -n "${SSH_CLIENT:-}" ]]; then
    local client_ip; client_ip=$(echo "$SSH_CLIENT" | awk '{print $1}')
    ip_info="from ${client_ip}"
  fi
  center "${FG_DIM}Connected via SSH ${ip_info}${RST}"
  echo ""
}

# ── Quick Actions Menu ────────────────────────────────────────────
show_menu() {
  echo -e "  ${FG_ACCENT}${BOLD}  QUICK ACTIONS${RST}"
  hr
  echo ""
  echo -e "  ${FG_CYAN}${BOLD} 1${RST}  ${FG_WHITE}Launch Claude Code${RST}        ${FG_DIM}— AI-assisted development${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 2${RST}  ${FG_WHITE}Start App${RST}                 ${FG_DIM}— Run gateway + all services${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 3${RST}  ${FG_WHITE}Stop App${RST}                  ${FG_DIM}— Kill running services${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 4${RST}  ${FG_WHITE}View Logs${RST}                 ${FG_DIM}— Tail gateway output${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 5${RST}  ${FG_WHITE}Git Status${RST}                ${FG_DIM}— Branch, changes, history${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 6${RST}  ${FG_WHITE}Run Tests${RST}                 ${FG_DIM}— Execute test suite${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 7${RST}  ${FG_WHITE}Service Health${RST}            ${FG_DIM}— Check all ports & services${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 8${RST}  ${FG_WHITE}Database Shell${RST}            ${FG_DIM}— Connect to PostgreSQL${RST}"
  echo -e "  ${FG_CYAN}${BOLD} 9${RST}  ${FG_WHITE}File Explorer${RST}             ${FG_DIM}— Browse workspace tree${RST}"
  echo -e "  ${FG_CYAN}${BOLD}10${RST}  ${FG_WHITE}Pending Reviews${RST}           ${FG_DIM}— Check docs/review-queue${RST}"
  echo ""
  echo -e "  ${FG_PURPLE}${BOLD} s${RST}  ${FG_WHITE}Shell${RST}                    ${FG_DIM}— Drop to bash${RST}"
  echo -e "  ${FG_PURPLE}${BOLD} r${RST}  ${FG_WHITE}Refresh${RST}                  ${FG_DIM}— Reload portal${RST}"
  echo -e "  ${FG_PURPLE}${BOLD} b${RST}  ${FG_WHITE}SSH Setup${RST}                ${FG_DIM}— Connection & key info${RST}"
  echo -e "  ${FG_PURPLE}${BOLD} q${RST}  ${FG_WHITE}Quit${RST}                     ${FG_DIM}— Exit portal${RST}"
  echo ""
  hr
}

# ── Action Handlers ───────────────────────────────────────────────
do_claude() {
  echo -e "\n${FG_ACCENT}${BOLD}  Launching Claude Code...${RST}\n"
  hr
  echo -e "${FG_DIM}  Tip: Type /help for commands, Ctrl+C to exit back to portal${RST}\n"
  cd /home/runner/workspace
  claude || true
  echo -e "\n${FG_OK}  Claude Code session ended.${RST}"
  pause_return
}

do_start_app() {
  echo -e "\n${FG_ACCENT}  Starting Vecto-Pilot...${RST}\n"
  cd /home/runner/workspace
  # Source env and start
  if [[ -f .env.local ]]; then
    set -a; source .env.local 2>/dev/null; set +a
  fi
  # Start in background so portal stays alive
  nohup node gateway-server.js > /tmp/vecto-pilot.log 2>&1 &
  local pid=$!
  echo -e "  ${FG_OK}●${RST} Gateway starting (PID: ${pid})"
  echo -e "  ${FG_DIM}  Logs: /tmp/vecto-pilot.log${RST}"
  sleep 2
  check_port 5000 "Gateway"
  pause_return
}

do_stop_app() {
  echo -e "\n${FG_WARN}  Stopping services...${RST}\n"
  # Kill node processes related to gateway
  local pids; pids=$(pgrep -f "gateway-server\|agent-server\|start-replit" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    echo -e "  ${FG_OK}  Services stopped.${RST}"
  else
    echo -e "  ${FG_DIM}  No running services found.${RST}"
  fi
  pause_return
}

do_logs() {
  echo -e "\n${FG_ACCENT}  Tailing logs (Ctrl+C to stop)...${RST}\n"
  hr
  if [[ -f /tmp/vecto-pilot.log ]]; then
    tail -f /tmp/vecto-pilot.log || true
  else
    echo -e "  ${FG_DIM}  No log file found. Start the app first.${RST}"
  fi
  pause_return
}

do_git_status() {
  echo ""
  cd /home/runner/workspace
  show_git
  echo -e "  ${FG_CYAN}${BOLD}RECENT COMMITS${RST}"
  hr
  git log --oneline --graph --decorate -15 2>/dev/null | while read -r line; do
    echo -e "  ${FG_DIM}${line}${RST}"
  done
  echo ""
  echo -e "  ${FG_CYAN}${BOLD}CHANGED FILES${RST}"
  hr
  git status --short 2>/dev/null | while read -r line; do
    echo -e "  ${line}"
  done
  echo ""
  pause_return
}

do_tests() {
  echo -e "\n${FG_ACCENT}  Running test suite...${RST}\n"
  hr
  cd /home/runner/workspace
  npm test 2>&1 || true
  echo ""
  pause_return
}

do_health() {
  echo ""
  show_services

  # Also check disk & memory
  echo -e "  ${FG_CYAN}${BOLD}RESOURCES${RST}"
  hr
  local disk_usage; disk_usage=$(df -h /home/runner 2>/dev/null | tail -1 | awk '{print $5}')
  local mem_free; mem_free=$(free -h 2>/dev/null | awk '/^Mem:/{print $7}' || echo "N/A")
  local node_count; node_count=$(pgrep -c node 2>/dev/null || echo "0")
  echo -e "  ${FG_WHITE}Disk:${RST}     ${disk_usage:-N/A} used"
  echo -e "  ${FG_WHITE}Memory:${RST}   ${mem_free} available"
  echo -e "  ${FG_WHITE}Node PIDs:${RST} ${node_count} running"
  echo ""
  pause_return
}

do_db_shell() {
  echo -e "\n${FG_ACCENT}  Connecting to PostgreSQL...${RST}\n"
  echo -e "  ${FG_DIM}  Type \\q to quit${RST}\n"
  hr
  cd /home/runner/workspace
  if [[ -f .env.local ]]; then
    set -a; source .env.local 2>/dev/null; set +a
  fi
  psql "$DATABASE_URL" 2>/dev/null || echo -e "  ${FG_ERR}  Could not connect. Is DATABASE_URL set?${RST}"
  pause_return
}

do_file_explorer() {
  echo -e "\n${FG_ACCENT}  Workspace Tree (depth 2)${RST}\n"
  hr
  cd /home/runner/workspace
  tree -L 2 -I 'node_modules|.git|dist|.cache' --dirsfirst -C 2>/dev/null || \
    find . -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -60
  echo ""
  pause_return
}

do_pending() {
  echo -e "\n${FG_ACCENT}  Pending Reviews${RST}\n"
  hr
  local pending="/home/runner/workspace/docs/review-queue/pending.md"
  if [[ -f "$pending" ]]; then
    cat "$pending"
  else
    echo -e "  ${FG_OK}  No pending reviews.${RST}"
  fi
  echo ""

  # Also show coach inbox
  local inbox="/home/runner/workspace/docs/coach-inbox.md"
  if [[ -f "$inbox" ]]; then
    echo -e "\n${FG_ACCENT}  Coach Inbox${RST}\n"
    hr
    cat "$inbox"
  fi
  echo ""
  pause_return
}

do_ssh_setup() {
  echo ""
  /home/runner/workspace/scripts/remote/ssh-setup.sh 2>/dev/null || \
    echo -e "  ${FG_ERR}  SSH setup script not found.${RST}"
  pause_return
}

pause_return() {
  echo ""
  echo -ne "  ${FG_DIM}Press any key to return to portal...${RST}"
  read -rsn1
}

# ── Main Loop ─────────────────────────────────────────────────────
main() {
  trap 'echo -e "\n${FG_DIM}Portal closed.${RST}"; exit 0' INT TERM

  while true; do
    show_header
    show_services
    show_git
    show_menu

    echo -ne "  ${FG_ACCENT}▸${RST} "
    read -rn2 choice
    echo ""

    case "$choice" in
      1)  do_claude ;;
      2)  do_start_app ;;
      3)  do_stop_app ;;
      4)  do_logs ;;
      5)  do_git_status ;;
      6)  do_tests ;;
      7)  do_health ;;
      8)  do_db_shell ;;
      9)  do_file_explorer ;;
      10) do_pending ;;
      s|S)
        echo -e "\n${FG_DIM}  Dropping to shell. Type 'portal' or 'exit' to return.${RST}\n"
        cd /home/runner/workspace
        bash --norc -i || true
        ;;
      r|R) continue ;;
      b|B) do_ssh_setup ;;
      q|Q)
        echo -e "\n${FG_DIM}  Goodbye, Melody. Safe driving.${RST}\n"
        exit 0
        ;;
      *)
        echo -e "\n  ${FG_WARN}  Unknown option: ${choice}${RST}"
        sleep 1
        ;;
    esac
  done
}

main "$@"
