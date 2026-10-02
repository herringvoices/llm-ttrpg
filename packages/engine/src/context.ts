import { maximumResolutionHorizon } from "./action-pressure.js";
import {
  contextAssemblyRequestSchema,
  contextItemSchema,
  contextPackageSchema,
  contextQueryAuthorizationSchema,
  sceneSourceElementSchema,
  type ContextAssemblyRequest,
  type ContextDiagnostic,
  type ContextItem,
  type ContextPackage,
  type ContextQueryAuthorization,
  type KnowledgePerspective,
  type ModelRole,
  type SceneElement,
  type SceneSourceElement,
} from "./context-contracts.js";
import type { LoadedGameDefinition } from "./contracts.js";
import { immutableOperationWorldView, type DeepReadonly, type OperationWorldView } from "./operations.js";
import type {
  EngineQueryExecutionOptions,
  ToolAvailabilityPolicy,
  ToolDescriptor,
} from "./tool-catalog.js";
import type { WorldState } from "./world.js";

export interface SceneSourceProvider {
  derive(
    world: DeepReadonly<OperationWorldView>,
    request: ContextAssemblyRequest,
  ): readonly SceneSourceElement[];
}

export interface AssembleContextInput {
  readonly game: LoadedGameDefinition;
  readonly world: WorldState;
  readonly worldRevision: number;
  readonly eventSequence?: number;
  readonly request: ContextAssemblyRequest;
  readonly sceneSource?: SceneSourceProvider;
  readonly retrieved?: readonly ContextItem[];
  readonly toolPolicy?: ToolAvailabilityPolicy;
}

export interface ContextCapabilityRule {
  readonly toolId: string;
  readonly roles?: readonly ModelRole[];
  readonly perspectiveKinds?: readonly KnowledgePerspective["kind"][];
  readonly when?: (
    descriptor: ToolDescriptor,
    authorization: ContextQueryAuthorization,
  ) => boolean;
}

export interface ContextToolPolicyInput {
  readonly authorization: ContextQueryAuthorization;
  readonly rules?: readonly ContextCapabilityRule[];
  readonly basePolicy?: ToolAvailabilityPolicy;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function estimateContextUnits(value: unknown): number {
  return JSON.stringify(value).length;
}

function holderMatches(
  perspective: KnowledgePerspective,
  holder: { readonly kind: "actor" | "group"; readonly id: string },
): boolean {
  return perspective.kind !== "canonical" &&
    perspective.kind === holder.kind && perspective.id === holder.id;
}

function awarenessPerspective(
  request: ContextAssemblyRequest,
): KnowledgePerspective {
  if (request.perspective.kind !== "canonical") return request.perspective;
  return request.focalActorId
    ? { kind: "actor", id: request.focalActorId }
    : request.perspective;
}

function hasKnowledge(
  source: SceneSourceElement,
  perspective: KnowledgePerspective,
): boolean {
  if (perspective.kind === "canonical") return true;
  return source.knownBy.some((holder) => holderMatches(perspective, holder));
}

function projectedIdentity(
  source: SceneSourceElement,
  request: ContextAssemblyRequest,
): { readonly display: string; readonly recognized: boolean } {
  const actorPerspective = awarenessPerspective(request);
  if (request.role === "debug" || request.role === "planner") {
    return { display: source.displayIdentity, recognized: true };
  }
  if (request.role === "orchestrator") {
    return {
      display: source.displayIdentity,
      recognized: hasKnowledge(source, actorPerspective),
    };
  }
  const identity = source.identities.find((candidate) =>
    holderMatches(actorPerspective, candidate.holder)
  );
  if (identity) {
    return {
      display: identity.displayIdentity,
      recognized: identity.recognized,
    };
  }
  if (hasKnowledge(source, actorPerspective)) {
    return { display: source.displayIdentity, recognized: true };
  }
  return {
    display: source.unrecognizedIdentity ?? source.displayIdentity,
    recognized: source.unrecognizedIdentity === undefined,
  };
}

function sourceIsAvailable(
  source: SceneSourceElement,
  request: ContextAssemblyRequest,
): boolean {
  const perspective = awarenessPerspective(request);
  if (request.role === "debug" || request.role === "planner") return true;
  if (request.role === "orchestrator") {
    return source.observable || source.orchestratorVisible || hasKnowledge(source, perspective);
  }
  return source.observable || hasKnowledge(source, perspective);
}

function localRef(index: number): string {
  return `scene.${String(index + 1).padStart(3, "0")}`;
}

function relevanceScore(
  source: SceneSourceElement,
  request: ContextAssemblyRequest,
): number {
  const working = request.workingContext;
  let score = source.prominence === "prominent" ? 50 : 10;
  if (source.canonicalEntityId === request.focalActorId) score += 100;
  if (request.executableIntent?.targetIds.includes(source.canonicalEntityId)) score += 90;
  if (working?.inspectedEntityId === source.canonicalEntityId) score += 85;
  if (working?.currentConversationEntityId === source.canonicalEntityId) score += 80;
  if (working?.activeEntityIds.includes(source.canonicalEntityId)) score += 75;
  if (source.activeInteraction) score += 70;
  if (source.activeParticipant) score += 60;
  if (working?.recentEntityIds.includes(source.canonicalEntityId)) score += 30;
  if (source.category === "condition") score += 20;
  return score;
}

function requiredSource(
  source: SceneSourceElement,
  request: ContextAssemblyRequest,
): boolean {
  const working = request.workingContext;
  return source.canonicalEntityId === request.focalActorId ||
    Boolean(request.executableIntent?.targetIds.includes(source.canonicalEntityId)) ||
    working?.inspectedEntityId === source.canonicalEntityId ||
    working?.currentConversationEntityId === source.canonicalEntityId ||
    Boolean(working?.activeEntityIds.includes(source.canonicalEntityId)) ||
    source.activeInteraction;
}

function validateRolePerspective(request: ContextAssemblyRequest): void {
  if (request.role === "actor" && request.perspective.kind === "canonical") {
    throw new Error("Actor context requires an actor or group knowledge perspective");
  }
}

function deriveLocationId(
  world: WorldState,
  request: ContextAssemblyRequest,
): string | undefined {
  if (request.locationId) return request.locationId;
  if (!request.focalActorId) return undefined;
  const actor = world.entities.find((entity) => entity.id === request.focalActorId);
  const fromData = actor?.data.currentLocation;
  if (typeof fromData === "string") return fromData;
  const fact = world.facts.find(
    (candidate) =>
      candidate.subjectId === request.focalActorId &&
      candidate.predicate === "actor.current-location" &&
      typeof candidate.value === "string",
  );
  return typeof fact?.value === "string" ? fact.value : undefined;
}

function actionPressureProjection(world: WorldState) {
  if (world.actionPressure.status === "unassessed") {
    return { status: "unassessed" } as const;
  }
  return {
    status: "assessed",
    level: world.actionPressure.level,
    maximumResolutionHorizonMs: maximumResolutionHorizon(
      world.actionPressure.level,
    ),
  } as const;
}

function compactSceneElement(element: SceneElement): SceneElement {
  const { summary: _summary, coarseState: _coarseState, ...existence } = element;
  return existence;
}

export function createContextualToolAvailabilityPolicy(
  input: ContextToolPolicyInput,
): ToolAvailabilityPolicy {
  const authorization = contextQueryAuthorizationSchema.parse(input.authorization);
  const byTool = new Map((input.rules ?? []).map((rule) => [rule.toolId, rule]));
  return (descriptor) => {
    if (input.basePolicy && !input.basePolicy(descriptor)) return false;
    const rule = byTool.get(descriptor.id);
    if (!rule) return true;
    if (rule.roles && !rule.roles.includes(authorization.role)) return false;
    if (
      rule.perspectiveKinds &&
      !rule.perspectiveKinds.includes(authorization.perspective.kind)
    ) return false;
    return rule.when ? rule.when(descriptor, authorization) : true;
  };
}

export function assembleContext(input: AssembleContextInput): ContextPackage {
  const request = contextAssemblyRequestSchema.parse(input.request);
  validateRolePerspective(request);
  const locationId = deriveLocationId(input.world, request);
  const sourceItems = (input.sceneSource?.derive(
    immutableOperationWorldView(input.world),
    request,
  ) ?? []).map((source) => sceneSourceElementSchema.parse(source));
  const relevantSources = sourceItems
    .filter((source) =>
      (locationId === undefined || source.locationId === locationId || source.activeInteraction) &&
      sourceIsAvailable(source, request)
    )
    .sort((left, right) =>
      relevanceScore(right, request) - relevanceScore(left, request) ||
      left.canonicalEntityId.localeCompare(right.canonicalEntityId)
    );

  const localReferences: Record<string, string> = {};
  const decisions: ContextDiagnostic[] = [];
  const projected = relevantSources.map((source, index) => {
    const ref = localRef(index);
    localReferences[ref] = source.canonicalEntityId;
    const actorPerspective = awarenessPerspective(request);
    const identity = projectedIdentity(source, request);
    const actorAware = source.observable &&
      (identity.recognized || source.unrecognizedIdentity !== undefined) ||
      hasKnowledge(source, actorPerspective);
    const privileged = request.role !== "actor" && !actorAware;
    const element: SceneElement = {
      localRef: ref,
      displayIdentity: identity.display,
      category: source.category,
      prominence: !source.observable && privileged ? "latent" : source.prominence,
      ...(source.summary ? { summary: source.summary } : {}),
      ...(source.coarseState !== undefined
        ? { coarseState: clone(source.coarseState) }
        : {}),
      activeParticipant: source.activeParticipant,
      activeInteraction: source.activeInteraction,
      access: {
        audience: [request.role],
        perspective: clone(request.perspective),
        actorAware,
        identityRecognized: identity.recognized,
        privileged,
        ...(source.discovery
          ? { discoveryStatus: source.discovery.status }
          : {}),
      },
    };
    return { source, element, required: requiredSource(source, request) };
  });

  const refForAll = (entityId: string | undefined): string | undefined =>
    entityId
      ? Object.entries(localReferences).find(([, canonical]) => canonical === entityId)?.[0]
      : undefined;
  const projectedIntent = request.executableIntent
    ? {
        goal: request.executableIntent.goal,
        requestedHorizonMs: request.executableIntent.requestedHorizonMs,
        pressureLevel: request.executableIntent.pressureLevel,
        authorizedHorizonMs: request.executableIntent.authorizedHorizonMs,
        wasNarrowed: request.executableIntent.wasNarrowed,
        ...(refForAll(request.executableIntent.actorId)
          ? { actorRef: refForAll(request.executableIntent.actorId) }
          : {}),
        targetRefs: request.executableIntent.targetIds
          .map(refForAll)
          .filter((value): value is string => Boolean(value)),
      }
    : undefined;
  const bootstrap = {
    authority: [
      "Simulation state and recorded history own canonical truth and consequences.",
      "Never invent or directly mutate authoritative state; use validated capabilities.",
    ],
    composition: clone(input.world.game),
    role: request.role,
    perspective: clone(request.perspective),
    discoveryProtocol: [
      "Retrieve missing knowledge and inspect capabilities progressively.",
      "Omitted information is unknown or unprovided, not false or nonexistent.",
    ],
  };
  const baseSituation = {
    role: request.role,
    perspective: clone(request.perspective),
    fictionalTime: input.world.fictionalTime,
    actionPressure: actionPressureProjection(input.world),
    ...(request.declaration ? { declaration: request.declaration } : {}),
    ...(projectedIntent
      ? { executableIntent: projectedIntent }
      : {}),
    scene: [] as SceneElement[],
  };
  const domains = input.game.toolCatalog.listDomains(input.toolPolicy);
  const discovery = {
    domains,
    omittedInformationIsUnknown: true as const,
  };
  const requiredUnits = estimateContextUnits({
    bootstrap,
    situation: baseSituation,
    discovery,
  });
  let usedUnits = requiredUnits;
  const scene: SceneElement[] = [];

  for (const item of projected) {
    const fullUnits = estimateContextUnits(item.element);
    const compact = compactSceneElement(item.element);
    const compactUnits = estimateContextUnits(compact);
    const fitsFull = usedUnits + fullUnits <= request.budget.maxUnits;
    const fitsCompact = usedUnits + compactUnits <= request.budget.maxUnits;
    if (item.required || fitsFull) {
      scene.push(item.element);
      usedUnits += fullUnits;
      decisions.push({
        localId: item.element.localRef,
        decision: "included",
        reason: item.required ? "required current-situation anchor" : "selected by deterministic salience",
        estimatedUnits: fullUnits,
        provenance: {
          sourceKind: item.source.sourceKind,
          sourceIds: [...item.source.sourceIds],
          worldRevision: input.worldRevision,
        },
        canonicalEntityId: item.source.canonicalEntityId,
      });
    } else if (fitsCompact) {
      scene.push(compact);
      usedUnits += compactUnits;
      decisions.push({
        localId: item.element.localRef,
        decision: "compressed",
        reason: "detail reduced before preserving existence under budget",
        estimatedUnits: compactUnits,
        provenance: {
          sourceKind: item.source.sourceKind,
          sourceIds: [...item.source.sourceIds],
          worldRevision: input.worldRevision,
        },
        canonicalEntityId: item.source.canonicalEntityId,
      });
    } else {
      decisions.push({
        localId: item.element.localRef,
        decision: "omitted",
        reason: "lower-priority scene element exceeded deterministic budget",
        estimatedUnits: compactUnits,
        provenance: {
          sourceKind: item.source.sourceKind,
          sourceIds: [...item.source.sourceIds],
          worldRevision: input.worldRevision,
        },
        canonicalEntityId: item.source.canonicalEntityId,
      });
    }
  }

  const includedRefs = new Set(scene.map((element) => element.localRef));
  const refFor = (entityId: string | undefined): string | undefined => {
    const ref = refForAll(entityId);
    return ref && includedRefs.has(ref) ? ref : undefined;
  };
  const working = request.workingContext
    ? {
        ...(request.workingContext.interactionId
          ? { interactionId: request.workingContext.interactionId }
          : {}),
        activeRefs: request.workingContext.activeEntityIds
          .map(refFor)
          .filter((value): value is string => Boolean(value)),
        recentRefs: request.workingContext.recentEntityIds
          .map(refFor)
          .filter((value): value is string => Boolean(value)),
        aliases: Object.fromEntries(
          request.workingContext.aliases.flatMap((alias) => {
            const ref = refFor(alias.entityId);
            return ref ? [[alias.alias, ref]] : [];
          }),
        ),
      }
    : undefined;

  const retrieved = (input.retrieved ?? [])
    .map((item) => contextItemSchema.parse(item))
    .sort((left, right) =>
      Number(right.salience === "required") - Number(left.salience === "required") ||
      right.relevance - left.relevance || left.localId.localeCompare(right.localId)
    )
    .filter((item) => {
      const units = estimateContextUnits(item);
      const samePerspective = item.access.perspective.kind === "canonical" ||
        JSON.stringify(item.access.perspective) === JSON.stringify(request.perspective);
      const stale = item.provenance.worldRevision !== undefined &&
        item.provenance.worldRevision !== input.worldRevision;
      const accessible = item.access.audience.includes(request.role) &&
        samePerspective &&
        !(item.provenance.sourceKind === "plan" && request.role === "actor");
      if (stale) {
        decisions.push({
          localId: item.localId,
          decision: "omitted",
          reason: "retrieved source revision is stale and must be refreshed",
          estimatedUnits: units,
          provenance: item.provenance,
        });
        return false;
      }
      if (!accessible) {
        decisions.push({
          localId: item.localId,
          decision: "omitted",
          reason: "role or knowledge perspective is not authorized for retrieved item",
          estimatedUnits: units,
          provenance: item.provenance,
        });
        return false;
      }
      if (item.salience === "required" || usedUnits + units <= request.budget.maxUnits) {
        usedUnits += units;
        decisions.push({
          localId: item.localId,
          decision: "included",
          reason: item.salience === "required" ? "required retrieved context" : "retrieved relevance fit budget",
          estimatedUnits: units,
          provenance: item.provenance,
        });
        return true;
      }
      decisions.push({
        localId: item.localId,
        decision: "omitted",
        reason: "retrieved item exceeded deterministic budget",
        estimatedUnits: units,
        provenance: item.provenance,
      });
      return false;
    });

  const packageValue = {
    bootstrap,
    situation: {
      ...baseSituation,
      ...(refFor(request.focalActorId) ? { focalActorRef: refFor(request.focalActorId) } : {}),
      ...(refFor(locationId) ? { locationRef: refFor(locationId) } : {}),
      scene,
      ...(working ? { working } : {}),
    },
    retrieved,
    discovery,
    diagnostics: {
      worldRevision: input.worldRevision,
      ...(input.eventSequence !== undefined
        ? { eventSequence: input.eventSequence }
        : {}),
      budget: clone(request.budget),
      usedUnits,
      requiredUnits,
      overBudget: usedUnits > request.budget.maxUnits,
      decisions,
      localReferences,
    },
  };
  return contextPackageSchema.parse(packageValue);
}

export function renderContextForModel(context: ContextPackage): string {
  const validated = contextPackageSchema.parse(context);
  return JSON.stringify({
    bootstrap: validated.bootstrap,
    situation: validated.situation,
    retrieved: validated.retrieved.map((item) => ({
      localId: item.localId,
      kind: item.kind,
      salience: item.salience,
      content: item.content,
      derivation: item.derivation,
      provenance: { sourceKind: item.provenance.sourceKind },
      access: {
        actorAware: item.access.actorAware,
        identityRecognized: item.access.identityRecognized,
        privileged: item.access.privileged,
        ...(item.access.discoveryStatus
          ? { discoveryStatus: item.access.discoveryStatus }
          : {}),
      },
    })),
    discovery: validated.discovery,
  });
}

export function queryAuthorizationFromContext(
  context: ContextPackage,
): ContextQueryAuthorization {
  return contextQueryAuthorizationSchema.parse({
    role: context.bootstrap.role,
    perspective: context.bootstrap.perspective,
    ...(context.bootstrap.perspective.kind === "actor"
      ? { focalActorId: context.bootstrap.perspective.id }
      : {}),
  });
}

export function createContextQueryExecutionOptions(input: {
  readonly context: ContextPackage;
  readonly request: ContextAssemblyRequest;
  readonly world: WorldState;
  readonly sceneSource: SceneSourceProvider;
}): EngineQueryExecutionOptions {
  const context = contextPackageSchema.parse(input.context);
  const request = contextAssemblyRequestSchema.parse(input.request);
  const sources = input.sceneSource.derive(
    immutableOperationWorldView(input.world),
    request,
  ).map((source) => sceneSourceElementSchema.parse(source));
  const byCanonical = new Map(
    sources.map((source) => [source.canonicalEntityId, source]),
  );
  const localDisplays: Record<string, string> = {};
  const localDetails: Record<string, import("./json.js").JsonValue> = {};
  for (const element of context.situation.scene) {
    const canonicalId = context.diagnostics.localReferences[element.localRef];
    const source = canonicalId ? byCanonical.get(canonicalId) : undefined;
    if (!source) continue;
    localDisplays[element.localRef] = element.displayIdentity;
    const detail = request.role === "actor"
      ? source.detail
      : source.privilegedDetail ?? source.detail;
    if (detail !== undefined) localDetails[element.localRef] = clone(detail);
  }
  return {
    authorization: queryAuthorizationFromContext(context),
    localReferences: clone(context.diagnostics.localReferences),
    localDisplays,
    localDetails,
  };
}
