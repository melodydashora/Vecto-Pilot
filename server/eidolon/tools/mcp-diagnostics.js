
/**
 * MCP (Model Context Protocol) Diagnostics and Repair Tools
 * Part of Eidolon Enhanced SDK
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export default class MCPDiagnostics {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.mcpServers = new Map();
    this.diagnosticResults = new Map();
  }

  async scanMCPConfiguration() {
    console.log('[mcp] Scanning MCP server configuration...');
    
    try {
      // Check for common MCP configuration files
      const configFiles = [
        '.replit-assistant-override.json',
        'mcp-config.json',
        'server-config.json'
      ];

      const foundConfigs = [];
      for (const configFile of configFiles) {
        try {
          const configPath = path.join(this.baseDir, configFile);
          await fs.access(configPath);
          const content = await fs.readFile(configPath, 'utf-8');
          foundConfigs.push({
            file: configFile,
            content: JSON.parse(content),
            status: 'valid'
          });
        } catch (err) {
          foundConfigs.push({
            file: configFile,
            status: 'missing',
            error: err.message
          });
        }
      }

      const diagnosis = {
        timestamp: new Date().toISOString(),
        configFiles: foundConfigs,
        mcpServers: Array.from(this.mcpServers.values()),
        status: foundConfigs.some(c => c.status === 'valid') ? 'configured' : 'needs_setup',
        recommendations: this.generateRecommendations(foundConfigs)
      };

      this.diagnosticResults.set('configuration', diagnosis);
      return diagnosis;

    } catch (err) {
      console.error('[mcp] Configuration scan failed:', err.message);
      return {
        status: 'error',
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async testMCPConnections() {
    console.log('[mcp] Testing MCP server connections...');

    const connectionTests = [];

    // Test local agent connection
    try {
      const agentUrl = process.env.AGENT_BASE_URL || 'http://127.0.0.1:43717';
      const response = await fetch(`${agentUrl}/agent/health`, { 
        method: 'GET',
        timeout: 5000 
      });
      
      connectionTests.push({
        server: 'local_agent',
        url: agentUrl,
        status: response.ok ? 'connected' : 'error',
        responseTime: Date.now(),
        details: response.ok ? 'Healthy' : `HTTP ${response.status}`
      });
    } catch (err) {
      connectionTests.push({
        server: 'local_agent',
        status: 'failed',
        error: err.message
      });
    }

    // Test main server health
    try {
      const mainPort = process.env.PORT || 3000;
      const response = await fetch(`http://localhost:${mainPort}/health`, {
        method: 'GET',
        timeout: 3000
      });

      connectionTests.push({
        server: 'main_server',
        url: `http://localhost:${mainPort}`,
        status: response.ok ? 'connected' : 'error',
        responseTime: Date.now(),
        details: response.ok ? 'Healthy' : `HTTP ${response.status}`
      });
    } catch (err) {
      connectionTests.push({
        server: 'main_server',
        status: 'failed',
        error: err.message
      });
    }

    return {
      timestamp: new Date().toISOString(),
      tests: connectionTests,
      summary: {
        total: connectionTests.length,
        passed: connectionTests.filter(t => t.status === 'connected').length,
        failed: connectionTests.filter(t => t.status === 'failed').length
      }
    };
  }

  async repairMCPServer(issues = []) {
    console.log('[mcp] Executing MCP server repairs...');

    const repairs = [];

    // Auto-repair missing configuration
    if (issues.includes('missing_config') || issues.length === 0) {
      try {
        const configPath = path.join(this.baseDir, '.replit-assistant-override.json');
        const defaultConfig = {
          assistant_override: true,
          eidolon_enhanced: true,
          version: "4.1.0",
          capabilities: [
            "enhanced_memory",
            "cross_chat_awareness", 
            "workspace_intelligence",
            "mcp_diagnostics"
          ],
          created: new Date().toISOString()
        };

        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
        repairs.push({
          type: 'config_creation',
          file: '.replit-assistant-override.json',
          status: 'completed',
          details: 'Created default MCP configuration'
        });
      } catch (err) {
        repairs.push({
          type: 'config_creation',
          status: 'failed',
          error: err.message
        });
      }
    }

    // Verify server processes
    try {
      const processes = await this.checkServerProcesses();
      repairs.push({
        type: 'process_check',
        status: 'completed',
        details: `Found ${processes.length} server processes`
      });
    } catch (err) {
      repairs.push({
        type: 'process_check',
        status: 'failed',
        error: err.message
      });
    }

    return repairs;
  }

  async checkServerProcesses() {
    // Simulate process checking (would use actual process monitoring in production)
    return [
      { pid: process.pid, name: 'eidolon-main', status: 'running' }
    ];
  }

  generateRecommendations(configFiles) {
    const recommendations = [];

    if (!configFiles.some(c => c.status === 'valid')) {
      recommendations.push('Create MCP server configuration file');
    }

    recommendations.push('Monitor server health endpoints regularly');
    recommendations.push('Implement automated error recovery');
    recommendations.push('Set up performance monitoring');

    return recommendations;
  }

  getDiagnosticSummary() {
    return {
      lastScan: this.diagnosticResults.get('configuration')?.timestamp,
      serverCount: this.mcpServers.size,
      status: this.diagnosticResults.size > 0 ? 'operational' : 'pending',
      capabilities: ['scan', 'test', 'repair', 'monitor']
    };
  }
}
