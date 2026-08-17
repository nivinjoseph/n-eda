// INACTIVE — this file is commented out in its entirety. The corresponding `EdaManager.registerConsumerTracer`
// is also commented out, so there is no per-handler tracing hook. OpenTelemetry instrumentation is instead
// emitted inline by producer.ts, consumer.ts, and processor.ts. See ARCHITECTURE.md.

// // public

// export type EventInfo = {
//     readonly topic: string;
//     readonly partition: number;
//     readonly partitionKey: string;
//     readonly eventName: string;
//     readonly eventId: string;
// };

// export type ConsumerTracer = (eventInfo: EventInfo, next: () => Promise<void>) => Promise<void>;