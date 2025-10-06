
/**
 * Vecto Workspace Repair Tools
 * Universal workspace architectural analysis and optimization
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export default class WorkspaceRepairTools {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.analysisCache = new Map();
  }

  async scanWorkspaceArchitecture() {
    console.log('[workspace] Scanning workspace architecture...');

    try {
      const architecture = {
        frontend: await this.scanFrontend(),
        backend: await this.scanBackend(),
        database: await this.scanDatabase(),
        apis: await this.scanAPIs(),
        deployment: await this.scanDeployment(),
        timestamp: new Date().toISOString()
      };

      this.analysisCache.set('architecture', architecture);
      return architecture;

    } catch (err) {
      console.error('[workspace] Architecture scan failed:', err.message);
      return {
        status: 'error',
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async scanFrontend() {
    const clientDir = path.join(this.baseDir, 'client');
    
    try {
      await fs.access(clientDir);
      
      // Check for package.json
      const packagePath = path.join(clientDir, 'package.json');
      let packageInfo = null;
      try {
        const packageContent = await fs.readFile(packagePath, 'utf-8');
        packageInfo = JSON.parse(packageContent);
      } catch {}

      // Scan source files
      const srcFiles = await this.scanDirectory(path.join(clientDir, 'src'));
      
      return {
        status: 'found',
        type: 'React + TypeScript',
        packageInfo: packageInfo ? {
          name: packageInfo.name,
          version: packageInfo.version,
          dependencies: Object.keys(packageInfo.dependencies || {}).length,
          devDependencies: Object.keys(packageInfo.devDependencies || {}).length
        } : null,
        sourceFiles: srcFiles.length,
        buildTool: packageInfo?.scripts?.build ? 'Vite' : 'Unknown',
        components: srcFiles.filter(f => f.endsWith('.tsx')).length,
        pages: srcFiles.filter(f => f.includes('/pages/')).length,
        hooks: srcFiles.filter(f => f.includes('/hooks/')).length
      };

    } catch (err) {
      return {
        status: 'not_found',
        error: 'Client directory not accessible'
      };
    }
  }

  async scanBackend() {
    try {
      const serverDir = path.join(this.baseDir, 'server');
      const mainServerExists = await this.fileExists(path.join(this.baseDir, 'index.js'));
      
      let serverFiles = [];
      try {
        serverFiles = await this.scanDirectory(serverDir);
      } catch {}

      return {
        status: 'found',
        type: 'Node.js + Express',
        mainServer: mainServerExists ? 'index.js' : 'not_found',
        serverFiles: serverFiles.length,
        routes: serverFiles.filter(f => f.includes('/routes/')).length,
        middleware: serverFiles.filter(f => f.includes('/middleware/')).length,
        apis: serverFiles.filter(f => f.includes('api') || f.includes('route')).length,
        eidolonIntegration: serverFiles.some(f => f.includes('eidolon'))
      };

    } catch (err) {
      return {
        status: 'error',
        error: err.message
      };
    }
  }

  async scanDatabase() {
    const dbDir = path.join(this.baseDir, 'server', 'db');
    
    try {
      await fs.access(dbDir);
      const dbFiles = await this.scanDirectory(dbDir);
      
      return {
        status: 'found',
        type: 'SQLite',
        migrations: dbFiles.filter(f => f.includes('migration')).length,
        schemas: dbFiles.filter(f => f.endsWith('.sql')).length,
        location: 'server/db'
      };

    } catch (err) {
      return {
        status: 'not_configured',
        recommendation: 'Database directory not found'
      };
    }
  }

  async scanAPIs() {
    const routesDir = path.join(this.baseDir, 'server', 'routes');
    
    try {
      await fs.access(routesDir);
      const routeFiles = await this.scanDirectory(routesDir);
      
      return {
        status: 'found',
        routes: routeFiles.length,
        endpoints: routeFiles.map(f => path.basename(f, path.extname(f))),
        authentication: routeFiles.some(f => f.includes('auth')),
        healthChecks: routeFiles.some(f => f.includes('health'))
      };

    } catch (err) {
      return {
        status: 'basic',
        note: 'API routes defined in main server file'
      };
    }
  }

  async scanDeployment() {
    const replitFile = path.join(this.baseDir, '.replit');
    
    try {
      await fs.access(replitFile);
      const replitContent = await fs.readFile(replitFile, 'utf-8');
      
      return {
        status: 'configured',
        platform: 'Replit',
        configFile: '.replit',
        hasRunConfig: replitContent.includes('run'),
        hasModules: replitContent.includes('modules')
      };

    } catch (err) {
      return {
        status: 'not_configured',
        recommendation: 'No deployment configuration found'
      };
    }
  }

  async scanDirectory(dir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.baseDir, fullPath);
        
        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch (err) {
      console.warn(`[workspace] Directory scan failed for ${dir}: ${err.message}`);
    }
    
    return files;
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getAnalysisSummary() {
    const architecture = this.analysisCache.get('architecture');
    
    if (!architecture) {
      return { status: 'pending', message: 'No analysis available' };
    }
    
    return {
      status: 'complete',
      frontend: architecture.frontend?.status || 'unknown',
      backend: architecture.backend?.status || 'unknown',
      database: architecture.database?.status || 'unknown',
      apis: architecture.apis?.status || 'unknown',
      deployment: architecture.deployment?.status || 'unknown',
      lastAnalyzed: architecture.timestamp
    };
  }
}
