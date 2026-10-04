import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  endConversationWorkingState,
  fictionalInstant,
  loadGameDefinition,
  performConversationTurn,
  selectNarrationTarget,
  type GameDefinition,
  type ModelInvocationOptions,
  type ModelRuntime,
  type ModelRuntimeCapabilities,
  type StructuredModelRequest,
  type StructuredModelResult,
  type TextModelRequest,
  type TextModelResult,
} from "@llm-ttrpg/engine";
import {
  generateStartingRegion,
  referenceConversationBindings,
  referenceGameDefinition,
  referenceSceneSource,
} from "@llm-ttrpg/reference-game";
import { createMigratedSqlitePersistence } from "../../../tests/support/sqlite.js";
import {
  DeterministicStartingRegionModel,
  generatedStart,
  startingRegionRequestFixture,
} from "./starting-region-fixture.js";

const playerId = "generated.actor.player";
const garyId = "generated.actor.alice";
const maraId = "generated.actor.bob";
const locationId = "generated.location.grocery";
const chickenId = "generated.entity.missing-chicken";
const hiddenFactId = "generated.fact.chicken-boiler-room";
const playerBeliefId = "generated.belief.player-chicken-boiler-room";
const secret = "Mara moved the missing chicken into the boiler room.";

type AnyModelRequest = TextModelRequest | StructuredModelRequest<unknown>;
type ModelHandler = (request: AnyModelRequest) => unknown;

class ConversationModelRuntime implements ModelRuntime {
  readonly capabilities: ModelRuntimeCapabilities = {
    structuredOutput: true,
    streamingText: false,
  };
  readonly requests: AnyModelRequest[] = [];

  constructor(private readonly handler: ModelHandler) {}

  generate(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult>;
  generate<T>(
    request: StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<StructuredModelResult<T>>;
  async generate<T>(
    request: TextModelRequest | StructuredModelRequest<T>,
    _options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    this.requests.push(request as AnyModelRequest);
    const answer = this.handler(request as AnyModelRequest);
    const metadata = { runtimeId: "conversation-script", elapsedMs: 0 };
    if (request.output.kind === "text") {
      return {
        ok: true,
        output: { kind: "text", text: String(answer) },
        metadata,
      };
    }
    return {
      ok: true,
      output: {
        kind: "structured",
        value: request.output.schema.parse(answer),
      },
      metadata,
    };
  }
}

function quotesIn(declaration: string): string[] {
  return [...declaration.matchAll(/"([^"\r\n]+)"/g)].map((match) => match[1]!);
}

function interpretation(
  request: AnyModelRequest,
  overrides: Record<string, unknown> = {},
) {
  const input = JSON.parse(request.prompt.input) as { declaration: string };
  const quotes = quotesIn(input.declaration);
  return {
    inputMode: quotes.length > 0 ? "quoted" : "described",
    exactQuoteFragments: quotes,
    semanticKinds: ["question"],
    authorizedContent: "ask whether Gary has heard anything about the missing chicken",
    testimonyIds: [],
    materialCommitments: [],
    deliveryIntent: "honest",
    containsNonSpeechAction: false,
    estimatedDurationMs: 1_000,
    pressureLevel: 3,
    ...overrides,
  };
}

function npcDecision(
  request: AnyModelRequest,
  overrides: Record<string, unknown> = {},
) {
  const input = JSON.parse(request.prompt.input) as { actorRef: string };
  return {
    actorId: input.actorRef,
    interpretation: "The player has asked a direct but ordinary question.",
    responseKind: "speak",
    intendedSpeechSemantics: "Gary says he has not heard anything useful.",
    speechSemanticKinds: ["assertion"],
    estimatedSpeechDurationMs: 500,
    disclosure: { mode: "none" },
    sceneState: {
      actorId: input.actorRef,
      interpretation: "A question about the missing chicken is being asked.",
      attention: ["the player", "the missing chicken"],
      immediatePriorities: ["answer honestly"],
      stance: "attentive",
      wants: ["understand why the chicken matters"],
      reluctantToRevealIds: [],
      considering: ["whether to ask a follow-up question"],
      unresolvedQuestions: ["where the chicken was last seen"],
    },
    requiresAuthoritativeResolution: false,
    stopReason: "answer-expected",
    ...overrides,
  };
}

function simpleModel(
  interpretationOverrides: Record<string, unknown> = {},
  decisionOverrides: Record<string, unknown> = {},
  narration?: (request: AnyModelRequest) => string,
) {
  return new ConversationModelRuntime((request) => {
    if (request.output.kind === "text") {
      if (narration) return narration(request);
      const input = JSON.parse(request.prompt.input) as {
        playerCommunication: { exactQuoteFragments: string[] };
      };
      const quote = input.playerCommunication.exactQuoteFragments[0];
      return quote
        ? `Liam asks, "${quote}" Gary answers carefully.`
        : "Liam asks about the missing chicken. Gary answers carefully.";
    }
    if (request.output.schemaId === "conversation.player-communication.v1") {
      return interpretation(request, interpretationOverrides);
    }
    if (request.output.schemaId === "conversation.npc-decision.v1") {
      return npcDecision(request, decisionOverrides);
    }
    if (request.output.schemaId === "conversation.durable-extraction.v1") {
      return { proposals: [] };
    }
    throw new Error(`Unexpected schema ${request.output.schemaId}`);
  });
}

function turnRequest(
  turnId: string,
  declaration: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    turnId,
    interactionId: "interaction.missing-chicken",
    playerActorId: playerId,
    playerCharacterName: "Liam",
    recipientIds: [garyId],
    materialNpcIds: [],
    declaration,
    locationId,
    narrationPreference: "standard" as const,
    beatComplexity: "ordinary" as const,
    budget: { maxUnits: 50_000 },
    authorizedMaterialSemanticKinds: [],
    authorizedMaterialCommitments: [],
    authorizedTestimony: [],
    authorizedDeception: false,
    extractDurableConsequences: false,
    ...overrides,
  };
}

async function conversationDefinition(): Promise<GameDefinition> {
  const generated = await generateStartingRegion(
    startingRegionRequestFixture,
    new DeterministicStartingRegionModel(),
  );
  if (generated.kind !== "generated") throw new Error("Expected generated region");
  const playerMechanics = generated.campaign.content.entities.find((entity) =>
    entity.id === playerId
  )?.data.mechanics;
  if (!playerMechanics || typeof playerMechanics !== "object") {
    throw new Error("Missing player mechanics fixture");
  }
  const campaign = {
    ...generated.campaign,
    identity: { id: "conversation-fixture", version: "0.1.0" },
    content: {
      ...generated.campaign.content,
      entities: [
        ...generated.campaign.content.entities.map((entity) => {
          if (![playerId, garyId, maraId].includes(entity.id)) return entity;
          const isPlayer = entity.id === playerId;
          const displayName = isPlayer ? "Liam" : entity.id === garyId ? "Gary" : "Mara";
          return {
            ...entity,
            name: displayName,
            data: {
              ...entity.data,
              currentLocation: locationId,
              mechanics: isPlayer
                ? playerMechanics
                : { ...playerMechanics, isPlayerCharacter: false },
              context: {
                locationId,
                category: "participant",
                prominence: "prominent",
                observable: true,
                activeParticipant: true,
                orchestratorVisible: true,
                knownBy: [{ kind: "actor", id: entity.id }],
                identities: [],
              },
            },
          };
        }),
        {
          id: chickenId,
          kind: "animal",
          name: "missing chicken",
          summary: "A chicken whose current location is not publicly known.",
          data: {
            context: {
              locationId,
              category: "other",
              prominence: "ambient",
              observable: false,
              activeParticipant: false,
              orchestratorVisible: true,
              knownBy: [{ kind: "actor", id: playerId }],
              identities: [],
            },
          },
        },
      ],
      facts: [
        ...generated.campaign.content.facts,
        {
          id: hiddenFactId,
          subjectId: chickenId,
          predicate: "animal.current-location",
          value: "boiler room",
          visibility: "hidden" as const,
          tags: ["chicken", "location", "hidden"],
        },
      ],
      beliefs: [
        ...generated.campaign.content.beliefs,
        {
          id: playerBeliefId,
          holder: { kind: "actor" as const, id: playerId },
          subjectId: chickenId,
          proposition: secret,
          truthStatus: "true" as const,
          confidence: 1,
          sourceFactId: hiddenFactId,
          sources: [{ kind: "fact" as const, id: hiddenFactId }],
        },
      ],
    },
  };
  return { ...referenceGameDefinition, campaign };
}

async function createConversationSession(
  persistence = createInMemoryPersistence(),
) {
  const game = loadGameDefinition(await conversationDefinition());
  let nextId = 0;
  const runtime = createGameRuntime({
    persistence,
    game,
    wallClock: { now: () => "2041-05-01T15:00:00.000Z" },
    idGenerator: { next: (kind: string) => `${kind}.conversation-${++nextId}` },
    worldSeedSource: { nextSeed: () => 0x1414_1414 },
    context: { sceneSource: referenceSceneSource },
  });
  return {
    game,
    runtime,
    session: await runtime.createWorld("Conversation fixture"),
  };
}

describe("NPC interaction and conversation", () => {
  it("normalizes described, third-person, quoted, and mixed speech without adding player intent", async () => {
    const declarations = [
      "I ask about the missing chicken.",
      "Liam asks about the missing chicken.",
      'I ask, "Have you heard anything about the missing chicken?"',
    ];
    const acts = [];
    for (const [index, declaration] of declarations.entries()) {
      const { session } = await createConversationSession();
      const result = await performConversationTurn({
        session,
        modelRuntime: simpleModel(),
        bindings: referenceConversationBindings,
        request: turnRequest(`turn.form-${index + 1}`, declaration),
      });
      acts.push(result.act);
      expect(result.communicationCommitted).toBe(true);
      expect(result.act.semanticKinds).toEqual(["question"]);
      expect(result.act.materialCommitments).toEqual([]);
      expect(result.narration).toBeDefined();
      const recordedPlayerAct = (await session.eventHistory()).find((event) =>
        event.type === "rules.communication-recorded" &&
        event.relatedEntityIds[0] === playerId
      );
      expect(recordedPlayerAct?.payload).toEqual(expect.objectContaining({
        act: expect.objectContaining({
          exactQuoteFragments: result.act.exactQuoteFragments,
        }),
      }));
    }
    expect(acts[0]?.authorizedContent).toBe(acts[1]?.authorizedContent);
    expect(acts[2]?.exactQuoteFragments).toEqual([
      "Have you heard anything about the missing chicken?",
    ]);
    expect(acts[2]?.inputMode).toBe("quoted");

    const { session } = await createConversationSession();
    const mixed = await performConversationTurn({
      session,
      modelRuntime: simpleModel({ inputMode: "mixed" }),
      bindings: referenceConversationBindings,
      request: turnRequest(
        "turn.mixed",
        'I try to sound casual and say, "So... you seen the chicken?"',
      ),
    });
    expect(mixed.act.inputMode).toBe("mixed");
    expect(mixed.act.exactQuoteFragments).toEqual([
      "So... you seen the chicken?",
    ]);

    const unauthorized = await createConversationSession();
    const before = unauthorized.session.snapshot();
    await expect(performConversationTurn({
      session: unauthorized.session,
      modelRuntime: simpleModel({ semanticKinds: ["question", "threat"] }),
      bindings: referenceConversationBindings,
      request: turnRequest("turn.unauthorized", declarations[0]!),
    })).rejects.toThrow(/unauthorized consequential player intent/);
    expect(unauthorized.session.snapshot()).toEqual(before);
  });

  it("keeps NPC knowledge perspective-safe until validated testimony changes one recipient belief", async () => {
    const { session } = await createConversationSession();
    const model = new ConversationModelRuntime((request) => {
      if (request.output.kind === "text") return "The conversation stays within what each person knows.";
      if (request.output.schemaId === "conversation.player-communication.v1") {
        const input = JSON.parse(request.prompt.input) as { declaration: string };
        const telling = input.declaration.includes("tell Gary");
        return interpretation(request, telling
          ? {
              semanticKinds: ["disclosure"],
              authorizedContent: secret,
              testimonyIds: ["testimony.missing-chicken"],
            }
          : {});
      }
      if (request.output.schemaId === "conversation.npc-decision.v1") {
        const context = request.prompt.context ?? "";
        const knows = context.includes(secret);
        const input = JSON.parse(request.prompt.input) as { actorRef: string };
        const canonical = context.includes("Gary") ? garyId : maraId;
        const learnedBeliefId =
          "turn.tell.communication.belief-1.generated.actor.alice";
        return npcDecision(request, {
          interpretation: knows
            ? "The actor can use the testimony they personally received."
            : "The actor has no grounded knowledge of the hidden event.",
          intendedSpeechSemantics: knows
            ? "The actor acknowledges the boiler-room testimony."
            : "The actor says they do not know where the chicken is.",
          disclosure: knows
            ? { mode: "disclose", groundingIds: [learnedBeliefId] }
            : { mode: "none" },
          sceneState: {
            ...npcDecision(request).sceneState,
            actorId: input.actorRef,
            interpretation: knows ? "New testimony is salient." : "Location remains unknown.",
          },
          actorId: input.actorRef,
          stopReason: canonical === garyId ? "answer-expected" : "no-material-reaction",
        });
      }
      throw new Error(`Unexpected schema ${request.output.schemaId}`);
    });

    const initial = await performConversationTurn({
      session,
      modelRuntime: model,
      bindings: referenceConversationBindings,
      request: turnRequest("turn.ask-before", "I ask Gary where the chicken is."),
    });
    expect(initial.decisions[0]?.intendedSpeechSemantics).toContain("do not know");
    const firstDecisionRequest = model.requests.find((request) =>
      request.output.kind === "structured" &&
      request.output.schemaId === "conversation.npc-decision.v1"
    );
    expect(firstDecisionRequest?.prompt.context).not.toContain(secret);

    const testimony = {
      id: "testimony.missing-chicken",
      subjectId: chickenId,
      proposition: secret,
      source: { kind: "belief" as const, id: playerBeliefId },
    };
    const told = await performConversationTurn({
      session,
      modelRuntime: model,
      bindings: referenceConversationBindings,
      workingState: initial.workingState,
      request: turnRequest(
        "turn.tell",
        "I tell Gary that Mara moved the missing chicken into the boiler room.",
        {
          authorizedMaterialSemanticKinds: ["disclosure"],
          authorizedTestimony: [testimony],
        },
      ),
    });
    expect(told.decisions[0]?.intendedSpeechSemantics).toContain("acknowledges");
    const worldAfterTestimony = session.snapshot();
    expect(worldAfterTestimony.facts.find((fact) => fact.id === hiddenFactId)?.value)
      .toBe("boiler room");
    expect(worldAfterTestimony.beliefs.some((belief) =>
      belief.holder.id === garyId && belief.proposition === secret
    )).toBe(true);
    expect(worldAfterTestimony.beliefs.some((belief) =>
      belief.holder.id === maraId && belief.proposition === secret
    )).toBe(false);

    const requestCount = model.requests.length;
    const compared = await performConversationTurn({
      session,
      modelRuntime: model,
      bindings: referenceConversationBindings,
      workingState: told.workingState,
      request: turnRequest(
        "turn.compare",
        "I ask Gary and Mara what they know about the chicken.",
        { recipientIds: [garyId], materialNpcIds: [maraId] },
      ),
    });
    expect(compared.decisions.map((decision) => decision.intendedSpeechSemantics))
      .toEqual([
        expect.stringContaining("acknowledges"),
        expect.stringContaining("do not know"),
      ]);
    const laterDecisionRequests = model.requests.slice(requestCount).filter((request) =>
      request.output.kind === "structured" &&
      request.output.schemaId === "conversation.npc-decision.v1"
    );
    expect(laterDecisionRequests[0]?.prompt.context).toContain(secret);
    expect(laterDecisionRequests[1]?.prompt.context).not.toContain(secret);
  });

  it("runs automatic, impossible, and uncertain social effects through normal resolution without authoring PC choices", async () => {
    const cases = [
      { id: "automatic", feasibility: { status: "feasible" }, resistance: 0 },
      {
        id: "impossible",
        feasibility: { status: "impossible", reason: "The request cannot plausibly work now." },
        resistance: 54,
      },
      { id: "uncertain", feasibility: { status: "feasible" }, resistance: 54 },
    ] as const;
    for (const item of cases) {
      const { session } = await createConversationSession();
      const playerBefore = session.snapshot().entities.find((entity) =>
        entity.id === playerId
      )?.data.mechanics;
      const model = new ConversationModelRuntime((request) => {
        if (request.output.kind === "text") return "Gary makes a bounded social attempt and Liam retains control.";
        if (request.output.schemaId === "conversation.player-communication.v1") {
          return interpretation(request);
        }
        if (request.output.schemaId === "conversation.npc-decision.v1") {
          const context = JSON.parse(request.prompt.context ?? "{}") as {
            situation: { scene: Array<{ localRef: string; displayIdentity: string }> };
          };
          const playerRef = context.situation.scene.find((scene) =>
            scene.displayIdentity === "Liam"
          )?.localRef;
          if (!playerRef) throw new Error("Missing player local ref");
          const input = JSON.parse(request.prompt.input) as { actorRef: string };
          return npcDecision(request, {
            responseKind: "act",
            intendedSpeechSemantics: undefined,
            speechSemanticKinds: [],
            estimatedSpeechDurationMs: 0,
            proposedAction: {
              kind: "resolution-operation",
              toolId: "rules.actions.resolve-action",
              arguments: {
                declaredActionId: `action.social-${item.id}`,
                approach: "make one bounded social request",
                feasibility: item.feasibility,
                performance: {
                  attributeIds: ["presence"],
                  applicableSkillIds: [],
                  attributeModifiers: [],
                  performanceModifiers: [],
                  helpers: [],
                  maxUsefulHelpers: 0,
                  combinedAttributeContributions: [],
                },
                resistance: {
                  kind: "fixed",
                  value: item.resistance,
                  provenance: {
                    kind: "authored",
                    description: "Conversation fixture social resistance",
                  },
                },
                effect: { mode: "fixed", potentialEffect: 1 },
                timeToMaterialEffectMs: 250,
                scopeIds: [],
              },
              goal: "make a bounded request without controlling the player",
              targetRefs: [playerRef],
              requestedHorizonMs: 5_000,
              estimatedDurationMs: 250,
            },
            sceneState: {
              ...npcDecision(request).sceneState,
              actorId: input.actorRef,
            },
            requiresAuthoritativeResolution: true,
            stopReason: "meaningful-player-choice",
          });
        }
        throw new Error(`Unexpected schema ${request.output.schemaId}`);
      });
      const result = await performConversationTurn({
        session,
        modelRuntime: model,
        bindings: referenceConversationBindings,
        request: turnRequest(`turn.social-${item.id}`, "I ask Gary to hear me out."),
      });
      expect(result.committedActions[0]?.resolutionPath).toBe(item.id);
      expect(session.snapshot().entities.find((entity) =>
        entity.id === playerId
      )?.data.mechanics).toEqual(playerBefore);
      expect(result.stopReason).toBe("meaningful-player-choice");
    }
  });

  it("allows speech to coexist with a pre-authorized #11 player action without bypassing action-run receipts", async () => {
    const { session } = await createConversationSession();
    let executionTurns = 0;
    const model = new ConversationModelRuntime((request) => {
      if (request.output.kind === "text") {
        return request.trace?.operation === "player-action.narration.v1"
          ? "Liam completes the authorized phone call."
          : "Liam calls animal control while asking Gary about the missing chicken.";
      }
      if (request.output.schemaId === "conversation.player-communication.v1") {
        return interpretation(request, { containsNonSpeechAction: true });
      }
      if (request.output.schemaId === "player-action.intent-interpretation.v1") {
        return {
          kind: "interpreted",
          goal: "call animal control",
          targetRefs: [],
          requestedHorizonMs: 10_000,
          pressureLevel: 3,
        };
      }
      if (request.output.schemaId === "player-action.execution-decision.v1") {
        executionTurns += 1;
        return executionTurns === 1
          ? {
              kind: "invoke-tool",
              toolId: "rules.social.place-call",
              arguments: {
                service: "animal control",
                message: "A chicken is missing under unusual circumstances.",
                durationMs: 3_000,
                scopeIds: [],
                causedByEventIds: [],
              },
            }
          : { kind: "stop", reason: "goal-achieved" };
      }
      if (request.output.schemaId === "conversation.npc-decision.v1") {
        return npcDecision(request);
      }
      throw new Error(`Unexpected schema ${request.output.schemaId}`);
    });
    const result = await performConversationTurn({
      session,
      modelRuntime: model,
      bindings: referenceConversationBindings,
      request: turnRequest(
        "turn.mixed-action",
        "I call animal control and ask Gary about the missing chicken.",
        {
          authorizedPlayerAction: {
            actionId: "action.call-animal-control",
            actorId: playerId,
            declaration: "Call animal control about the missing chicken.",
            locationId,
            budget: { maxUnits: 50_000 },
          },
        },
      ),
    });
    expect(result.act.containsNonSpeechAction).toBe(true);
    expect(result.committedActions).toEqual([
      expect.objectContaining({
        actorId: playerId,
        toolId: "rules.social.place-call",
        kind: "ordinary-operation",
      }),
    ]);
    expect((await session.eventHistory()).map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "rules.call-placed",
        "rules.communication-recorded",
      ]),
    );
  });

  it("permits NPC deception only when its private intent is grounded in that NPC's perspective", async () => {
    const ungrounded = await createConversationSession();
    await expect(performConversationTurn({
      session: ungrounded.session,
      modelRuntime: simpleModel({}, {
        disclosure: {
          mode: "deceive",
          groundingIds: [hiddenFactId],
          claim: "The chicken ran toward the river.",
        },
      }),
      bindings: referenceConversationBindings,
      request: turnRequest("turn.bad-deception", "I ask Gary what he saw."),
    })).rejects.toThrow(/cannot ground disclosure in unknown record/);

    const grounded = await createConversationSession();
    const result = await performConversationTurn({
      session: grounded.session,
      modelRuntime: simpleModel({}, {
        disclosure: {
          mode: "deceive",
          groundingIds: ["memory.alice.blue-light"],
          claim: "The blue light was only a delivery truck.",
        },
      }),
      bindings: referenceConversationBindings,
      request: turnRequest("turn.grounded-deception", "I ask Gary what he saw."),
    });
    expect(result.decisions[0]?.disclosure.mode).toBe("deceive");
    const npcCommunication = (await grounded.session.eventHistory()).find((event) =>
      event.type === "rules.communication-recorded" &&
      event.relatedEntityIds[0] === garyId
    );
    expect(npcCommunication?.access).toBe("gm-only");
    expect(npcCommunication?.payload).toEqual(expect.objectContaining({
      act: expect.objectContaining({
        deliveryIntent: "deceive",
        groundingIds: ["memory.alice.blue-light"],
      }),
    }));
    expect(grounded.session.snapshot().facts.some((fact) =>
      fact.value === "The blue light was only a delivery truck."
    )).toBe(false);
  });

  it("reasons separately for material NPCs and executes an NPC call through ordinary persistence machinery", async () => {
    const { session } = await createConversationSession();
    const model = new ConversationModelRuntime((request) => {
      if (request.output.kind === "text") {
        return "Gary answers while Mara steps aside and calls emergency services. Liam must decide what to do next.";
      }
      if (request.output.schemaId === "conversation.player-communication.v1") {
        return interpretation(request);
      }
      if (request.output.schemaId === "conversation.npc-decision.v1") {
        const context = request.prompt.context ?? "";
        const input = JSON.parse(request.prompt.input) as { actorRef: string };
        if (context.includes("goal.bob.keep-clinic-open")) {
          return npcDecision(request, {
            actorId: input.actorRef,
            interpretation: "Mara treats the report as an emergency.",
            responseKind: "both",
            intendedSpeechSemantics: "Mara says she is calling emergency services.",
            speechSemanticKinds: ["assertion"],
            proposedAction: {
              kind: "ordinary-operation",
              toolId: "rules.social.place-call",
              arguments: {
                service: "emergency services",
                message: "A possible supernatural animal incident needs assessment.",
                durationMs: 5_000,
                scopeIds: [],
                causedByEventIds: [],
              },
              goal: "report the possible emergency",
              targetRefs: [],
              requestedHorizonMs: 10_000,
              estimatedDurationMs: 5_000,
            },
            sceneState: {
              ...npcDecision(request).sceneState,
              actorId: input.actorRef,
              stance: "urgent",
            },
            requiresAuthoritativeResolution: true,
            stopReason: "material-circumstance-change",
          });
        }
        return npcDecision(request, {
          actorId: input.actorRef,
          interpretation: "Gary wants a direct answer before doing anything else.",
          sceneState: {
            ...npcDecision(request).sceneState,
            actorId: input.actorRef,
            stance: "guarded",
          },
        });
      }
      throw new Error(`Unexpected schema ${request.output.schemaId}`);
    });
    const result = await performConversationTurn({
      session,
      modelRuntime: model,
      bindings: referenceConversationBindings,
      request: turnRequest(
        "turn.multi-npc",
        "I ask Gary and Mara whether we should call for help.",
        { recipientIds: [garyId], materialNpcIds: [maraId] },
      ),
    });
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions[0]?.sceneState.stance).toBe("guarded");
    expect(result.decisions[1]?.sceneState.stance).toBe("urgent");
    expect(result.committedActions).toEqual([
      expect.objectContaining({
        actorId: maraId,
        toolId: "rules.social.place-call",
        kind: "ordinary-operation",
      }),
    ]);
    expect((await session.eventHistory()).some((event) =>
      event.type === "rules.call-placed" && event.relatedEntityIds.includes(maraId)
    )).toBe(true);
    expect(JSON.stringify(session.snapshot())).not.toContain(
      "Mara treats the report as an emergency.",
    );
    const decisionRequests = model.requests.filter((request) =>
      request.output.kind === "structured" &&
      request.output.schemaId === "conversation.npc-decision.v1"
    );
    expect(decisionRequests[0]?.prompt.context).not.toContain("goal.bob.keep-clinic-open");
    expect(decisionRequests[1]?.prompt.context).not.toContain("goal.alice.finish-shift");
    expect(result.stopReason).toBe("answer-expected");
  });

  it("selectively persists durable consequences while ending scene-local cognition", async () => {
    const sqlite = await createMigratedSqlitePersistence();
    const { runtime, session } = await createConversationSession(sqlite.persistence);
    const model = new ConversationModelRuntime((request) => {
      if (request.output.kind === "text") return "Gary takes the warning seriously.";
      if (request.output.schemaId === "conversation.player-communication.v1") {
        return interpretation(request);
      }
      if (request.output.schemaId === "conversation.npc-decision.v1") {
        return npcDecision(request);
      }
      if (request.output.schemaId === "conversation.durable-extraction.v1") {
        const input = JSON.parse(request.prompt.input) as {
          availableEventIds: string[];
        };
        const sourceEventId = input.availableEventIds.at(-1)!;
        return {
          proposals: [{
            mutation: {
              kind: "upsert-actor-memory",
              actorId: garyId,
              memory: {
                id: "memory.gary.player-warning",
                summary: "Liam seriously asked for help with the missing chicken.",
                formedAt: generatedStart,
                salience: 0.8,
                relatedEntityIds: [playerId, chickenId],
                sourceEventIds: [sourceEventId],
                tags: ["conversation", "warning"],
              },
            },
            sourceEventIds: [sourceEventId],
            rationale: "The warning is salient enough to matter after the scene.",
          }],
          compactedSummary: "Liam asked Gary for serious help with the missing chicken.",
        };
      }
      throw new Error(`Unexpected schema ${request.output.schemaId}`);
    });
    const result = await performConversationTurn({
      session,
      modelRuntime: model,
      bindings: referenceConversationBindings,
      request: turnRequest(
        "turn.extract",
        "I seriously ask Gary to help find the missing chicken.",
        { extractDurableConsequences: true },
      ),
    });
    expect(result.extractionEventIds).toHaveLength(1);
    expect(result.workingState.npcStates).toHaveLength(1);
    const ended = endConversationWorkingState(result.workingState);
    expect(ended.npcStates).toEqual([]);
    expect(ended.recentTranscript).toEqual([]);

    await session.save("conversation consequences");
    const reopened = await runtime.openWorld(session.worldId);
    expect(reopened.snapshot().actorSocialStates.find((state) =>
      state.actorId === garyId
    )?.memories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "memory.gary.player-warning" }),
    ]));
    expect(JSON.stringify(reopened.snapshot())).not.toContain(
      "A question about the missing chicken is being asked.",
    );
  });

  it("keeps narration targets non-authoritative, advisory, and pressure-bounded", async () => {
    const { session } = await createConversationSession();
    const before = session.snapshot();
    expect(selectNarrationTarget("expansive", "terse")).toEqual({
      preference: "expansive",
      band: "small",
      minimumCharacters: 180,
      maximumCharacters: 600,
      hardLimit: false,
    });
    expect(selectNarrationTarget("concise", "complex")).toEqual({
      preference: "concise",
      band: "large",
      minimumCharacters: 700,
      maximumCharacters: 1_200,
      hardLimit: false,
    });
    expect(session.snapshot()).toEqual(before);

    const longNarration = "x".repeat(500);
    const narrated = await performConversationTurn({
      session,
      modelRuntime: simpleModel({}, {}, () => longNarration),
      bindings: referenceConversationBindings,
      request: turnRequest("turn.long", "I greet Gary.", {
        narrationPreference: "concise",
        beatComplexity: "terse",
      }),
    });
    expect(narrated.narrationTarget.maximumCharacters).toBe(300);
    expect(narrated.narration).toHaveLength(500);

    const highPressure = await createConversationSession();
    const pressureModel = simpleModel({
      pressureLevel: 9,
      estimatedDurationMs: 6_000,
    });
    const bounded = await performConversationTurn({
      session: highPressure.session,
      modelRuntime: pressureModel,
      bindings: referenceConversationBindings,
      request: turnRequest(
        "turn.pressure",
        'I explain the whole story and say, "Please listen to all of it."',
      ),
    });
    expect(bounded.communicationCommitted).toBe(false);
    expect(bounded.stopReason).toBe("pressure-boundary");
    expect(bounded.act.exactQuoteFragments).toEqual([
      "Please listen to all of it.",
    ]);
    expect((await highPressure.session.eventHistory()).some((event) =>
      event.type === "rules.communication-recorded"
    )).toBe(false);
  });
});
