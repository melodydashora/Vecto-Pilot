# Eidolon Configuration (`server/eidolon/config.ts`)

The `EIDOLON_CONFIG` object defines the core behavior, capabilities, and identity of the Eidolon AI system. It is currently configured for maximum context and unified capabilities using Gemini 3 Pro.

## System Identity
- **Version**: `8.0.0-unified-max`
- **Identity**: Eidolon Unified AI - Complete IDE Integration (Gemini 3 Pro - 1M Context + High Thinking)
- **Model**: `gemini-3.1-pro-preview`
- **Context Window**: 1,000,000 tokens
- **Thinking Mode**: `high`

## Capabilities
The system is configured for **Unified Maximum Capabilities**, ensuring all AI subsystems have identical, unrestricted access to the environment.

### Core Infrastructure
- **File System**: Full root access (`fs_read`, `fs_write`, `fs_delete`, `fs_create`, `fs_rename`). Can modify any file including system configs.
- **Shell**: Unrestricted shell execution (`shell_exec`, `shell_unrestricted`) and process management.
- **Database**: Complete SQL control (`sql_query`, `sql_execute`, `sql_ddl`, `sql_dml`, `sql_schema_introspection`).
- **Network**: HTTP fetch, WebSocket access, and API integration.

### Intelligence & Memory
- **Memory**: Enhanced memory with cross-chat awareness, long-term persistence, and full workspace intelligence.
- **Reasoning**: Deep reasoning, ultra-deep thinking, and predictive intelligence.
- **Research**: Web research (Perplexity) and semantic search.

### Self-Healing & Autonomy
- **Circuit Breaker**: Active with override capabilities (`circuit_breaker_active`, `circuit_breaker_override`).
- **Recovery**: Autonomous recovery, error prediction, and auto-remediation.

## Features
Enabled advanced features include:
- Internet Search & Perplexity Research
- Code Pattern Recognition
- Security Auditing & Hardening
- Performance Profiling & Auto-optimization
- Multi-file Refactoring

## Assistant Replacement
Eidolon is configured to completely replace the standard assistant:
- **Standard Assistant**: `COMPLETELY_BYPASSED`
- **Override Mode**: `TOTAL_REPLACEMENT`
- **Interception**: `ALL_REQUESTS`