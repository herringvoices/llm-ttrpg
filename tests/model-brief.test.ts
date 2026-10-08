import { describe, expect, it } from "vitest";
import {
  assembleContext,
  classifyTurnDeclaration,
  deterministicTurnClassification,
  initializeCampaignWorld,
  loadGameDefinition,
  prepareModelBrief,
  renderContextForModel,
  resolveBriefReference,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition, referenceSceneSource } from "@llm-ttrpg/reference-game";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";

const locationId = "fixture.location.lobby";
const aliceId = "fixture.actor.alice";
const bobId = "fixture.actor.bob";
const maskedId = "fixture.actor.daniel";
const doorId = "fixture.feature.secret-door";

function setup() {
  const game = loadGameDefinition(referenceGameDefinition);
  const world = initializeCampaignWorld(game, 12345);
  const actor = world.entities.find((entity) => entity.kind === "actor");
  if (!actor) throw new Error("No actor in the reference fixture");
  const add = (id: string, name: string, summary: string, context: Record<string, unknown>) => {
    world.entities.push({
      ...actor,
      id, name, summary,
      data: {
        ...actor.data,
        context: {
          locationId,
          category: "participant",
          prominence: "prominent",
          observable: true,
          activeParticipant: true,
          orchestratorVisible: true,
          knownBy: [],
          identities: [],
          ...context,
        },
      },
    });
  };
  add(aliceId, "Alice", "A character standing in the lobby.", {});
  add(bobId, "Bob", "Private relationship detail visible only to Bob.", {});
  add(maskedId, "Daniel Mercer", "Secret identity: Daniel Mercer in disguise.", {
    unrecognizedIdentity: "masked figure",
    category: "participant",
    identities: [],
  });
  add(doorId, "Concealed service door", "A concealed door behind the wall.", {
    category: "feature",
    observable: false,
    orchestratorVisible: true,
    knownBy: [{ kind: "actor", id: aliceId }],
  });
  add("fixture.condition.smoke", "Thick smoke", "Smoke fills the lobby.", {
    category: "condition",
    prominence: "prominent",
  });
  const get = (id: string) => assembleContext({
    game,
    world,
    worldRevision: 7,
    eventSequence: 11,
    request: {
      role: "actor",
      perspective: { kind: "actor", id },
      focalActorId: id,
      locationId,
      declaration: "Ask the masked figure about the noise.",
      workingContext: {
        currentConversationEntityId: maskedId,
        inspectedEntityId: maskedId,
        activeEntityIds: [maskedId],
        recentEntityIds: [],
        aliases: [],
      },
      budget: { maxUnits: 50_000 },
    },
    sceneSource: referenceSceneSource,
  });
  return { game, world, get };
}

describe("LM-02 compact model-facing briefs", () => {
  it("is smaller than full context and excludes private identity and scene machinery", () => {
    const { get } = setup();
    const context = get(bobId);
    const request = {
      purpose: "routing" as const,
      context,
      perspective: { kind: "actor" as const, id: bobId },
    };
    const brief = prepareModelBrief(request);
    console.info(
      `LM-02 scripted brief sample: before=${renderContextForModel(context).length} characters; after=${brief.modelText.length} characters`,
    );
    expect(prepareModelBrief(request)).toEqual(brief);
    expect(brief.modelText.length).toBeLessThan(renderContextForModel(context).length);
    expect(brief.modelText).toContain("masked figure");
    expect(brief.modelText).toContain("Thick smoke");
    expect(brief.modelText).not.toContain("Daniel Mercer");
    expect(brief.modelText).not.toContain(maskedId);
    expect(brief.modelText).not.toContain("Concealed service door");
    expect(brief.modelText).not.toContain(doorId);
    expect(brief.modelText).not.toContain("bootstrap");
    expect(brief.modelText).not.toContain("discoveryProtocol");
    expect(brief.modelText).not.toContain("provenance");
    expect(brief.modelText).not.toContain("privileged");
    expect(brief.modelText).not.toContain("toolCatalog");
    expect(brief.diagnostics.projector).toBe("compact-v1");
    expect(brief.diagnostics.serializedCharacters).toBe(brief.modelText.length);
    const masked = (JSON.parse(brief.modelText) as {
      situation: { scene: { localRef: string; displayIdentity: string }[] };
    }).situation.scene.find((item) => item.displayIdentity === "masked figure");
    expect(masked).toBeDefined();
    expect(resolveBriefReference(brief, masked!.localRef, brief.basis)).toBe(maskedId);
    expect(() => resolveBriefReference(brief, "scene.999", brief.basis)).toThrow(/Unknown/);
    expect(() => resolveBriefReference(brief, maskedId, brief.basis)).toThrow(/Invalid/);
    expect(() => resolveBriefReference(brief, masked!.localRef, {
      worldRevision: 8, eventSequence: 11,
    })).toThrow(/Stale/);
  });

  it("reveals known private objects only to the knowing actor and rejects canonical context", () => {
    const { game, world, get } = setup();
    const aliceContext = get(aliceId);
    const bobContext = get(bobId);
    const alice = prepareModelBrief({
      purpose: "npc-response", context: aliceContext,
      perspective: { kind: "actor", id: aliceId },
    });
    const bob = prepareModelBrief({
      purpose: "npc-response", context: bobContext,
      perspective: { kind: "actor", id: bobId },
    });
    expect(alice.modelText).toContain("Concealed service door");
    expect(alice.modelText).not.toContain("Private relationship detail");
    expect(bob.modelText).not.toContain("Concealed service door");
    expect(() => prepareModelBrief({
      purpose: "narration", context: bobContext,
      perspective: { kind: "actor", id: aliceId },
    })).toThrow(/authorized/);
    const privileged = assembleContext({
      game, world, worldRevision: 7,
      request: {
        role: "orchestrator", perspective: { kind: "canonical" },
        focalActorId: bobId, locationId, budget: { maxUnits: 50_000 },
      },
      sceneSource: referenceSceneSource,
    });
    expect(() => prepareModelBrief({
      purpose: "routing", context: privileged,
      perspective: { kind: "actor", id: bobId },
    })).toThrow(/authorized/);
  });

  it("keeps required targets, reports overflow and excludes ambient optional details", () => {
    const { get } = setup();
    const brief = prepareModelBrief({
      purpose: "action-interpretation",
      context: get(bobId),
      perspective: { kind: "actor", id: bobId },
      requiredEntityIds: [maskedId],
      maxCharacters: 100,
    });
    expect(brief.diagnostics.requiredOverflow).toBe(true);
    expect(brief.modelText.length).toBeGreaterThan(100);
    expect(brief.modelText).toContain("masked figure");
    expect(brief.modelText).toContain("Thick smoke");
    expect(brief.modelText).not.toContain("Concealed service door");
  });
});

describe("LM-03 ordered interpretation", () => {
  it("preserves movement before quoted speech and resolves local recipients once", async () => {
    const { get } = setup();
    const context = get(bobId);
    const ref = context.situation.scene.find((item) => item.displayIdentity === "masked figure")!.localRef;
    const declaration = 'I approach the masked figure, then say "Who are you?"';
    const model = new ScriptedModelRuntime([{
      id: "ordered", match: { schemaId: "turn.declaration.v1" },
      result: { kind: "structured", value: {
        kind: "interpreted", segments: [
          { kind: "action", text: "I approach the masked figure",
            goal: "approach the figure", targetRefs: [ref],
            modes: ["movement", "interaction"], statedMeans: ["walk"],
            pressureLevel: 5, requestedHorizonMs: 30000 },
          { kind: "communication", text: 'say "Who are you?"',
            recipientRefs: [ref], utterance: "Who are you?" },
        ],
      } },
    }]);
    const decision = await classifyTurnDeclaration({
      declaration, actorId: bobId, context, modelRuntime: model,
      worldRevision: 7, eventSequence: 11,
    });
    expect(decision.kind).toBe("interpreted");
    if (decision.kind !== "interpreted") return;
    expect(decision.segments).toMatchObject([
      { kind: "action", targetIds: [maskedId] },
      { kind: "communication", recipientIds: [maskedId], utterance: "Who are you?" },
    ]);
    expect(model.invocations).toHaveLength(1);
  });
});

describe("LM-03 classifier smoke", () => {
  it("uses one model classification and keeps actor-local aliases", async () => {
    const { get } = setup();
    const context = get(bobId);
    const model = new ScriptedModelRuntime([{
      id: "interpret",
      match: { schemaId: "turn.declaration.v1" },
      result: { kind: "structured", value: { kind: "interpreted", segments: [{
        kind: "action", goal: "observe", modes: ["observation"],
        targetRefs: [], statedMeans: [], pressureLevel: 3, requestedHorizonMs: 1000,
      }] } },
    }]);
    const decision = await classifyTurnDeclaration({
      declaration: "I observe.", actorId: bobId, context,
      modelRuntime: model, worldRevision: 7, eventSequence: 11,
    });
    expect(decision.kind).toBe("interpreted");
    expect(model.invocations).toHaveLength(1);
  });
  it("only fast paths observations under assessed pressure", () => {
    const { world, get } = setup();
    expect(deterministicTurnClassification("I look around.", get(bobId))).toBeUndefined();
    world.actionPressure = { status: "assessed", level: 9 };
    expect(deterministicTurnClassification("I look around.", get(bobId))).toMatchObject({
      kind: "interpreted", source: "deterministic",
    });
  });
});
