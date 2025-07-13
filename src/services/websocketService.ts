import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface WebSocketConfig {
  port: number;
  maxConnections: number;
  pingInterval: number;
}

export class WebSocketService extends EventEmitter {
  private wss: WebSocket.Server;
  private connections: Map<string, WebSocket> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // clientId -> topics
  private pingInterval?: NodeJS.Timeout;

  constructor(config: WebSocketConfig) {
    super();
    this.wss = new WebSocket.Server({ 
      port: config.port,
      maxPayload: 1024 * 1024 // 1MB max message size
    });
    
    this.setupWebSocketServer(config);
    this.startPingInterval(config.pingInterval);
  }

  private setupWebSocketServer(config: WebSocketConfig): void {
    this.wss.on('connection', (ws: WebSocket, req: any) => {
      const clientId = this.generateClientId();
      
      // Connection limit check
      if (this.connections.size >= config.maxConnections) {
        ws.close(1008, 'Server at capacity');
        return;
      }
      
      this.connections.set(clientId, ws);
      this.subscriptions.set(clientId, new Set());
      
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(clientId, data);
        } catch (error) {
          this.sendToClient(clientId, { 
            type: 'error', 
            message: 'Invalid message format' 
          });
        }
      });

      ws.on('close', () => {
        this.connections.delete(clientId);
        this.subscriptions.delete(clientId);
      });

      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      // Initial connection message
      this.sendToClient(clientId, {
        type: 'connection',
        clientId,
        message: 'Connected to Genesys Cloud MCP+ WebSocket',
        availableTopics: [
          'queue_alerts',
          'agent_status_changes', 
          'sla_breaches',
          'system_health'
        ]
      });
    });
  }

  private handleClientMessage(clientId: string, data: any): void {
    switch (data.type) {
      case 'subscribe':
        this.handleSubscription(clientId, data);
        break;
      case 'unsubscribe':
        this.handleUnsubscription(clientId, data);
        break;
      case 'ping':
        this.sendToClient(clientId, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        this.sendToClient(clientId, { 
          type: 'error', 
          message: 'Unknown message type' 
        });
    }
  }

  private handleSubscription(clientId: string, data: any): void {
    const { topic, filters = {} } = data;
    const clientSubscriptions = this.subscriptions.get(clientId);
    
    if (clientSubscriptions) {
      clientSubscriptions.add(topic);
      this.sendToClient(clientId, {
        type: 'subscription_confirmed',
        topic,
        filters,
        message: `Subscribed to ${topic}`
      });
    }
  }

  private handleUnsubscription(clientId: string, data: any): void {
    const { topic } = data;
    const clientSubscriptions = this.subscriptions.get(clientId);
    
    if (clientSubscriptions) {
      clientSubscriptions.delete(topic);
      this.sendToClient(clientId, {
        type: 'unsubscription_confirmed', 
        topic,
        message: `Unsubscribed from ${topic}`
      });
    }
  }

  private sendToClient(clientId: string, data: any): void {
    const ws = this.connections.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  public broadcast(topic: string, data: any, filter?: (clientId: string) => boolean): void {
    const message = JSON.stringify({
      type: 'broadcast',
      topic,
      data,
      timestamp: new Date().toISOString()
    });

    this.subscriptions.forEach((topics, clientId) => {
      if (topics.has(topic) && (!filter || filter(clientId))) {
        const ws = this.connections.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    });
  }

  public sendAlert(alertData: any): void {
    this.broadcast('queue_alerts', alertData);
  }

  public sendAgentStatusChange(agentData: any): void {
    this.broadcast('agent_status_changes', agentData);
  }

  public sendSLABreach(slaData: any): void {
    this.broadcast('sla_breaches', slaData);
  }

  private startPingInterval(intervalMs: number): void {
    this.pingInterval = setInterval(() => {
      this.connections.forEach((ws, clientId) => {
        if ((ws as any).isAlive === false) {
          ws.terminate();
          this.connections.delete(clientId);
          this.subscriptions.delete(clientId);
          return;
        }

        (ws as any).isAlive = false;
        ws.ping();
      });
    }, intervalMs);
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public getConnectionStats(): { 
    totalConnections: number; 
    totalSubscriptions: number;
    connectionsByTopic: Record<string, number>;
  } {
    const connectionsByTopic: Record<string, number> = {};
    
    this.subscriptions.forEach(topics => {
      topics.forEach(topic => {
        connectionsByTopic[topic] = (connectionsByTopic[topic] || 0) + 1;
      });
    });

    return {
      totalConnections: this.connections.size,
      totalSubscriptions: Array.from(this.subscriptions.values())
        .reduce((sum, topics) => sum + topics.size, 0),
      connectionsByTopic
    };
  }

  public close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.wss.close();
  }
}