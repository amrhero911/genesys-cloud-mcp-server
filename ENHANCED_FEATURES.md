# Genesys Cloud MCP+ Enhanced Features

This document describes the enhanced features added to the Genesys Cloud MCP server, transforming it into a comprehensive contact center management platform.

## 🚀 Enhanced Features Overview

### **Agent-Focused Tools (4 new tools)**

#### 1. Real-Time Agent Status (`get_realtime_agent_status`)
- **Purpose**: Get comprehensive real-time agent information
- **Features**:
  - Live routing status and presence
  - Queue memberships and member counts
  - Activity timeline and status changes
  - LLM-optimized output format

**Example Usage:**
```json
{
  "userId": "agent-id-123",
  "includeQueues": true,
  "format": "llm"
}
```

#### 2. Agent KPI Dashboard (`get_agent_kpi_dashboard`)
- **Purpose**: Generate performance analytics for agents
- **Features**:
  - AHT, talk time, transfer rates
  - Performance grading (A+ to D)
  - Historical trend analysis
  - Multi-agent comparison

**Example Usage:**
```json
{
  "userIds": ["agent1", "agent2"],
  "startDate": "2023-01-01T00:00:00Z",
  "endDate": "2023-01-31T23:59:59Z",
  "interval": "P1D"
}
```

### **Queue & SLA Monitoring Tools (2 new tools)**

#### 3. Real-Time SLA Monitor (`monitor_queue_sla_realtime`)
- **Purpose**: Monitor SLA performance across multiple queues
- **Features**:
  - Customizable SLA thresholds
  - Real-time wait times and service levels
  - Alert generation for breaches
  - Traffic light status indicators (🟢🟡🔴)

**Example Usage:**
```json
{
  "queueIds": ["queue1", "queue2"],
  "slaThresholds": {
    "serviceLevel": 80,
    "waitTime": 300
  },
  "alertMode": true
}
```

#### 4. Queue Alert System (`configure_queue_alerts`)
- **Purpose**: Configure intelligent alerting with webhooks
- **Features**:
  - Multiple metric monitoring (wait time, SLA%, abandon rate)
  - Webhook notifications
  - Cooldown periods to prevent spam
  - Rule-based alert triggers

**Example Usage:**
```json
{
  "queueId": "queue-123",
  "rules": [
    {
      "metric": "waitTime",
      "threshold": 300,
      "operator": ">",
      "severity": "HIGH",
      "webhookUrl": "https://your-webhook.com/alerts",
      "cooldownMinutes": 5
    }
  ],
  "action": "create"
}
```

### **System & Performance Tools (2 new tools)**

#### 5. System Health (`get_system_health`)
- **Purpose**: Monitor server performance and status
- **Features**:
  - Rate limiting status
  - Error tracking and statistics
  - WebSocket connection metrics
  - Cache performance data

#### 6. Webhook Testing (`test_webhook`)
- **Purpose**: Test webhook endpoints for connectivity
- **Features**:
  - Response time measurement
  - Success/failure status
  - Detailed error reporting

## 🔧 Enhanced Services

### **Rate Limiting Middleware**
- Intelligent retry with exponential backoff
- Genesys Cloud API rate limit handling
- Error tracking and statistics
- Configurable thresholds

### **WebSocket Service**
- Real-time updates for dashboards
- Topic-based subscriptions
- Connection management with limits
- Automatic ping/pong heartbeat

### **Caching System**
- TTL-based in-memory caching
- Automatic cleanup of expired entries
- Performance optimization
- Statistics and monitoring

### **Webhook Service**
- Reliable delivery with retries
- Multiple webhook types (alerts, status changes)
- Response time tracking
- Test connectivity features

## 📊 Performance Enhancements

### **Parallel API Calls**
All enhanced tools use parallel API calls where possible to minimize response times:

```typescript
const [userDetails, routingStatus, queueMemberships] = await Promise.all([
  usersApi.getUser(userId),
  usersApi.getUserRoutingstatus(userId),
  routingApi.getUserQueues(userId)
]);
```

### **Smart Error Handling**
- Comprehensive error tracking
- Automatic retry mechanisms
- Graceful degradation
- Detailed error reporting

### **Memory Management**
- Automatic cache cleanup
- Connection pooling
- Resource monitoring
- Graceful shutdown

## 🔒 Security Features

- **OAuth Token Management**: Automatic token refresh
- **Rate Limiting**: Prevent API abuse
- **Input Validation**: Zod schema validation
- **Error Sanitization**: Safe error messages

## 📈 Monitoring & Observability

### **Built-in Metrics**
- API call success/failure rates
- Response times
- Error frequencies
- Cache hit/miss ratios
- WebSocket connection counts

### **Health Checks**
The `get_system_health` tool provides comprehensive system status:

```json
{
  "status": "healthy",
  "timestamp": "2023-01-01T12:00:00Z",
  "rateLimiting": {
    "remaining": 45,
    "resetTime": "2023-01-01T12:01:00Z"
  },
  "errors": {
    "totalTypes": 2,
    "recentErrors": [...]
  },
  "websocket": {
    "totalConnections": 5,
    "totalSubscriptions": 12
  },
  "cache": {
    "size": 150,
    "expired": 3
  }
}
```

## 🚀 Getting Started

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and configure:

```bash
# Core Genesys Cloud Config
GENESYSCLOUD_REGION=mypurecloud.com
GENESYSCLOUD_OAUTHCLIENT_ID=your_oauth_client_id
GENESYSCLOUD_OAUTHCLIENT_SECRET=your_oauth_client_secret

# Enhanced Features
WEBSOCKET_ENABLED=true
WEBSOCKET_PORT=8080
RATE_LIMIT_REQUESTS_PER_MINUTE=60
```

### 3. Running Enhanced Server
```bash
# Development with enhanced features
npm run dev:enhanced

# Production with enhanced features  
npm run start:enhanced

# With MCP Inspector
npm run start:inspector:enhanced
```

### 4. Claude Desktop Configuration
```json
{
  "mcpServers": {
    "genesys-cloud-plus": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@makingchatbots/genesys-cloud-mcp-server"],
      "env": {
        "GENESYSCLOUD_REGION": "mypurecloud.com",
        "GENESYSCLOUD_OAUTHCLIENT_ID": "your_oauth_client_id",
        "GENESYSCLOUD_OAUTHCLIENT_SECRET": "your_oauth_client_secret",
        "WEBSOCKET_ENABLED": "true",
        "RATE_LIMIT_REQUESTS_PER_MINUTE": "60"
      }
    }
  }
}
```

## 📚 Tool Summary

| Tool Category | Tool Name | Purpose | Key Features |
|---------------|-----------|---------|--------------|
| **Agent** | `get_realtime_agent_status` | Live agent monitoring | Status, presence, queues |
| **Agent** | `get_agent_kpi_dashboard` | Performance analytics | KPIs, grading, trends |
| **Queue** | `monitor_queue_sla_realtime` | SLA monitoring | Real-time metrics, alerts |
| **Queue** | `configure_queue_alerts` | Alert management | Webhooks, cooldowns |
| **System** | `get_system_health` | Server monitoring | Performance, errors |
| **System** | `test_webhook` | Connectivity testing | Response time, status |

## 🎯 Use Cases

### **Contact Center Supervisors**
- Monitor agent performance in real-time
- Track SLA compliance across queues
- Set up automated alerts for threshold breaches
- Generate performance reports

### **Workforce Management**
- Analyze agent utilization and efficiency
- Monitor schedule adherence
- Track performance trends
- Identify coaching opportunities

### **Operations Teams**
- System health monitoring
- Performance optimization
- Error tracking and resolution
- Webhook integration testing

### **Business Intelligence**
- KPI dashboard generation
- Historical trend analysis
- Performance benchmarking
- Custom reporting

## 🔮 Future Enhancements

- **Redis Cache Integration**: For production scalability
- **Advanced Analytics**: Machine learning insights
- **Custom Dashboards**: Web-based management interface
- **Integration APIs**: Connect with external systems
- **Advanced Alerting**: SMS, email, and escalation rules

## 💡 Best Practices

1. **Rate Limiting**: Keep requests within Genesys Cloud limits
2. **Caching**: Use appropriate TTL values for your use case
3. **Error Handling**: Monitor error rates and adjust retry logic
4. **WebSocket Management**: Limit concurrent connections
5. **Security**: Rotate OAuth credentials regularly

This enhanced MCP server transforms basic Genesys Cloud API access into a comprehensive contact center management platform while maintaining full compatibility with existing tools.