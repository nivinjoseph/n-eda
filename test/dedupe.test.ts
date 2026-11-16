import { Delay, Duration } from "@nivinjoseph/n-util";
import { Redis } from "ioredis";
import assert from "node:assert";
import test, { after, before, describe } from "node:test";
import { EdaManager, EventBus, NedaClearTrackedKeysEvent } from "../src/index.js";
import {
    DedupeLostKeyEvent, DedupeRecorder, DedupeTestEvent, DedupeUnhandledEvent, RecordingLogger,
    createDedupeEdaManager, failNextLpush, holdNextUnlinkReply, holdThenFailNextUnlink,
    readIndexKey, slotKey, trackedKeysKey, writeIndexKey
} from "./utils/dedupe-test-utils.js";
import { waitFor } from "./utils/observer-test-utils.js";


await describe("duplicate suppression tests", async () =>
{
    // Topic names and event ids are unique per run. Two of these tests leave a window their consumer can
    // never get past, so a topic reused across runs would start the next run already stuck.
    const runId = Date.now().toString();

    const sameWindowTopic = `dedupe-${runId}-same-window`;
    const openWindowTopic = `dedupe-${runId}-open-window`;
    const rereadTopic = `dedupe-${runId}-reread`;
    const clearTopic = `dedupe-${runId}-clear`;
    const rewindTopic = `dedupe-${runId}-rewind`;
    const twoClearsTopic = `dedupe-${runId}-two-clears`;
    const rejectTopic = `dedupe-${runId}-reject`;
    const duringClearTopic = `dedupe-${runId}-during-clear`;
    const failedClearTopic = `dedupe-${runId}-failed-clear`;
    const stuckRewindTopic = `dedupe-${runId}-stuck-rewind`;
    const logFailTopic = `dedupe-${runId}-log-fail`;
    const stopTopic = `dedupe-${runId}-stop`;

    // Named in the failure message of every test that waits on RecordingLogger.countConsumerErrors, because
    // that count depends on the wording of a log line and a timeout there would otherwise look like a bug.
    const logWordingHint = "or the consumer's 'Error in consumer' warning was reworded "
        + "(see RecordingLogger.countConsumerErrors)";

    const rereadEventId = `evt_${runId}_reread`;
    const afterClearEventId = `evt_${runId}_after_clear`;
    const duringClearEventId = `evt_${runId}_during_clear`;
    const failedClearEventId = `evt_${runId}_failed_clear`;

    let edaManager: EdaManager;
    let eventBus: EventBus;
    let recorder: DedupeRecorder;
    let logger: RecordingLogger;
    // The shared manager's own client, which its consumers use. Only for injecting failures and delays.
    let managerClient: Redis;
    // Owned by the suite rather than borrowed from a manager, because a manager's client is closed by dispose().
    let redis: Redis;

    // Two clears caught mid-flight: the first has its delete sent and the reply held back, the second has
    // its delete held and then failed. Both are let go in `after` too, or a test that fails early would
    // leave a consumer waiting on its delete and dispose() waiting on that consumer.
    let heldClear: ReturnType<typeof holdNextUnlinkReply>;
    let heldFailingClear: ReturnType<typeof holdThenFailNextUnlink>;

    /**
     * Allocates the topic's next slot and fills it with a payload that cannot be inflated. Reading it makes
     * the consume loop throw, back off for five seconds, and read the same window again — indefinitely.
     */
    const appendUndecodableSlot = async (topic: string): Promise<void> =>
    {
        const slot = await redis.incr(writeIndexKey(topic));
        await redis.setex(slotKey(topic, slot), 3600, Buffer.from([0xff, 0xff, 0xff, 0xff]));
    };

    before(async () =>
    {
        redis = new Redis();

        edaManager = await createDedupeEdaManager(
            sameWindowTopic, openWindowTopic, rereadTopic, clearTopic, rewindTopic, twoClearsTopic, rejectTopic,
            duringClearTopic, failedClearTopic, stuckRewindTopic, logFailTopic);
        eventBus = edaManager.serviceLocator.resolve<EventBus>("EventBus");
        recorder = edaManager.serviceLocator.resolve<DedupeRecorder>("DedupeRecorder");
        logger = edaManager.serviceLocator.resolve<RecordingLogger>("Logger");
        managerClient = edaManager.serviceLocator.resolve<Redis>("EdaRedisClient");

        // The topics below are seeded before consumption starts, so the consumer's first read of each
        // sees every slot of its window at once.

        // an event whose handler stays open, then a slot that fails the window
        recorder.hold(rereadEventId);
        await eventBus.publish(rereadTopic, new DedupeTestEvent({ id: rereadEventId, key: "reread" }));
        await appendUndecodableSlot(rereadTopic);

        // a clear, then an event, then a slot that fails the window
        await eventBus.publish(clearTopic, new NedaClearTrackedKeysEvent({ id: `clear_${runId}` }));
        await eventBus.publish(clearTopic, new DedupeTestEvent({ id: afterClearEventId, key: "after-clear" }));
        await appendUndecodableSlot(clearTopic);

        // an event whose handler stays open, a clear whose delete will be caught mid-flight, then a slot
        // that fails the window
        recorder.hold(duringClearEventId);
        await eventBus.publish(duringClearTopic,
            new DedupeTestEvent({ id: duringClearEventId, key: "during-clear" }));
        await eventBus.publish(duringClearTopic, new NedaClearTrackedKeysEvent({ id: `clear_${runId}_during` }));
        await appendUndecodableSlot(duringClearTopic);
        heldClear = holdNextUnlinkReply(managerClient, trackedKeysKey(duringClearTopic));

        // an event whose handler stays open, then a clear whose delete will be held and then failed
        recorder.hold(failedClearEventId);
        await eventBus.publish(failedClearTopic,
            new DedupeTestEvent({ id: failedClearEventId, key: "failed-clear" }));
        await eventBus.publish(failedClearTopic, new NedaClearTrackedKeysEvent({ id: `clear_${runId}_failed` }));
        heldFailingClear = holdThenFailNextUnlink(managerClient, trackedKeysKey(failedClearTopic));

        // the consume loop never resolves; deliberately not awaited
        edaManager.beginConsumption().catch(e => console.error(e));
    });

    after(async () =>
    {
        // a handler held open, or a consumer waiting on a held delete, would keep dispose() waiting forever
        recorder.releaseAll();
        heldClear.release();
        heldFailingClear.fail();

        await edaManager.dispose();
        await redis.quit();
    });


    await test("handles an id once when two copies arrive in the same read window", async () =>
    {
        const eventId = `evt_${runId}_same_window`;

        // one publish call to a single-partition topic is one slot, hence one read window
        await eventBus.publish(sameWindowTopic,
            new DedupeTestEvent({ id: eventId, key: "same-window" }),
            new DedupeTestEvent({ id: eventId, key: "same-window" }));

        assert.ok(await waitFor(() => recorder.countHandled(eventId) >= 1), "the event was never handled");

        // both copies share a partition key, so a second dispatch would run straight after the first
        await Delay.seconds(2);

        assert.strictEqual(recorder.countHandled(eventId), 1, "the second copy was dispatched as well");
    });

    await test("saves a finished event's id while its read window is still open", async () =>
    {
        const finishedEventId = `evt_${runId}_open_window_finished`;
        const heldEventId = `evt_${runId}_open_window_held`;

        recorder.hold(heldEventId);

        try
        {
            await eventBus.publish(openWindowTopic,
                new DedupeTestEvent({ id: finishedEventId, key: "open-window-a" }),
                new DedupeTestEvent({ id: heldEventId, key: "open-window-b" }));

            // one partition means one processor, so the held event only starts once the first has finished
            assert.ok(await waitFor(() => recorder.hasStarted(heldEventId)), "the held event never started");
            assert.strictEqual(recorder.countHandled(finishedEventId), 1, "the first event did not finish");

            const saved = await waitFor(async () =>
                (await redis.lrange(trackedKeysKey(openWindowTopic), 0, -1)).includes(finishedEventId),
                Duration.fromSeconds(2));

            assert.ok(saved, "the finished event's id was not saved while the window was still open");
        }
        finally
        {
            recorder.release(heldEventId);
        }

        assert.ok(await waitFor(() => recorder.countHandled(heldEventId) === 1), "the held event never finished");
    });

    await test("does not dispatch an in-flight event again when its window is re-read after an error", async () =>
    {
        assert.ok(await waitFor(() => recorder.hasStarted(rereadEventId)), "the seeded event never started");

        // The second failure means the window has been read again, past the slot holding the seeded event,
        // while that event's handler is still open. Releasing it any earlier would test nothing.
        assert.ok(await waitFor(() => logger.countConsumerErrors(rereadTopic) >= 2),
            `the window was never read a second time, ${logWordingHint}`);

        recorder.release(rereadEventId);

        assert.ok(await waitFor(() => recorder.countHandled(rereadEventId) >= 1), "the seeded event never finished");

        // a second dispatch would be queued behind the first on the same partition key
        await Delay.seconds(2);

        assert.strictEqual(recorder.countHandled(rereadEventId), 1,
            "the event was dispatched again when its window was re-read");
    });

    await test("applies a clear once, so an event finished after it is not dispatched again on a re-read", async () =>
    {
        assert.ok(await waitFor(() => recorder.countHandled(afterClearEventId) >= 1),
            "the event after the clear was never handled");

        // the second failure means the window, clear included, has been read again
        assert.ok(await waitFor(() => logger.countConsumerErrors(clearTopic) >= 2),
            `the window was never read a second time, ${logWordingHint}`);

        // had the clear been applied again it would have wiped the event's id, and the event would have
        // been dispatched during that same read
        await Delay.seconds(2);

        assert.strictEqual(recorder.countHandled(afterClearEventId), 1,
            "the event was dispatched again after the clear was re-applied");
    });

    await test("applies a clear again when its slot is replayed after the read index is rewound", async () =>
    {
        const eventId = `evt_${runId}_rewind`;

        await eventBus.publish(rewindTopic, new NedaClearTrackedKeysEvent({ id: `clear_${runId}_rewind` }));
        await eventBus.publish(rewindTopic, new DedupeTestEvent({ id: eventId, key: "rewind" }));

        assert.ok(await waitFor(() => recorder.countHandled(eventId) === 1), "the event was never handled");

        // both slots consumed and their window completed, so the rewind below is a replay and not a re-read
        const consumed = await waitFor(async () => await redis.get(readIndexKey(rewindTopic)) === "2");
        assert.ok(consumed, "the consumer never advanced past both slots");

        await redis.set(readIndexKey(rewindTopic), "0");

        // The replayed clear wipes the event's id, so the event behind it is processed again — which is what
        // a clear is for. An idle consumer notices the rewind on its next poll, at most 5 seconds away.
        assert.ok(await waitFor(() => recorder.countHandled(eventId) === 2, Duration.fromSeconds(12)),
            "the replayed clear was skipped, so the event behind it was suppressed as a duplicate");
    });

    await test("applies every clear in a slot, even when they share an id", async () =>
    {
        const unhandledEventId = `evt_${runId}_between_clears`;
        const clearId = `clear_${runId}_reused`;

        // One publish is one slot. The event between the clears has no handler, so the consumer tracks its
        // id as it reads it — after the first clear and before the second. The clears share an id on
        // purpose: a clear is an instruction, and reusing an id must not turn the second one into a no-op.
        await eventBus.publish(twoClearsTopic,
            new NedaClearTrackedKeysEvent({ id: clearId }),
            new DedupeUnhandledEvent({ id: unhandledEventId }),
            new NedaClearTrackedKeysEvent({ id: clearId }));

        const consumed = await waitFor(async () => await redis.get(readIndexKey(twoClearsTopic)) === "1");
        assert.ok(consumed, "the consumer never completed the window");

        const tracked = await redis.lrange(trackedKeysKey(twoClearsTopic), 0, -1);

        assert.ok(!tracked.includes(unhandledEventId),
            "the second clear was skipped, so the id tracked before it is still in the list");
    });

    await test("fails the window, rather than the process, when a dispatch rejects", async () =>
    {
        const lostKeyEventId = `evt_${runId}_lost_key`;
        const normalEventId = `evt_${runId}_after_lost_key`;

        const unhandledRejections = new Array<unknown>();
        const onUnhandledRejection = (reason: unknown): void => { unhandledRejections.push(reason); };
        process.on("unhandledRejection", onUnhandledRejection);

        try
        {
            // The rejecting dispatch has to be followed by another slot in the same read, which is when the
            // loop is busy elsewhere and nothing is watching the rejection yet. Parking the read index
            // above the write index keeps the consumer idle while both slots are written; putting it back
            // lets the consumer find both on its next poll.
            await redis.set(readIndexKey(rejectTopic), "100");
            await eventBus.publish(rejectTopic, new DedupeLostKeyEvent({ id: lostKeyEventId, key: "lost-key" }));
            await eventBus.publish(rejectTopic, new DedupeTestEvent({ id: normalEventId, key: "after-lost-key" }));
            await redis.set(readIndexKey(rejectTopic), "0");

            assert.ok(await waitFor(() => logger.countConsumerErrors(rejectTopic) >= 1),
                `the window holding the rejected dispatch never failed, ${logWordingHint}`);

            // the window fails as soon as the rejection is seen, which can be before this handler returns
            assert.ok(await waitFor(() => recorder.countHandled(normalEventId) === 1),
                "the event after the rejected dispatch was never handled");

            // An unobserved rejection is reported while the loop is reading the slot after it, so by the
            // time the window has failed it would already be in this list.
            assert.deepStrictEqual(unhandledRejections, [],
                "the rejected dispatch was reported as an unhandled rejection");
        }
        finally
        {
            process.off("unhandledRejection", onUnhandledRejection);
        }
    });

    await test("keeps an id that finishes while a clear is being applied", async () =>
    {
        assert.ok(await waitFor(() => heldClear.sent), "the consumer never reached the clear's delete");

        // The delete has reached Redis and the consumer is waiting on its reply. Finishing the event now
        // offers its id for tracking in exactly that gap: nothing between a handler returning and its id
        // being tracked waits on a timer, so the id has been offered by the time this poll sees the count.
        recorder.release(duringClearEventId);
        assert.ok(await waitFor(() => recorder.countHandled(duringClearEventId) === 1),
            "the event held open ahead of the clear never finished");

        heldClear.release();

        // the second failure means the window has been read again, past the slot holding the event
        assert.ok(await waitFor(() => logger.countConsumerErrors(duringClearTopic) >= 2),
            `the window was never read a second time, ${logWordingHint}`);

        // a second dispatch would have nothing to wait on: the hold on this id is already released
        await Delay.seconds(1);

        assert.strictEqual(recorder.countHandled(duringClearEventId), 1,
            "the id was dropped when the clear completed, so the event was dispatched again on the re-read");

        const tracked = await redis.lrange(trackedKeysKey(duringClearTopic), 0, -1);
        assert.ok(tracked.includes(duringClearEventId), "the id is not in Redis");
    });

    await test("tracks an id that finishes while a clear is being applied, even if the clear fails", async () =>
    {
        assert.ok(await waitFor(() => heldFailingClear.started), "the consumer never reached the clear's delete");

        recorder.release(failedClearEventId);
        assert.ok(await waitFor(() => recorder.countHandled(failedClearEventId) === 1),
            "the event held open ahead of the clear never finished");

        heldFailingClear.fail();

        // The failed clear fails the window. Five seconds later the window is read again from its first
        // slot: the event's slot first, then the clear, which now goes through and lets the window complete.
        const completed = await waitFor(async () => await redis.get(readIndexKey(failedClearTopic)) === "2");
        assert.ok(completed, "the window never completed after the clear was retried");

        assert.strictEqual(recorder.countHandled(failedClearEventId), 1,
            "the id was lost when the clear failed, so the event was dispatched again on the re-read");
    });

    await test("applies a clear again when the read index is rewound while its window is stuck", async () =>
    {
        const firstEventId = `evt_${runId}_stuck_rewind_first`;
        const laterEventId = `evt_${runId}_stuck_rewind_later`;

        // a first window that completes, so the read index sits above zero and there is somewhere to rewind to
        await eventBus.publish(stuckRewindTopic,
            new DedupeTestEvent({ id: firstEventId, key: "stuck-rewind-first" }));
        const firstWindowDone = await waitFor(async () => await redis.get(readIndexKey(stuckRewindTopic)) === "1");
        assert.ok(firstWindowDone, "the first window never completed");

        // A second window that cannot complete: a clear, an event behind it, and a slot that fails the
        // window. Parking the read index above the write index keeps the consumer idle while the three
        // slots are written, so it reads them in one go.
        await redis.set(readIndexKey(stuckRewindTopic), "100");
        await eventBus.publish(stuckRewindTopic, new NedaClearTrackedKeysEvent({ id: `clear_${runId}_stuck` }));
        await eventBus.publish(stuckRewindTopic,
            new DedupeTestEvent({ id: laterEventId, key: "stuck-rewind-later" }));
        await appendUndecodableSlot(stuckRewindTopic);
        await redis.set(readIndexKey(stuckRewindTopic), "1");

        assert.ok(await waitFor(() => logger.countConsumerErrors(stuckRewindTopic) >= 1),
            `the second window never failed, ${logWordingHint}`);
        assert.ok(await waitFor(() => recorder.countHandled(laterEventId) === 1),
            "the event behind the clear was never handled");

        // The rewind an operator makes to force reprocessing. The window is still stuck, so the consumer
        // has not forgotten the clear on its own; it has to notice that the read index is no longer where
        // it left it.
        await redis.set(readIndexKey(stuckRewindTopic), "0");

        assert.ok(await waitFor(() => recorder.countHandled(laterEventId) === 2, Duration.fromSeconds(15)),
            "the replayed clear was skipped, so the event behind it was suppressed as a duplicate");
    });

    await test("does not surface an unhandled rejection when a failed save cannot be logged", async () =>
    {
        const eventId = `evt_${runId}_log_fail`;
        const key = trackedKeysKey(logFailTopic);

        const unhandledRejections = new Array<unknown>();
        const onUnhandledRejection = (reason: unknown): void => { unhandledRejections.push(reason); };
        process.on("unhandledRejection", onUnhandledRejection);

        try
        {
            // the save made when the event finishes fails, and the logger rejects the attempt to report it
            const failedWrite = failNextLpush(managerClient, key);
            const failedLog = logger.rejectNextError(key);

            await eventBus.publish(logFailTopic, new DedupeTestEvent({ id: eventId, key: "log-fail" }));

            assert.ok(await waitFor(() => failedWrite.used), "the save made when the event finished did not fail");
            assert.ok(await waitFor(() => failedLog.used), "the failed save was never reported to the logger");

            // the save at the end of the window retries the id, so it still reaches Redis
            const saved = await waitFor(async () => (await redis.lrange(key, 0, -1)).includes(eventId));
            assert.ok(saved, "the id whose first save failed never reached Redis");

            // A rejection nothing observes is reported once the code that caused it has run to completion,
            // well before the polls above return.
            assert.deepStrictEqual(unhandledRejections, [],
                "the logger's failure was reported as an unhandled rejection");
        }
        finally
        {
            process.off("unhandledRejection", onUnhandledRejection);
        }
    });

    await test("saves an id left pending by a failed write when the consumer stops", async () =>
    {
        const eventId = `evt_${runId}_stop`;

        // Its own manager: this test disposes it, and it has to do so while the consumer is still retrying
        // the missing slot, which a manager shared with slower tests could not guarantee.
        const stopManager = await createDedupeEdaManager(stopTopic);

        try
        {
            const stopEventBus = stopManager.serviceLocator.resolve<EventBus>("EventBus");
            const stopRecorder = stopManager.serviceLocator.resolve<DedupeRecorder>("DedupeRecorder");

            // The id is normally saved the moment its event finishes, which would leave nothing for the
            // consumer to do on the way out. Failing that one write leaves the id pending, so only the save
            // the consumer makes when it stops can put it in Redis.
            const failedWrite = failNextLpush(
                stopManager.serviceLocator.resolve<Redis>("EdaRedisClient"), trackedKeysKey(stopTopic));

            // Seeded before consumption starts: a real event, then a slot that is allocated but never
            // written. The consumer dispatches the event and then sits retrying the missing slot.
            await stopEventBus.publish(stopTopic, new DedupeTestEvent({ id: eventId, key: "stop" }));
            await redis.incr(writeIndexKey(stopTopic));

            stopManager.beginConsumption().catch(e => console.error(e));

            assert.ok(await waitFor(() => stopRecorder.countHandled(eventId) === 1), "the event was never handled");
            assert.ok(await waitFor(() => failedWrite.used), "the save made when the event finished did not fail");

            const savedEarly = (await redis.lrange(trackedKeysKey(stopTopic), 0, -1)).includes(eventId);
            assert.ok(!savedEarly, "the id reached Redis before the consumer stopped, so this test proves nothing");
        }
        finally
        {
            await stopManager.dispose();
        }

        const saved = (await redis.lrange(trackedKeysKey(stopTopic), 0, -1)).includes(eventId);

        assert.ok(saved, "the id left pending was not saved before the consumer stopped");
    });
});
