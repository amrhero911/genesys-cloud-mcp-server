import { z } from "zod";
import { createTool, type ToolFactory } from "../utils/createTool.js";
import type { AnalyticsApi } from "purecloud-platform-client-v2";

export interface AgentKpiDependencies {
  readonly analyticsApi: Pick<AnalyticsApi, "postAnalyticsUsersDetailsQuery">;
}

const agentKpiSchema = z.object({
  userIds: z.array(z.string()).describe("Array of agent user IDs"),
  startDate: z.string().describe("Start date (ISO format)"),
  endDate: z.string().describe("End date (ISO format)"),
  interval: z.enum(['PT15M', 'PT1H', 'P1D']).default('P1D').describe("Time interval"),
  includeComparison: z.boolean().default(false).describe("Include period-over-period comparison"),
  metrics: z.array(z.enum([
    'aht', 'talk_time', 'hold_time', 'acw_time', 
    'transfers', 'call_count', 'answer_rate'
  ])).optional().describe("Specific metrics to include")
});

export const agentKpiDashboard: ToolFactory<
  AgentKpiDependencies,
  typeof agentKpiSchema
> = ({ analyticsApi }) =>
  createTool({
    schema: {
      name: "get_agent_kpi_dashboard",
      annotations: { title: "Agent KPI Dashboard" },
      description: "Generate comprehensive KPI dashboard for one or more agents with metrics like AHT, talk time, transfers, and performance comparisons",
      paramsSchema: agentKpiSchema,
    },
    call: async ({ userIds, startDate, endDate, interval, includeComparison, metrics }) => {
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
          
          return {
            userId,
            period: { startDate, endDate },
            kpis: calculateKPIs(metrics),
            performanceGrade: calculatePerformanceGrade(metrics)
          };
        });

        return {
          content: [{
            type: "text",
            text: formatKPIDashboard(kpiResults, { includeComparison })
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
    }
  });

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

function calculatePerformanceGrade(metrics: any): string {
  const kpis = calculateKPIs(metrics);
  
  // Simple performance grading logic
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

function formatKPIDashboard(results: any[], options: { includeComparison?: boolean }) {
  const header = `
**Agent KPI Dashboard**
Generated: ${new Date().toLocaleString()}
Agents Analyzed: ${results.length}

`;

  const agentSummaries = results.map((agent: any) => `
**Agent: ${agent.userId}**
• Performance Grade: ${agent.performanceGrade}
• Calls Handled: ${agent.kpis.callsConnected}
• Answer Rate: ${agent.kpis.answerRate.toFixed(1)}%
• Average Handle Time: ${(agent.kpis.averageHandleTime / 60000).toFixed(1)} min
• Transfer Rate: ${agent.kpis.transferRate.toFixed(1)}%
• Talk Time: ${(agent.kpis.totalTalkTime / 60000).toFixed(1)} min
• ACW Time: ${(agent.kpis.totalAcwTime / 60000).toFixed(1)} min
`).join('\n');

  return header + agentSummaries;
}