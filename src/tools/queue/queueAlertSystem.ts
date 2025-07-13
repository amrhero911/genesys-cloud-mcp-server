import { z } from "zod";
import { createTool, type ToolFactory } from "../utils/createTool.js";
import { CacheService } from "../../services/cacheService.js";
import { WebhookService } from "../../services/webhookService.js";

export interface QueueAlertDependencies {
  readonly webhookService: WebhookService;
  readonly cacheService: CacheService;
}

const queueAlertSchema = z.object({
  queueId: z.string().describe("Queue ID to monitor"),
  rules: z.array(z.object({
    metric: z.enum(['waitTime', 'serviceLevelPercentage', 'waitingCount', 'abandonRate']),
    threshold: z.number(),
    operator: z.enum(['>', '<', '>=', '<=']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    webhookUrl: z.string().optional(),
    cooldownMinutes: z.number().default(5).describe("Minutes before re-alerting"),
    enabled: z.boolean().default(true)
  })).describe("Alert rules configuration"),
  action: z.enum(['create', 'update', 'delete', 'list']).default('create')
});

// Queue Alert System with Redis/Memory Cache for managing alert state
export const queueAlertSystem: ToolFactory<
  QueueAlertDependencies,
  typeof queueAlertSchema
> = ({ webhookService, cacheService }) =>
  createTool({
    schema: {
      name: "configure_queue_alerts",
      annotations: { title: "Queue Alert System" },
      description: "Configure intelligent alerting for queue metrics with webhook notifications and cooldown periods",
      paramsSchema: queueAlertSchema,
    },
    call: async ({ queueId, rules, action }) => {
      const alertKey = `queue_alerts:${queueId}`;
      
      try {
        switch (action) {
          case 'create':
          case 'update':
            await cacheService.set(alertKey, JSON.stringify(rules));
            
            // Start monitoring if not already active
            if (!await cacheService.has(`monitoring:${queueId}`)) {
              startQueueMonitoring(queueId, rules, webhookService, cacheService);
              await cacheService.set(`monitoring:${queueId}`, 'active');
            }
            
            return {
              content: [{
                type: "text",
                text: `✅ Alert rules ${action}d for queue ${queueId}. Active rules: ${rules.filter((r: any) => r.enabled).length}`
              }]
            };
            
          case 'delete':
            await cacheService.delete(alertKey);
            await cacheService.delete(`monitoring:${queueId}`);
            
            return {
              content: [{
                type: "text",
                text: `✅ Alert rules deleted for queue ${queueId}`
              }]
            };
            
          case 'list':
            const existingRules = await cacheService.get(alertKey);
            
            return {
              content: [{
                type: "text",
                text: existingRules 
                  ? `Active alert rules for queue ${queueId}:\n${JSON.stringify(JSON.parse(existingRules), null, 2)}`
                  : `No alert rules configured for queue ${queueId}`
              }]
            };
        }
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Failed to configure alerts: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    }
  });

// Background monitoring service
function startQueueMonitoring(
  queueId: string, 
  rules: any[], 
  webhookService: WebhookService, 
  cacheService: CacheService
) {
  const monitoringInterval = setInterval(async () => {
    try {
      const currentRules = await cacheService.get(`queue_alerts:${queueId}`);
      if (!currentRules) {
        clearInterval(monitoringInterval);
        return;
      }

      const parsedRules = JSON.parse(currentRules);
      const queueStats = await getCurrentQueueStats(queueId);
      
      for (const rule of parsedRules.filter((r: any) => r.enabled)) {
        const currentValue = queueStats[rule.metric];
        const alertTriggered = evaluateAlertRule(currentValue, rule);
        
        if (alertTriggered) {
          const cooldownKey = `alert_cooldown:${queueId}:${rule.metric}`;
          const inCooldown = await cacheService.has(cooldownKey);
          
          if (!inCooldown) {
            await triggerAlert(queueId, rule, currentValue, webhookService);
            
            // Set cooldown
            await cacheService.set(
              cooldownKey, 
              'active', 
              rule.cooldownMinutes * 60 * 1000
            );
          }
        }
      }
    } catch (error) {
      console.error(`Queue monitoring error for ${queueId}:`, error);
    }
  }, 30000); // Check every 30 seconds
}

async function triggerAlert(
  queueId: string, 
  rule: any, 
  currentValue: number, 
  webhookService: WebhookService
) {
  const alert = {
    id: `${queueId}_${rule.metric}_${Date.now()}`,
    queueId,
    metric: rule.metric,
    currentValue,
    threshold: rule.threshold,
    severity: rule.severity,
    timestamp: new Date().toISOString(),
    message: `Queue ${queueId} ${rule.metric} ${rule.operator} ${rule.threshold}. Current: ${currentValue}`
  };

  // Send webhook if configured
  if (rule.webhookUrl) {
    await webhookService.send(rule.webhookUrl, {
      type: 'QUEUE_ALERT',
      data: alert
    });
  }
  
  console.log(`Alert triggered: ${alert.message}`);
}

function evaluateAlertRule(currentValue: number, rule: any): boolean {
  switch (rule.operator) {
    case '>': return currentValue > rule.threshold;
    case '<': return currentValue < rule.threshold;
    case '>=': return currentValue >= rule.threshold;
    case '<=': return currentValue <= rule.threshold;
    default: return false;
  }
}

// Mock function for getting current queue stats (would be replaced with actual implementation)
async function getCurrentQueueStats(queueId: string): Promise<any> {
  // This would integrate with the existing analytics API
  // For now, return mock data
  return {
    waitTime: Math.random() * 300,
    serviceLevelPercentage: 70 + Math.random() * 30,
    waitingCount: Math.floor(Math.random() * 50),
    abandonRate: Math.random() * 10
  };
}