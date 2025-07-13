import platformClient from "purecloud-platform-client-v2";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Enhanced imports
import { createConfigRetriever } from "./createConfigRetriever.js";
import { OAuthClientCredentialsWrapper } from "./auth/OAuthClientCredentialsWrapper.js";
import { RateLimitingMiddleware } from "./middleware/rateLimitingMiddleware.js";
import { WebSocketService } from "./services/websocketService.js";
import { WebhookService } from "./services/webhookService.js";
import { SimpleCacheService } from "./services/cacheService.js";

// Existing tools
import { searchQueues } from "./tools/searchQueues.js";
import { sampleConversationsByQueue } from "./tools/sampleConversationsByQueue/sampleConversationsByQueue.js";
import { queryQueueVolumes } from "./tools/queryQueueVolumes/queryQueueVolumes.js";
import { voiceCallQuality } from "./tools/voiceCallQuality.js";
import { conversationSentiment } from "./tools/conversationSentiment/conversationSentiment.js";
import { conversationTopics } from "./tools/conversationTopics/conversationTopics.js";
import { searchVoiceConversations } from "./tools/searchVoiceConversations.js";
import { conversationTranscription } from "./tools/conversationTranscription/conversationTranscription.js";

// New enhanced tools
import { realTimeAgentStatus } from "./tools/agent/realTimeAgentStatus.js";
import { agentKpiDashboard } from "./tools/agent/agentKpiDashboard.js";
import { realTimeSlaMonitor } from "./tools/queue/realTimeSlaMonitor.js";
import { queueAlertSystem } from "./tools/queue/queueAlertSystem.js";

// Setup enhanced logging (basic console logging for now)
const logger = {
  info: (message: string, ...args: any[]) => console.log(`[INFO] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args)
};

// Enhanced configuration
const configRetriever = createConfigRetriever(process.env);
const rateLimitingMiddleware = new RateLimitingMiddleware({
  requestsPerMinute: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || '60'),
  burstLimit: parseInt(process.env.RATE_LIMIT_BURST_LIMIT || '10'),
  enabled: process.env.RATE_LIMIT_ENABLED !== 'false'
}, logger);

// Setup services
const webhookService = new WebhookService();
const cacheService = new SimpleCacheService();
let webSocketService: WebSocketService | null = null;

// Initialize WebSocket service if enabled
if (process.env.WEBSOCKET_ENABLED === 'true') {
  webSocketService = new WebSocketService({
    port: parseInt(process.env.WEBSOCKET_PORT || '8080'),
    maxConnections: parseInt(process.env.WEBSOCKET_MAX_CONNECTIONS || '100'),
    pingInterval: 30000
  });
  
  logger.info(`WebSocket service started on port ${process.env.WEBSOCKET_PORT || '8080'}`);
}

// Setup authentication wrapper with retry logic
const withAuth = OAuthClientCredentialsWrapper(
  configRetriever,
  platformClient.ApiClient.instance,
);

// Enhanced authentication wrapper with rate limiting
const withAuthAndRateLimit = <T extends any[], R>(fn: (...args: T) => Promise<R>) => {
  return async (...args: T): Promise<R> => {
    return rateLimitingMiddleware.executeWithRetry(
      () => withAuth(fn)(...args),
      3,
      1000,
      fn.name || 'unknown_operation'
    );
  };
};

// Initialize MCP Server
const server: McpServer = new McpServer({
  name: "Genesys Cloud MCP+",
  version: "1.0.0",
});

// Setup API clients
const routingApi = new platformClient.RoutingApi();
const analyticsApi = new platformClient.AnalyticsApi();
const speechTextAnalyticsApi = new platformClient.SpeechTextAnalyticsApi();
const recordingApi = new platformClient.RecordingApi();
const presenceApi = new platformClient.PresenceApi();
const usersApi = new platformClient.UsersApi();

// Register existing tools with enhanced wrapper
const existingTools = [
  searchQueues({ routingApi }),
  sampleConversationsByQueue({ analyticsApi }),
  queryQueueVolumes({ analyticsApi }),
  voiceCallQuality({ analyticsApi }),
  conversationSentiment({ speechTextAnalyticsApi }),
  conversationTopics({ speechTextAnalyticsApi, analyticsApi }),
  searchVoiceConversations({ analyticsApi }),
  conversationTranscription({ recordingApi, speechTextAnalyticsApi, fetchUrl: fetch })
];

existingTools.forEach(tool => {
  server.tool(
    tool.schema.name,
    tool.schema.description,
    tool.schema.paramsSchema.shape,
    tool.schema.annotations,
    withAuthAndRateLimit(tool.call),
  );
});

// Register new enhanced tools
const enhancedTools = [
  realTimeAgentStatus({ presenceApi, usersApi, routingApi }),
  agentKpiDashboard({ analyticsApi }),
  realTimeSlaMonitor({ analyticsApi, routingApi }),
  queueAlertSystem({ webhookService, cacheService })
];

enhancedTools.forEach(tool => {
  server.tool(
    tool.schema.name,
    tool.schema.description,
    tool.schema.paramsSchema.shape,
    tool.schema.annotations,
    withAuthAndRateLimit(tool.call),
  );
});

// Add system health tool
server.tool(
  "get_system_health",
  "Get system health metrics including rate limits, error rates, and connection status",
  {
    includeDetails: {
      type: "boolean",
      description: "Include detailed metrics"
    }
  },
  { title: "System Health" },
  async ({ includeDetails = false }) => {
    const rateLimitStatus = await rateLimitingMiddleware.getRateLimitStatus();
    const errorStats = rateLimitingMiddleware.getErrorStats();
    const wsStats = webSocketService?.getConnectionStats();
    const cacheStats = cacheService.getStats();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      rateLimiting: {
        remaining: rateLimitStatus.remaining,
        resetTime: rateLimitStatus.resetTime
      },
      errors: {
        totalTypes: errorStats.length,
        recentErrors: includeDetails ? errorStats : errorStats.slice(0, 5)
      },
      websocket: wsStats || { enabled: false },
      cache: {
        enabled: true,
        size: cacheStats.size,
        expired: cacheStats.expired
      }
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(health, null, 2)
      }]
    };
  }
);

// Add webhook test tool
server.tool(
  "test_webhook",
  "Test a webhook endpoint to verify connectivity and response",
  {
    webhookUrl: {
      type: "string",
      description: "The webhook URL to test"
    }
  },
  { title: "Test Webhook" },
  async ({ webhookUrl }) => {
    try {
      const result = await webhookService.testWebhook(webhookUrl);
      
      return {
        content: [{
          type: "text",
          text: `Webhook Test Results:
• Success: ${result.success ? '✅' : '❌'}
• Response Time: ${result.responseTime}ms
• Error: ${result.error || 'None'}
${result.success ? '\nWebhook is working correctly!' : '\nWebhook test failed. Please check the URL and endpoint.'}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Failed to test webhook: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

logger.info("🚀 Genesys Cloud MCP+ Server started successfully");
logger.info(`Features enabled: Authentication ✓, Rate Limiting ✓, WebSocket ${webSocketService ? '✓' : '✗'}, Caching ✓`);
logger.info(`Total tools available: ${existingTools.length + enhancedTools.length + 2}`);

console.error("Genesys Cloud MCP+ Server running on stdio");

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down Genesys Cloud MCP+ Server...');
  webSocketService?.close();
  process.exit(0);
});

// Periodic cache cleanup
setInterval(() => {
  cacheService.cleanup();
}, 5 * 60 * 1000); // Clean up every 5 minutes