import { z } from "zod";
import { createTool, type ToolFactory } from "../utils/createTool.js";
import type { AnalyticsApi, RoutingApi } from "purecloud-platform-client-v2";

export interface SlaMonitorDependencies {
  readonly analyticsApi: Pick<AnalyticsApi, "postAnalyticsQueuesObservationsQuery">;
  readonly routingApi: Pick<RoutingApi, "getRoutingQueue" | "getRoutingQueueEstimatedwaittime">;
}

const slaMonitorSchema = z.object({
  queueIds: z.array(z.string()).describe("Array of queue IDs to monitor"),
  slaThresholds: z.object({
    serviceLevel: z.number().default(80).describe("Service level percentage threshold"),
    answerTime: z.number().default(20).describe("Answer time threshold in seconds"),
    waitTime: z.number().default(300).describe("Maximum wait time in seconds")
  }).optional(),
  alertMode: z.boolean().default(false).describe("Return alerts for thresholds exceeded"),
  includeForecasting: z.boolean().default(false).describe("Include short-term forecasting")
});

export const realTimeSlaMonitor: ToolFactory<
  SlaMonitorDependencies,
  typeof slaMonitorSchema
> = ({ analyticsApi, routingApi }) =>
  createTool({
    schema: {
      name: "monitor_queue_sla_realtime",
      annotations: { title: "Real-Time SLA Monitor" },
      description: "Monitor real-time SLA performance across multiple queues with customizable thresholds and alerting",
      paramsSchema: slaMonitorSchema,
    },
    call: async ({ queueIds, slaThresholds = {}, alertMode, includeForecasting }) => {
      const thresholds = {
        serviceLevel: 80,
        answerTime: 20,
        waitTime: 300,
        ...slaThresholds
      };

      try {
        const results = await Promise.all(
          queueIds.map(async (queueId: string) => {
            const [queueDetails, currentStats, waitTime] = await Promise.all([
              routingApi.getRoutingQueue(queueId),
              getQueueRealTimeStats(analyticsApi, queueId),
              routingApi.getRoutingQueueEstimatedwaittime(queueId).catch(() => null)
            ]);

            const slaStatus = calculateSLAStatus(currentStats, thresholds);
            const alertLevel = determineSLAAlertLevel(slaStatus, thresholds);

            return {
              queueId,
              name: queueDetails.name,
              currentMetrics: {
                waitingCount: currentStats.waitingCount || 0,
                longestWaitTime: currentStats.longestWaitTime || 0,
                averageWaitTime: currentStats.averageWaitTime || 0,
                estimatedWaitTime: waitTime?.estimatedWaitTimeSeconds || 0,
                activeAgents: currentStats.activeAgents || 0,
                availableAgents: currentStats.availableAgents || 0,
                serviceLevelPercentage: currentStats.serviceLevelPercentage || 0
              },
              slaStatus: {
                ...slaStatus,
                thresholds,
                isBreaching: alertLevel !== 'GREEN'
              },
              alertLevel,
              alerts: alertMode ? generateSLAAlerts(slaStatus, thresholds, queueDetails.name) : [],
              timestamp: new Date().toISOString()
            };
          })
        );

        const summary = {
          totalQueues: results.length,
          queuesBreaching: results.filter((r: any) => r.alertLevel !== 'GREEN').length,
          avgServiceLevel: results.reduce((sum: number, r: any) => sum + r.currentMetrics.serviceLevelPercentage, 0) / results.length,
          totalWaiting: results.reduce((sum: number, r: any) => sum + r.currentMetrics.waitingCount, 0),
          criticalQueues: results.filter((r: any) => r.alertLevel === 'RED').length
        };

        return {
          content: [{
            type: "text",
            text: formatSLAMonitorReport(results, summary, { alertMode, includeForecasting })
          }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Failed to monitor SLA: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    }
  });

async function getQueueRealTimeStats(analyticsApi: any, queueId: string) {
  // Implementation for getting real-time queue statistics
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 15 * 60 * 1000); // Last 15 minutes

  const query = {
    interval: `${startTime.toISOString()}/${endTime.toISOString()}`,
    granularity: 'PT15M',
    groupBy: ['queueId'],
    metrics: ['oWaiting', 'tWait', 'nOffered', 'nConnected'],
    filter: {
      type: 'dimension',
      dimension: 'queueId',
      operator: 'matches',
      value: queueId
    }
  };

  const response = await analyticsApi.postAnalyticsQueuesObservationsQuery(query);
  
  // Process response and calculate current stats
  return {
    waitingCount: response.results?.[0]?.data?.[0]?.metrics?.oWaiting || 0,
    longestWaitTime: 0, // Would need additional API call
    averageWaitTime: response.results?.[0]?.data?.[0]?.metrics?.tWait || 0,
    activeAgents: 0, // Would need additional API call
    availableAgents: 0, // Would need additional API call
    serviceLevelPercentage: calculateServiceLevel(response.results?.[0]?.data?.[0]?.metrics)
  };
}

function calculateServiceLevel(metrics: any): number {
  if (!metrics) return 0;
  const offered = metrics.nOffered || 0;
  const connected = metrics.nConnected || 0;
  return offered > 0 ? (connected / offered * 100) : 0;
}

function calculateSLAStatus(stats: any, thresholds: any) {
  return {
    serviceLevelStatus: stats.serviceLevelPercentage >= thresholds.serviceLevel ? 'WITHIN_SLA' : 'BREACHING_SLA',
    waitTimeStatus: stats.averageWaitTime <= thresholds.waitTime ? 'WITHIN_LIMIT' : 'EXCEEDED',
    serviceLevelPercentage: stats.serviceLevelPercentage,
    serviceLevelGap: thresholds.serviceLevel - stats.serviceLevelPercentage
  };
}

function determineSLAAlertLevel(slaStatus: any, thresholds: any): 'GREEN' | 'YELLOW' | 'RED' {
  if (slaStatus.serviceLevelPercentage >= thresholds.serviceLevel) return 'GREEN';
  if (slaStatus.serviceLevelPercentage >= thresholds.serviceLevel * 0.9) return 'YELLOW';
  return 'RED';
}

function generateSLAAlerts(slaStatus: any, thresholds: any, queueName?: string): string[] {
  const alerts: string[] = [];
  
  if (slaStatus.serviceLevelStatus === 'BREACHING_SLA') {
    alerts.push(`Service Level below threshold: ${slaStatus.serviceLevelPercentage.toFixed(1)}% (Target: ${thresholds.serviceLevel}%)`);
  }
  
  if (slaStatus.waitTimeStatus === 'EXCEEDED') {
    alerts.push(`Wait time exceeded: ${(slaStatus.averageWaitTime / 60).toFixed(1)} min (Limit: ${(thresholds.waitTime / 60).toFixed(1)} min)`);
  }
  
  return alerts;
}

function formatSLAMonitorReport(results: any[], summary: any, options: any): string {
  const timestamp = new Date().toLocaleString();
  
  let report = `
**Real-Time SLA Monitor Report**
Generated: ${timestamp}

**Summary**
• Total Queues: ${summary.totalQueues}
• Queues Breaching SLA: ${summary.queuesBreaching}
• Critical Queues: ${summary.criticalQueues}
• Average Service Level: ${summary.avgServiceLevel.toFixed(1)}%
• Total Customers Waiting: ${summary.totalWaiting}

**Queue Details**
`;

  results.forEach((queue: any) => {
    const alertIcon = queue.alertLevel === 'RED' ? '🔴' : queue.alertLevel === 'YELLOW' ? '🟡' : '🟢';
    
    report += `
${alertIcon} **${queue.name}**
• Service Level: ${queue.currentMetrics.serviceLevelPercentage.toFixed(1)}%
• Waiting: ${queue.currentMetrics.waitingCount} customers
• Avg Wait: ${(queue.currentMetrics.averageWaitTime / 60).toFixed(1)} min
• Available Agents: ${queue.currentMetrics.availableAgents}
`;

    if (options.alertMode && queue.alerts.length > 0) {
      report += `• Alerts: ${queue.alerts.join(', ')}\n`;
    }
  });

  return report;
}