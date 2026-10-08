import {
  communicationActSchema,
  conversationTurnRequestSchema,
  conversationWorkingStateSchema,
  npcReplySchema,
  type ConversationTurnRequest,
  type ConversationWorkingState,
  type NpcReply,
} from "./conversation-contracts.js";
import { prepareModelBrief, redactModelBriefText } from "./model-brief.js";
import { projectContinuity } from "./continuity.js";
import { maximumResolutionHorizon } from "./action-pressure.js";
import type { PerformConversationTurnInput, ConversationTurnResult } from "./conversation.js";
import { compileNarrationDirective, deriveSceneRegister } from "./presentation.js";

/** The normal path never performs a canonical write. Speech is presentation. */
const MAX_CONTINUITY_ITEMS = 6;
const MAX_REPLY_ATTEMPTS = 2;
const FAST_BRIEF_BUDGET = 3_200;
const MATERIAL_CLAIM = /\b(?:i (?:promise|swear|confess|stole|hid|killed|accept|agree|offer|give|sold|bought|paid)|we (?:promise|swear|agree)|(?:i'll|i will) (?:pay|give|trade|attack|leave|help)|(?:deal|payment|contract|trade) (?:is|was) (?:done|agreed|accepted))\b/i;
const MATERIAL_GESTURE = /\b(?:hands? (?:you|over)|gives? (?:you|the player)|passes? (?:you|over)|opens? (?:the|a) (?:door|gate|container|chest)|leaves? (?:the|this) (?:room|building)|strikes? (?:you|the player)|attacks? (?:you|the player)|pays? (?:you|the player)|produces? (?:a|the) (?:item|key|weapon))\b/i;

function quotes(declaration: string): string[] {
  return [...declaration.matchAll(/"([^"\r\n]+)"/g)].map((item) => item[1]!);
}
function spokenMs(text: string): number {
  // ~3 spoken words/second, with a conservative minimum interaction cost.
  return Math.max(400, Math.ceil((text.trim().split(/\s+/).filter(Boolean).length * 1000) / 3));
}
function short(text: string, size: number): string {
  return redactModelBriefText(text.slice(0, size));
}
function workingState(
  request: ConversationTurnRequest,
  prior?: ConversationWorkingState,
): ConversationWorkingState {
  if (prior && prior.interactionId !== request.interactionId) {
    throw new Error("Conversation working state belongs to another interaction");
  }
  return conversationWorkingStateSchema.parse({
    interactionId: request.interactionId,
    participantIds: [...new Set([
      ...(prior?.participantIds ?? []),
      request.playerActorId,
      ...request.recipientIds,
      ...request.materialNpcIds,
    ])],
    beat: prior?.beat ?? 0,
    npcStates: prior?.npcStates ?? [],
    recentTranscript: (prior?.recentTranscript ?? []).slice(-12),
    ...(prior?.compactedSummary ? { compactedSummary: prior.compactedSummary } : {}),
  });
}
function npcKnowledge(
  world: ReturnType<PerformConversationTurnInput["session"]["snapshot"]>,
  actorId: string,
  playerId: string,
  working: ConversationWorkingState,
) {
  const localState = working.npcStates.find((item) => item.actorId === actorId);
  return {
    ...(localState ? { stance: short(localState.stance, 100) } : {}),
    // The legacy compactedSummary is interaction-wide without per-actor
    // provenance; including it could leak another NPC's private information.
    recentUtterances: working.recentTranscript.filter((entry) =>
      entry.kind !== "narration" &&
      (entry.speakerId === actorId || entry.audienceIds.includes(actorId))
    ).slice(-MAX_CONTINUITY_ITEMS).map((entry) => ({
      speaker: entry.speakerId === actorId
        ? "self"
        : entry.speakerId === playerId ? "player" : "other",
      content: short(entry.content, 250),
    })),
  };
}

export async function tryOrdinaryNpcConversation(
  input: PerformConversationTurnInput,
): Promise<ConversationTurnResult | undefined> {
  const request = conversationTurnRequestSchema.parse(input.request);
  if (
    request.recipientIds.length !== 1 ||
    request.materialNpcIds.some((id) => id !== request.recipientIds[0]) ||
    request.authorizedPlayerAction ||
    request.authorizedMaterialCommitments.length > 0 ||
    request.authorizedTestimony.length > 0 ||
    request.authorizedDeception
  ) return undefined;

  const actorId = request.recipientIds[0]!;
  const world = input.session.snapshot();
  if (
    actorId === request.playerActorId ||
    !world.entities.some((entity) => entity.id === actorId) ||
    !world.entities.some((entity) => entity.id === request.playerActorId)
  ) return undefined;
  if (world.actionPressure.status !== "assessed") return undefined;

  const playerDuration = spokenMs(request.declaration);
  const limit = maximumResolutionHorizon(world.actionPressure.level);
  if (playerDuration >= limit) return undefined;
  const start = input.session.planningBasis();
  const context = input.session.assembleContext({
    role: "actor",
    perspective: { kind: "actor", id: actorId },
    focalActorId: actorId,
    ...(request.locationId ? { locationId: request.locationId } : {}),
    declaration: request.declaration,
    workingContext: {
      interactionId: request.interactionId,
      currentConversationEntityId: request.playerActorId,
      activeEntityIds: [request.playerActorId, actorId],
      recentEntityIds: [],
      aliases: [],
    },
    budget: { maxUnits: Math.min(8_000, request.budget.maxUnits) },
  });
  const basis = input.session.planningBasis();
  const continuity = projectContinuity({
    worldId: input.session.worldId,
    world, worldRevision: basis.worldRevision,
    eventSequence: basis.eventSequence,
    perspective: { kind: "actor", id: actorId },
    scope: { kind: "actor", id: actorId },
    maxCharacters: 900,
  });
  const brief = prepareModelBrief({
    purpose: "npc-response",
    continuity: continuity.summary,
    perspective: { kind: "actor", id: actorId },
    context,
    maxCharacters: FAST_BRIEF_BUDGET,
    requiredEntityIds: [request.playerActorId],
  });
  const recognizedPlayer = Object.entries(brief.localReferences)
    .some(([, id]) => id === request.playerActorId);
  if (!recognizedPlayer) return undefined;
  const npcScene = context.situation.scene.find((item) =>
    context.diagnostics.localReferences[item.localRef] === actorId);
  const displayName = npcScene?.displayIdentity ?? "NPC";
  const working = workingState(request, input.workingState);
  const npcContext = npcKnowledge(world, actorId, request.playerActorId, working);
  const directive = compileNarrationDirective(
    input.session.presentation().narrationProfile,
    deriveSceneRegister({
      kind: "conversation",
      actionPressure: world.actionPressure.level,
      authorizedHorizonMs: limit,
      elapsedMs: playerDuration,
    }),
  );
  let reply: NpcReply | undefined;
  input.onProgress?.("responding");
  for (let attempt = 1; attempt <= MAX_REPLY_ATTEMPTS; attempt += 1) {
    let result;
    try {
      result = await input.modelRuntime.generate({
        prompt: {
          protectedContext: [directive.protectedContext],
          instructions: [
            "Speak directly as the focal NPC. Output your final, player-visible spoken words, not a plan or paraphrase.",
            "Only use this NPC's actor-visible scene, subjective beliefs, and short continuity. Subjective beliefs are not world truth.",
            "Do not add new canonical facts, items, actions, promises, disclosures, threats, trades, agreements, powers, or player speech.",
            "You may decline, ask a question, remain silent, or knowingly withhold information, but cannot write player choices or thoughts.",
            "If the reply would assert a material secret, make or accept a commitment, negotiate an agreement, or perform an NPC world action, choose escalate instead of ordinary.",
            "Ordinary visibleManner is incidental, not a movement, handoff, environmental change, or mechanical result.",
            "The player's quoted words are authoritative. Do not rewrite or repeat them as though the NPC spoke them.",
            `Keep speech brief; speech and manner have strict size caps. Remaining Action Pressure horizon: ${limit - playerDuration}ms.`,
            ...(attempt === 2 ? ["Your prior answer was malformed or unsuitable. Return one valid short reply or escalation using the exact schema."] : []),
          ],
          context: brief.modelText,
          input: JSON.stringify({
            declaration: request.declaration,
            speaker: "player",
            actor: "current-npc",
            knowledge: npcContext,
            continuitySourceCount: continuity.diagnostics.selectedSourceCount,
          }),
        },
        output: { kind: "structured", schemaId: "conversation.npc-reply.v1", schema: npcReplySchema },
        trace: { operation: "conversation.npc-reply.v1" },
      }, input.modelOptions);
      if (!result.ok || result.output.kind !== "structured") continue;
      const parsed = npcReplySchema.safeParse(result.output.value);
      if (!parsed.success) continue;
      if (parsed.data.kind === "escalate") return undefined;
      if (MATERIAL_CLAIM.test(parsed.data.speech) ||
          MATERIAL_CLAIM.test(parsed.data.visibleManner ?? "") ||
          MATERIAL_GESTURE.test(parsed.data.visibleManner ?? "")) {
        // This utterance/gesture could propose a lasting effect. Do not
        // display it as accomplished or commit from language alone.
        return undefined;
      }
      reply = { ...parsed.data,
        speech: redactModelBriefText(parsed.data.speech),
        ...(parsed.data.visibleManner
          ? { visibleManner: redactModelBriefText(parsed.data.visibleManner) }
          : {}),
      };
      break;
    } catch {
      // Malformed local-model responses get one bounded repair; no state changes.
    }
  }
  if (!reply || reply.kind !== "ordinary") return {
    act: communicationActSchema.parse({
      id: `${request.turnId}.communication`,
      interactionId: request.interactionId,
      speakerId: request.playerActorId,
      recipientIds: request.recipientIds,
      inputMode: quotes(request.declaration).length ? "quoted" : "described",
      exactQuoteFragments: quotes(request.declaration),
      semanticKinds: ["other"],
      authorizedContent: request.declaration,
      testimony: [],
      materialCommitments: [],
      deliveryIntent: "honest",
      groundingIds: [],
      containsNonSpeechAction: false,
      durationMs: playerDuration,
    }),
    communicationCommitted: false,
    decisions: [],
    committedActions: [],
    communicationEventIds: [],
    extractionEventIds: [],
    stopReason: "safety-ceiling",
    narrationTarget: { preference: request.narrationPreference, band: "small", minimumCharacters: 0, maximumCharacters: 900, hardLimit: false },
    narrationError: "NPC reply was invalid after one repair attempt. No dialogue or world change was committed.",
    workingState: working,
  };

  const npcDuration = reply.speech ? spokenMs(reply.speech) : 0;
  if (playerDuration + npcDuration > limit) {
    const q = quotes(request.declaration);
    return {
      act: communicationActSchema.parse({
        id: `${request.turnId}.communication`, interactionId: request.interactionId,
        speakerId: request.playerActorId, recipientIds: request.recipientIds,
        inputMode: q.length ? "quoted" : "described", exactQuoteFragments: q,
        semanticKinds: ["other"], authorizedContent: request.declaration,
        testimony: [], materialCommitments: [], deliveryIntent: "honest",
        groundingIds: [], containsNonSpeechAction: false, durationMs: playerDuration,
      }),
      communicationCommitted: false, decisions: [], committedActions: [],
      communicationEventIds: [], extractionEventIds: [],
      stopReason: "pressure-boundary",
      narrationTarget: { preference: request.narrationPreference, band: "small", minimumCharacters: 0, maximumCharacters: 900, hardLimit: false },
      narrationError: "This exchange exceeds the current Action Pressure window; speech was not committed.",
      workingState: working,
    };
  }
  const current = input.session.planningBasis();
  if (current.worldRevision !== start.worldRevision || current.eventSequence !== start.eventSequence) {
    throw new Error("World revision changed during NPC reply; no speech was accepted");
  }

  const q = quotes(request.declaration);
  const act = communicationActSchema.parse({
    id: `${request.turnId}.communication`, interactionId: request.interactionId,
    speakerId: request.playerActorId, recipientIds: request.recipientIds,
    inputMode: q.length ? "quoted" : "described", exactQuoteFragments: q,
    semanticKinds: ["other"], authorizedContent: request.declaration,
    testimony: [], materialCommitments: [], deliveryIntent: "honest",
    groundingIds: [], containsNonSpeechAction: false, durationMs: playerDuration,
  });
  const beat = working.beat + 1;
  const narration = reply.speech.length
    ? `${displayName}: "${reply.speech}"${reply.visibleManner ? ` (${reply.visibleManner})` : ""}`
    : `${displayName} does not answer.`;
  const nextWorking = conversationWorkingStateSchema.parse({
    ...working,
    beat,
    recentTranscript: [
      ...working.recentTranscript,
      {
        beat, speakerId: request.playerActorId, audienceIds: [actorId],
        kind: "player-act", content: request.declaration, exactQuoteFragments: q,
      },
      ...(reply.speech ? [{
        beat, speakerId: actorId, audienceIds: [request.playerActorId],
        kind: "npc-semantics" as const, content: reply.speech, exactQuoteFragments: [],
      }] : []),
    ].slice(-12),
  });
  return {
    act,
    communicationCommitted: true,
    decisions: [],
    committedActions: [],
    communicationEventIds: [],
    extractionEventIds: [],
    stopReason: reply.continueConversation ? "answer-expected" : "no-material-reaction",
    narrationTarget: { preference: request.narrationPreference, band: "small", minimumCharacters: 0, maximumCharacters: 900, hardLimit: false },
    narration,
    workingState: nextWorking,
  };
}
