# n-eda
Event Driven Architecture framework for Node.js applications

## Overview
n-eda is a powerful Event Driven Architecture framework that provides a robust infrastructure for building event-driven applications in Node.js. It supports various event handling patterns, distributed systems, and integration with different messaging systems.

## Features
- Event-driven architecture implementation
- Support for multiple event handling patterns
- Distributed event handling
- Integration with Redis for event distribution
- AWS Lambda integration
- gRPC and RPC support
- Topic-based event routing
- Partitioned event processing
- Observer pattern implementation
- Dependency injection support
- OpenTelemetry integration for observability

## Installation
```bash
npm install @nivinjoseph/n-eda
# or
yarn add @nivinjoseph/n-eda
```

## Requirements
- Node.js >= 20.10
- Redis (for distributed event handling)

## Quick Start

```typescript
import { EdaManager, Topic, Duration } from "@nivinjoseph/n-eda";

// Create an EDA manager instance
const edaManager = new EdaManager();

// Define topics with retention period and partition count
const userTopic = new Topic("user", Duration.fromMinutes(180), 10);
const orderTopic = new Topic("order", Duration.fromMinutes(180), 10);

// Register a custom EventBus implementation
edaManager.registerEventBus(RedisEventBus);

// Register topics
edaManager.registerTopics(userTopic, orderTopic);

// Register event handlers
@event(UserCreatedEvent)
class UserCreatedEventHandler extends EdaEventHandler<UserCreatedEvent> {
    public async handle(event: UserCreatedEvent): Promise<void> {
        // Handle the event
    }
}

edaManager.registerEventHandlers(UserCreatedEventHandler);

// Bootstrap the system
edaManager.bootstrap();

// Start consuming events
await edaManager.beginConsumption();
```

## Core Concepts

### EventBus
The EventBus is a crucial component of the EDA system that serves as the central hub for event publishing and distribution. It's responsible for:

- Publishing events to the appropriate topics
- Ensuring reliable event delivery
- Managing event routing
- Supporting distributed event processing

To use the EventBus:

```typescript
// Publish an event
await eventBus.publish("UserTopic", new UserCreatedEvent(userData));
```

The EventBus must be registered with the EdaManager before it can be used:

```typescript
// Register a custom EventBus implementation
edaManager.registerEventBus(RedisEventBus);

// Or use the default in-memory implementation
edaManager.registerEventBus(InMemoryEventBus);
```

### Topics
Topics are the primary routing mechanism for events. They help organize and route events to appropriate handlers.

```typescript
// Create a topic with retention period and partition count
const topic = new Topic("user", Duration.fromMinutes(180), 10);
```

### Event Handlers
Event handlers process specific types of events. They can be registered with the EDA manager.

```typescript
@event(UserCreatedEvent)
class UserCreatedEventHandler extends EdaEventHandler<UserCreatedEvent> {
    public async handle(event: UserCreatedEvent): Promise<void> {
        // Handle the event
    }
}
```

### Distributed Processing
n-eda supports distributed event processing through Redis:

```typescript
edaManager.registerEventSubscriptionManager(RedisEventSubMgr, "consumer-group-id");
```

### AWS Lambda Integration
You can proxy events to AWS Lambda functions:

```typescript
edaManager.proxyToAwsLambda({
    functionName: "my-lambda",
    region: "us-east-1"
});
```

### gRPC and RPC Support
n-eda provides support for gRPC and RPC communication:

```typescript
// gRPC
edaManager.proxyToGrpc({
    serviceUrl: "localhost:50051",
    protoPath: "./protos/service.proto"
});

// RPC
edaManager.proxyToRpc({
    serviceUrl: "http://localhost:3000"
});
```

## Advanced Features

### Partitioned Processing
You can implement custom partitioning logic for events:

```typescript
edaManager.usePartitionKeyMapper((event) => event.userId);
```

### Distributed Observer Pattern
Enable distributed observer pattern for cross-service communication:

```typescript
edaManager.enableDistributedObserver(new Topic("system-events"));
```

### Cleanup
Proper cleanup of resources:

```typescript
await edaManager.dispose();
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


## Support
For support, please open an issue in the [GitHub repository](https://github.com/nivinjoseph/n-eda/issues).
