
import { readJson, writeJson } from './memory-store';
import { contextAwareness } from './context-awareness';

export interface DeploymentRecord {
  id: string;
  timestamp: string;
  environment: 'dev' | 'staging' | 'prod';
  version: string;
  components: string[];
  status: 'pending' | 'deployed' | 'failed';
  changes: string[];
}

export interface ProductionState {
  lastDeployment: string;
  components: Record<string, {
    version: string;
    lastModified: string;
    status: 'active' | 'deprecated';
  }>;
  features: string[];
  configuration: Record<string, any>;
}

class DeploymentTracker {
  private rootDir: string;
  
  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  async recordDeployment(record: Omit<DeploymentRecord, 'id' | 'timestamp'>): Promise<string> {
    const id = `deploy_${Date.now()}`;
    const timestamp = new Date().toISOString();
    
    const deployment: DeploymentRecord = {
      id,
      timestamp,
      ...record
    };
    
    const history = await this.getDeploymentHistory();
    history.push(deployment);
    
    // Keep last 50 deployments
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
    
    await writeJson(this.rootDir, 'deployment-history', history);
    
    // Update production state if this is a prod deployment
    if (record.environment === 'prod' && record.status === 'deployed') {
      await this.updateProductionState(deployment);
    }
    
    return id;
  }

  async getDeploymentHistory(): Promise<DeploymentRecord[]> {
    const history = await readJson(this.rootDir, 'deployment-history');
    return history || [];
  }

  async getProductionState(): Promise<ProductionState | null> {
    return await readJson(this.rootDir, 'production-state');
  }

  async updateProductionState(deployment: DeploymentRecord): Promise<void> {
    const currentState = await this.getProductionState() || {
      lastDeployment: '',
      components: {},
      features: [],
      configuration: {}
    };
    
    currentState.lastDeployment = deployment.timestamp;
    
    // Update components
    deployment.components.forEach(component => {
      currentState.components[component] = {
        version: deployment.version,
        lastModified: deployment.timestamp,
        status: 'active'
      };
    });
    
    await writeJson(this.rootDir, 'production-state', currentState);
  }

  async compareWithDev(): Promise<{
    missingInDev: string[];
    extraInDev: string[];
    modifiedInDev: string[];
    syncRecommendations: string[];
  }> {
    const prodState = await this.getProductionState();
    if (!prodState) {
      return {
        missingInDev: [],
        extraInDev: [],
        modifiedInDev: [],
        syncRecommendations: ['No production state found. Consider initial deployment.']
      };
    }
    
    const currentSnapshot = await contextAwareness.getLastSnapshot();
    if (!currentSnapshot) {
      return {
        missingInDev: [],
        extraInDev: [],
        modifiedInDev: [],
        syncRecommendations: ['Capture a context snapshot first.']
      };
    }
    
    const prodComponents = Object.keys(prodState.components);
    const devComponents = currentSnapshot.activeComponents;
    
    const missingInDev = prodComponents.filter(c => !devComponents.includes(c));
    const extraInDev = devComponents.filter(c => !prodComponents.includes(c));
    const modifiedInDev = currentSnapshot.recentChanges;
    
    const syncRecommendations = [];
    if (missingInDev.length > 0) {
      syncRecommendations.push(`Add missing components: ${missingInDev.join(', ')}`);
    }
    if (extraInDev.length > 0) {
      syncRecommendations.push(`Consider deploying new components: ${extraInDev.join(', ')}`);
    }
    if (modifiedInDev.length > 0) {
      syncRecommendations.push(`Test recent changes before deployment`);
    }
    
    return {
      missingInDev,
      extraInDev,
      modifiedInDev,
      syncRecommendations
    };
  }

  async generateSyncPlan(): Promise<{
    actions: Array<{
      type: 'add' | 'update' | 'remove' | 'test';
      component: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
    }>;
    estimatedTime: string;
    risks: string[];
  }> {
    const comparison = await this.compareWithDev();
    const actions: Array<{
      type: 'add' | 'update' | 'remove' | 'test';
      component: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
    }> = [];
    
    // Add missing components
    comparison.missingInDev.forEach(component => {
      actions.push({
        type: 'add' as const,
        component,
        description: `Add ${component} from production`,
        priority: 'high' as const
      });
    });
    
    // Update modified components
    comparison.modifiedInDev.forEach(change => {
      actions.push({
        type: 'test' as const,
        component: change,
        description: `Test changes: ${change}`,
        priority: 'medium' as const
      });
    });
    
    // Deploy new components
    comparison.extraInDev.forEach(component => {
      actions.push({
        type: 'update' as const,
        component,
        description: `Consider deploying ${component}`,
        priority: 'low' as const
      });
    });
    
    return {
      actions,
      estimatedTime: `${actions.length * 5} minutes`,
      risks: [
        'Test all changes in staging first',
        'Backup current production state',
        'Monitor deployment for errors'
      ]
    };
  }
}

export const deploymentTracker = new DeploymentTracker();
