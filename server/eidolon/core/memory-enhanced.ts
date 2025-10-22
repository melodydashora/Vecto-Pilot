
import { readJson, writeJson } from './memory-store';
import { contextAwareness } from './context-awareness';

export interface MemoryEntry {
  id: string;
  timestamp: string;
  type: 'conversation' | 'codebase' | 'deployment' | 'user_preference';
  content: any;
  tags: string[];
  importance: number; // 1-10
  relationships: string[]; // IDs of related memories
}

export interface EnhancedMemory {
  entries: MemoryEntry[];
  lastUpdated: string;
  totalEntries: number;
  contextMap: Record<string, string[]>;
}

class MemoryManager {
  private rootDir: string;
  
  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  async storeMemory(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string> {
    const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    const memoryEntry: MemoryEntry = {
      id,
      timestamp,
      ...entry
    };
    
    const currentMemory = await this.getMemory();
    currentMemory.entries.push(memoryEntry);
    currentMemory.lastUpdated = timestamp;
    currentMemory.totalEntries = currentMemory.entries.length;
    
    // Update context map
    entry.tags.forEach(tag => {
      if (!currentMemory.contextMap[tag]) {
        currentMemory.contextMap[tag] = [];
      }
      currentMemory.contextMap[tag].push(id);
    });
    
    // Keep only recent 1000 entries to prevent bloat
    if (currentMemory.entries.length > 1000) {
      currentMemory.entries = currentMemory.entries.slice(-1000);
    }
    
    await writeJson(this.rootDir, 'enhanced-memory', currentMemory);
    return id;
  }

  async getMemory(): Promise<EnhancedMemory> {
    const existing = await readJson(this.rootDir, 'enhanced-memory');
    if (existing) {
      return existing;
    }
    
    return {
      entries: [],
      lastUpdated: new Date().toISOString(),
      totalEntries: 0,
      contextMap: {}
    };
  }

  async getMemoriesByTag(tag: string): Promise<MemoryEntry[]> {
    const memory = await this.getMemory();
    return memory.entries.filter(entry => entry.tags.includes(tag));
  }

  async getRecentMemories(limit: number = 10): Promise<MemoryEntry[]> {
    const memory = await this.getMemory();
    return memory.entries.slice(-limit);
  }

  async getRelatedMemories(memoryId: string): Promise<MemoryEntry[]> {
    const memory = await this.getMemory();
    const targetMemory = memory.entries.find(e => e.id === memoryId);
    if (!targetMemory) return [];
    
    return memory.entries.filter(e => 
      targetMemory.relationships.includes(e.id) ||
      e.relationships.includes(memoryId)
    );
  }

  async recordInteraction(interaction: {
    type: string;
    content: string;
    context: string[];
  }): Promise<void> {
    await this.storeMemory({
      type: 'conversation',
      content: interaction,
      tags: ['interaction', ...interaction.context],
      importance: 5,
      relationships: []
    });
  }

  async recordCodebaseChange(change: {
    files: string[];
    description: string;
    impact: string;
  }): Promise<void> {
    await this.storeMemory({
      type: 'codebase',
      content: change,
      tags: ['codebase', 'change', ...change.files],
      importance: 7,
      relationships: []
    });
  }

  async getContextSummary(): Promise<{
    recentChanges: MemoryEntry[];
    componentMap: Record<string, string[]>;
    interactions: number;
    codebaseUpdates: number;
  }> {
    const memory = await this.getMemory();
    const recentChanges = this.getRecentMemories(5);
    const interactions = memory.entries.filter(e => e.type === 'conversation').length;
    const codebaseUpdates = memory.entries.filter(e => e.type === 'codebase').length;
    
    return {
      recentChanges: await recentChanges,
      componentMap: memory.contextMap,
      interactions,
      codebaseUpdates
    };
  }
}

export const memoryManager = new MemoryManager();
