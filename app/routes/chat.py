"""AI Chat Assistant API routes with full repo access"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import os
import subprocess
from pathlib import Path

from openai import AsyncOpenAI
from app.core.config import settings


router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    """Chat message request"""
    message: str
    conversation_history: Optional[List[Dict[str, Any]]] = []


class ChatResponse(BaseModel):
    """Chat message response"""
    response: str
    tool_calls: Optional[List[Dict[str, Any]]] = []


# Tool functions for GPT-5
def read_file(file_path: str) -> str:
    """Read a file from the repository"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        return f"File: {file_path}\n\n{content}"
    except Exception as e:
        return f"Error reading {file_path}: {str(e)}"


def write_file(file_path: str, content: str) -> str:
    """Write content to a file"""
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w') as f:
            f.write(content)
        return f"✅ Successfully wrote to {file_path}"
    except Exception as e:
        return f"Error writing {file_path}: {str(e)}"


def list_directory(directory: str = ".") -> str:
    """List files in a directory"""
    try:
        result = subprocess.run(
            ["ls", "-la", directory],
            capture_output=True,
            text=True,
            timeout=5
        )
        return f"Directory: {directory}\n\n{result.stdout}"
    except Exception as e:
        return f"Error listing {directory}: {str(e)}"


def search_files(pattern: str, directory: str = ".") -> str:
    """Search for files matching a pattern"""
    try:
        result = subprocess.run(
            ["find", directory, "-name", pattern, "-type", "f"],
            capture_output=True,
            text=True,
            timeout=10
        )
        return f"Files matching '{pattern}':\n\n{result.stdout}"
    except Exception as e:
        return f"Error searching: {str(e)}"


def grep_code(pattern: str, directory: str = "app") -> str:
    """Search for text/code patterns in files"""
    try:
        result = subprocess.run(
            ["grep", "-r", "-n", "-i", pattern, directory],
            capture_output=True,
            text=True,
            timeout=10
        )
        return f"Matches for '{pattern}':\n\n{result.stdout if result.stdout else 'No matches found'}"
    except Exception as e:
        return f"Error searching code: {str(e)}"


def execute_command(command: str) -> str:
    """Execute a safe shell command"""
    # Whitelist safe commands
    allowed_commands = ["ls", "find", "grep", "cat", "head", "tail", "wc", "tree", "pwd", "python", "pip"]
    
    cmd_parts = command.split()
    if not cmd_parts or cmd_parts[0] not in allowed_commands:
        return f"❌ Command '{cmd_parts[0] if cmd_parts else command}' not allowed. Safe commands: {', '.join(allowed_commands)}"
    
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        output = result.stdout if result.returncode == 0 else result.stderr
        return f"Command: {command}\n\n{output}"
    except Exception as e:
        return f"Error executing command: {str(e)}"


def get_repo_structure() -> str:
    """Get the repository structure"""
    try:
        result = subprocess.run(
            ["find", "app", "-type", "f", "-name", "*.py"],
            capture_output=True,
            text=True,
            timeout=10
        )
        return f"Repository Python files:\n\n{result.stdout}"
    except Exception as e:
        return f"Error: {str(e)}"


# Tool definitions for GPT-5
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file from the repository",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to read (e.g., 'app/main.py')"
                    }
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write or update a file in the repository",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file"
                    }
                },
                "required": ["file_path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "List files and directories",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Directory to list (default: current directory)"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "Find files by name pattern",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "File name pattern (e.g., '*.py', 'config*')"
                    },
                    "directory": {
                        "type": "string",
                        "description": "Directory to search in"
                    }
                },
                "required": ["pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "grep_code",
            "description": "Search for text patterns in code files",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Text pattern to search for"
                    },
                    "directory": {
                        "type": "string",
                        "description": "Directory to search in (default: app)"
                    }
                },
                "required": ["pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_command",
            "description": "Execute a safe shell command (ls, grep, cat, head, tail, wc, tree, pwd, python, pip)",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_repo_structure",
            "description": "Get overview of repository structure (all Python files)",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    }
]


# Map function names to actual functions
FUNCTION_MAP = {
    "read_file": read_file,
    "write_file": write_file,
    "list_directory": list_directory,
    "search_files": search_files,
    "grep_code": grep_code,
    "execute_command": execute_command,
    "get_repo_structure": get_repo_structure
}


@router.post("", response_model=ChatResponse)
async def chat_with_assistant(request: ChatRequest):
    """
    Chat with AI assistant with FULL repository access
    
    GPT-5 can:
    - Read any file in the repo
    - Write/edit files
    - Search code and files
    - Execute safe shell commands
    - List directories
    - Analyze and refactor code
    """
    try:
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        system_prompt = """You are an expert AI coding assistant with FULL ACCESS to the Vecto Pilot repository.

**Repository Overview:**
- Python FastAPI backend with MLOps infrastructure
- Triad AI pipeline: Claude Strategist → GPT-5 Planner → Gemini Validator
- 15-table PostgreSQL database for ML tracking
- Event store, model adapters, training/evaluation pipelines
- Fine-tuning infrastructure and observability system
- Safety guardrails with RELEASE_TOKEN and canary rollouts

**Your Capabilities:**
1. **Read files** - View any file in the repo
2. **Write files** - Create or modify files
3. **Search code** - Find patterns, functions, classes
4. **Execute commands** - Run safe shell commands
5. **List directories** - Explore repo structure

**Guidelines:**
- Use tools proactively to understand the codebase before answering
- Read files before editing them to understand context
- Make incremental, safe changes
- Test code changes when possible
- Explain what you're doing and why
- Format code properly with syntax highlighting

Always use your tools to explore and modify the repository. Be thorough and precise."""

        # Build messages
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(request.conversation_history)
        messages.append({"role": "user", "content": request.message})
        
        # Initial GPT-5 call with tools
        response = await client.chat.completions.create(
            model="gpt-5",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            max_completion_tokens=4000
        )
        
        response_message = response.choices[0].message
        tool_calls_made = []
        
        # Execute tool calls if any
        if response_message.tool_calls:
            messages.append(response_message)
            
            for tool_call in response_message.tool_calls:
                function_name = tool_call.function.name
                function_args = json.loads(tool_call.function.arguments)
                
                # Execute the function
                if function_name in FUNCTION_MAP:
                    function_result = FUNCTION_MAP[function_name](**function_args)
                    tool_calls_made.append({
                        "function": function_name,
                        "args": function_args,
                        "result": function_result[:500]  # Truncate for response
                    })
                    
                    # Add function result to messages
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": function_result
                    })
            
            # Get final response after tool execution
            final_response = await client.chat.completions.create(
                model="gpt-5",
                messages=messages,
                max_completion_tokens=4000
            )
            
            final_content = final_response.choices[0].message.content
        else:
            final_content = response_message.content
        
        return ChatResponse(
            response=final_content,
            tool_calls=tool_calls_made if tool_calls_made else None
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")
