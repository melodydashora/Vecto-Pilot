
import fs from 'node:fs/promises';
import path from 'node:path';

function memoryRoot(root: string): string {
  return path.join(root, 'data', 'memory');
}

export async function writeJson(root: string, name: string, data: any): Promise<void> {
  const dir = memoryRoot(root);
  await fs.mkdir(dir, { recursive: true });
  
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const versioned = path.join(dir, `${name}.${ts}.json`);
  const payload = { version: ts, createdAt: new Date().toISOString(), data };
  await fs.writeFile(versioned, JSON.stringify(payload, null, 2), 'utf-8');
  const latest = path.join(dir, `${name}.latest.json`);
  await fs.writeFile(latest, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function readJson(root: string, name: string): Promise<any> {
  const dir = memoryRoot(root);
  const latest = path.join(dir, `${name}.latest.json`);
  try {
    const content = await fs.readFile(latest, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed.data;
  } catch {
    try {
      const files = await fs.readdir(dir);
      const matches = files.filter(f => f.startsWith(`${name}.`) && f.endsWith('.json')).sort();
      if (matches.length > 0) {
        const lastFile = path.join(dir, matches[matches.length - 1]);
        const content = await fs.readFile(lastFile, 'utf-8');
        const parsed = JSON.parse(content);
        return parsed.data;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

export async function listMemoryFiles(root: string): Promise<string[]> {
  const dir = memoryRoot(root);
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
}

export async function deleteMemory(root: string, name: string): Promise<void> {
  const dir = memoryRoot(root);
  try {
    const files = await fs.readdir(dir);
    const toDelete = files.filter(f => f.startsWith(`${name}.`));
    await Promise.all(toDelete.map(f => fs.unlink(path.join(dir, f))));
  } catch (err) {
    console.warn(`Could not delete memory ${name}:`, err);
  }
}
