Based on the analysis of the code changes in `server/eidolon/core/llm.ts` and the provided documentation, the documentation appears to be **already up to date**.

The provided documentation snippet for `llm.ts` reads:
> `llm.ts` | LLM client (Anthropic) and Atlas planning engine with SQL, shell, and file system tools (uses `../../lib/anthropic-extended.js`)

This accurately reflects the code which:
1.  Exports an `LLMClient` using Anthropic.
2.  Exports an `llmPlan` function (Atlas planning engine).
3.  Defines tools for SQL (`sql_query`, `sql_execute`, etc.), Shell (`run_shell`), and File System (`file_read`, `file_write`).
4.  Imports from `../../lib/anthropic-extended.js`.

The preamble in the provided "Current Documentation" also explicitly states that the documentation was updated to reflect these specific tools.

NO_CHANGE