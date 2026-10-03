import { describe, expect, it } from "vitest";
import {
  SimulationBudgetExceededError,
  createGameRuntime,
  createInMemoryPersistence,
  createWorldSimulationRegistry,
  fictionalInstant,
  loadGameDefinition,
  type GameRuntimeDependencies,
  type PersistencePorts,
  type WorldState,
  type WorldProcessDefinition,
} from "@llm-ttrpg/engine";
import { createMigratedSqlitePersistence } from "./support/sqlite.js";
import {
  WEEK_MS,
  simulationTestGameDefinition,
} from "./support/simulation-game.js";

function dependencies(
  persistence: PersistencePorts,
  failProcess = false,
  idPrefix = "simulation",
): GameRuntimeDependencies {
  let id = 0;
  return {
    persistence,
    wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
    idGenerator: { next: (kind) => `${kind}.${idPrefix}-${++id}` },
    worldSeedSource: { nextSeed: () => 0x1234_5678 },
    game: loadGameDefinition(simulationTestGameDefinition({ failProcess })),
  };
}

async function prepareSleepingWorld(
  persistence: PersistencePorts,
  failProcess = false,
  idPrefix = "simulation",
) {
  const runtimeDependencies = dependencies(persistence, failProcess, idPrefix);
  const runtime = createGameRuntime(runtimeDependencies);
  const session = await runtime.createWorld("Sleeping world");
  const start = session.snapshot().fictionalTime;

  const initialNoOp = await session.catchUpScope({ scopeId: "scope.test-town" });
  expect(initialNoOp).toEqual(expect.objectContaining({
    kind: "no-op",
    reason: "already-current",
    originalCursor: start,
    finalCursor: start,
  }));

  const dueAt = fictionalInstant(
    new Date(Date.parse(start) + WEEK_MS).toISOString(),
  );
  const scheduled = await session.scheduleTrigger({
    type: "test.delivery-due",
    schemaVersion: 1,
    sourceComponent: runtimeDependencies.game.campaign.identity,
    dueAt,
    scopeIds: ["scope.test-town"],
    payload: { amount: 5 },
  });
  await session.advanceTime(3 * WEEK_MS);
  const target = session.snapshot().fictionalTime;

  const cursorsAfterAdvance = session.snapshot().simulationCursors;
  expect(cursorsAfterAdvance).toHaveLength(5);
  expect(cursorsAfterAdvance.every((cursor) => cursor.lastSimulatedAt === start))
    .toBe(true);

  await session.executeOperation("test.events.record-external", {
    type: "test.route-disrupted",
    scopeId: "scope.test-town",
  });
  await session.executeOperation("test.events.record-external", {
    type: "test.unrelated-development",
    scopeId: "scope.unrelated-town",
  });
  const history = await session.eventHistory();
  const relevantEvent = history.find((event) => event.type === "test.route-disrupted")!;
  const unrelatedEvent = history.find(
    (event) => event.type === "test.unrelated-development",
  )!;
  return {
    runtime,
    runtimeDependencies,
    session,
    start,
    target,
    scheduled,
    relevantEvent,
    unrelatedEvent,
  };
}

function fixtureEntityData(
  state: WorldState,
  entityId: string,
) {
  return state.entities.find((entity) => entity.id === entityId)!.data;
}

async function exerciseCatchUpPersistence(persistence: PersistencePorts) {
  const prepared = await prepareSleepingWorld(persistence);
  const historyBefore = await prepared.session.eventHistory();
  const fictionalTimeBefore = prepared.session.snapshot().fictionalTime;
  const revisionBefore = (await persistence.worlds.load(prepared.session.worldId))!.revision;
  const result = await prepared.session.catchUpScope({ scopeId: "scope.test-site" });
  expect(result.kind).toBe("caught-up");
  if (result.kind !== "caught-up") throw new Error("Expected catch-up result");

  expect(result.originalCursor).toBe(prepared.start);
  expect(result.finalCursor).toBe(prepared.target);
  expect(result.awakenedScopeIds).toEqual([
    "scope.world",
    "scope.region",
    "scope.test-town",
    "scope.test-site",
  ]);
  expect(result.processOrder).toEqual([
    "scope.test-town:simulation.supply",
    "scope.test-town:simulation.disruption",
    "scope.test-town:simulation.local-pressure",
  ]);
  expect(result.relevantEventIds).toContain(prepared.relevantEvent.id);
  expect(result.relevantEventIds).not.toContain(prepared.unrelatedEvent.id);
  expect(result.processedScheduledTriggerIds).toEqual([prepared.scheduled.id]);
  expect(result.randomness).toEqual([
    expect.objectContaining({ stream: 0, draws: 1 }),
  ]);
  expect(result.canonicalEventIds).toHaveLength(2);
  expect(result.worldRevisionBefore).toBe(revisionBefore);
  expect(result.worldRevisionAfter).toBe(revisionBefore + 1);

  const supplyDiagnostic = result.processOutcomes.find(
    (item) => item.processId === "simulation.supply",
  )!.diagnostics;
  expect(supplyDiagnostic).toEqual({
    strategy: "weekly-aggregate",
    weeks: 3,
    delivered: 5,
    supply: 96,
  });
  expect(result.processOutcomes.find(
    (item) => item.processId === "simulation.disruption",
  )!.diagnostics).toEqual({
    selectedSupply: 96,
    disruptions: 1,
    supply: 76,
  });
  expect(result.processOutcomes.find(
    (item) => item.processId === "simulation.local-pressure",
  )!.diagnostics).toEqual(expect.objectContaining({
    selectedSupply: 76,
    selectedDisruptions: 1,
  }));

  const state = prepared.session.snapshot();
  expect(state.fictionalTime).toBe(fictionalTimeBefore);
  const testTown = fixtureEntityData(state, "simulation.entity.test-town");
  const unrelatedTown = fixtureEntityData(
    state,
    "simulation.entity.unrelated-town",
  );
  expect(testTown.supply).toBe(76);
  expect(testTown.disruptions).toBe(1);
  expect(testTown["process-log"]).toEqual([
    "supply",
    "disruption",
    "local-pressure",
  ]);
  expect(unrelatedTown).toEqual(expect.objectContaining({
    supply: 100,
    disruptions: 0,
    pressure: 0,
    "process-log": [],
  }));
  expect(state.randomness.nextStream).toBe(1);
  expect(state.scheduledTriggers).toEqual([
    expect.objectContaining({
      type: "test.delivery-due",
      scopeIds: ["scope.test-town"],
      payload: { amount: 4 },
    }),
  ]);
  expect(state.simulationCursors.find(
    (cursor) => cursor.scopeId === "scope.unrelated-town",
  )?.lastSimulatedAt).toBe(prepared.start);
  for (const scopeId of result.awakenedScopeIds) {
    expect(state.simulationCursors.find(
      (cursor) => cursor.scopeId === scopeId,
    )?.lastSimulatedAt).toBe(prepared.target);
  }

  const historyAfter = await prepared.session.eventHistory();
  expect(historyAfter).toHaveLength(historyBefore.length + 2);
  const disruptionOutcome = historyAfter.find(
    (event) => event.type === "test.local-supply-disrupted",
  )!;
  expect(disruptionOutcome.causedByEventIds).toEqual([prepared.relevantEvent.id]);
  expect(historyAfter.find(
    (event) => event.type === "test.local-pressure-changed",
  )?.payload).toEqual(expect.objectContaining({ supply: 76, disruptions: 1 }));

  const persistedBeforeNoOp = await persistence.worlds.load(prepared.session.worldId);
  const noOp = await prepared.session.catchUpScope({ scopeId: "scope.test-site" });
  expect(noOp).toEqual(expect.objectContaining({
    kind: "no-op",
    reason: "already-current",
    awakenedScopeIds: [],
    canonicalEventIds: [],
    randomness: [],
  }));
  expect(await persistence.worlds.load(prepared.session.worldId))
    .toEqual(persistedBeforeNoOp);
  expect(await prepared.session.eventHistory()).toEqual(historyAfter);

  const saved = await prepared.session.save("after catch-up");
  const reopened = await createGameRuntime(prepared.runtimeDependencies).openWorld(
    prepared.session.worldId,
  );
  expect(reopened.snapshot()).toEqual(state);
  expect(await reopened.eventHistory()).toEqual(historyAfter);
  expect((await persistence.saves.loadCheckpoint(saved.checkpointId))?.state)
    .toEqual(state);

  return { ...prepared, result, state, historyAfter };
}

describe("world simulation registration", () => {
  const sourceComponent = { id: "simulation-tests", version: "1.0.0" } as const;
  const emptyOutcome = {
    workUnits: 0,
    mutations: [],
    events: [],
    processedScheduledTriggerIds: [],
    cancelScheduledTriggerIds: [],
    schedule: [],
    diagnostics: {},
  };
  const process = (
    id: string,
    dependencies: string[] = [],
  ): WorldProcessDefinition => ({
    metadata: {
      id,
      version: "1.0.0",
      description: id,
      kind: "deterministic",
      scopeKinds: ["scope-kind"],
      dependencies,
      eventInterests: [],
      scheduledTriggerTypes: [],
    },
    selectRelevantState: () => ({}),
    runCatchUp: () => emptyOutcome,
  });

  it("rejects missing scope parents and cyclic scope dependencies", () => {
    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [{
          id: "scope.child",
          kind: "scope-kind",
          parentScopeId: "scope.missing",
          dependencyScopeIds: [],
        }],
      },
    }])).toThrow(/missing dependency/i);

    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [
          {
            id: "scope.a",
            kind: "scope-kind",
            dependencyScopeIds: ["scope.b"],
          },
          {
            id: "scope.b",
            kind: "scope-kind",
            dependencyScopeIds: ["scope.a"],
          },
        ],
      },
    }])).toThrow(/dependency cycle/i);
  });

  it("rejects missing and cyclic process dependencies", () => {
    const scope = {
      id: "scope.root",
      kind: "scope-kind",
      dependencyScopeIds: [],
    };
    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: { scopes: [scope], processes: [process("process.a", ["process.missing"])] },
    }])).toThrow(/missing dependency/i);
    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [scope],
        processes: [
          process("process.a", ["process.b"]),
          process("process.b", ["process.a"]),
        ],
      },
    }])).toThrow(/dependency cycle/i);
  });

  it("rejects duplicate IDs, unsupported scope kinds, and malformed event interests", () => {
    const scope = {
      id: "scope.root",
      kind: "scope-kind",
      dependencyScopeIds: [],
    };
    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [scope],
        processes: [process("process.same"), process("process.same")],
      },
    }])).toThrow(/duplicate world process/i);

    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [scope],
        processes: [{
          ...process("process.unsupported"),
          metadata: {
            ...process("process.unsupported").metadata,
            scopeKinds: ["missing-kind"],
          },
        }],
      },
    }])).toThrow(/unknown scope kind/i);

    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [scope],
        processes: [{
          ...process("process.interest"),
          metadata: {
            ...process("process.interest").metadata,
            eventInterests: [{}],
          },
        } as WorldProcessDefinition],
      },
    }])).toThrow(/event interest/i);
  });

  it("rejects ambiguous scheduled-work ownership", () => {
    const scheduled = (id: string): WorldProcessDefinition => ({
      ...process(id),
      metadata: {
        ...process(id).metadata,
        scheduledTriggerTypes: ["test.scheduled"],
      },
    });
    expect(() => createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [{
          id: "scope.root",
          kind: "scope-kind",
          dependencyScopeIds: [],
        }],
        processes: [scheduled("process.a"), scheduled("process.b")],
      },
    }])).toThrow(/multiple handlers/i);
  });

  it("produces deterministic process and scope dependency order", () => {
    const registry = createWorldSimulationRegistry([{
      sourceComponent,
      contribution: {
        scopes: [
          { id: "scope.root", kind: "scope-kind", dependencyScopeIds: [] },
          {
            id: "scope.dependency",
            kind: "scope-kind",
            parentScopeId: "scope.root",
            dependencyScopeIds: [],
          },
          {
            id: "scope.target",
            kind: "scope-kind",
            parentScopeId: "scope.root",
            dependencyScopeIds: ["scope.dependency"],
          },
          {
            id: "scope.unrelated",
            kind: "scope-kind",
            parentScopeId: "scope.root",
            dependencyScopeIds: [],
          },
        ],
        processes: [
          process("process.b", ["process.a"]),
          process("process.a"),
        ],
      },
    }]);
    expect(registry.dependencyClosure("scope.target").map((scope) => scope.id))
      .toEqual(["scope.root", "scope.dependency", "scope.target"]);
    expect(registry.listChildren("scope.root").map((scope) => scope.id))
      .toEqual(["scope.dependency", "scope.target", "scope.unrelated"]);
    expect(registry.listAncestors("scope.target").map((scope) => scope.id))
      .toEqual(["scope.root"]);
    expect(registry.listProcesses("scope-kind").map((item) => item.metadata.id))
      .toEqual(["process.a", "process.b"]);
  });
});

describe("lazy world catch-up", () => {
  it("runs the full dependency closure atomically in memory", async () => {
    await exerciseCatchUpPersistence(createInMemoryPersistence());
  });

  it("runs the same meaningful workflow with SQLite and survives reopen", async () => {
    const sqlite = await createMigratedSqlitePersistence();
    await exerciseCatchUpPersistence(sqlite.persistence);
  });

  it("reproduces state and stochastic evidence from an identical checkpoint", async () => {
    const persistence = createInMemoryPersistence();
    const prepared = await prepareSleepingWorld(persistence, false, "original");
    const saved = await prepared.session.save("before catch-up");
    const checkpoint = (await persistence.saves.loadCheckpoint(saved.checkpointId))!;
    const original = await prepared.session.catchUpScope({ scopeId: "scope.test-site" });
    if (original.kind !== "caught-up") throw new Error("Expected catch-up result");

    const clonePersistence = createInMemoryPersistence();
    await clonePersistence.worlds.create({
      metadata: {
        id: "world.checkpoint-clone",
        name: "Checkpoint clone",
        createdAt: "2042-01-01T00:00:00.000Z",
        updatedAt: "2042-01-01T00:00:00.000Z",
        game: checkpoint.metadata.game,
      },
      state: checkpoint.state,
      initialEvents: checkpoint.history,
    });
    const cloneRuntime = createGameRuntime(
      dependencies(clonePersistence, false, "clone"),
    );
    const cloneSession = await cloneRuntime.openWorld("world.checkpoint-clone");
    const replay = await cloneSession.catchUpScope({ scopeId: "scope.test-site" });
    if (replay.kind !== "caught-up") throw new Error("Expected replay catch-up result");

    expect(fixtureEntityData(
      cloneSession.snapshot(),
      "simulation.entity.test-town",
    )).toEqual(fixtureEntityData(
      prepared.session.snapshot(),
      "simulation.entity.test-town",
    ));
    expect(cloneSession.snapshot().randomness).toEqual(
      prepared.session.snapshot().randomness,
    );
    expect(replay.randomness).toEqual(original.randomness);
    expect(replay.processOutcomes.map((item) => item.diagnostics))
      .toEqual(original.processOutcomes.map((item) => item.diagnostics));
  });

  it("rolls back state, events, schedules, RNG, and cursors on mid-run failure", async () => {
    const persistence = createInMemoryPersistence();
    const prepared = await prepareSleepingWorld(persistence, true, "failure");
    const worldBefore = await persistence.worlds.load(prepared.session.worldId);
    const historyBefore = await prepared.session.eventHistory();
    await expect(prepared.session.catchUpScope({ scopeId: "scope.test-site" }))
      .rejects.toThrow(/failure after tentative rng/i);
    expect(await persistence.worlds.load(prepared.session.worldId)).toEqual(worldBefore);
    expect(await prepared.session.eventHistory()).toEqual(historyBefore);
    expect(prepared.session.snapshot()).toEqual(worldBefore?.state);
  });

  it("fails work-budget exhaustion without committing an approximation", async () => {
    const persistence = createInMemoryPersistence();
    const prepared = await prepareSleepingWorld(persistence, false, "budget");
    const worldBefore = await persistence.worlds.load(prepared.session.worldId);
    await expect(prepared.session.catchUpScope({
      scopeId: "scope.test-site",
      maxWorkUnits: 2,
    })).rejects.toBeInstanceOf(SimulationBudgetExceededError);
    expect(await persistence.worlds.load(prepared.session.worldId)).toEqual(worldBefore);
  });

  it("rejects a target earlier than the scope cursor", async () => {
    const persistence = createInMemoryPersistence();
    const prepared = await prepareSleepingWorld(persistence, false, "cursor");
    await prepared.session.catchUpScope({ scopeId: "scope.test-town" });
    await expect(prepared.session.catchUpScope({
      scopeId: "scope.test-town",
      targetTime: prepared.start,
    })).rejects.toThrow(/later than the catch-up target/i);
  });

  it("keeps registered cursors catch-up managed", async () => {
    const persistence = createInMemoryPersistence();
    const prepared = await prepareSleepingWorld(persistence, false, "managed-cursor");
    await expect(prepared.session.setSimulationCursor(
      "scope.test-town",
      prepared.target,
    )).rejects.toThrow(/advance only through catch-up/i);
  });

  it("rejects scheduled work without a registered deterministic handler", async () => {
    const persistence = createInMemoryPersistence();
    const prepared = await prepareSleepingWorld(persistence, false, "schedule-owner");
    await expect(prepared.session.scheduleTrigger({
      type: "test.unhandled",
      schemaVersion: 1,
      sourceComponent: prepared.session.snapshot().game.campaign,
      dueAt: prepared.target,
      scopeIds: ["scope.test-town"],
      payload: {},
    })).rejects.toThrow(/no world process handles scheduled trigger/i);
  });
});
