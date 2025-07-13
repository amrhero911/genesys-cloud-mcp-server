// Webhook service implementation
export class WebhookService {
  private retryAttempts: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor(retryAttempts: number = 3, retryDelay: number = 1000) {
    this.retryAttempts = retryAttempts;
    this.retryDelay = retryDelay;
  }

  async send(url: string, payload: any): Promise<void> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Genesys-Cloud-MCP-Server/1.0',
            'X-Webhook-Timestamp': Date.now().toString(),
            'X-Webhook-Attempt': attempt.toString()
          },
          body: JSON.stringify({
            ...payload,
            timestamp: new Date().toISOString(),
            attempt: attempt
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Success
        return;
      } catch (error) {
        lastError = error as Error;
        console.error(`Webhook attempt ${attempt}/${this.retryAttempts} failed:`, error);
        
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          await this.sleep(delay);
        }
      }
    }

    console.error(`Webhook failed after ${this.retryAttempts} attempts:`, lastError!.message);
  }

  async sendAlert(url: string, alertData: any): Promise<void> {
    await this.send(url, {
      type: 'QUEUE_ALERT',
      data: alertData
    });
  }

  async sendAgentStatusChange(url: string, agentData: any): Promise<void> {
    await this.send(url, {
      type: 'AGENT_STATUS_CHANGE',
      data: agentData
    });
  }

  async sendSLABreach(url: string, slaData: any): Promise<void> {
    await this.send(url, {
      type: 'SLA_BREACH',
      data: slaData
    });
  }

  async sendSystemHealth(url: string, healthData: any): Promise<void> {
    await this.send(url, {
      type: 'SYSTEM_HEALTH',
      data: healthData
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Test webhook endpoint
  async testWebhook(url: string): Promise<{ success: boolean; responseTime: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Genesys-Cloud-MCP-Server/1.0',
          'X-Webhook-Test': 'true'
        },
        body: JSON.stringify({
          type: 'TEST',
          message: 'Webhook test from Genesys Cloud MCP+ Server',
          timestamp: new Date().toISOString()
        })
      });

      const responseTime = Date.now() - startTime;

      return {
        success: response.ok,
        responseTime,
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}