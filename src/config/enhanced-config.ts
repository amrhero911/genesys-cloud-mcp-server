import { z } from "zod";

export const enhancedConfigSchema = z.object({
  // Existing config
  region: z.string(),
  oAuthClientId: z.string(),
  oAuthClientSecret: z.string(),
  
  // New enhanced features
  websocket: z.object({
    enabled: z.boolean().default(false),
    port: z.number().default(8080),
    maxConnections: z.number().default(100)
  }).optional(),
  
  rateLimiting: z.object({
    enabled: z.boolean().default(true),
    requestsPerMinute: z.number().default(60),
    burstLimit: z.number().default(10)
  }).optional(),
  
  monitoring: z.object({
    enabled: z.boolean().default(false),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    metricsCollection: z.boolean().default(false)
  }).optional(),
  
  cache: z.object({
    enabled: z.boolean().default(true),
    ttlSeconds: z.number().default(300),
    maxKeys: z.number().default(1000)
  }).optional()
});

export type EnhancedConfig = z.infer<typeof enhancedConfigSchema>;

export function createEnhancedConfigRetriever(env: Record<string, string | undefined>) {
  return {
    getEnhancedConfig(): { success: true; value: EnhancedConfig } | { success: false; reason: string } {
      try {
        const config = enhancedConfigSchema.parse({
          region: env.GENESYSCLOUD_REGION,
          oAuthClientId: env.GENESYSCLOUD_OAUTHCLIENT_ID,
          oAuthClientSecret: env.GENESYSCLOUD_OAUTHCLIENT_SECRET,
          websocket: {
            enabled: env.WEBSOCKET_ENABLED === 'true',
            port: env.WEBSOCKET_PORT ? parseInt(env.WEBSOCKET_PORT) : 8080,
            maxConnections: env.WEBSOCKET_MAX_CONNECTIONS ? parseInt(env.WEBSOCKET_MAX_CONNECTIONS) : 100
          },
          rateLimiting: {
            enabled: env.RATE_LIMIT_ENABLED !== 'false',
            requestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE ? parseInt(env.RATE_LIMIT_REQUESTS_PER_MINUTE) : 60,
            burstLimit: env.RATE_LIMIT_BURST_LIMIT ? parseInt(env.RATE_LIMIT_BURST_LIMIT) : 10
          },
          monitoring: {
            enabled: env.MONITORING_ENABLED === 'true',
            logLevel: (env.LOG_LEVEL as any) || 'info',
            metricsCollection: env.METRICS_COLLECTION_ENABLED === 'true'
          },
          cache: {
            enabled: env.CACHE_ENABLED !== 'false',
            ttlSeconds: env.CACHE_TTL_SECONDS ? parseInt(env.CACHE_TTL_SECONDS) : 300,
            maxKeys: env.CACHE_MAX_KEYS ? parseInt(env.CACHE_MAX_KEYS) : 1000
          }
        });
        
        return { success: true, value: config };
      } catch (error) {
        return { 
          success: false, 
          reason: error instanceof Error ? error.message : 'Unknown configuration error'
        };
      }
    }
  };
}