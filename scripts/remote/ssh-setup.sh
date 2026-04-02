#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# SSH Connection Kit — displays everything needed to connect to
# this Replit workspace from any SSH client (Termius, Blink, etc.)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

RST='\033[0m'; BOLD='\033[1m'
FG_TITLE='\033[38;5;39m'; FG_ACCENT='\033[38;5;214m'
FG_OK='\033[38;5;82m'; FG_WARN='\033[38;5;208m'
FG_DIM='\033[38;5;245m'; FG_WHITE='\033[38;5;255m'
FG_CYAN='\033[38;5;51m'; FG_ERR='\033[38;5;196m'

hr() { printf "${FG_DIM}"; printf '%*s' "$(tput cols 2>/dev/null || echo 70)" '' | tr ' ' '─'; printf "${RST}\n"; }

echo ""
echo -e "  ${FG_TITLE}${BOLD}SSH CONNECTION KIT${RST}"
echo -e "  ${FG_DIM}Everything you need to connect remotely (Termius, Blink, etc.)${RST}"
echo ""
hr

# ── 1. Replit SSH Address ─────────────────────────────────────────
echo -e "\n  ${FG_ACCENT}${BOLD}1. YOUR REPLIT SSH ADDRESS${RST}\n"

REPLIT_SSH_USER="69f9de93-7dc3-48aa-9050-4c395406d344"
REPLIT_DOMAIN="${REPLIT_SSH_USER}-00-3uat6a5ciur3j.riker.replit.dev"

echo -e "  ${FG_WHITE}Host:${RST}  ${FG_CYAN}${REPLIT_DOMAIN}${RST}"
echo -e "  ${FG_WHITE}User:${RST}  ${FG_CYAN}${REPLIT_SSH_USER}${RST}"
echo -e "  ${FG_WHITE}Port:${RST}  ${FG_CYAN}22${RST}"
echo ""
echo -e "  ${FG_DIM}Full SSH command:${RST}"
echo -e "  ${FG_OK}ssh -p 22 ${REPLIT_SSH_USER}@${REPLIT_DOMAIN}${RST}"
echo ""
hr

# ── 2. SSH Public Key ─────────────────────────────────────────────
echo -e "\n  ${FG_ACCENT}${BOLD}2. SSH PUBLIC KEY${RST}"
echo -e "  ${FG_DIM}(Already added to Replit — shown for reference)${RST}\n"

if [[ -f ~/.ssh/id_ed25519.pub ]]; then
  echo -e "  ${FG_OK}$(cat ~/.ssh/id_ed25519.pub)${RST}"
else
  echo -e "  ${FG_ERR}  No public key found. Run: ssh-keygen -t ed25519${RST}"
fi
echo ""
hr

# ── 3. Private Key ────────────────────────────────────────────────
echo -e "\n  ${FG_ACCENT}${BOLD}3. PRIVATE KEY (for import)${RST}"
echo -e "  ${FG_WARN}  Copy this ENTIRE block into your SSH client's key manager${RST}\n"

if [[ -f ~/.ssh/id_ed25519 ]]; then
  echo -e "${FG_WHITE}"
  cat ~/.ssh/id_ed25519
  echo -e "${RST}"
else
  echo -e "  ${FG_ERR}  No private key found.${RST}"
fi
hr

# ── 4. Host Configuration ────────────────────────────────────────
echo -e "\n  ${FG_ACCENT}${BOLD}4. HOST SETUP${RST}\n"
echo -e "  ${FG_WHITE}Create a new host in your SSH client:${RST}\n"
echo -e "  ${FG_DIM}┌──────────────────────────────────────────────┐${RST}"
echo -e "  ${FG_DIM}│${RST}  ${FG_WHITE}Label/Alias:${RST} ${FG_CYAN}vecto-pilot${RST}                   ${FG_DIM}│${RST}"
echo -e "  ${FG_DIM}│${RST}  ${FG_WHITE}Host:${RST}        ${FG_CYAN}${REPLIT_DOMAIN}${RST}   ${FG_DIM}│${RST}"
echo -e "  ${FG_DIM}│${RST}  ${FG_WHITE}Port:${RST}        ${FG_CYAN}22${RST}                             ${FG_DIM}│${RST}"
echo -e "  ${FG_DIM}│${RST}  ${FG_WHITE}User:${RST}        ${FG_CYAN}runner${RST}                         ${FG_DIM}│${RST}"
echo -e "  ${FG_DIM}│${RST}  ${FG_WHITE}Key:${RST}         ${FG_CYAN}(select imported key)${RST}          ${FG_DIM}│${RST}"
echo -e "  ${FG_DIM}└──────────────────────────────────────────────┘${RST}"
echo ""
hr

# ── 5. Port Forwarding ───────────────────────────────────────────
echo -e "\n  ${FG_ACCENT}${BOLD}5. PORT FORWARDING (optional)${RST}"
echo -e "  ${FG_DIM}Add these in your SSH client's port forwarding settings${RST}\n"
echo -e "  ${FG_WHITE}Local:${RST}"
echo -e "    ${FG_CYAN}5000${RST}   -> localhost:5000   ${FG_DIM}(Gateway — web app)${RST}"
echo -e "    ${FG_CYAN}43717${RST}  -> localhost:43717  ${FG_DIM}(Agent Server)${RST}"
echo -e "    ${FG_CYAN}5173${RST}   -> localhost:5173   ${FG_DIM}(Vite dev server)${RST}"
echo ""
echo -e "  ${FG_DIM}Or from command line:${RST}"
echo -e "  ${FG_OK}ssh -p 22 -L 5000:localhost:5000 -L 43717:localhost:43717 ${REPLIT_SSH_USER}@${REPLIT_DOMAIN}${RST}"
echo ""
hr

# ── 6. Quick Start ────────────────────────────────────────────────
echo -e "\n  ${FG_ACCENT}${BOLD}6. QUICK START${RST}\n"
echo -e "  ${FG_WHITE}Once connected:${RST}\n"
echo -e "  ${FG_CYAN}  portal${RST}        ${FG_DIM}— Launch the interactive portal${RST}"
echo -e "  ${FG_CYAN}  claude${RST}        ${FG_DIM}— Start Claude Code directly${RST}"
echo -e "  ${FG_CYAN}  vstatus${RST}       ${FG_DIM}— Quick service health check${RST}"
echo -e "  ${FG_CYAN}  vstatus -w${RST}    ${FG_DIM}— Watch mode (auto-refresh)${RST}"
echo ""
hr
echo ""
