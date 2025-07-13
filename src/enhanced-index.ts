import platformClient from "purecloud-platform-client-v2";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConfigRetriever } from "./createConfigRetriever.js";
import { searchQueues } from "./tools/searchQueues.js";
import { sampleConversationsByQueue } from "./tools/sampleConversationsByQueue/sampleConversationsByQueue.js";
import { queryQueueVolumes } from "./tools/queryQueueVolumes/queryQueueVolumes.js";
import { voiceCallQuality } from "./tools/voiceCallQuality.js";
import { conversationSentiment } from "./tools/conversationSentiment/conversationSentiment.js";
import { conversationTopics } from "./tools/conversationTopics/conversationTopics.js";
import { searchVoiceConversations } from "./tools/searchVoiceConversations.js";
import { conversationTranscription } from "./tools/conversationTranscription/conversationTranscription.js";
import { OAuthClientCredentialsWrapper } from "./auth/OAuthClientCredentialsWrapper.js";

// Enhanced auth wrapper with retry logic
const withAuthAndRetry = OAuthClientCredentialsWrapper(
  createConfigRetriever(process.env),
  platformClient.ApiClient.instance,
);

const server: McpServer = new McpServer({
  name: "Genesys Cloud MCP+",
  version: "1.0.0", // Enhanced version
});

const routingApi = new platformClient.RoutingApi();
const analyticsApi = new platformClient.AnalyticsApi();
const speechTextAnalyticsApi = new platformClient.SpeechTextAnalyticsApi();
const recordingApi = new platformClient.RecordingApi();
const usersApi = new platformClient.UsersApi();

// Register existing tools
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
    withAuthAndRetry(tool.call),
  );
});

// Enhanced Tool: Real-Time Agent Status
server.tool(
  "get_realtime_agent_status",
  "Get comprehensive real-time agent status including routing status, presence, and queue memberships",
  {
    userId: {
      type: "string",
      description: "Agent user ID"
    },
    includeQueues: {
      type: "boolean",
      description: "Include queue memberships",
      default: true
    },
    format: {
      type: "string",
      enum: ["json", "llm"],
      description: "Output format",
      default: "json"
    }
  },
  { title: "Real-Time Agent Status" },
  withAuthAndRetry(async ({ userId, includeQueues = true, format = "json" }) => {
    try {
      const [userDetails, routingStatus, queueMemberships] = await Promise.all([
        usersApi.getUser(userId),
        usersApi.getUserRoutingstatus(userId),
        includeQueues ? routingApi.getUserQueues(userId) : Promise.resolve(null)
      ]);

      const result = {
        agent: {
          id: userId,
          name: userDetails.name,
          email: userDetails.email,
          department: userDetails.department,
          title: userDetails.title
        },
        status: {
          routing: {
            status: routingStatus.status,
            startTime: routingStatus.startTime,
            userId: routingStatus.userId
          },
          presence: {
            definition: routingStatus.presenceDefinition,
            systemPresence: routingStatus.systemPresence,
            organizationPresence: routingStatus.organizationPresence,
            message: routingStatus.message
          }
        },
        queues: queueMemberships?.entities?.map((q: any) => ({
          id: q.id,
          name: q.name,
          memberCount: q.memberCount,
          wrapupTimeoutMs: q.wrapupTimeoutMs
        })) || [],
        metadata: {
          timestamp: new Date().toISOString(),
          includeQueues
        }
      };

      if (format === 'llm') {
        const status = result.status.routing.status;
        const presence = result.status.presence.definition?.systemPresence || 'Unknown';
        const queueCount = result.queues.length;
        
        const llmText = `
**Agent Status Summary**
• Name: ${result.agent.name} (${result.agent.email})
• Department: ${result.agent.department || 'Not specified'}
• Current Status: ${status}
• Presence: ${presence}
• Active Queues: ${queueCount}
• Last Status Change: ${new Date(result.status.routing.startTime).toLocaleString()}

${result.queues.length > 0 ? `
**Queue Memberships:**
${result.queues.map((q: any) => `• ${q.name} (${q.memberCount} members)`).join('\n')}
` : ''}

*Data retrieved: ${new Date(result.metadata.timestamp).toLocaleString()}*
        `.trim();

        return {
          content: [{ type: "text", text: llmText }]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Failed to get agent status: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  })
);

// Enhanced Tool: Agent KPI Dashboard
server.tool(
  "get_agent_kpi_dashboard",
  "Generate comprehensive KPI dashboard for agents with performance metrics and grading",
  {
    userIds: {
      type: "array",
      items: { type: "string" },
      description: "Array of agent user IDs"
    },
    startDate: {
      type: "string",
      description: "Start date (ISO format)"
    },
    endDate: {
      type: "string", 
      description: "End date (ISO format)"
    },
    interval: {
      type: "string",
      enum: ["PT15M", "PT1H", "P1D"],
      description: "Time interval",
      default: "P1D"
    }
  },
  { title: "Agent KPI Dashboard" },
  withAuthAndRetry(async ({ userIds, startDate, endDate, interval = "P1D" }) => {
    try {
      const query = {
        interval: `${startDate}/${endDate}`,
        granularity: interval,
        groupBy: ['userId'],
        metrics: [
          'nOffered', 'nConnected', 'nTransferred', 'nAbandon',
          'tTalk', 'tAcw', 'tHandle', 'tHeld', 'tAlert'
        ],
        filter: {
          type: 'and',
          predicates: [
            {
              type: 'dimension',
              dimension: 'userId',
              operator: 'matches',
              value: userIds.join(',')
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
        return {
          content: [{
            type: "text",
            text: "No data found for the specified agents and time period"
          }]
        };
      }

      const kpiResults = response.userDetails.map((userDetail: any) => {
        const userId = userDetail.userId;
        const metrics = userDetail.primaryPresence?.[0]?.metrics || {};
        const kpis = calculateKPIs(metrics);
        
        return {
          userId,
          period: { startDate, endDate },
          kpis,
          performanceGrade: calculatePerformanceGrade(kpis)
        };
      });

      const header = `
**Agent KPI Dashboard**
Generated: ${new Date().toLocaleString()}
Agents Analyzed: ${kpiResults.length}

`;

      const agentSummaries = kpiResults.map((agent: any) => `
**Agent: ${agent.userId}**
• Performance Grade: ${agent.performanceGrade}
• Calls Handled: ${agent.kpis.callsConnected}
• Answer Rate: ${agent.kpis.answerRate.toFixed(1)}%
• Average Handle Time: ${(agent.kpis.averageHandleTime / 60000).toFixed(1)} min
• Transfer Rate: ${agent.kpis.transferRate.toFixed(1)}%
• Talk Time: ${(agent.kpis.totalTalkTime / 60000).toFixed(1)} min
• ACW Time: ${(agent.kpis.totalAcwTime / 60000).toFixed(1)} min
`).join('\n');

      return {
        content: [{
          type: "text",
          text: header + agentSummaries
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Failed to generate KPI dashboard: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  })
);

// Enhanced Tool: System Health
server.tool(
  "get_system_health",
  "Get system health metrics and status information",
  {
    includeDetails: {
      type: "boolean",
      description: "Include detailed metrics",
      default: false
    }
  },
  { title: "System Health" },
  async ({ includeDetails = false }) => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      server: {
        name: 'Genesys Cloud MCP+',
        version: '1.0.0',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      },
      features: {
        authentication: 'OAuth Client Credentials',
        tools: existingTools.length + 3, // existing + new enhanced tools
        rateLimiting: 'Built-in retry logic',
        errorHandling: 'Comprehensive'
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        region: process.env.GENESYSCLOUD_REGION || 'Not configured'
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

// Helper functions
function calculateKPIs(metrics: any) {
  const callsOffered = metrics.nOffered?.sum || 0;
  const callsConnected = metrics.nConnected?.sum || 0;
  const callsTransferred = metrics.nTransferred?.sum || 0;
  const totalTalkTime = metrics.tTalk?.sum || 0;
  const totalAcwTime = metrics.tAcw?.sum || 0;
  const totalHandleTime = metrics.tHandle?.sum || 0;
  const totalHeldTime = metrics.tHeld?.sum || 0;

  return {
    callsOffered,
    callsConnected,
    callsTransferred,
    totalTalkTime,
    totalAcwTime,
    totalHandleTime,
    totalHeldTime,
    averageHandleTime: callsConnected > 0 ? totalHandleTime / callsConnected : 0,
    averageTalkTime: callsConnected > 0 ? totalTalkTime / callsConnected : 0,
    transferRate: callsConnected > 0 ? (callsTransferred / callsConnected * 100) : 0,
    answerRate: callsOffered > 0 ? (callsConnected / callsOffered * 100) : 0
  };
}

function calculatePerformanceGrade(kpis: any): string {
  let score = 0;
  
  // Answer rate (30% weight)
  if (kpis.answerRate >= 90) score += 30;
  else if (kpis.answerRate >= 80) score += 25;
  else if (kpis.answerRate >= 70) score += 20;
  
  // Transfer rate (25% weight) - lower is better
  if (kpis.transferRate <= 5) score += 25;
  else if (kpis.transferRate <= 10) score += 20;
  else if (kpis.transferRate <= 15) score += 15;
  
  // AHT (25% weight) - target 5-8 minutes
  const ahtMinutes = kpis.averageHandleTime / 60000;
  if (ahtMinutes >= 5 && ahtMinutes <= 8) score += 25;
  else if (ahtMinutes <= 10) score += 20;
  else if (ahtMinutes <= 12) score += 15;
  
  // Call volume (20% weight)
  if (kpis.callsConnected >= 20) score += 20;
  else if (kpis.callsConnected >= 15) score += 15;
  else if (kpis.callsConnected >= 10) score += 10;
  
  if (score >= 85) return 'A+ (Excellent)';
  if (score >= 75) return 'A (Very Good)';
  if (score >= 65) return 'B (Good)';
  if (score >= 55) return 'C (Satisfactory)';
  return 'D (Needs Improvement)';
}

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("🚀 Genesys Cloud MCP+ Server running on stdio with enhanced features");
console.error(`📊 Total tools available: ${existingTools.length + 3}`);
console.error("✨ Enhanced features: Agent Status, KPI Dashboard, System Health");

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('Shutting down Genesys Cloud MCP+ Server...');
  process.exit(0);
});