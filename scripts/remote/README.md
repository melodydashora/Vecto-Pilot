# Remote Development Portal

**SSH-based development access for remote terminals (Termius, Blink, etc.).**

Built 2026-03-31 to solve the pain of iOS copy/paste limitations when starting Claude Code sessions from iPad. Works with any SSH client on desktop or mobile.

## Architecture

```
Termius/Blink ──SSH──> Replit Workspace
                          │
                          ├── portal.sh      (Interactive TUI menu)
                          ├── status.sh      (Service health checker)
                          ├── ssh-setup.sh    (Connection setup guide)
                          │
                          └── .bash_profile  (Auto-detects SSH, shows welcome)
```

## Quick Start

Once connected via SSH:

| Command | What it does |
|---------|-------------|
| `portal` | Launch interactive development portal |
| `claude` | Start Claude Code directly |
| `vstatus` | Quick service health check |
| `vwatch` | Live service monitor (auto-refresh) |

## Files

| File | Location | Purpose |
|------|----------|---------|
| `portal.sh` | `scripts/remote/` | Interactive TUI with 10+ quick actions |
| `status.sh` | `scripts/remote/` | Service health check (one-shot or watch mode) |
| `ssh-setup.sh` | `scripts/remote/` | Displays SSH keys, host config, port forwarding |
| `.bash_profile` | `~/.bash_profile` | SSH session detection + welcome banner |
| `.ssh/config` | `~/.ssh/config` | SSH keepalive + GitHub key config |

## Portal Actions

1. **Launch Claude Code** — Full AI-assisted development
2. **Start App** — Run gateway + all services
3. **Stop App** — Kill running services
4. **View Logs** — Tail gateway output
5. **Git Status** — Branch, changes, history
6. **Run Tests** — Execute test suite
7. **Service Health** — Check all ports & services
8. **Database Shell** — Connect to PostgreSQL
9. **File Explorer** — Browse workspace tree
10. **Pending Reviews** — Check docs/review-queue

## How SSH Tunneling Works

Traffic from your SSH client arrives at `127.0.0.1` inside the workspace, so it automatically passes the Agent Server's IP allowlist — no config changes needed.

```
SSH Client (Termius/Blink)
  └── SSH tunnel (-L 5000:localhost:5000)
        └── Replit workspace (localhost:5000 = Gateway)
              ├── /assistant/* → Eidolon AI
              ├── /agent/*     → Agent Server (43717)
              └── /api/*       → SDK routes
```

## Security Notes

- SSH key: Ed25519 (generated on workspace, no passphrase for dev convenience)
- Agent Server: localhost-only access in dev mode (SSH tunnel preserves this)
- Private key displayed by `ssh-setup.sh` — only share with your own devices
