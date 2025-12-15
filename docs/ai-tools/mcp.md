# MCP Server Tools

Full reference for the 39 MCP (Model Context Protocol) tools.

## Server Location

`mcp-server/` - Standalone Express server exposing tools via HTTP/MCP protocol.

## Connection

```json
// Claude Desktop config
{
  "mcpServers": {
    "vecto-pilot": {
      "url": "https://69f9de93-7dc3-48aa-9050-4c395406d344-00-3uat6a5ciur3j.riker.replit.dev/mcp"
    }
  }
}
```

## Tool Categories

### File Operations (8 tools)

| Tool | Description |
|------|-------------|
| `read_file` | Read files with line ranges |
| `write_file` | Create/update files |
| `edit_file` | Find and replace text |
| `delete_file` | Delete files/directories |
| `move_file` | Move or rename files |
| `copy_file` | Copy files |
| `list_directory` | Browse with glob patterns |
| `file_info` | Get detailed file information |

**Example: read_file**
```json
{
  "file_path": "src/index.js",
  "offset": 1,
  "limit": 50
}
```

### Search Operations (4 tools)

| Tool | Description |
|------|-------------|
| `grep_search` | Search content with regex (ripgrep) |
| `glob_find` | Find files by pattern |
| `search_replace` | Search and replace across files |
| `search_symbols` | Find functions, classes, exports |

**Example: grep_search**
```json
{
  "pattern": "export.*function",
  "file_type": "js",
  "context_lines": 2
}
```

### Shell Operations (3 tools)

| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands |
| `run_script` | Run npm/node/python scripts |
| `get_process_info` | Get process information |

**Example: run_command**
```json
{
  "command": "npm run typecheck",
  "timeout": 60000
}
```

### Database Operations (4 tools)

| Tool | Description |
|------|-------------|
| `sql_query` | Execute SELECT queries |
| `sql_execute` | Execute INSERT/UPDATE/DELETE |
| `db_schema` | Get table schema |
| `db_tables` | List all tables |

**Example: sql_query**
```json
{
  "query": "SELECT * FROM snapshots WHERE created_at > $1",
  "params": ["2024-12-01"],
  "limit": 10
}
```

### Web Operations (3 tools)

| Tool | Description |
|------|-------------|
| `web_fetch` | Fetch content from URLs |
| `web_search` | Search the web |
| `api_call` | Make API calls with auth |

### Memory Operations (5 tools)

| Tool | Description |
|------|-------------|
| `memory_store` | Store persistent memories |
| `memory_retrieve` | Retrieve by key |
| `memory_search` | Search by tags/content |
| `memory_clear` | Clear memories |
| `context_get` | Get session context |

See [memory.md](memory.md) for detailed usage.

### Project Intelligence (6 tools)

| Tool | Description |
|------|-------------|
| `get_guidelines` | **CALL FIRST!** Get critical rules |
| `get_repo_info` | Project overview |
| `code_map` | Map code structure |
| `dependency_graph` | Analyze dependencies |
| `todo_list` | Find TODOs/FIXMEs |
| `project_stats` | Get project statistics |

**IMPORTANT:** Always call `get_guidelines` before making changes!

### MCP Diagnostics (3 tools)

| Tool | Description |
|------|-------------|
| `mcp_status` | Server status/health |
| `mcp_test` | Test tool functionality |
| `mcp_logs` | View request history |

### AI Operations (4 tools)

| Tool | Description |
|------|-------------|
| `ai_analyze` | Analyze code for issues |
| `ai_suggest` | Suggest improvements |
| `ai_explain` | Explain code structure |
| `ai_refactor` | Identify refactoring opportunities |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/mcp` | GET | Server info & capabilities |
| `/mcp/tools` | GET | List all available tools |
| `/mcp/tools/:name` | POST | Execute a tool |
| `/mcp/batch` | POST | Batch execute multiple tools |

## Security

- File operations restricted to `REPO_ROOT`
- Parameterized database queries
- Configurable command timeouts
- No dynamic code execution

## See Also

- [mcp-server/README.md](../../mcp-server/README.md) - Full server documentation
- [README.md](README.md) - AI tools index
