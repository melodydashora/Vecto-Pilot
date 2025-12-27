# Vecto Pilot MCP Server

Full-featured MCP (Model Context Protocol) server with **39 tools** for complete repo access from Claude Desktop.

## What's Included

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

### Search Operations (4 tools)
| Tool | Description |
|------|-------------|
| `grep_search` | Search content with regex (ripgrep) |
| `glob_find` | Find files by pattern |
| `search_replace` | Search and replace across files |
| `search_symbols` | Find functions, classes, exports |

### Shell Operations (3 tools)
| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands |
| `run_script` | Run npm/node/python scripts |
| `get_process_info` | Get process information |

### Database Operations (4 tools)
| Tool | Description |
|------|-------------|
| `sql_query` | Execute SELECT queries |
| `sql_execute` | Execute INSERT/UPDATE/DELETE |
| `db_schema` | Get table schema |
| `db_tables` | List all tables |

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

### Project Intelligence (6 tools)
| Tool | Description |
|------|-------------|
| `get_guidelines` | **CALL FIRST!** Get critical rules and warnings |
| `get_repo_info` | Project overview |
| `code_map` | Map code structure |
| `dependency_graph` | Analyze dependencies |
| `todo_list` | Find TODOs/FIXMEs |
| `project_stats` | Get project statistics |

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

## Quick Start

### 1. Install Dependencies

```bash
cd mcp-server
npm install
```

### 2. Start the Server

```bash
# Default port 3001
npm start

# Or with custom port and repo root
REPO_ROOT=/home/runner/workspace MCP_PORT=3001 npm start
```

### 3. Test It

```bash
# Health check
curl http://localhost:3001/health

# List all tools
curl http://localhost:3001/mcp/tools

# Execute a tool
curl -X POST http://localhost:3001/mcp/tools/read_file \
  -H "Content-Type: application/json" \
  -d '{"file_path": "package.json"}'
```

## Connecting to Claude Desktop

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json` on Linux/Mac or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "vecto-pilot": {
      "url": "https://69f9de93-7dc3-48aa-9050-4c395406d344-00-3uat6a5ciur3j.riker.replit.dev/mcp"
    }
  }
}
```

For local development:

```json
{
  "mcpServers": {
    "vecto-pilot": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/mcp` | GET | Server info & capabilities |
| `/mcp/tools` | GET | List all available tools |
| `/mcp/tools/:name` | POST | Execute a tool |
| `/mcp/batch` | POST | Batch execute multiple tools |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | 3001 | Server port |
| `REPO_ROOT` | cwd | Root directory for file operations |
| `DATABASE_URL` | - | PostgreSQL connection string |

## Tool Examples

### Read a file with line range
```json
{
  "file_path": "src/index.js",
  "offset": 1,
  "limit": 50
}
```

### Search for a pattern
```json
{
  "pattern": "export.*function",
  "file_type": "js",
  "context_lines": 2
}
```

### Execute a command
```json
{
  "command": "npm run build",
  "timeout": 60000
}
```

### Query the database
```json
{
  "query": "SELECT * FROM users WHERE created_at > $1",
  "params": ["2024-01-01"],
  "limit": 10
}
```

### Store a memory
```json
{
  "key": "project_notes",
  "content": "Important implementation detail...",
  "tags": ["notes", "architecture"]
}
```

## Memory Table Setup

If using database-backed memory, create the table:

```sql
CREATE TABLE IF NOT EXISTS mcp_memory (
  key VARCHAR(255) PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_mcp_memory_tags ON mcp_memory USING GIN (tags);
```

## Architecture

```
mcp-server/
├── src/
│   ├── index.js           # Main server
│   └── tools/
│       ├── file-tools.js     # File operations
│       ├── search-tools.js   # Search operations
│       ├── shell-tools.js    # Shell execution
│       ├── database-tools.js # Database operations
│       ├── web-tools.js      # Web operations
│       ├── memory-tools.js   # Memory/context
│       ├── project-tools.js  # Project intelligence
│       ├── mcp-tools.js      # MCP diagnostics
│       └── ai-tools.js       # AI operations
├── package.json
└── README.md
```

## Security Considerations

- File operations are restricted to `REPO_ROOT`
- Database queries use parameterized statements
- Shell commands have configurable timeouts
- No eval() or dynamic code execution
- API keys should be set via environment variables

## License

MIT - Part of Vecto Pilot
