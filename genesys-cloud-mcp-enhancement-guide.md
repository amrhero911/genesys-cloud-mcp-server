# Genesys Cloud MCP+ Enhancement Guide

## Phase 1: Project Setup & Core Structure

### 1.1 Initialize Base Project Structure
```bash
# Fork and clone the repository
git clone https://github.com/your-username/genesys-cloud-mcp-fork.git
cd genesys-cloud-mcp-fork
npm install

# Create enhanced directory structure
mkdir -p src/{tools,middleware,utils,types,services}
mkdir -p src/tools/{agent,queue,conversation,system}
mkdir -p tests/{unit,integration}
```

### 1.2 Core Package Dependencies
```json
{
  "name": "@yourorg/genesys-cloud-mcp-plus",
  "version": "1.0.0",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.4.0",
    "purecloud-platform-client-v2": "^210.0.0",
    "ws": "^8.14.0",
    "winston": "^3.10.0",
    "node-cron": "^3.0.2",
    "express": "^4.18.0",
    "helmet": "^7.0.0",
    "cors": "^2.8.5",
    "joi": "^17.9.0",
    "lodash": "^4.17.21",
    "dotenv": "^16.3.0"
  }
}
```

### 1.3 Core Authentication Module
```typescript
// src/services/auth.ts
import platformClient from 'purecloud-platform-client-v2';

export class GenesysAuthService {
  private client: any;
  private tokenRefreshInterval: NodeJS.Timeout | null = null;
  
  constructor(
    private clientId: string,
    private clientSecret: string,
    private environment: string = 'mypurecloud.com'
  ) {
    this.client = platformClient.ApiClient.instance;
    this.client.setEnvironment(environment);
  }

  async authenticate(): Promise<void> {
    try {
      const authData = await this.client.loginClientCredentialsGrant(
        this.clientId,
        this.clientSecret
      );
      
      // Auto-refresh token every 23 hours
      this.setupTokenRefresh();
      
      console.log('✅ Genesys Cloud authentication successful');
      return authData;
    } catch (error) {
      console.error('❌ Authentication failed:', error);
      throw error;
    }
  }

  private setupTokenRefresh(): void {
    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
    }
    
    this.tokenRefreshInterval = setInterval(async () => {
      try {
        await this.authenticate();
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }, 23 * 60 * 60 * 1000); // 23 hours
  }

  getApiClient() {
    return this.client;
  }
}
```

## Phase 2: Agent-Focused Tools Implementation

### 2.1 Real-Time Agent Status Tool
```typescript
// src/tools/agent/agent-status.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { GenesysAuthService } from '../../services/auth.js';

export class AgentStatusTool {
  constructor(private authService: GenesysAuthService) {}

  static definition: Tool = {
    name: 'get_agent_status',
    description: 'Get real-time agent status including routing status, presence, and current activity',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Agent user ID' },
        includeQueues: { type: 'boolean', default: true },
        format: { type: 'string', enum: ['json', 'llm'], default: 'json' }
      },
      required: ['userId']
    }
  };

  async execute(params: any) {
    const { userId, includeQueues = true, format = 'json' } = params;
    
    try {
      const usersApi = new platformClient.UsersApi();
      const routingApi = new platformClient.RoutingApi();
      
      // Get user details and routing status
      const [userDetails, routingStatus] = await Promise.all([
        usersApi.getUser(userId),
        usersApi.getUserRoutingstatus(userId)
      ]);

      let queueMemberships = [];
      if (includeQueues) {
        const userQueues = await routingApi.getUserQueues(userId);
        queueMemberships = userQueues.entities || [];
      }

      const result = {
        userId,
        name: userDetails.name,
        email: userDetails.email,
        routingStatus: {
          status: routingStatus.status,
          startTime: routingStatus.startTime,
          userId: routingStatus.userId
        },
        presence: {
          presenceDefinition: routingStatus.presenceDefinition,
          systemPresence: routingStatus.systemPresence,
          organizationPresence: routingStatus.organizationPresence
        },
        queueMemberships: queueMemberships.map(q => ({
          id: q.id,
          name: q.name,
          memberCount: q.memberCount
        })),
        timestamp: new Date().toISOString()
      };

      return format === 'llm' ? this.formatForLLM(result) : result;
    } catch (error) {
      throw new Error(`Failed to get agent status: ${error.message}`);
    }
  }

  private formatForLLM(data: any): string {
    return `
Agent Status Summary:
- Name: ${data.name} (${data.email})
- Routing Status: ${data.routingStatus.status}
- Presence: ${data.presence.presenceDefinition?.systemPresence || 'Unknown'}
- Active Queues: ${data.queueMemberships.length}
- Status Since: ${new Date(data.routingStatus.startTime).toLocaleString()}
    `.trim();
  }
}
```

### 2.2 Agent KPI Query Tool
```typescript
// src/tools/agent/agent-kpi.ts
export class AgentKPITool {
  constructor(private authService: GenesysAuthService) {}

  static definition: Tool = {
    name: 'get_agent_kpi',
    description: 'Get agent KPI statistics including AHT, talk time, call count, ACW, and transfers',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Agent user ID' },
        startDate: { type: 'string', description: 'Start date (ISO format)' },
        endDate: { type: 'string', description: 'End date (ISO format)' },
        interval: { type: 'string', enum: ['PT15M', 'PT1H', 'P1D'], default: 'P1D' }
      },
      required: ['userId', 'startDate', 'endDate']
    }
  };

  async execute(params: any) {
    const { userId, startDate, endDate, interval = 'P1D' } = params;
    
    try {
      const analyticsApi = new platformClient.AnalyticsApi();
      
      const query = {
        interval: startDate + '/' + endDate,
        granularity: interval,
        groupBy: ['userId'],
        metrics: [
          'nOffered',
          'nConnected',
          'nTransferred',
          'tTalk',
          'tAcw',
          'tHandle',
          'tHeld'
        ],
        filter: {
          type: 'and',
          predicates: [
            {
              type: 'dimension',
              dimension: 'userId',
              operator: 'matches',
              value: userId
            },
            {
              type: 'dimension',
              dimension: 'mediaType',
              operator: 'matches',
              value: 'voice'
            }
          ]
        }
      };

      const response = await analyticsApi.postAnalyticsUsersDetailsQuery(query);
      
      if (!response.userDetails || response.userDetails.length === 0) {
        return { message: 'No data found for the specified period' };
      }

      const userDetail = response.userDetails[0];
      const metrics = userDetail.primaryPresence?.[0]?.metrics || {};
      
      return {
        userId,
        period: { startDate, endDate },
        kpis: {
          callsOffered: metrics.nOffered?.sum || 0,
          callsConnected: metrics.nConnected?.sum || 0,
          callsTransferred: metrics.nTransferred?.sum || 0,
          totalTalkTime: metrics.tTalk?.sum || 0,
          totalAcwTime: metrics.tAcw?.sum || 0,
          totalHandleTime: metrics.tHandle?.sum || 0,
          totalHeldTime: metrics.tHeld?.sum || 0,
          averageHandleTime: metrics.tHandle?.sum && metrics.nConnected?.sum ? 
            (metrics.tHandle.sum / metrics.nConnected.sum) : 0,
          averageTalkTime: metrics.tTalk?.sum && metrics.nConnected?.sum ? 
            (metrics.tTalk.sum / metrics.nConnected.sum) : 0,
          transferRate: metrics.nConnected?.sum ? 
            ((metrics.nTransferred?.sum || 0) / metrics.nConnected.sum * 100) : 0
        }
      };
    } catch (error) {
      throw new Error(`Failed to get agent KPI: ${error.message}`);
    }
  }
}
```

## Phase 3: Queue & Routing Tools

### 3.1 Real-Time SLA Monitor
```typescript
// src/tools/queue/sla-monitor.ts
export class SLAMonitorTool {
  constructor(private authService: GenesysAuthService) {}

  static definition: Tool = {
    name: 'get_queue_sla_status',
    description: 'Monitor real-time SLA performance, wait times, and queue metrics',
    inputSchema: {
      type: 'object',
      properties: {
        queueIds: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Array of queue IDs to monitor'
        },
        slaThresholds: {
          type: 'object',
          properties: {
            waitTime: { type: 'number', default: 300 },
            slaPercentage: { type: 'number', default: 80 }
          }
        }
      },
      required: ['queueIds']
    }
  };

  async execute(params: any) {
    const { queueIds, slaThresholds = { waitTime: 300, slaPercentage: 80 } } = params;
    
    try {
      const analyticsApi = new platformClient.AnalyticsApi();
      const routingApi = new platformClient.RoutingApi();
      
      const results = await Promise.all(
        queueIds.map(async (queueId) => {
          const [queueDetails, queueStats] = await Promise.all([
            routingApi.getRoutingQueue(queueId),
            this.getQueueRealTimeStats(queueId)
          ]);

          const slaStatus = this.calculateSLAStatus(queueStats, slaThresholds);
          
          return {
            queueId,
            name: queueDetails.name,
            currentMetrics: {
              waitingCount: queueStats.waitingCount || 0,
              longestWaitTime: queueStats.longestWaitTime || 0,
              averageWaitTime: queueStats.averageWaitTime || 0,
              activeAgents: queueStats.activeAgents || 0,
              availableAgents: queueStats.availableAgents || 0
            },
            slaStatus: {
              percentage: slaStatus.percentage,
              isWithinThreshold: slaStatus.isWithinThreshold,
              threshold: slaThresholds.slaPercentage,
              waitTimeStatus: slaStatus.waitTimeStatus
            },
            alertLevel: this.determineAlertLevel(slaStatus, slaThresholds),
            timestamp: new Date().toISOString()
          };
        })
      );

      return { queues: results };
    } catch (error) {
      throw new Error(`Failed to get SLA status: ${error.message}`);
    }
  }

  private async getQueueRealTimeStats(queueId: string) {
    // Implementation for real-time queue stats
    const analyticsApi = new platformClient.AnalyticsApi();
    
    const query = {
      interval: new Date(Date.now() - 30*60*1000).toISOString() + '/' + new Date().toISOString(),
      granularity: 'PT15M',
      groupBy: ['queueId'],
      metrics: ['oWaiting', 'tWait'],
      filter: {
        type: 'dimension',
        dimension: 'queueId',
        operator: 'matches',
        value: queueId
      }
    };

    const response = await analyticsApi.postAnalyticsQueuesObservationsQuery(query);
    return this.processQueueStats(response);
  }

  private calculateSLAStatus(stats: any, thresholds: any) {
    const withinSLA = stats.averageWaitTime <= thresholds.waitTime;
    const percentage = withinSLA ? 100 : Math.max(0, 100 - (stats.averageWaitTime / thresholds.waitTime * 100));
    
    return {
      percentage: Math.round(percentage),
      isWithinThreshold: percentage >= thresholds.slaPercentage,
      waitTimeStatus: stats.longestWaitTime > thresholds.waitTime ? 'EXCEEDED' : 'WITHIN_LIMIT'
    };
  }

  private determineAlertLevel(slaStatus: any, thresholds: any): 'GREEN' | 'YELLOW' | 'RED' {
    if (slaStatus.percentage >= thresholds.slaPercentage) return 'GREEN';
    if (slaStatus.percentage >= thresholds.slaPercentage * 0.8) return 'YELLOW';
    return 'RED';
  }
}
```

### 3.2 Queue Alert System
```typescript
// src/tools/queue/queue-alerts.ts
export class QueueAlertSystem {
  private alertRules: Map<string, any> = new Map();
  private activeAlerts: Map<string, any> = new Map();

  constructor(private authService: GenesysAuthService) {}

  static definition: Tool = {
    name: 'setup_queue_alerts',
    description: 'Create threshold-based alerts for queue metrics',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
        rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              metric: { type: 'string', enum: ['waitTime', 'slaPercentage', 'waitingCount'] },
              threshold: { type: 'number' },
              operator: { type: 'string', enum: ['>', '<', '>=', '<='] },
              severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
              webhookUrl: { type: 'string' }
            }
          }
        }
      },
      required: ['queueId', 'rules']
    }
  };

  async execute(params: any) {
    const { queueId, rules } = params;
    
    this.alertRules.set(queueId, rules);
    
    // Start monitoring this queue
    this.startQueueMonitoring(queueId);
    
    return {
      success: true,
      message: `Alert rules configured for queue ${queueId}`,
      activeRules: rules.length
    };
  }

  private startQueueMonitoring(queueId: string) {
    setInterval(async () => {
      try {
        const rules = this.alertRules.get(queueId);
        if (!rules) return;

        const queueStats = await this.getQueueRealTimeStats(queueId);
        
        for (const rule of rules) {
          const currentValue = queueStats[rule.metric];
          const alertTriggered = this.evaluateRule(currentValue, rule);
          
          if (alertTriggered) {
            await this.triggerAlert(queueId, rule, currentValue);
          }
        }
      } catch (error) {
        console.error(`Queue monitoring error for ${queueId}:`, error);
      }
    }, 30000); // Check every 30 seconds
  }

  private evaluateRule(currentValue: number, rule: any): boolean {
    switch (rule.operator) {
      case '>': return currentValue > rule.threshold;
      case '<': return currentValue < rule.threshold;
      case '>=': return currentValue >= rule.threshold;
      case '<=': return currentValue <= rule.threshold;
      default: return false;
    }
  }

  private async triggerAlert(queueId: string, rule: any, currentValue: number) {
    const alertId = `${queueId}_${rule.metric}_${Date.now()}`;
    
    if (this.activeAlerts.has(alertId)) return; // Prevent spam
    
    const alert = {
      id: alertId,
      queueId,
      metric: rule.metric,
      currentValue,
      threshold: rule.threshold,
      severity: rule.severity,
      timestamp: new Date().toISOString()
    };

    this.activeAlerts.set(alertId, alert);
    
    // Send webhook notification
    if (rule.webhookUrl) {
      await this.sendWebhookAlert(rule.webhookUrl, alert);
    }
    
    // Clean up alert after 5 minutes to allow re-triggering
    setTimeout(() => {
      this.activeAlerts.delete(alertId);
    }, 5 * 60 * 1000);
  }

  private async sendWebhookAlert(webhookUrl: string, alert: any) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'QUEUE_ALERT',
          data: alert
        })
      });
      
      if (!response.ok) {
        console.error('Webhook alert failed:', response.statusText);
      }
    } catch (error) {
      console.error('Webhook alert error:', error);
    }
  }
}
```

## Phase 4: System & Admin Tools

### 4.1 Rate Limiting & Error Handling Middleware
```typescript
// src/middleware/rate-limiting.ts
export class RateLimitingMiddleware {
  private rateLimiters: Map<string, any> = new Map();
  private errorCounts: Map<string, number> = new Map();

  constructor(private logger: any) {}

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    backoffMs: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        if (error.status === 429) {
          const retryAfter = error.headers?.['retry-after'] || backoffMs;
          this.logger.warn(`Rate limited, retrying in ${retryAfter}ms (attempt ${attempt}/${maxRetries})`);
          await this.sleep(retryAfter);
          continue;
        }
        
        if (attempt === maxRetries) break;
        
        const delay = backoffMs * Math.pow(2, attempt - 1);
        this.logger.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  trackError(operation: string, error: Error): void {
    const key = `${operation}_${error.message}`;
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
    
    this.logger.error(`Operation failed: ${operation}`, {
      error: error.message,
      stack: error.stack,
      count: this.errorCounts.get(key)
    });
  }

  getErrorStats(): any {
    return Array.from(this.errorCounts.entries()).map(([key, count]) => ({
      operation: key,
      count
    }));
  }
}
```

### 4.2 WebSocket Support for Real-Time Updates
```typescript
// src/services/websocket-service.ts
import WebSocket from 'ws';

export class WebSocketService {
  private wss: WebSocket.Server;
  private connections: Map<string, WebSocket> = new Map();

  constructor(port: number = 8080) {
    this.wss = new WebSocket.Server({ port });
    this.setupWebSocketServer();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const clientId = this.generateClientId();
      this.connections.set(clientId, ws);
      
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(clientId, data);
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        this.connections.delete(clientId);
      });

      ws.send(JSON.stringify({ 
        type: 'connection',
        clientId,
        message: 'Connected to Genesys Cloud MCP+ WebSocket'
      }));
    });
  }

  private handleClientMessage(clientId: string, data: any): void {
    const ws = this.connections.get(clientId);
    if (!ws) return;

    switch (data.type) {
      case 'subscribe':
        this.handleSubscription(clientId, data);
        break;
      case 'unsubscribe':
        this.handleUnsubscription(clientId, data);
        break;
      default:
        ws.send(JSON.stringify({ error: 'Unknown message type' }));
    }
  }

  private handleSubscription(clientId: string, data: any): void {
    // Implementation for handling subscriptions to queue alerts, agent status changes, etc.
    const ws = this.connections.get(clientId);
    if (!ws) return;

    ws.send(JSON.stringify({
      type: 'subscription_confirmed',
      topic: data.topic,
      filters: data.filters
    }));
  }

  broadcast(topic: string, data: any): void {
    const message = JSON.stringify({
      type: 'broadcast',
      topic,
      data,
      timestamp: new Date().toISOString()
    });

    this.connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

## Phase 5: Main Server Integration

### 5.1 Enhanced MCP Server
```typescript
// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { GenesysAuthService } from './services/auth.js';
import { AgentStatusTool } from './tools/agent/agent-status.js';
import { AgentKPITool } from './tools/agent/agent-kpi.js';
import { SLAMonitorTool } from './tools/queue/sla-monitor.js';
import { QueueAlertSystem } from './tools/queue/queue-alerts.js';
import { WebSocketService } from './services/websocket-service.js';
import { RateLimitingMiddleware } from './middleware/rate-limiting.js';
import winston from 'winston';

export class GenesysCloudMCPServer {
  private server: Server;
  private authService: GenesysAuthService;
  private webSocketService: WebSocketService;
  private rateLimitingMiddleware: RateLimitingMiddleware;
  private logger: winston.Logger;
  
  private tools: Map<string, any> = new Map();

  constructor() {
    this.setupLogger();
    this.server = new Server(
      {
        name: 'genesys-cloud-mcp-plus',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.authService = new GenesysAuthService(
      process.env.GENESYS_CLIENT_ID!,
      process.env.GENESYS_CLIENT_SECRET!,
      process.env.GENESYS_ENVIRONMENT
    );

    this.webSocketService = new WebSocketService(8080);
    this.rateLimitingMiddleware = new RateLimitingMiddleware(this.logger);
    
    this.initializeTools();
    this.setupHandlers();
  }

  private setupLogger(): void {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console()
      ]
    });
  }

  private initializeTools(): void {
    // Agent Tools
    this.tools.set('get_agent_status', new AgentStatusTool(this.authService));
    this.tools.set('get_agent_kpi', new AgentKPITool(this.authService));
    
    // Queue Tools
    this.tools.set('get_queue_sla_status', new SLAMonitorTool(this.authService));
    this.tools.set('setup_queue_alerts', new QueueAlertSystem(this.authService));
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler('tools/list', async () => {
      return {
        tools: Array.from(this.tools.values()).map(tool => tool.constructor.definition)
      };
    });

    // Execute tool calls
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;
      
      if (!this.tools.has(name)) {
        throw new Error(`Tool ${name} not found`);
      }

      const tool = this.tools.get(name);
      
      try {
        const result = await this.rateLimitingMiddleware.executeWithRetry(
          () => tool.execute(args)
        );
        
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        this.rateLimitingMiddleware.trackError(name, error);
        throw error;
      }
    });

    // Health check endpoint
    this.server.setRequestHandler('ping', async () => {
      return { status: 'healthy', timestamp: new Date().toISOString() };
    });
  }

  async start(): Promise<void> {
    try {
      await this.authService.authenticate();
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      this.logger.info('🚀 Genesys Cloud MCP+ Server started successfully');
    } catch (error) {
      this.logger.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the server
if (require.main === module) {
  const server = new GenesysCloudMCPServer();
  server.start().catch(console.error);
}
```

## Phase 6: Testing & Deployment

### 6.1 Unit Tests
```typescript
// tests/unit/agent-status.test.ts
import { expect } from 'chai';
import { AgentStatusTool } from '../../src/tools/agent/agent-status.js';

describe('AgentStatusTool', () => {
  let tool: AgentStatusTool;
  
  beforeEach(() => {
    // Mock auth service
    const mockAuthService = {
      getApiClient: () => ({})
    };
    tool = new AgentStatusTool(mockAuthService as any);
  });

  it('should have correct tool definition', () => {
    expect(AgentStatusTool.definition.name).to.equal('get_agent_status');
    expect(AgentStatusTool.definition.inputSchema.required).to.include('userId');
  });

  it('should format data for LLM consumption', () => {
    const mockData = {
      name: 'John Doe',
      email: 'john@example.com',
      routingStatus: { status: 'IDLE', startTime: '2023-01-01T00:00:00Z' },
      presence: { presenceDefinition: { systemPresence: 'Available' } },
      queueMemberships: [{ name: 'Support' }]
    };
    
    const formatted = tool['formatForLLM'](mockData);
    expect(formatted).to.include('John Doe');
    expect(formatted).to.include('IDLE');
  });
});
```

### 6.2 Package.json Scripts
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/server.ts",
    "test": "mocha tests/**/*.test.ts",
    "test:watch": "mocha tests/**/*.test.ts --watch",
    "lint": "eslint src --ext .ts",
    "start": "node dist/server.js",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

## Deployment Roadmap Summary

| Phase | Features | Key Files | Timeline |
|-------|----------|-----------|----------|
| 1 | Project Setup, Auth | `auth.ts`, `server.ts` | Week 1 |
| 2 | Agent Tools | `agent-status.ts`, `agent-kpi.ts` | Week 2 |
| 3 | Queue Tools | `sla-monitor.ts`, `queue-alerts.ts` | Week 3 |
| 4 | System Tools | `rate-limiting.ts`, `websocket-service.ts` | Week 4 |
| 5 | Integration | `server.ts`, tool registration | Week 5 |
| 6 | Testing & Deployment | Test files, CI/CD | Week 6 |

## Key Genesys Cloud API Endpoints Used

- **Agent Status**: `/api/v2/users/{userId}/routingstatus`
- **Agent KPI**: `/api/v2/analytics/users/details/query`
- **Queue Stats**: `/api/v2/analytics/queues/observations/query`
- **Queue Details**: `/api/v2/routing/queues/{queueId}`
- **User Details**: `/api/v2/users/{userId}`

## Potential Challenges & Solutions

1. **Rate Limiting**: Implement exponential backoff and request queuing
2. **Token Refresh**: Auto-refresh OAuth tokens every 23 hours
3. **Real-time Data**: Use WebSockets for live updates
4. **Error Handling**: Comprehensive logging and retry mechanisms
5. **Performance**: Batch API calls and implement caching where appropriate

## Publishing to NPM

```bash
# Build and test
npm run build
npm test

# Update version
npm version patch

# Publish
npm publish --access public
```

This guide provides a comprehensive foundation for building your enhanced Genesys Cloud MCP+ server with all the requested features while maintaining the existing OAuth authentication patterns.