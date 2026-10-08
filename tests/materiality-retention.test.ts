import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  loadGameDefinition,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";

function setup() {
  const persistence = createInMemoryPersistence();
  let nextId = 0;
  const dependencies = {
    persistence,
    game: loadGameDefinition(referenceGameDefinition),
    wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
    idGenerator: {
      next: (kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") =>
        `${kind}.materiality-${++nextId}`,
    },
    worldSeedSource: { nextSeed: () => 0x2026_0606 },
  };
  return { persistence, dependencies };
}

describe("LM-06 package-owned materiality and event-sparse persistence", () => {
  it("commits 20 ordinary tasks without adding canonical events, facts, entities or beliefs", async () => {
    const { dependencies } = setup();
    const session = await createGameRuntime(dependencies).createWorld("Event sparse");
    const before = session.snapshot();
    const historyBefore = await session.eventHistory();
    const basisBefore = session.planningBasis();

    for (let i = 0; i < 20; i++) {
      await session.executeOperation("rules.actions.complete-routine-task", {
        actorId: "campaign.entity.amelia",
        actionSummary: `Routine observation ${i + 1}`,
        durationMs: 1_000,
      });
    }

    expect(session.snapshot().fictionalTime).toBe(
      new Date(Date.parse(before.fictionalTime) + 20_000).toISOString(),
    );
    expect(session.planningBasis().worldRevision).toBe(basisBefore.worldRevision + 20);
    expect(session.planningBasis().eventSequence).toBe(basisBefore.eventSequence);
    expect(await session.eventHistory()).toEqual(historyBefore);
    expect(session.snapshot().entities).toEqual(before.entities);
    expect(session.snapshot().facts).toEqual(before.facts);
    expect(session.snapshot().beliefs).toEqual(before.beliefs);
    expect(session.snapshot().actorSocialStates).toEqual(before.actorSocialStates);

    const slot = await session.save("Sparse history");
    const reopened = await createGameRuntime(dependencies).openWorld(session.worldId);
    expect((await reopened.eventHistory()).length).toBe(historyBefore.length);
    expect(reopened.snapshot().fictionalTime).toBe(session.snapshot().fictionalTime);
    expect(slot.checkpointId).toBeTruthy();

    const priorEntityCount = reopened.snapshot().entities.length;
    await reopened.executeOperation("rules.actions.enter-local-place", {
      actorId: "campaign.entity.amelia",
      placeName: "Back Room",
      travelDurationMs: 1_000,
    });
    const material = (await reopened.eventHistory()).at(-1)!;
    expect(material.type).toBe("rules.local-place-entered");
    expect(material.sequence).toBe(basisBefore.eventSequence + 1);
    expect(reopened.snapshot().entities).toHaveLength(priorEntityCount + 1);
    expect(reopened.snapshot().facts.some((fact) =>
      fact.subjectId === "campaign.entity.amelia" &&
      fact.predicate === "actor.current-location" &&
      String(fact.value).includes("back-room"),
    )).toBe(true);

    const historyAfterEntry = await reopened.eventHistory();
    await reopened.executeOperation("rules.actions.enter-local-place", {
      actorId: "campaign.entity.amelia",
      placeName: "Back Room",
      travelDurationMs: 1_000,
    });
    expect(await reopened.eventHistory()).toEqual(historyAfterEntry);
    expect(reopened.snapshot().entities).toHaveLength(priorEntityCount + 1);
  });

  it("reopens an event-rich legacy world without deleting routine-event history", async () => {
    const { persistence, dependencies } = setup();
    const legacyEvent = {
      id: "legacy.event.routine-1",
      type: "rules.routine-task-completed",
      schemaVersion: 1,
      occurredAt: referenceGameDefinition.campaign.startTime,
      relatedEntityIds: ["campaign.entity.amelia"],
      scopeIds: [],
      causedByEventIds: [],
      origin: { kind: "campaign-initialization", id: "legacy-routine-snapshot" },
      summary: "Amelia completed a recorded routine task.",
      payload: {
        actorId: "campaign.entity.amelia",
        actionSummary: "Restock a shelf",
      },
      access: "public" as const,
    };
    const oldGame = loadGameDefinition({
      ...referenceGameDefinition,
      campaign: {
        ...referenceGameDefinition.campaign,
        content: {
          ...referenceGameDefinition.campaign.content,
          events: [...referenceGameDefinition.campaign.content.events, legacyEvent],
        },
      },
    });
    const runtimeDependencies = { ...dependencies, game: oldGame };
    const world = await createGameRuntime(runtimeDependencies).createWorld("Legacy event history");
    const before = await world.eventHistory();
    expect(before.some((event) => event.id === legacyEvent.id)).toBe(true);
    await world.save("Legacy save");
    const reopened = await createGameRuntime({ ...runtimeDependencies, persistence })
      .openWorld(world.worldId);
    expect(await reopened.eventHistory()).toEqual(before);
    const legacy = (await reopened.eventHistory()).find((event) =>
      event.id === legacyEvent.id
    );
    expect(legacy?.payload).toEqual(legacyEvent.payload);
    expect(legacy?.type).toBe("rules.routine-task-completed");
  });

  it("keeps the old routine event type registered for historical saves", async () => {
    const { dependencies } = setup();
    const eventType = dependencies.game.eventTypeRegistry.resolve(
      "rules.routine-task-completed", 1,
    );
    expect(eventType.sourceComponent).toEqual(referenceGameDefinition.ruleset.identity);
    expect(dependencies.game.operationRegistry.get(
      "rules.actions.complete-routine-task",
    ).metadata.retentionClass).toBe("continuity");
  });

  it("does not emit canonical history for incidental unsourced conversation, but retains material warnings", async () => {
    const { dependencies } = setup();
    const session = await createGameRuntime(dependencies).createWorld("Speech retention");
    const initial = await session.eventHistory();
    const baseAct = {
      id: "act.materiality.1",
      interactionId: "interaction.materiality.1",
      speakerId: "campaign.entity.amelia",
      recipientIds: ["campaign.entity.nina"],
      inputMode: "described",
      exactQuoteFragments: [],
      semanticKinds: ["question"],
      authorizedContent: "Ask how the morning is going.",
      testimony: [],
      materialCommitments: [],
      deliveryIntent: "honest",
      groundingIds: [],
      containsNonSpeechAction: false,
      durationMs: 1_000,
    };
    await session.executeOperation("rules.social.record-communication", {
      actorId: baseAct.speakerId,
      act: baseAct,
      durationMs: baseAct.durationMs,
      scopeIds: [],
    });
    expect(await session.eventHistory()).toEqual(initial);
    await session.executeOperation("rules.social.record-communication", {
      actorId: baseAct.speakerId,
      act: {
        ...baseAct,
        id: "act.materiality.2",
        semanticKinds: ["threat"],
        authorizedContent: "A consequential threat.",
      },
      durationMs: 1_000,
      scopeIds: [],
    });
    const history = await session.eventHistory();
    expect(history).toHaveLength(initial.length + 1);
    expect(history.at(-1)?.type).toBe("rules.communication-recorded");
    expect(history.at(-1)?.sequence).toBe(initial.length + 1);
  });
});
