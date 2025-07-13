import { RateLimiterMemory } from 'rate-limiter-flexible';

export interface RateLimitConfig {
  requestsPerMinute: number;
  burstLimit: number;
  enabled: boolean;
}

export class RateLimitingMiddleware {
  private rateLimiter: RateLimiterMemory;
  private errorCounts: Map<string, number> = new Map();
  private logger: any;

  constructor(config: RateLimitConfig, logger: any) {
    this.logger = logger;
    
    this.rateLimiter = new RateLimiterMemory({
      points: config.requestsPerMinute,
      duration: 60, // Per 60 seconds
      blockDuration: 60, // Block for 60 seconds if rate exceeded
    });
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    backoffMs: number = 1000,
    operationName: string = 'unknown'
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check rate limit
        await this.rateLimiter.consume('global');
        
        const result = await operation();
        
        // Reset error count on success
        this.errorCounts.delete(operationName);
        
        return result;
      } catch (error: any) {
        lastError = error;
        
        // Handle rate limiting from Genesys Cloud
        if (error.status === 429) {
          const retryAfter = this.parseRetryAfter(error.headers?.['retry-after']) || backoffMs;
          this.logger.warn(`Rate limited by Genesys Cloud, retrying in ${retryAfter}ms (attempt ${attempt}/${maxRetries})`);
          
          if (attempt < maxRetries) {
            await this.sleep(retryAfter);
            continue;
          }
        }
        
        // Handle other errors with exponential backoff
        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt - 1);
          this.logger.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await this.sleep(delay);
          continue;
        }
        
        this.trackError(operationName, error);
      }
    }
    
    throw lastError!;
  }

  private parseRetryAfter(retryAfter?: string): number | null {
    if (!retryAfter) return null;
    
    const seconds = parseInt(retryAfter, 10);
    return isNaN(seconds) ? null : seconds * 1000;
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

  getErrorStats(): Array<{ operation: string; count: number }> {
    return Array.from(this.errorCounts.entries()).map(([key, count]) => ({
      operation: key,
      count
    }));
  }

  async getRateLimitStatus(): Promise<{ remaining: number; resetTime: Date }> {
    const res = await this.rateLimiter.get('global');
    return {
      remaining: res ? res.remainingPoints : 60,
      resetTime: res ? new Date(Date.now() + res.msBeforeNext) : new Date()
    };
  }
}