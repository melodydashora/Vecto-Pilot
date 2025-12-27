/**
 * File Operation Tools (8 tools)
 *
 * read_file, write_file, edit_file, delete_file,
 * move_file, copy_file, list_directory, file_info
 */

import fs from 'node:fs/promises';
import path from 'node:path';

let repoRoot = process.cwd();

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(repoRoot, filePath);
}

export const fileTools = {
  // ─────────────────────────────────────────────────────────────────────────
  // read_file - Read file contents with optional line ranges
  // ─────────────────────────────────────────────────────────────────────────
  read_file: {
    category: 'file',
    description: 'Read file contents. Supports line ranges with offset/limit.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file (relative or absolute)' },
        offset: { type: 'number', description: 'Start line (1-indexed)' },
        limit: { type: 'number', description: 'Number of lines to read' },
        encoding: { type: 'string', default: 'utf-8' }
      },
      required: ['file_path']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, offset, limit, encoding = 'utf-8' }) {
      const fullPath = resolvePath(file_path);
      const content = await fs.readFile(fullPath, encoding);
      const lines = content.split('\n');

      if (offset || limit) {
        const start = (offset || 1) - 1;
        const end = limit ? start + limit : lines.length;
        const slicedLines = lines.slice(start, end);
        return {
          file_path: fullPath,
          content: slicedLines.map((line, i) => `${start + i + 1}\t${line}`).join('\n'),
          total_lines: lines.length,
          returned_lines: slicedLines.length
        };
      }

      return {
        file_path: fullPath,
        content,
        total_lines: lines.length
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // write_file - Create or overwrite a file
  // ─────────────────────────────────────────────────────────────────────────
  write_file: {
    category: 'file',
    description: 'Create or overwrite a file with content.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' },
        content: { type: 'string', description: 'File content' },
        create_dirs: { type: 'boolean', default: true, description: 'Create parent directories if needed' }
      },
      required: ['file_path', 'content']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, content, create_dirs = true }) {
      const fullPath = resolvePath(file_path);

      if (create_dirs) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
      }

      await fs.writeFile(fullPath, content, 'utf-8');
      const stats = await fs.stat(fullPath);

      return {
        file_path: fullPath,
        bytes_written: stats.size,
        created: true
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // edit_file - Find and replace text in a file
  // ─────────────────────────────────────────────────────────────────────────
  edit_file: {
    category: 'file',
    description: 'Edit a file by replacing old_string with new_string.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' },
        old_string: { type: 'string', description: 'Text to find' },
        new_string: { type: 'string', description: 'Text to replace with' },
        replace_all: { type: 'boolean', default: false, description: 'Replace all occurrences' }
      },
      required: ['file_path', 'old_string', 'new_string']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, old_string, new_string, replace_all = false }) {
      const fullPath = resolvePath(file_path);
      let content = await fs.readFile(fullPath, 'utf-8');

      const count = (content.match(new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

      if (count === 0) {
        throw new Error(`String not found in file: "${old_string.slice(0, 50)}..."`);
      }

      if (count > 1 && !replace_all) {
        throw new Error(`Found ${count} occurrences. Use replace_all=true or provide more context.`);
      }

      if (replace_all) {
        content = content.split(old_string).join(new_string);
      } else {
        content = content.replace(old_string, new_string);
      }

      await fs.writeFile(fullPath, content, 'utf-8');

      return {
        file_path: fullPath,
        replacements: replace_all ? count : 1,
        success: true
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // delete_file - Delete a file or directory
  // ─────────────────────────────────────────────────────────────────────────
  delete_file: {
    category: 'file',
    description: 'Delete a file or directory.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file or directory' },
        recursive: { type: 'boolean', default: false, description: 'Delete directories recursively' }
      },
      required: ['file_path']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path, recursive = false }) {
      const fullPath = resolvePath(file_path);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        await fs.rm(fullPath, { recursive });
      } else {
        await fs.unlink(fullPath);
      }

      return {
        file_path: fullPath,
        deleted: true,
        was_directory: stats.isDirectory()
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // move_file - Move or rename a file
  // ─────────────────────────────────────────────────────────────────────────
  move_file: {
    category: 'file',
    description: 'Move or rename a file.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' }
      },
      required: ['source', 'destination']
    },
    init(root) { repoRoot = root; },
    async execute({ source, destination }) {
      const srcPath = resolvePath(source);
      const destPath = resolvePath(destination);

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.rename(srcPath, destPath);

      return {
        source: srcPath,
        destination: destPath,
        moved: true
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // copy_file - Copy a file
  // ─────────────────────────────────────────────────────────────────────────
  copy_file: {
    category: 'file',
    description: 'Copy a file to a new location.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path' },
        destination: { type: 'string', description: 'Destination path' }
      },
      required: ['source', 'destination']
    },
    init(root) { repoRoot = root; },
    async execute({ source, destination }) {
      const srcPath = resolvePath(source);
      const destPath = resolvePath(destination);

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);

      return {
        source: srcPath,
        destination: destPath,
        copied: true
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // list_directory - List directory contents with glob support
  // ─────────────────────────────────────────────────────────────────────────
  list_directory: {
    category: 'file',
    description: 'List directory contents. Supports glob patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path or glob pattern' },
        recursive: { type: 'boolean', default: false },
        include_hidden: { type: 'boolean', default: false }
      },
      required: ['path']
    },
    init(root) { repoRoot = root; },
    async execute({ path: dirPath, recursive = false, include_hidden = false }) {
      const fullPath = resolvePath(dirPath);

      // Check if it's a glob pattern
      if (dirPath.includes('*')) {
        const { glob } = await import('glob');
        const files = await glob(dirPath, {
          cwd: repoRoot,
          dot: include_hidden,
          nodir: false
        });
        return { pattern: dirPath, matches: files, count: files.length };
      }

      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const results = [];

      for (const entry of entries) {
        if (!include_hidden && entry.name.startsWith('.')) continue;

        const entryPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(entryPath);

        results.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          modified: stats.mtime
        });

        if (recursive && entry.isDirectory()) {
          const subEntries = await this.execute({
            path: entryPath,
            recursive: true,
            include_hidden
          });
          results.push(...subEntries.entries.map(e => ({
            ...e,
            name: path.join(entry.name, e.name)
          })));
        }
      }

      return {
        path: fullPath,
        entries: results,
        count: results.length
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // file_info - Get detailed file information
  // ─────────────────────────────────────────────────────────────────────────
  file_info: {
    category: 'file',
    description: 'Get detailed information about a file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' }
      },
      required: ['file_path']
    },
    init(root) { repoRoot = root; },
    async execute({ file_path }) {
      const fullPath = resolvePath(file_path);
      const stats = await fs.stat(fullPath);

      return {
        file_path: fullPath,
        exists: true,
        is_file: stats.isFile(),
        is_directory: stats.isDirectory(),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        permissions: stats.mode.toString(8).slice(-3)
      };
    }
  }
};
