// import { ApplicationException } from "@nivinjoseph/n-exception";
// import { Delay, Deserializer, Make } from "@nivinjoseph/n-util";
// import { EventRegistration } from "../event-registration";
// import { Consumer } from "./consumer";
// import { ConsumerProfiler } from "./consumer-profiler";
export {};
// export class ProfilingConsumer extends Consumer
// {
//     private readonly _profiler = new ConsumerProfiler();
//     public get profiler(): ConsumerProfiler { return this._profiler; }
//     protected async beginConsume(): Promise<void>
//     {
//         while (true)
//         {
//             if (this.isDisposed)
//                 return;
//             try 
//             {
//                 this._profiler.fetchPartitionWriteIndexStarted();
//                 const writeIndex = await this.fetchPartitionWriteIndex();
//                 this._profiler.fetchPartitionWriteIndexEnded();
//                 this._profiler.fetchConsumerPartitionReadIndexStarted();
//                 const readIndex = await this.fetchConsumerPartitionReadIndex();
//                 this._profiler.fetchConsumerPartitionReadIndexEnded();
//                 if (readIndex >= writeIndex)
//                 {
//                     await Delay.seconds(1);
//                     continue;
//                 }
//                 const maxRead = 50;
//                 const lowerBoundReadIndex = readIndex + 1;
//                 const upperBoundReadIndex = (writeIndex - readIndex) > maxRead ? readIndex + maxRead : writeIndex;
//                 this._profiler.batchRetrieveEventsStarted();
//                 const eventsData = await this.batchRetrieveEvents(lowerBoundReadIndex, upperBoundReadIndex);
//                 this._profiler.batchRetrieveEventsEnded();
//                 for (const item of eventsData)
//                 {
//                     if (this.isDisposed)
//                         return;
//                     let eventData = item.value;
//                     let numReadAttempts = 1;
//                     const maxReadAttempts = 10;
//                     while (eventData == null && numReadAttempts < maxReadAttempts) // we need to do this to deal with race condition
//                     {
//                         if (this.isDisposed)
//                             return;
//                         await Delay.milliseconds(100);
//                         this._profiler.retrieveEventStarted();
//                         eventData = await this.retrieveEvent(item.index);
//                         this._profiler.retrieveEventEnded();
//                         numReadAttempts++;
//                     }
//                     if (eventData == null)
//                     {
//                         try 
//                         {
//                             throw new ApplicationException(`Failed to read event data after ${maxReadAttempts} read attempts => Topic=${this.topic}; Partition=${this.partition}; ReadIndex=${item.index};`);
//                         }
//                         catch (error)
//                         {
//                             await this.logger.logError(error);
//                         }
//                         this._profiler.incrementConsumerPartitionReadIndexStarted();
//                         await this.incrementConsumerPartitionReadIndex();
//                         this._profiler.incrementConsumerPartitionReadIndexEnded();
//                         continue;
//                     }
//                     this._profiler.decompressEventStarted();
//                     const event = await this.decompressEvent(eventData);
//                     this._profiler.decompressEventEnded();
//                     const eventId = (<any>event).$id || (<any>event).id; // for compatibility with n-domain DomainEvent
//                     const eventName = (<any>event).$name || (<any>event).name; // for compatibility with n-domain DomainEvent
//                     const eventRegistration = this.manager.eventMap.get(eventName) as EventRegistration;
//                     // const deserializedEvent = (<any>eventRegistration.eventType).deserializeEvent(event);
//                     this._profiler.deserializeEventStarted();
//                     const deserializedEvent = Deserializer.deserialize(event);
//                     this._profiler.deserializeEventEnded();
//                     if (this.trackedIdsSet.has(eventId))
//                     {
//                         this._profiler.incrementConsumerPartitionReadIndexStarted();
//                         await this.incrementConsumerPartitionReadIndex();
//                         this._profiler.incrementConsumerPartitionReadIndexEnded();
//                         continue;
//                     }
//                     let failed = false;
//                     try 
//                     {
//                         this._profiler.eventProcessingStarted(eventName, eventId);
//                         await Make.retryWithExponentialBackoff(async () =>
//                         {
//                             if (this.isDisposed)
//                             {
//                                 failed = true;
//                                 return;
//                             }
//                             try 
//                             {
//                                 await this.processEvent(eventName, eventRegistration, deserializedEvent, eventId);
//                             }
//                             catch (error)
//                             {
//                                 this._profiler.eventRetried(eventName);
//                                 throw error;
//                             }
//                         }, 5)();
//                         this._profiler.eventProcessingEnded(eventName, eventId);
//                     }
//                     catch (error)
//                     {
//                         failed = true;
//                         this._profiler.eventFailed(eventName);
//                         await this.logger.logWarning(`Failed to process event of type '${eventName}' with data ${JSON.stringify(event)} after 5 attempts.`);
//                         await this.logger.logError(error);
//                     }
//                     finally
//                     {
//                         if (failed && this.isDisposed)
//                             return;
//                         this.track(eventId);
//                         this._profiler.incrementConsumerPartitionReadIndexStarted();
//                         await this.incrementConsumerPartitionReadIndex();
//                         this._profiler.incrementConsumerPartitionReadIndexEnded();
//                     }
//                 }
//             }
//             catch (error)
//             {
//                 await this.logger.logWarning(`Error in consumer => ConsumerGroupId: ${this.manager.consumerGroupId}; Topic: ${this.topic}; Partition: ${this.partition};`);
//                 await this.logger.logError(error);
//                 if (this.isDisposed)
//                     return;
//                 await Delay.seconds(15);
//             }
//         }
//     }
// }
//# sourceMappingURL=profiling-consumer.js.map