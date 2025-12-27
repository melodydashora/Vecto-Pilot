# MCP Protocol API

MCP (Model Context Protocol) server integrated into the gateway for Claude Desktop access.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | GET | Server info & capabilities |
| `/mcp/tools` | GET | List all 32 tools |
| `/mcp/tools/:name` | POST | Execute a tool |
| `/mcp/batch` | POST | Batch execute multiple tools |

## Tools (32 total)

### File Operations (8)
- `read_file` - Read files with line ranges
- `write_file` - Create/update files
- `edit_file` - Find and replace text
- `delete_file` - Delete files/directories
- `move_file` - Move or rename files
- `copy_file` - Copy files
- `list_directory` - Browse with glob patterns
- `file_info` - Get detailed file information

### Search Operations (4)
- `grep_search` - Search content with regex (ripgrep)
- `glob_find` - Find files by pattern
- `search_replace` - Search and replace across files
- `search_symbols` - Find functions, classes, exports

### Shell Operations (3)
- `run_command` - Execute shell commands
- `run_script` - Run npm/node/python scripts
- `get_process_info` - Get process information

### Database Operations (4)
- `sql_query` - Execute SELECT queries
- `sql_execute` - Execute INSERT/UPDATE/DELETE
- `db_schema` - Get table schema
- `db_tables` - List all tables

### Project Intelligence (6)
- `get_guidelines` - **CALL FIRST!** Get critical rules
- `get_repo_info` - Project overview
- `code_map` - Map code structure
- `dependency_graph` - Analyze dependencies
- `todo_list` - Find TODOs/FIXMEs
- `project_stats` - Get project statistics

### MCP Diagnostics (3)
- `mcp_status` - Server status/health
- `mcp_test` - Test tool functionality
- `mcp_logs` - View request history

### AI Operations (4)
- `ai_analyze` - Analyze code for issues
- `ai_suggest` - Suggest improvements
- `ai_explain` - Explain code structure
- `ai_refactor` - Identify refactoring opportunities

## Claude Desktop Setup

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vecto-pilot": {
      "url": "https://YOUR-REPLIT-DEV-URL/mcp"
    }
  }
}
```

## Usage

```bash
# Get server info
curl https://YOUR-URL/mcp

# List tools
curl https://YOUR-URL/mcp/tools

# Execute a tool
curl -X POST https://YOUR-URL/mcp/tools/read_file \
  -H "Content-Type: application/json" \
  -d '{"file_path": "package.json"}'
```
