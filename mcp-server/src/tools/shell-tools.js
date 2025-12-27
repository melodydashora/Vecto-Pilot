/**
 * Shell Execution Tools (3 tools)
 *
 * run_command, run_script, get_process_info
 */

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
let repoRoot = process.cwd();

// Track running processes
const runningProcesses = new Map();

export const shellTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // run_command - Execute a shell command
  // ─────────────────────────────────────────────────────────────────────────
  run_command: {
    category: 'shell',
    description: 'Execute a shell command and return output.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', default: 60000, description: 'Timeout in ms' },
        env: { type: 'object', description: 'Additional environment variables' }
      },
      required: ['command']
    },
    init(root) { repoRoot = root; },
    async execute({ command, cwd, timeout = 60000, env = {} }) {
      const workDir = cwd || repoRoot;
      const startTime = Date.now();

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workDir,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, ...env }
        });

        return {
          command,
          cwd: workDir,
          stdout: stdout.slice(0, 100000), // Limit output size
          stderr: stderr.slice(0, 10000),
          exit_code: 0,
          duration_ms: Date.now() - startTime
        };
      } catch (err) {
        return {
          command,
          cwd: workDir,
          stdout: err.stdout?.slice(0, 100000) || '',
          stderr: err.stderr?.slice(0, 10000) || err.message,
          exit_code: err.code || 1,
          duration_ms: Date.now() - startTime,
          error: err.message
        };
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // run_script - Run a script file (npm, node, python, etc.)
  // ─────────────────────────────────────────────────────────────────────────
  run_script: {
    category: 'shell',
    description: 'Run a script file with appropriate interpreter.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Script path or npm script name' },
        type: {
          type: 'string',
          enum: ['npm', 'node', 'python', 'bash', 'auto'],
          default: 'auto'
        },
        args: { type: 'array', items: { type: 'string' }, default: [] },
        background: { type: 'boolean', default: false },
        timeout: { type: 'number', default: 300000 }
      },
      required: ['script']
    },
    init(root) { repoRoot = root; },
    async execute({ script, type = 'auto', args = [], background = false, timeout = 300000 }) {
      let command;

      // Determine command based on type
      if (type === 'npm' || (type === 'auto' && !script.includes('/'))) {
        command = `npm run ${script} ${args.join(' ')}`.trim();
      } else if (type === 'node' || (type === 'auto' && script.endsWith('.js'))) {
        command = `node ${script} ${args.join(' ')}`.trim();
      } else if (type === 'python' || (type === 'auto' && script.endsWith('.py'))) {
        command = `python ${script} ${args.join(' ')}`.trim();
      } else if (type === 'bash' || (type === 'auto' && script.endsWith('.sh'))) {
        command = `bash ${script} ${args.join(' ')}`.trim();
      } else {
        command = `${script} ${args.join(' ')}`.trim();
      }

      if (background) {
        const proc = spawn(command, {
          shell: true,
          cwd: repoRoot,
          detached: true,
          stdio: 'pipe'
        });

        const processId = `proc_${Date.now()}`;
        runningProcesses.set(processId, {
          pid: proc.pid,
          command,
          started: new Date(),
          output: []
        });

        proc.stdout?.on('data', (data) => {
          const entry = runningProcesses.get(processId);
          if (entry) entry.output.push(data.toString());
        });

        proc.on('exit', (code) => {
          const entry = runningProcesses.get(processId);
          if (entry) entry.exit_code = code;
        });

        return {
          process_id: processId,
          pid: proc.pid,
          command,
          background: true,
          status: 'running'
        };
      }

      // Foreground execution
      return shellTools.run_command.execute({ command, timeout });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // get_process_info - Get info about running/completed processes
  // ─────────────────────────────────────────────────────────────────────────
  get_process_info: {
    category: 'shell',
    description: 'Get information about background processes or system processes.',
    inputSchema: {
      type: 'object',
      properties: {
        process_id: { type: 'string', description: 'Process ID from run_script' },
        list_all: { type: 'boolean', default: false, description: 'List all tracked processes' },
        system: { type: 'boolean', default: false, description: 'Get system process info' }
      }
    },
    init(root) { repoRoot = root; },
    async execute({ process_id, list_all = false, system = false }) {
      if (system) {
        try {
          const { stdout } = await execAsync('ps aux --sort=-%mem | head -20');
          return {
            type: 'system',
            processes: stdout
          };
        } catch (err) {
          return { error: err.message };
        }
      }

      if (list_all) {
        const processes = Array.from(runningProcesses.entries()).map(([id, info]) => ({
          id,
          pid: info.pid,
          command: info.command,
          started: info.started,
          exit_code: info.exit_code,
          output_lines: info.output.length
        }));
        return { processes, count: processes.length };
      }

      if (process_id) {
        const info = runningProcesses.get(process_id);
        if (!info) {
          return { error: 'Process not found', process_id };
        }
        return {
          process_id,
          pid: info.pid,
          command: info.command,
          started: info.started,
          exit_code: info.exit_code,
          output: info.output.join('').slice(-50000) // Last 50KB of output
        };
      }

      return { error: 'Provide process_id, list_all=true, or system=true' };
    }
  }
};
