import { z } from "zod";
import { createTool, type ToolFactory } from "../utils/createTool.js";
import type { UsersApi, RoutingApi } from "purecloud-platform-client-v2";

export interface AgentStatusDependencies {
  readonly usersApi: Pick<UsersApi, "getUser" | "getUserRoutingstatus">;
  readonly routingApi: Pick<RoutingApi, "getUserQueues">;
}

const agentStatusSchema = z.object({
  userId: z.string().describe("Agent user ID"),
  includeQueues: z.boolean().default(true).describe("Include queue memberships"),
  format: z.enum(['json', 'llm']).default('json').describe("Output format")
});

export const realTimeAgentStatus: ToolFactory<
  AgentStatusDependencies,
  typeof agentStatusSchema
> = ({ usersApi, routingApi }) =>
  createTool({
    schema: {
      name: "get_realtime_agent_status",
      annotations: { title: "Real-Time Agent Status" },
      description: "Get comprehensive real-time agent status including routing status, presence, queue memberships, and activity timeline",
      paramsSchema: agentStatusSchema,
    },
    call: async ({ userId, includeQueues, format }) => {
      try {
        // Parallel API calls for efficiency
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
          return {
            content: [{
              type: "text",
              text: formatAgentStatusForLLM(result)
            }]
          };
        }

        return {
          content: [{
            type: "text", 
            text: JSON.stringify(result, null, 2)
          }]
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
    }
  });

function formatAgentStatusForLLM(data: any): string {
  const status = data.status.routing.status;
  const presence = data.status.presence.definition?.systemPresence || 'Unknown';
  const queueCount = data.queues.length;
  
  return `
**Agent Status Summary**
• Name: ${data.agent.name} (${data.agent.email})
• Department: ${data.agent.department || 'Not specified'}
• Current Status: ${status}
• Presence: ${presence}
• Active Queues: ${queueCount}
• Last Status Change: ${new Date(data.status.routing.startTime).toLocaleString()}

${data.queues.length > 0 ? `
**Queue Memberships:**
${data.queues.map((q: any) => `• ${q.name} (${q.memberCount} members)`).join('\n')}
` : ''}

*Data retrieved: ${new Date(data.metadata.timestamp).toLocaleString()}*
  `.trim();
}