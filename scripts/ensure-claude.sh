#!/usr/bin/env bash
# scripts/ensure-claude.sh — keep the Claude Code CLI working across Replit restarts.
# Provenance: Claude (2026-04-13 launcher symlink only; 2026-09-10/11 rewrite with
# persisted config dir, at Melody's request "fix local/bin/claude startup issues").
#
# WHY (verified 2026-09-10): on Replit only $REPL_HOME (/home/runner/workspace)
# survives a workspace restart. The rest of /home/runner is rebuilt from the
# image, so every restart used to wipe:
#   ~/.local/bin/claude          launcher symlink  -> "claude: command not found"
#   ~/.claude/  ~/.claude.json   settings, OAuth credentials, plugins, session
#                                transcripts, memory, onboarding/trust state
#                                -> theme + login + trust + API-key prompts on
#                                   every boot, plugins re-cloned, no --resume
# The version binaries already persist because Replit exports
# XDG_DATA_HOME=$REPL_HOME/.local/share and the native installer honors it
# ($XDG_DATA_HOME/claude/versions/<semver>; staging in $XDG_CACHE_HOME). The
# launcher path ~/.local/bin is hardcoded in the binary (no env override), so it
# must be re-created per boot.
#
# WHAT (idempotent, offline, bash only, safe to `source`):
#   1. export CLAUDE_CONFIG_DIR=$REPL_HOME/.config/claude-code  (persisted; the
#      whole .config/ tree is gitignored). Claude Code keeps everything that
#      used to live in ~/.claude AND ~/.claude.json there — verified against the
#      2.1.268 binary: config file = $CLAUDE_CONFIG_DIR/.claude.json, and
#      projects/, plugins/, shell-snapshots/, session-env/ all derive from it.
#   2. one-time seed: if the persisted dir has no .claude.json yet but a real
#      ~/.claude.json exists (a login done before this script), copy ~/.claude/*
#      first and .claude.json LAST as the "seed complete" marker, so a partial
#      copy is retried on the next run and reported loudly.
#   3. fresh boot (no ~/.claude yet): symlink ~/.claude and ~/.claude.json to
#      the persisted copies. This link is LOAD-BEARING, not a courtesy:
#      plugins/known_marketplaces.json records absolute /home/runner/.claude/...
#      paths, and any process started without the env var needs it. A real
#      (non-symlink) ~/.claude or a symlink that points somewhere else is never
#      touched; only dangling links are repaired.
#   4. relink ~/.local/bin/claude -> newest executable <semver> under
#      $XDG_DATA_HOME/claude/versions (never replaces a non-symlink launcher).
#   5. put ~/.local/bin on PATH.
#   6. re-create $REPL_HOME/.config/bashrc (the Replit per-shell hook) if it is
#      missing, so a fresh clone gets the Shell-tab half of the fix from the
#      tracked files alone. An existing file is never modified.
#   7. drop a CLAUDE_CODE_OAUTH_TOKEN inherited from the environment once the
#      persisted dir holds a login. Verified 2026-09-11: that env var (here a
#      Replit Secret from an older keep-me-logged-in workaround) OUTRANKS the
#      persisted claude.ai login in every new claude process, and its value
#      was dead -> "401 Invalid bearer token" on the first launch after the
#      first real restart. Loud on every run, never silent; ANTHROPIC_API_KEY
#      is never touched (the app itself needs it). Lasting fix: delete that
#      Secret in the Replit Secrets pane; --status reports whether it is set.
#
# WHERE:
#   .replit  onBoot                 runs this once per container boot (pid1 runs
#                                   it via sh -c from cwd=/; absolute paths only)
#   .replit  [userenv.development]  CLAUDE_CONFIG_DIR for every NEW workspace
#                                   process (Shell tabs, workflows, agents; pid2
#                                   merges it at spawn, no restart needed; tabs
#                                   opened before the edit must be reopened).
#                                   Not [userenv.shared]: that also feeds the
#                                   published Cloud Run app, where it is inert.
#   $REPL_HOME/.config/bashrc       sources this in every interactive Shell tab;
#                                   gitignored, so step 6 re-creates it when
#                                   missing (fresh clone / re-import).
#   Shells with REPLIT_MODE=agent|workflow skip .config/bashrc by Replit design:
#   they get CLAUDE_CONFIG_DIR but NOT ~/.local/bin on PATH, so call the launcher
#   by absolute path there.
#
# USAGE (executed, not sourced):
#   bash scripts/ensure-claude.sh            # repair; prints only what changed
#   bash scripts/ensure-claude.sh --status   # print resolved paths, no changes
#   bash scripts/ensure-claude.sh --sync     # ONLY on the boot where the seed
#       happened while a session was still writing to a real ~/.claude: merge
#       newer files from ~/.claude and ~/.claude.json into the persisted dir.
#       Not automatic, because on that boot new shells already write to the
#       persisted dir and an unconditional copy would clobber them.
#
# EXPOSURE NOTE: the persisted dir holds the claude.ai OAuth token, MCP OAuth
# tokens and full session transcripts. It is gitignored (.config/), but it sits
# in the workspace like .env.local does — if this Repl is ever made public,
# forked or exported, treat .config/claude-code/ exactly like .env.local.
# DELETION HAZARDS (verified 2026-09-11): `git clean -fdx` / `-fdX` would remove
# .config/ (token store) AND .local/ (all Claude binaries, ~620MB) — never run
# git clean with -x/-X in this workspace. Replit Agent checkpoint rollbacks are
# documented as restoring "all project files"; whether they rewind these
# gitignored dirs is unverified — re-login is the worst case.
#
# No `set -e`/`exit` at top level and no `ls`/`grep` without `command`: this
# file is sourced by interactive shells that may carry aliases and strict opts.

_ensure_claude_main() {
  local IFS=' '
  local mode="${1:-}"
  local repl_home="${REPL_HOME:-/home/runner/workspace}"
  local home="${HOME:-/home/runner}"
  local data_home="${XDG_DATA_HOME:-$repl_home/.local/share}"
  local config_home="${XDG_CONFIG_HOME:-$repl_home/.config}"
  local persisted="${CLAUDE_CONFIG_DIR:-$config_home/claude-code}"
  local versions_dir="$data_home/claude/versions"
  local bin_dir="$home/.local/bin"
  local launcher="$bin_dir/claude"
  local -a changed=()
  local -a problems=()
  local p v latest="" target="" seed_ok=1 executed=0 verbose=0 env_token_seen=0

  if [ "${BASH_SOURCE[0]}" = "$0" ]; then executed=1; fi
  if [ "$executed" = 1 ] || [ -t 2 ]; then verbose=1; fi

  case "$persisted" in
    /*) ;;
    *) printf '[ensure-claude] PROBLEM: CLAUDE_CONFIG_DIR must be an absolute path, got: %s\n' "$persisted" >&2 || true
       return 1 ;;
  esac
  persisted="${persisted%/}"
  export CLAUDE_CONFIG_DIR="$persisted"

  # 1. persisted config dir
  if [ ! -d "$persisted" ]; then
    if mkdir -p "$persisted"; then
      changed+=("created $persisted")
    else
      problems+=("cannot create $persisted")
    fi
  fi

  # 2. one-time seed: directory first, .claude.json last (= completion marker)
  if [ -d "$persisted" ] && [ ! -e "$persisted/.claude.json" ] \
     && [ -f "$home/.claude.json" ] && [ ! -L "$home/.claude.json" ]; then
    if [ -d "$home/.claude" ] && [ ! -L "$home/.claude" ]; then
      if cp -a "$home/.claude/." "$persisted/"; then
        changed+=("seeded ~/.claude contents")
      else
        seed_ok=0
        problems+=("SEED INCOMPLETE: copying ~/.claude into $persisted failed; will retry next run")
      fi
    fi
    if [ "$seed_ok" = 1 ]; then
      if cp -p "$home/.claude.json" "$persisted/.claude.json"; then
        changed+=("seeded .claude.json")
      else
        problems+=("SEED INCOMPLETE: copying ~/.claude.json failed; will retry next run")
      fi
    fi
  fi

  # --sync: newer-wins merge from a still-live real ~/.claude (see USAGE)
  if [ "$mode" = "--sync" ] && [ -d "$persisted" ]; then
    if [ -d "$home/.claude" ] && [ ! -L "$home/.claude" ]; then
      if cp -a -u "$home/.claude/." "$persisted/"; then
        changed+=("synced ~/.claude -> $persisted (newer wins)")
      else
        problems+=("sync of ~/.claude failed part-way")
      fi
    fi
    if [ -f "$home/.claude.json" ] && [ ! -L "$home/.claude.json" ] \
       && { [ ! -e "$persisted/.claude.json" ] || [ "$home/.claude.json" -nt "$persisted/.claude.json" ]; }; then
      if cp -p "$home/.claude.json" "$persisted/.claude.json"; then
        changed+=("synced .claude.json")
      else
        problems+=("sync of ~/.claude.json failed")
      fi
    fi
  fi

  if [ -d "$persisted" ]; then
    chmod 700 "$persisted" 2>/dev/null || true
    if [ -f "$persisted/.credentials.json" ]; then
      chmod 600 "$persisted/.credentials.json" 2>/dev/null || true
    fi
  fi

  # 3. fresh boot: point the legacy paths at the persisted copies (-T: never
  #    descend into an existing link; a lost race is fine if the link is right)
  if [ -d "$persisted" ]; then
    if [ -L "$home/.claude" ]; then
      if [ ! -e "$home/.claude" ]; then
        if ln -sfnT "$persisted" "$home/.claude"; then changed+=("relinked dangling ~/.claude"); fi
      elif [ "$(readlink -f "$home/.claude" 2>/dev/null || true)" != "$(readlink -f "$persisted" 2>/dev/null || true)" ]; then
        problems+=("~/.claude is a symlink to $(readlink "$home/.claude" 2>/dev/null || true), not to $persisted; left alone")
      fi
    elif [ ! -e "$home/.claude" ]; then
      if ln -sT "$persisted" "$home/.claude" 2>/dev/null; then
        changed+=("linked ~/.claude")
      elif [ "$(readlink "$home/.claude" 2>/dev/null || true)" != "$persisted" ]; then
        problems+=("could not link ~/.claude -> $persisted")
      fi
    fi
    if [ -f "$persisted/.claude.json" ]; then
      if [ -L "$home/.claude.json" ]; then
        if [ ! -e "$home/.claude.json" ]; then
          if ln -sfnT "$persisted/.claude.json" "$home/.claude.json"; then changed+=("relinked dangling ~/.claude.json"); fi
        elif [ "$(readlink -f "$home/.claude.json" 2>/dev/null || true)" != "$(readlink -f "$persisted/.claude.json" 2>/dev/null || true)" ]; then
          problems+=("~/.claude.json is a symlink to $(readlink "$home/.claude.json" 2>/dev/null || true), not to the persisted copy; left alone")
        fi
      elif [ ! -e "$home/.claude.json" ]; then
        if ln -sT "$persisted/.claude.json" "$home/.claude.json" 2>/dev/null; then
          changed+=("linked ~/.claude.json")
        elif [ "$(readlink "$home/.claude.json" 2>/dev/null || true)" != "$persisted/.claude.json" ]; then
          problems+=("could not link ~/.claude.json")
        fi
      fi
    fi
  fi

  # 4. launcher -> newest executable semver binary (alias- and shopt-proof)
  if [ -d "$versions_dir" ]; then
    while IFS= read -r v; do
      p="$versions_dir/$v"
      if [ -f "$p" ] && [ -x "$p" ] && [ -s "$p" ]; then
        latest="$v"
        break
      fi
    done < <(command find "$versions_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null \
             | command grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | command sort -rV)
  fi
  if [ -n "$latest" ]; then
    target="$versions_dir/$latest"
    if [ -e "$launcher" ] && [ ! -L "$launcher" ]; then
      problems+=("$launcher exists and is not a symlink; not touching it (expected a symlink into $versions_dir)")
    elif [ "$(readlink "$launcher" 2>/dev/null || true)" != "$target" ]; then
      if mkdir -p "$bin_dir" && ln -sfnT "$target" "$launcher"; then
        changed+=("claude -> $latest")
      else
        problems+=("could not link $launcher -> $target")
      fi
    fi
  else
    problems+=("no Claude Code binary under $versions_dir — install with: curl -fsSL https://claude.ai/install.sh | bash")
  fi

  # 5. PATH
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) export PATH="$bin_dir:$PATH" ;;
  esac

  # 6. per-shell hook: re-create only when missing (never edit an existing one)
  if [ ! -e "$config_home/bashrc" ] && [ -d "$config_home" ] && [ -f "$repl_home/scripts/ensure-claude.sh" ]; then
    if printf '%s\n' \
      '# User shell customizations for the Replit workspace (re-created by' \
      '# scripts/ensure-claude.sh because it was missing; see its header).' \
      '# Sourced by Replit'"'"'s system .bashrc for interactive Shell tabs only.' \
      'case $- in' \
      '  *i*)' \
      '    if [ -f "${REPL_HOME:-/home/runner/workspace}/scripts/ensure-claude.sh" ]; then' \
      '        source "${REPL_HOME:-/home/runner/workspace}/scripts/ensure-claude.sh"' \
      '    fi' \
      '    ;;' \
      'esac' > "$config_home/bashrc"; then
      changed+=("created $config_home/bashrc")
    else
      problems+=("could not create $config_home/bashrc")
    fi
  fi

  # 7. stale-token guard (see header). Sourced: unsets it in the Shell tab so
  #    `claude` started there uses the persisted login. Executed (onBoot,
  #    --status): process-local, message only.
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    env_token_seen=1
    if [ -f "$persisted/.credentials.json" ]; then
      unset CLAUDE_CODE_OAUTH_TOKEN
      changed+=("ignored CLAUDE_CODE_OAUTH_TOKEN from the environment: the persisted login in $persisted wins (delete that Replit Secret to silence this)")
    fi
  fi

  if [ "$mode" = "--status" ]; then
    local cfg_state link_dir link_json vers tok_state
    if [ "$env_token_seen" = 1 ]; then
      if [ -f "$persisted/.credentials.json" ]; then
        tok_state='SET in the environment (outranks the persisted login; dropped by step 7 in shells that source this script) — delete the Replit Secret'
      else
        tok_state='SET in the environment and used (no persisted login yet)'
      fi
    else
      tok_state='not set (persisted login is used)'
    fi
    if [ -f "$persisted/.claude.json" ]; then cfg_state='has .claude.json'; else cfg_state='EMPTY — run claude once and log in'; fi
    link_dir="$(readlink "$home/.claude" 2>/dev/null || true)"
    if [ -z "$link_dir" ]; then
      if [ -d "$home/.claude" ]; then link_dir='real directory (not linked; predates this script on this boot — see --sync)'; else link_dir='absent'; fi
    fi
    link_json="$(readlink "$home/.claude.json" 2>/dev/null || true)"
    if [ -z "$link_json" ]; then
      if [ -f "$home/.claude.json" ]; then link_json='real file (not linked; predates this script on this boot — see --sync)'; else link_json='absent'; fi
    fi
    vers="$(command find "$versions_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null | command grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | command sort -V | command tr '\n' ' ' || true)"
    printf 'CLAUDE_CONFIG_DIR = %s (%s)\n' "$persisted" "$cfg_state"
    printf '~/.claude         -> %s\n' "$link_dir"
    printf '~/.claude.json    -> %s\n' "$link_json"
    printf 'launcher          = %s -> %s\n' "$launcher" "$(readlink "$launcher" 2>/dev/null || echo 'MISSING')"
    printf 'versions          = %s: %s\n' "$versions_dir" "$vers"
    printf 'CLAUDE_CODE_OAUTH_TOKEN = %s\n' "$tok_state"
  fi
  if [ "${#problems[@]}" -gt 0 ]; then
    printf '[ensure-claude] PROBLEM: %s\n' "${problems[@]}" >&2 || true
  fi
  if [ "$verbose" = 1 ] && [ "${#changed[@]}" -gt 0 ]; then
    printf '[ensure-claude] %s\n' "${changed[*]}" >&2 || true
  fi
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  _ensure_claude_main "$@"
  _ensure_claude_rc=$?
  unset -f _ensure_claude_main
  exit "$_ensure_claude_rc"
fi
_ensure_claude_main || true   # sourced: never abort a strict-mode caller
unset -f _ensure_claude_main
