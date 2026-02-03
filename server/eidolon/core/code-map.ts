
import fs from 'node:fs/promises';
import path from 'node:path';

interface CodeEntry {
  file: string;
  name: string;
  type: 'function' | 'class' | 'interface' | 'route' | 'export';
  line: number;
  signature: string;
  id: string;
}

export async function buildCodeMap(rootDir: string): Promise<CodeEntry[]> {
  const entries: CodeEntry[] = [];
  
  async function scanDir(dir: string) {
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        
        if (item.isDirectory()) {
          // Skip node_modules, dist, build directories
          if (!['node_modules', 'dist', 'build', '.git'].includes(item.name)) {
            await scanDir(fullPath);
          }
        } else if (item.isFile()) {
          const ext = path.extname(item.name);
          if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
            await scanFile(fullPath);
          }
        }
      }
    } catch (err) {
      console.warn(`Cannot scan directory ${dir}:`, err);
    }
  }

  async function scanFile(filePath: string) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(rootDir, filePath);

      extractFunctions(lines, relPath);
      extractClasses(lines, relPath);
      extractInterfaces(lines, relPath);
      extractRoutes(lines, relPath);
      extractExports(lines, relPath);
    } catch (err) {
      console.warn(`Cannot scan file ${filePath}:`, err);
    }
  }

  function addEntry(file: string, name: string, type: CodeEntry['type'], line: number, lines: string[]) {
    const lineIdx = Math.max(0, line - 1);
    const sig = lines[lineIdx]?.slice(0, 240) ?? '';
    const id = `${file}:${name}:${line}`;
    
    entries.push({
      file,
      name,
      type,
      line,
      signature: sig,
      id
    });
  }

  function extractFunctions(lines: string[], file: string) {
    const reFn = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
    const reArrow = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      let match = line.match(reFn);
      if (match) {
        addEntry(file, match[1], 'function', i + 1, lines);
        continue;
      }
      
      match = line.match(reArrow);
      if (match) {
        addEntry(file, match[1], 'function', i + 1, lines);
      }
    }
  }

  function extractClasses(lines: string[], file: string) {
    const reClass = /(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
    
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(reClass);
      if (match) {
        addEntry(file, match[1], 'class', i + 1, lines);
      }
    }
  }

  function extractInterfaces(lines: string[], file: string) {
    const reInterface = /(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
    
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(reInterface);
      if (match) {
        addEntry(file, match[1], 'interface', i + 1, lines);
      }
    }
  }

  function extractRoutes(lines: string[], file: string) {
    const reRoute = /([A-Za-z0-9_]+)\.(get|post|put|delete|patch|use)\s*\(\s*['"`]([^'"`]+)['"`]/;
    
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(reRoute);
      if (match) {
        addEntry(file, `${match[2].toUpperCase()} ${match[3]}`, 'route', i + 1, lines);
      }
    }
  }

  function extractExports(lines: string[], file: string) {
    const reExport = /export\s+\{\s*([^}]+)\s*\}/;
    
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(reExport);
      if (match) {
        const exports = match[1].split(',').map(e => e.trim());
        exports.forEach(exp => {
          if (exp) {
            addEntry(file, exp, 'export', i + 1, lines);
          }
        });
      }
    }
  }

  await scanDir(rootDir);
  return entries;
}

export async function loadLatestCodeMap(rootDir: string): Promise<CodeEntry[]> {
  try {
    const mapPath = path.join(rootDir, 'data', 'code-map.latest.json');
    const content = await fs.readFile(mapPath, 'utf-8');
    const data = JSON.parse(content);
    return data.entries || [];
  } catch {
    return buildCodeMap(rootDir);
  }
}

export async function buildAndPersist(rootDir: string): Promise<CodeEntry[]> {
  const entries = await buildCodeMap(rootDir);
  
  try {
    const dataDir = path.join(rootDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    const mapPath = path.join(dataDir, 'code-map.latest.json');
    const payload = {
      version: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      entries
    };
    
    await fs.writeFile(mapPath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not persist code map:', err);
  }
  
  return entries;
}
