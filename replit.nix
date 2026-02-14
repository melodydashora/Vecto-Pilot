# Replit Nix Configuration for Vecto Pilot
# ==========================================
# This file provides system-level dependencies and development tools.
# It works alongside .replit for a complete development environment.
#
# Usage: Replit automatically reads this file on container initialization.
# To update packages, add them here and reboot the repl.

{ pkgs }: {
  deps = [
    # ===== Core Runtime =====
    pkgs.nodejs_22              # Node.js 22 LTS for server/client
    pkgs.postgresql_16          # PostgreSQL 16 for local development
    pkgs.python311              # Python for scripts and tools

    # ===== Build Tools =====
    pkgs.nodePackages.typescript  # TypeScript compiler
    pkgs.nodePackages.pnpm        # Fast package manager alternative

    # ===== Database Tools =====
    pkgs.pgcli                  # PostgreSQL CLI with autocomplete

    # ===== Development Utilities =====
    pkgs.jq                     # JSON processor (essential for API debugging)
    pkgs.tree                   # Directory structure visualization
    pkgs.lsof                   # Port/process debugging
    pkgs.imagemagick            # Image processing (for screenshots)
    pkgs.curl                   # HTTP testing
    pkgs.wget                   # File downloads

    # ===== Git & Version Control =====
    pkgs.git                    # Git (latest)
    pkgs.gh                     # GitHub CLI for PR/issue management
    pkgs.git-lfs                # Large file storage

    # ===== Playwright Dependencies =====
    # Required for E2E testing with Playwright
    pkgs.chromium
    pkgs.mesa
    pkgs.xorg.libX11
    pkgs.xorg.libXcomposite
    pkgs.xorg.libXdamage
    pkgs.xorg.libXext
    pkgs.xorg.libXfixes
    pkgs.xorg.libXrandr
    pkgs.libxkbcommon
    pkgs.alsa-lib
    pkgs.at-spi2-atk
    pkgs.at-spi2-core
    pkgs.atk
    pkgs.cairo
    pkgs.cups
    pkgs.dbus
    pkgs.glib
    pkgs.nspr
    pkgs.nss
    pkgs.pango
    pkgs.libxcb

    # ===== AI Development Tools =====
    # These support Claude Code and AI-powered development
    pkgs.ripgrep                # Fast code search (rg)
    pkgs.fd                     # Fast file finder
    pkgs.fzf                    # Fuzzy finder for interactive search
    pkgs.bat                    # Better cat with syntax highlighting
    pkgs.delta                  # Better git diff viewer

    # ===== Networking & Security =====
    pkgs.openssl                # SSL/TLS support
    pkgs.cacert                 # CA certificates
  ];

  # Environment variables set on container start
  env = {
    # Playwright configuration
    PLAYWRIGHT_BROWSERS_PATH = "${pkgs.chromium}/bin";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

    # Node.js optimization
    NODE_OPTIONS = "--max-old-space-size=4096";

    # PostgreSQL
    PGHOST = "localhost";

    # Claude Code / AI tools
    ANTHROPIC_LOG = "warn";
  };
}
