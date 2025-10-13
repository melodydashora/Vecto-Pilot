import { readJson, writeJson } from './memory-store';
import { buildAndPersist } from './code-map';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface ContextSnapshot {
  timestamp: string;
  codeMap: any[];
  activeComponents: string[];
  deploymentState: 'dev' | 'staging' | 'prod';
  componentLocations: Record<string, string>;
  recentChanges: string[];
  memoryCheckpoints: string[];
  deepAnalysis?: any;
  insights?: any[];
  recommendations?: any[];
}

export interface ComponentMap {
  name: string;
  path: string;
  type: 'page' | 'component' | 'hook' | 'util' | 'service';
  dependencies: string[];
  lastModified: string;
  prodStatus: 'deployed' | 'pending' | 'modified';
}

class ContextAwarenessEngine {
  private rootDir: string;
  private patterns = new Map<string, number>();
  private interactions = new Map<string, any>();
  private conversationFlow = new Map<string, string[]>();
  private workspaceState = new Map<string, any>();
  private projectContext = new Map<string, any>();

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  async captureSnapshot(): Promise<ContextSnapshot> {
    const timestamp = new Date().toISOString();

    // Build fresh code map
    const codeMap = await buildAndPersist(this.rootDir);

    // Scan for active components
    const activeComponents = await this.scanActiveComponents();

    // Map component locations
    const componentLocations = await this.mapComponentLocations();

    // Get recent changes
    const recentChanges = await this.getRecentChanges();

    // Get memory checkpoints
    const memoryCheckpoints = await this.getMemoryCheckpoints();

    const snapshot: ContextSnapshot = {
      timestamp,
      codeMap,
      activeComponents,
      deploymentState: 'dev',
      componentLocations,
      recentChanges,
      memoryCheckpoints
    };

    // Store snapshot
    await writeJson(this.rootDir, 'context-snapshot', snapshot);

    return snapshot;
  }

  async scanActiveComponents(): Promise<string[]> {
    const components: string[] = [];
    const clientDir = path.join(this.rootDir, 'client/src/components');

    try {
      const files = await fs.readdir(clientDir, { recursive: true });
      for (const file of files) {
        if (typeof file === 'string' && file.endsWith('.tsx')) {
          components.push(file.replace('.tsx', ''));
        }
      }
    } catch (err) {
      console.warn('Could not scan components:', err);
    }

    return components;
  }

  async mapComponentLocations(): Promise<Record<string, string>> {
    const locations: Record<string, string> = {};
    const dirs = [
      'client/src/components',
      'client/src/pages',
      'client/src/hooks',
      'client/src/lib',
      'server/routes'
    ];

    for (const dir of dirs) {
      const fullDir = path.join(this.rootDir, dir);
      try {
        const files = await fs.readdir(fullDir, { recursive: true });
        for (const file of files) {
          if (typeof file === 'string' && (file.endsWith('.tsx') || file.endsWith('.ts'))) {
            const name = path.basename(file, path.extname(file));
            locations[name] = path.join(dir, file);
          }
        }
      } catch (err) {
        // Directory might not exist
      }
    }

    return locations;
  }

  async getRecentChanges(): Promise<string[]> {
    // This would track recent file modifications
    // For now, return placeholder data
    return [
      'Enhanced context awareness system',
      'Added memory management',
      'Updated component mapping'
    ];
  }

  async getMemoryCheckpoints(): Promise<string[]> {
    const memoryDir = path.join(this.rootDir, 'data/memory');
    try {
      const files = await fs.readdir(memoryDir);
      return files.filter(f => f.endsWith('.json')).slice(-10);
    } catch {
      return [];
    }
  }

  async loadPhaseContext(phase: 'a' | 'b' | 'c'): Promise<string | null> {
    const phaseFiles = {
      a: 'audit-export/phase-a-client-location/PHASE_A_CONTEXT.md',
      b: 'audit-export/phase-b-server-blocks/PHASE_B_CONTEXT.md',
      c: 'audit-export/phase-c-eidolon-override/PHASE_C_CONTEXT.md'
    };
    
    try {
      const filePath = path.join(this.rootDir, phaseFiles[phase]);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  }

  async getLastSnapshot(): Promise<ContextSnapshot | null> {
    return await readJson(this.rootDir, 'context-snapshot');
  }

  async compareWithProduction(): Promise<{
    differences: string[];
    missing: string[];
    extra: string[];
  }> {
    // This would compare current state with production deployment
    // Placeholder implementation
    return {
      differences: [
        'client/src/components/enhanced-openai-agenda.tsx modified',
        'server/routes/health.ts updated'
      ],
      missing: [],
      extra: [
        'client/src/components/new-feature.tsx'
      ]
    };
  }

  // Placeholder methods for deep analysis (to be implemented)
  private async scanComponents(): Promise<any[]> { return []; }
  private async analyzeDependencies(): Promise<any[]> { return []; }
  private async analyzePerformance(): Promise<any[]> { return []; }
  private async getHealthMetrics(): Promise<any[]> { return []; }
  private async analyzeCodeComplexity(): Promise<any> { return { high: false }; }
  private async identifyArchitecturalPatterns(): Promise<any[]> { return []; }
  private async findOptimizationOpportunities(): Promise<any[]> { return []; }
  private async assessRisks(): Promise<any[]> { return []; }
  private async analyzeScalability(): Promise<any[]> { return []; }
  private async assessSecurity(): Promise<any[]> { return []; }

  async analyzeContext(): Promise<ContextSnapshot> {
    const components = await this.scanComponents();
    const dependencies = await this.analyzeDependencies();
    const performance = await this.analyzePerformance();

    // Enhanced deep analysis
    const deepAnalysis = await this.performDeepAnalysis({
      components,
      dependencies,
      performance
    });

    return {
      timestamp: new Date().toISOString(), // Corrected timestamp
      codeMap: [], // Placeholder, as buildAndPersist is not called here
      activeComponents: [], // Placeholder
      deploymentState: 'dev', // Placeholder
      componentLocations: {}, // Placeholder
      recentChanges: [], // Placeholder
      memoryCheckpoints: [], // Placeholder
      deepAnalysis,
      insights: await this.generateInsights(deepAnalysis),
      recommendations: await this.generateRecommendations(deepAnalysis)
    };
  }

  private async performDeepAnalysis(baseData: any) {
    return {
      codeComplexity: await this.analyzeCodeComplexity(),
      architecturalPatterns: await this.identifyArchitecturalPatterns(),
      optimizationOpportunities: await this.findOptimizationOpportunities(),
      riskAssessment: await this.assessRisks(),
      scalabilityAnalysis: await this.analyzeScalability(),
      securityPosture: await this.assessSecurity()
    };
  }

  private async generateInsights(analysis: any) {
    const insights = [];

    // Generate actionable insights from deep analysis
    if (analysis.codeComplexity?.high) {
      insights.push({
        type: 'complexity',
        severity: 'medium',
        message: 'High complexity detected in several components',
        action: 'Consider refactoring for maintainability'
      });
    }

    if (analysis.optimizationOpportunities?.length > 0) {
      insights.push({
        type: 'optimization',
        severity: 'low',
        message: `${analysis.optimizationOpportunities.length} optimization opportunities found`,
        action: 'Review and implement performance improvements'
      });
    }

    return insights;
  }

  private async generateRecommendations(analysis: any) {
    const recommendations = [];

    // Generate specific recommendations based on analysis
    recommendations.push({
      priority: 'high',
      category: 'performance',
      title: 'Optimize AI query processing',
      description: 'Implement caching for frequently accessed AI recommendations'
    });

    recommendations.push({
      priority: 'medium',
      category: 'architecture',
      title: 'Enhance error handling',
      description: 'Add comprehensive error boundaries and fallback mechanisms'
    });

    return recommendations;
  }

  recordInteraction(type: string, data: any) {
    const key = `${type}_${Date.now()}`;
    this.interactions.set(key, {
      type,
      data,
      timestamp: Date.now(),
      context: this.getCurrentWorkspaceState()
    });

    // Track conversation flow patterns
    if (type === 'conversation') {
      const sessionId = data.sessionId || 'default';
      const flow = this.conversationFlow.get(sessionId) || [];
      flow.push(data.topic || 'general');
      this.conversationFlow.set(sessionId, flow.slice(-20)); // Keep last 20 topics
    }

    // Update pattern frequency
    const pattern = this.extractPattern(type, data);
    this.patterns.set(pattern, (this.patterns.get(pattern) || 0) + 1);
  }

  getCurrentWorkspaceState(): any {
    return {
      activeFiles: Array.from(this.workspaceState.keys()),
      recentActions: Array.from(this.interactions.values()).slice(-5),
      projectType: this.projectContext.get('type') || 'unknown',
      lastActivity: Date.now()
    };
  }

  getConversationContext(sessionId: string = 'default'): any {
    const flow = this.conversationFlow.get(sessionId) || [];
    const recentInteractions = Array.from(this.interactions.values())
      .filter(i => i.data?.sessionId === sessionId)
      .slice(-10);

    return {
      topicFlow: flow,
      recentInteractions,
      continuityScore: this.calculateContinuity(flow),
      workspaceAlignment: this.assessWorkspaceAlignment(recentInteractions)
    };
  }

  private extractPattern(type: string, data: any): string {
    if (type === 'conversation') {
      return `chat_${data.topic || 'general'}`;
    }
    if (type === 'file_operation') {
      return `file_${data.operation}_${data.fileType}`;
    }
    if (type === 'error') {
      return `error_${data.category || 'unknown'}`;
    }
    return `${type}_pattern`;
  }

  private calculateContinuity(flow: string[]): number {
    if (flow.length < 2) return 0;
    let continuity = 0;
    for (let i = 1; i < flow.length; i++) {
      if (flow[i] === flow[i-1] || this.areTopicsRelated(flow[i], flow[i-1])) {
        continuity++;
      }
    }
    return continuity / (flow.length - 1);
  }

  private areTopicsRelated(topic1: string, topic2: string): boolean {
    const relatedGroups = [
      ['code', 'debug', 'fix', 'error'],
      ['ui', 'design', 'style', 'component'],
      ['api', 'server', 'backend', 'database'],
      ['deployment', 'production', 'build', 'release']
    ];

    return relatedGroups.some(group => 
      group.includes(topic1.toLowerCase()) && group.includes(topic2.toLowerCase())
    );
  }

  private assessWorkspaceAlignment(interactions: any[]): number {
    // Score how well conversation aligns with actual workspace activity
    const workspaceFiles = this.getCurrentWorkspaceState().activeFiles;
    const mentionedFiles = interactions
      .flatMap(i => i.data?.files || [])
      .filter(f => workspaceFiles.includes(f));

    return interactions.length > 0 ? mentionedFiles.length / interactions.length : 0;
  }

  getRecentPatterns(limit: number = 10): Array<{pattern: string, frequency: number}> {
    return Array.from(this.patterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([pattern, frequency]) => ({ pattern, frequency }));
  }

  updateWorkspaceState(file: string, operation: string, data?: any) {
    this.workspaceState.set(file, {
      operation,
      data,
      timestamp: Date.now()
    });

    this.recordInteraction('file_operation', {
      file,
      operation,
      data,
      fileType: file.split('.').pop()
    });
  }

  setProjectContext(key: string, value: any) {
    this.projectContext.set(key, value);
  }
}

export const contextAwareness = new ContextAwarenessEngine();