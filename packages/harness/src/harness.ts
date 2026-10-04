import {
  applyMutationProposals,
  canonicalEventSchema,
  createGameRuntime,
  createInMemoryPersistence,
  executeEngineQueryTool,
  jsonValueSchema,
  loadGameDefinition,
  mutationProposalSchema,
  performConversationTurn,
  validateWorldState,
  type CanonicalEvent,
  type CatchUpScopeRequest,
  type CatchUpScopeResult,
  type ContextAssemblyRequest,
  type ContextQueryAuthorization,
  type ConversationAuthorityBindings,
  type ConversationTurnRequest,
  type ConversationTurnResult,
  type ConversationWorkingState,
  type FictionalInstant,
  type GameRuntimeDependencies,
  type GameSession,
  type JsonValue,
  type ModelRuntime,
  type MutationProposal,
  type PersistencePorts,
  type PlayerActionRequest,
  type PlayerActionResult,
  type ScheduledTrigger,
  type ToolAvailabilityPolicy,
  type WorldState,
} from "@llm-ttrpg/engine";
import {
  harnessEventInputSchema,
  reproductionBundleSchema,
  traceLevelSchema,
  type ContextInspection,
  type HarnessEventInput,
  type HarnessScenario,
  type HarnessSnapshot,
  type HarnessTraceEntry,
  type ReplayCommand,
  type ReproductionBundle,
  type SemanticDiff,
  type ToolInspection,
  type TraceLevel,
} from "./contracts.js";
import { diffSnapshots } from "./diff.js";
import { ScriptedModelRuntime } from "./scripted-model.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function diagnostic(value: unknown): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function safeNamespace(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function createDependencies(
  scenario: HarnessScenario,
  persistence: PersistencePorts,
  idNamespace: string,
  startingId = 0,
): GameRuntimeDependencies {
  let id = startingId;
  return {
    persistence,
    wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
    idGenerator: {
      next: (kind) => `${kind}.harness-${idNamespace}-${++id}`,
    },
    worldSeedSource: { nextSeed: () => scenario.seed },
    game: loadGameDefinition(scenario.game),
    ...(scenario.sceneSource
      ? { context: { sceneSource: scenario.sceneSource } }
      : {}),
  };
}

async function completeHistory(
  persistence: PersistencePorts,
  worldId: string,
): Promise<CanonicalEvent[]> {
  const events: CanonicalEvent[] = [];
  let cursor: { occurredAt: FictionalInstant; sequence: number } | undefined;
  while (true) {
    const page = await persistence.history.query(worldId, {
      direction: "ascending",
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    events.push(...page);
    if (page.length < 1000) break;
    const last = page.at(-1)!;
    cursor = { occurredAt: last.occurredAt, sequence: last.sequence };
  }
  return events;
}

export interface CreateHarnessOptions {
  readonly scenarios: readonly HarnessScenario[];
  readonly persistenceFactory?: () => PersistencePorts;
  readonly realModelRuntime?: ModelRuntime;
  readonly traceLevel?: TraceLevel;
}

export interface ChallengeProbe {
  readonly id: string;
  readonly run: (session: HarnessSession) => Promise<unknown>;
}

export interface ChallengeProbeResult {
  readonly id: string;
  readonly result?: JsonValue;
  readonly error?: string;
  readonly snapshot: HarnessSnapshot;
  readonly diff: SemanticDiff;
}

export class Harness {
  private readonly scenarios = new Map<string, HarnessScenario>();
  private readonly persistenceFactory: () => PersistencePorts;
  readonly realModelRuntime?: ModelRuntime;
  readonly defaultTraceLevel: TraceLevel;

  constructor(options: CreateHarnessOptions) {
    for (const scenario of options.scenarios) {
      if (this.scenarios.has(scenario.id)) {
        throw new Error(`Duplicate harness scenario: ${scenario.id}`);
      }
      this.scenarios.set(scenario.id, scenario);
    }
    this.persistenceFactory = options.persistenceFactory ?? createInMemoryPersistence;
    this.realModelRuntime = options.realModelRuntime;
    this.defaultTraceLevel = traceLevelSchema.parse(options.traceLevel ?? "decision");
  }

  listScenarios(): readonly Pick<HarnessScenario, "id" | "description" | "seed">[] {
    return [...this.scenarios.values()]
      .map(({ id, description, seed }) => ({ id, description, seed }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  scenario(id: string): HarnessScenario {
    const scenario = this.scenarios.get(id);
    if (!scenario) throw new Error(`Harness scenario not found: ${id}`);
    return scenario;
  }

  async loadScenario(id: string): Promise<HarnessSession> {
    return HarnessSession.create(this, this.scenario(id));
  }

  persistence(): PersistencePorts {
    return this.persistenceFactory();
  }
}

export class HarnessSession {
  private persistence: PersistencePorts;
  private dependencies: GameRuntimeDependencies;
  private runtime: ReturnType<typeof createGameRuntime>;
  private session: GameSession;
  private modelRuntime?: ModelRuntime;
  private traceLevel: TraceLevel;
  private traceEntries: HarnessTraceEntry[] = [];
  private commands: ReplayCommand[] = [];
  private initializing = false;
  private initialSnapshot!: HarnessSnapshot;
  private lastDiagnostics?: JsonValue;
  private readonly forks = new Map<string, HarnessSession>();

  private constructor(
    private readonly owner: Harness,
    readonly scenario: HarnessScenario,
    persistence: PersistencePorts,
    dependencies: GameRuntimeDependencies,
    runtime: ReturnType<typeof createGameRuntime>,
    session: GameSession,
    modelRuntime?: ModelRuntime,
    private readonly idNamespace = scenario.id,
  ) {
    this.persistence = persistence;
    this.dependencies = dependencies;
    this.runtime = runtime;
    this.session = session;
    this.modelRuntime = modelRuntime;
    this.traceLevel = owner.defaultTraceLevel;
  }

  static async create(
    owner: Harness,
    scenario: HarnessScenario,
  ): Promise<HarnessSession> {
    const persistence = owner.persistence();
    const dependencies = createDependencies(scenario, persistence, scenario.id);
    const runtime = createGameRuntime(dependencies);
    const gameSession = await runtime.createWorld(
      scenario.worldName ?? `Harness: ${scenario.description}`,
    );
    const modelRuntime = scenario.modelRuntimeFactory?.() ?? scenario.modelRuntime ??
      owner.realModelRuntime;
    const harness = new HarnessSession(
      owner,
      scenario,
      persistence,
      dependencies,
      runtime,
      gameSession,
      modelRuntime,
      safeNamespace(scenario.id),
    );
    harness.initializing = true;
    if (scenario.setup) await scenario.setup(harness);
    if (scenario.assertInvariants) await scenario.assertInvariants(harness);
    harness.initializing = false;
    harness.traceEntries = [];
    harness.commands = [];
    harness.initialSnapshot = await harness.snapshot();
    return harness;
  }

  get scenarioId(): string {
    return this.scenario.id;
  }

  get worldId(): string {
    return this.session.worldId;
  }

  world(): WorldState {
    return this.session.snapshot();
  }

  game() {
    return this.dependencies.game;
  }

  setTraceLevel(level: TraceLevel): void {
    this.traceLevel = traceLevelSchema.parse(level);
  }

  selectedTraceLevel(): TraceLevel {
    return this.traceLevel;
  }

  useModelRuntime(runtime: ModelRuntime): void {
    this.modelRuntime = runtime;
  }

  useRealModelRuntime(): void {
    if (!this.owner.realModelRuntime) {
      throw new Error("No real local model runtime was configured for this harness");
    }
    this.modelRuntime = this.owner.realModelRuntime;
  }

  private async persisted() {
    const persisted = await this.persistence.worlds.load(this.worldId);
    if (!persisted) throw new Error(`Harness world disappeared: ${this.worldId}`);
    return persisted;
  }

  async inspectPersistedWorld() {
    return clone(await this.persisted());
  }

  async snapshot(diagnostics = this.lastDiagnostics): Promise<HarnessSnapshot> {
    const persisted = await this.persisted();
    return {
      scenarioId: this.scenario.id,
      game: clone(persisted.state.game),
      worldId: this.worldId,
      revision: persisted.revision,
      eventSequence: persisted.eventSequence,
      state: clone(persisted.state),
      history: await completeHistory(this.persistence, this.worldId),
      ...(diagnostics === undefined ? {} : { diagnostics: clone(diagnostics) }),
    };
  }

  diff(before: HarnessSnapshot, after: HarnessSnapshot): SemanticDiff {
    return diffSnapshots(before, after);
  }

  private async record<T>(
    command: string,
    decision: unknown,
    run: () => Promise<T>,
    replay?: ReplayCommand,
  ): Promise<T> {
    const before = await this.snapshot();
    const modelStart = this.modelRuntime instanceof ScriptedModelRuntime
      ? this.modelRuntime.invocations.length
      : 0;
    try {
      const result = await run();
      const modelInvocations = this.modelRuntime instanceof ScriptedModelRuntime
        ? this.modelRuntime.invocations.slice(modelStart)
        : [];
      this.lastDiagnostics = diagnostic({
        command,
        decision,
        result,
        ...(modelInvocations.length > 0 ? { modelInvocations } : {}),
      });
      const after = await this.snapshot();
      const diff = diffSnapshots(before, after);
      this.traceEntries.push({
        sequence: this.traceEntries.length + 1,
        level: this.traceLevel,
        command,
        status: "succeeded",
        summary: `${command} succeeded; ${diff.changes.length} semantic change(s).`,
        worldRevisionBefore: before.revision,
        worldRevisionAfter: after.revision,
        fictionalTimeBefore: before.state.fictionalTime,
        fictionalTimeAfter: after.state.fictionalTime,
        changedCategories: diff.changedCategories,
        ...(this.traceLevel === "summary" ? {} : { decision: diagnostic(decision) }),
        ...(this.traceLevel === "full"
          ? { full: diagnostic({ result, diff, modelInvocations, before, after }) }
          : {}),
      });
      if (replay && !this.initializing) this.commands.push(clone(replay));
      return result;
    } catch (error) {
      const after = await this.snapshot().catch(() => before);
      const diff = diffSnapshots(before, after);
      this.traceEntries.push({
        sequence: this.traceEntries.length + 1,
        level: this.traceLevel,
        command,
        status: "failed",
        summary: `${command} failed without a successful harness result.`,
        worldRevisionBefore: before.revision,
        worldRevisionAfter: after.revision,
        fictionalTimeBefore: before.state.fictionalTime,
        fictionalTimeAfter: after.state.fictionalTime,
        changedCategories: diff.changedCategories,
        ...(this.traceLevel === "summary" ? {} : { decision: diagnostic(decision) }),
        ...(this.traceLevel === "full"
          ? { full: diagnostic({ diff, before, after }) }
          : {}),
        error: errorMessage(error),
      });
      throw error;
    }
  }

  trace(level: TraceLevel = this.traceLevel): readonly HarnessTraceEntry[] {
    const requested = traceLevelSchema.parse(level);
    return this.traceEntries.map((entry) => ({
      ...clone(entry),
      ...(requested === "summary" ? { decision: undefined, full: undefined } : {}),
      ...(requested === "decision" ? { full: undefined } : {}),
    })).map((entry) => {
      const { decision, full, ...base } = entry;
      return {
        ...base,
        ...(decision === undefined ? {} : { decision }),
        ...(full === undefined ? {} : { full }),
      };
    });
  }

  clearTrace(): void {
    this.traceEntries = [];
  }

  async reset(): Promise<void> {
    const replacement = await HarnessSession.create(this.owner, this.scenario);
    this.persistence = replacement.persistence;
    this.dependencies = replacement.dependencies;
    this.runtime = replacement.runtime;
    this.session = replacement.session;
    this.modelRuntime = replacement.modelRuntime;
    this.traceLevel = replacement.traceLevel;
    this.traceEntries = [];
    this.commands = [];
    this.initialSnapshot = replacement.initialSnapshot;
    this.lastDiagnostics = undefined;
    this.forks.clear();
  }

  async advanceTime(durationMs: number): Promise<WorldState> {
    return this.record(
      "advance-time",
      { durationMs },
      () => this.session.advanceTime(durationMs),
      { kind: "advance-time", durationMs },
    );
  }

  async catchUp(request: CatchUpScopeRequest): Promise<CatchUpScopeResult> {
    const replay: ReplayCommand = {
      kind: "catch-up",
      scopeId: request.scopeId,
      ...(request.maxWorkUnits === undefined
        ? {}
        : { maxWorkUnits: request.maxWorkUnits }),
    };
    return this.record(
      "catch-up",
      request,
      () => this.session.catchUpScope(request),
      replay,
    );
  }

  async scheduleTrigger(
    trigger: Omit<ScheduledTrigger, "id">,
  ): Promise<ScheduledTrigger> {
    return this.record(
      "schedule-trigger",
      trigger,
      () => this.session.scheduleTrigger(trigger),
    );
  }

  async injectMutations(
    proposals: readonly MutationProposal[],
    label = "validated scenario setup",
  ): Promise<WorldState> {
    const parsed = proposals.map((proposal) => mutationProposalSchema.parse(proposal));
    return this.record(
      "inject-mutations",
      { label, proposalCount: parsed.length, provenance: "harness-validated" },
      async () => {
        const persisted = await this.persisted();
        const candidate = clone(persisted.state);
        applyMutationProposals(candidate, parsed);
        validateWorldState(candidate);
        await this.persistence.worlds.commit({
          worldId: this.worldId,
          expectedRevision: persisted.revision,
          updatedAt: this.dependencies.wallClock.now(),
          state: candidate,
          events: [],
          eventSequence: persisted.eventSequence,
        });
        this.session = await this.runtime.openWorld(this.worldId);
        return this.world();
      },
      { kind: "inject-mutations", proposals: parsed, label },
    );
  }

  async injectEvent(input: HarnessEventInput): Promise<CanonicalEvent> {
    const event = harnessEventInputSchema.parse(input);
    return this.record(
      "inject-event",
      { type: event.type, provenance: "harness-injection" },
      async () => {
        const persisted = await this.persisted();
        const definition = this.dependencies.game.eventTypeRegistry.resolve(
          event.type,
          event.schemaVersion,
        );
        const canonical = canonicalEventSchema.parse({
          id: this.dependencies.idGenerator.next("event"),
          type: event.type,
          schemaVersion: event.schemaVersion,
          sourceComponent: definition.sourceComponent,
          occurredAt: event.occurredAt ?? persisted.state.fictionalTime,
          sequence: persisted.eventSequence + 1,
          summary: event.summary,
          relatedEntityIds: event.relatedEntityIds ?? [],
          scopeIds: event.scopeIds ?? [],
          causedByEventIds: event.causedByEventIds ?? [],
          origin: { kind: "harness-injection", id: this.scenario.id },
          payload: this.dependencies.game.eventTypeRegistry.validatePayload(
            event.type,
            event.schemaVersion,
            event.payload,
          ),
          access: event.access ?? "gm-only",
        });
        await this.persistence.worlds.commit({
          worldId: this.worldId,
          expectedRevision: persisted.revision,
          updatedAt: this.dependencies.wallClock.now(),
          state: persisted.state,
          events: [canonical],
          eventSequence: canonical.sequence,
        });
        this.session = await this.runtime.openWorld(this.worldId);
        return canonical;
      },
      { kind: "inject-event", event },
    );
  }

  /** Deliberately bypasses world validation for corruption/recovery tests only. */
  async unsafePatchWorldForTest(
    patch: (draft: WorldState) => void,
    label: string,
  ): Promise<void> {
    await this.record(
      "UNSAFE-patch-world-for-test",
      { label, provenance: "harness-unsafe-corruption" },
      async () => {
        const persisted = await this.persisted();
        const candidate = clone(persisted.state);
        patch(candidate);
        await this.persistence.worlds.commit({
          worldId: this.worldId,
          expectedRevision: persisted.revision,
          updatedAt: this.dependencies.wallClock.now(),
          state: candidate,
          events: [],
          eventSequence: persisted.eventSequence,
        });
        try {
          this.session = await this.runtime.openWorld(this.worldId);
        } catch {
          // The corrupt persisted state intentionally remains inspectable.
        }
      },
    );
  }

  async executeOperation<TResult = unknown>(
    operationId: string,
    input: unknown,
  ): Promise<TResult> {
    const replayInput = jsonValueSchema.parse(input);
    return this.record(
      "execute-operation",
      { operationId, input: replayInput },
      () => this.session.executeOperation<TResult>(operationId, input),
      { kind: "execute-operation", operationId, input: replayInput },
    );
  }

  async executeAction(
    request: PlayerActionRequest,
    modelRuntime = this.modelRuntime,
  ): Promise<PlayerActionResult> {
    if (!modelRuntime) {
      throw new Error("No scripted or real model runtime is configured");
    }
    return this.record(
      "execute-action",
      { actionId: request.actionId, actorId: request.actorId },
      () => this.session.performPlayerAction(request, { modelRuntime }),
      { kind: "execute-action", request },
    );
  }

  async executeConversation(
    request: ConversationTurnRequest,
    bindings: ConversationAuthorityBindings,
    workingState?: ConversationWorkingState,
    modelRuntime = this.modelRuntime,
  ): Promise<ConversationTurnResult> {
    if (!modelRuntime) {
      throw new Error("No scripted or real model runtime is configured");
    }
    return this.record(
      "execute-conversation",
      { turnId: request.turnId, interactionId: request.interactionId },
      () => performConversationTurn({
        session: this.session,
        modelRuntime,
        request,
        bindings,
        ...(workingState ? { workingState } : {}),
      }),
      {
        kind: "execute-conversation",
        request,
        bindings,
        ...(workingState ? { workingState } : {}),
      },
    );
  }

  inspectContext(
    request: ContextAssemblyRequest,
    options: { readonly toolPolicy?: ToolAvailabilityPolicy } = {},
  ): ContextInspection {
    const context = this.session.assembleContext(request, options);
    this.lastDiagnostics = diagnostic({
      kind: "context-inspection",
      request,
      inclusion: context.diagnostics,
      localReferences: context.diagnostics.localReferences,
    });
    return { request: clone(request), package: context };
  }

  inspectTools(policy?: ToolAvailabilityPolicy): ToolInspection {
    const catalog = this.dependencies.game.toolCatalog;
    const domains = catalog.listDomains(policy).map((domain) => ({
      id: domain.id,
      description: domain.description,
      subsystems: catalog.listSubsystems(domain.id, policy).map((subsystem) => ({
        id: subsystem.id,
        description: subsystem.description,
        tools: catalog.listTools(domain.id, subsystem.id, policy).map((tool) => ({
          id: tool.id,
          description: tool.description,
          contract: diagnostic(catalog.inspectTool(tool.id, policy)),
        })),
      })),
    }));
    const inspection = { domains };
    this.lastDiagnostics = diagnostic({ kind: "tool-inspection", ...inspection });
    return inspection;
  }

  async inspectQuery(
    toolId: string,
    input: unknown,
    authorization: ContextQueryAuthorization,
    localReferences: Readonly<Record<string, string>> = {},
  ): Promise<JsonValue> {
    const binding = this.dependencies.game.toolCatalog.resolveBinding(toolId);
    const result = await executeEngineQueryTool(
      binding,
      this.world(),
      input,
      {
        worldId: this.worldId,
        history: this.persistence.history,
        authorization,
        localReferences,
      },
    );
    this.lastDiagnostics = diagnostic({
      kind: "query-inspection",
      toolId,
      authorization,
      input,
      result,
    });
    return result;
  }

  async eventHistory(): Promise<readonly CanonicalEvent[]> {
    return completeHistory(this.persistence, this.worldId);
  }

  simulationInspection(): JsonValue {
    const registry = this.dependencies.game.worldSimulationRegistry;
    const scopes = registry.listScopes();
    const processes = [...new Map(scopes.flatMap((scope) =>
      registry.listProcesses(scope.kind).map((process) => [
        process.metadata.id,
        process,
      ] as const)
    )).values()];
    return diagnostic({
      scopes,
      processes,
      cursors: this.world().simulationCursors,
      scheduledTriggers: this.world().scheduledTriggers,
    });
  }

  rngInspection(): JsonValue {
    const fullTraceRandomness = this.traceEntries.flatMap((entry) => {
      if (!entry.full || typeof entry.full !== "object" || Array.isArray(entry.full)) return [];
      return JSON.stringify(entry.full).includes("randomness") ? [entry.full] : [];
    });
    return diagnostic({
      state: this.world().randomness,
      traceEntriesWithRandomness: fullTraceRandomness,
    });
  }

  async fork(name: string): Promise<HarnessSession> {
    if (this.forks.has(name)) throw new Error(`Fork already exists: ${name}`);
    const source = await this.snapshot();
    const persistence = this.owner.persistence();
    const dependencies = createDependencies(
      this.scenario,
      persistence,
      safeNamespace(`${this.scenario.id}-${name}`),
      source.eventSequence + source.revision,
    );
    const runtime = createGameRuntime(dependencies);
    const timestamp = dependencies.wallClock.now();
    const worldId = dependencies.idGenerator.next("world");
    await persistence.worlds.create({
      metadata: {
        id: worldId,
        name: `Harness fork ${name}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        game: clone(source.game),
      },
      state: clone(source.state),
      initialEvents: clone(source.history),
    });
    for (let revision = 0; revision < source.revision; revision += 1) {
      const current = await persistence.worlds.load(worldId);
      if (!current) throw new Error(`Fork world not found: ${worldId}`);
      await persistence.worlds.commit({
        worldId,
        expectedRevision: current.revision,
        updatedAt: timestamp,
        state: current.state,
        events: [],
        eventSequence: current.eventSequence,
      });
    }
    const session = await runtime.openWorld(worldId);
    const modelRuntime = this.scenario.modelRuntimeFactory?.() ??
      this.scenario.modelRuntime ?? this.owner.realModelRuntime;
    const fork = new HarnessSession(
      this.owner,
      this.scenario,
      persistence,
      dependencies,
      runtime,
      session,
      modelRuntime,
      safeNamespace(`${this.scenario.id}-${name}`),
    );
    fork.traceLevel = this.traceLevel;
    fork.initialSnapshot = await fork.snapshot();
    this.forks.set(name, fork);
    return fork;
  }

  listForks(): readonly string[] {
    return [...this.forks.keys()].sort();
  }

  getFork(name: string): HarnessSession {
    const fork = this.forks.get(name);
    if (!fork) throw new Error(`Fork not found: ${name}`);
    return fork;
  }

  discardFork(name: string): boolean {
    return this.forks.delete(name);
  }

  async runChallengeProbes(
    probes: readonly ChallengeProbe[],
  ): Promise<readonly ChallengeProbeResult[]> {
    const base = await this.snapshot();
    const results: ChallengeProbeResult[] = [];
    for (const probe of probes) {
      const fork = await this.fork(`probe-${probe.id}`);
      try {
        const result = await probe.run(fork);
        const snapshot = await fork.snapshot();
        results.push({
          id: probe.id,
          result: diagnostic(result),
          snapshot,
          diff: diffSnapshots(base, snapshot),
        });
      } catch (error) {
        const snapshot = await fork.snapshot();
        results.push({
          id: probe.id,
          error: errorMessage(error),
          snapshot,
          diff: diffSnapshots(base, snapshot),
        });
      }
    }
    return results;
  }

  async exportReproduction(failure?: string): Promise<ReproductionBundle> {
    const finalSnapshot = await this.snapshot();
    return reproductionBundleSchema.parse({
      schemaVersion: 1,
      scenarioId: this.scenario.id,
      idNamespace: this.idNamespace,
      game: clone(this.initialSnapshot.game),
      seed: this.scenario.seed,
      startingSnapshot: {
        revision: this.initialSnapshot.revision,
        eventSequence: this.initialSnapshot.eventSequence,
        fictionalTime: this.initialSnapshot.state.fictionalTime,
        randomness: this.initialSnapshot.state.randomness,
        state: this.initialSnapshot.state,
        history: this.initialSnapshot.history,
      },
      commands: clone(this.commands),
      finalSnapshot: {
        revision: finalSnapshot.revision,
        eventSequence: finalSnapshot.eventSequence,
        fictionalTime: finalSnapshot.state.fictionalTime,
        randomness: finalSnapshot.state.randomness,
        state: finalSnapshot.state,
        history: finalSnapshot.history,
      },
      traceLevel: this.traceLevel,
      ...(this.modelRuntime instanceof ScriptedModelRuntime
        ? { scriptedModelInvocations: this.modelRuntime.invocations }
        : {}),
      ...(failure ? { failure } : {}),
    });
  }

  async replayReproduction(
    input: ReproductionBundle,
  ): Promise<HarnessSnapshot> {
    const bundle = reproductionBundleSchema.parse(input);
    if (bundle.scenarioId !== this.scenario.id) {
      throw new Error(
        `Bundle scenario ${bundle.scenarioId} does not match ${this.scenario.id}`,
      );
    }
    const persistence = this.owner.persistence();
    const dependencies = createDependencies(
      this.scenario,
      persistence,
      bundle.idNamespace,
      bundle.startingSnapshot.eventSequence + bundle.startingSnapshot.revision,
    );
    const runtime = createGameRuntime(dependencies);
    const timestamp = dependencies.wallClock.now();
    const worldId = dependencies.idGenerator.next("world");
    await persistence.worlds.create({
      metadata: {
        id: worldId,
        name: `Harness replay: ${bundle.scenarioId}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        game: clone(bundle.game),
      },
      state: clone(bundle.startingSnapshot.state),
      initialEvents: clone(bundle.startingSnapshot.history),
    });
    for (
      let revision = 0;
      revision < bundle.startingSnapshot.revision;
      revision += 1
    ) {
      const current = await persistence.worlds.load(worldId);
      if (!current) throw new Error(`Replay world not found: ${worldId}`);
      await persistence.worlds.commit({
        worldId,
        expectedRevision: current.revision,
        updatedAt: timestamp,
        state: current.state,
        events: [],
        eventSequence: current.eventSequence,
      });
    }
    this.persistence = persistence;
    this.dependencies = dependencies;
    this.runtime = runtime;
    this.session = await runtime.openWorld(worldId);
    this.modelRuntime = this.scenario.modelRuntimeFactory?.() ??
      this.scenario.modelRuntime ?? this.owner.realModelRuntime;
    this.traceEntries = [];
    this.commands = [];
    this.lastDiagnostics = undefined;
    this.initialSnapshot = await this.snapshot();
    this.setTraceLevel(bundle.traceLevel);
    for (const command of bundle.commands) {
      switch (command.kind) {
        case "advance-time":
          await this.advanceTime(command.durationMs);
          break;
        case "catch-up":
          await this.catchUp({
            scopeId: command.scopeId,
            ...(command.maxWorkUnits === undefined
              ? {}
              : { maxWorkUnits: command.maxWorkUnits }),
          });
          break;
        case "inject-event":
          await this.injectEvent(command.event);
          break;
        case "inject-mutations":
          await this.injectMutations(command.proposals, command.label);
          break;
        case "execute-operation":
          await this.executeOperation(command.operationId, command.input);
          break;
        case "execute-action":
          await this.executeAction(command.request);
          break;
        case "execute-conversation":
          await this.executeConversation(
            command.request,
            command.bindings,
            command.workingState,
          );
          break;
      }
    }
    const result = await this.snapshot();
    if (
      result.state.fictionalTime !== bundle.finalSnapshot.fictionalTime ||
      JSON.stringify(result.state) !== JSON.stringify(bundle.finalSnapshot.state) ||
      JSON.stringify(result.history) !== JSON.stringify(bundle.finalSnapshot.history) ||
      result.eventSequence !== bundle.finalSnapshot.eventSequence
    ) {
      throw new Error("Reproduction replay diverged from the recorded authoritative result");
    }
    return result;
  }
}

export function createHarness(options: CreateHarnessOptions): Harness {
  return new Harness(options);
}
