import {
  communicationActSchema,
  communicationRecordPayloadSchema,
  durableConversationConsequenceProposalSchema,
  fictionalDurationMs,
  jsonValueSchema,
  mutationProposalSchema,
  OperationValidationError,
  stableIdSchema,
  type EventTypeDefinition,
  type MutationProposal,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";

export const recordCommunicationInputSchema = z.object({
  actorId: stableIdSchema,
  act: communicationActSchema,
  durationMs: z.number().int().nonnegative(),
  scopeIds: z.array(stableIdSchema),
}).strict();

export const recordCommunicationResultSchema = z.object({
  actId: stableIdSchema,
  speakerId: stableIdSchema,
  recipientIds: z.array(stableIdSchema),
  recipientBeliefIds: z.array(stableIdSchema),
  durationMs: z.number().int().nonnegative(),
}).strict();

export const communicationRecordedEventType: EventTypeDefinition<
  z.infer<typeof communicationRecordPayloadSchema>
> = {
  type: "rules.communication-recorded",
  schemaVersion: 1,
  payloadSchema: communicationRecordPayloadSchema,
};

export const recordCommunicationOperation: RulesOperation<
  z.infer<typeof recordCommunicationInputSchema>,
  z.infer<typeof recordCommunicationResultSchema>
> = {
  metadata: {
    id: "rules.social.record-communication",
    kind: "ordinary",
    description:
      "Record consequential communication semantics and perspective-grounded testimony without making a spoken proposition world truth.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "social", label: "Social" },
      tags: ["communication", "testimony", "beliefs"],
    },
    applicability: { actionModes: ["communication"] },
  },
  inputSchema: recordCommunicationInputSchema,
  outputSchema: recordCommunicationResultSchema,
  execute(context, input) {
    if (input.actorId !== input.act.speakerId) {
      throw new OperationValidationError(
        "Communication actor must be the authoritative speaker",
      );
    }
    if (!context.world.entities.some((entity) => entity.id === input.actorId)) {
      throw new OperationValidationError(`Missing speaker ${input.actorId}`);
    }
    for (const recipientId of input.act.recipientIds) {
      if (!context.world.entities.some((entity) => entity.id === recipientId)) {
        throw new OperationValidationError(`Missing recipient ${recipientId}`);
      }
    }

    const mutations: MutationProposal[] = [];
    const recipientBeliefIds: string[] = [];
    for (const [testimonyIndex, testimony] of input.act.testimony.entries()) {
      let truthStatus: "true" | "incomplete" | "uncertain" | "false";
      let confidence: number;
      if (testimony.source.kind === "fact") {
        const fact = context.world.facts.find((item) =>
          item.id === testimony.source.id
        );
        if (!fact) {
          throw new OperationValidationError(
            `Testimony references missing fact ${testimony.source.id}`,
          );
        }
        if (fact.subjectId !== testimony.subjectId) {
          throw new OperationValidationError(
            `Testimony ${testimony.id} cites an unrelated fact subject`,
          );
        }
        const speakerBelief = context.world.beliefs.find((belief) =>
          belief.holder.kind === "actor" &&
          belief.holder.id === input.actorId &&
          (belief.sourceFactId === fact.id ||
            belief.sources?.some((source) =>
              source.kind === "fact" && source.id === fact.id
            ))
        );
        if (fact.visibility !== "public" && !speakerBelief) {
          throw new OperationValidationError(
            `Speaker ${input.actorId} is not authorized to testify from hidden fact ${fact.id}`,
          );
        }
        truthStatus = "true";
        confidence = 0.8;
      } else {
        const belief = context.world.beliefs.find((item) =>
          item.id === testimony.source.id &&
          item.holder.kind === "actor" &&
          item.holder.id === input.actorId
        );
        if (!belief) {
          throw new OperationValidationError(
            `Speaker ${input.actorId} lacks source belief ${testimony.source.id}`,
          );
        }
        if (
          belief.subjectId !== testimony.subjectId ||
          belief.proposition !== testimony.proposition
        ) {
          throw new OperationValidationError(
            `Testimony ${testimony.id} contradicts its cited source belief`,
          );
        }
        truthStatus = belief.truthStatus;
        confidence = Math.max(0, Math.min(1, belief.confidence * 0.8));
      }
      for (const recipientId of input.act.recipientIds) {
        const beliefId = `${input.act.id}.belief-${testimonyIndex + 1}.${recipientId}`;
        recipientBeliefIds.push(beliefId);
        mutations.push({
          kind: "upsert-belief",
          belief: {
            id: beliefId,
            holder: { kind: "actor", id: recipientId },
            subjectId: testimony.subjectId,
            proposition: testimony.proposition,
            truthStatus,
            confidence,
            sources: [{ kind: "testimony", id: input.act.id }],
          },
        });
      }
    }
    const result = recordCommunicationResultSchema.parse({
      actId: input.act.id,
      speakerId: input.act.speakerId,
      recipientIds: input.act.recipientIds,
      recipientBeliefIds,
      durationMs: input.durationMs,
    });
    const payload = communicationRecordPayloadSchema.parse({
      act: input.act,
      recipientBeliefIds,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(input.durationMs),
      proposedMutations: mutations,
      proposedEvents: [{
        type: "rules.communication-recorded",
        schemaVersion: 1,
        summary:
          `${input.act.speakerId} communicated ${input.act.semanticKinds.join(", ")} semantics to ${input.act.recipientIds.join(", ")}.`,
        relatedEntityIds: [
          input.act.speakerId,
          ...input.act.recipientIds,
          ...input.act.testimony.map((item) => item.subjectId),
        ],
        scopeIds: input.scopeIds,
        causedByEventIds: [],
        origin: {
          kind: "rules-operation",
          id: "rules.social.record-communication",
        },
        payload,
        access: "gm-only",
      }],
    };
  },
};

export const applyConversationConsequencesInputSchema = z.object({
  actorId: stableIdSchema,
  proposals: z.array(durableConversationConsequenceProposalSchema).max(8),
  scopeIds: z.array(stableIdSchema),
}).strict();

export const applyConversationConsequencesResultSchema = z.object({
  appliedCount: z.number().int().nonnegative(),
  mutationKinds: z.array(stableIdSchema),
  sourceEventIds: z.array(stableIdSchema),
}).strict();

export const conversationConsequencesAppliedEventType: EventTypeDefinition<
  z.infer<typeof applyConversationConsequencesResultSchema>
> = {
  type: "rules.conversation-consequences-applied",
  schemaVersion: 1,
  payloadSchema: applyConversationConsequencesResultSchema,
};

function requireSources(
  actual: readonly string[] | undefined,
  expected: readonly string[],
  label: string,
): void {
  if (!expected.every((id) => actual?.includes(id))) {
    throw new OperationValidationError(
      `${label} must retain every extraction source event`,
    );
  }
}

export const applyConversationConsequencesOperation: RulesOperation<
  z.infer<typeof applyConversationConsequencesInputSchema>,
  z.infer<typeof applyConversationConsequencesResultSchema>
> = {
  metadata: {
    id: "rules.social.apply-conversation-consequences",
    kind: "ordinary",
    description:
      "Apply selectively extracted beliefs, goals, relationships, memories, or commitments through existing authoritative stores.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "social", label: "Social" },
      tags: ["conversation", "memory", "beliefs", "relationships"],
    },
  },
  inputSchema: applyConversationConsequencesInputSchema,
  outputSchema: applyConversationConsequencesResultSchema,
  execute(context, input) {
    const mutations: MutationProposal[] = [];
    for (const proposal of input.proposals) {
      const mutation = mutationProposalSchema.parse(proposal.mutation);
      if ("actorId" in mutation) {
        if (!context.world.entities.some((entity) => entity.id === mutation.actorId)) {
          throw new OperationValidationError(
            `Conversation consequence references missing actor ${mutation.actorId}`,
          );
        }
      }
      switch (mutation.kind) {
        case "upsert-belief": {
          const eventSources = mutation.belief.sources
            ?.filter((source) => source.kind === "event")
            .map((source) => source.id);
          requireSources(eventSources, proposal.sourceEventIds, "Belief consequence");
          break;
        }
        case "upsert-actor-goal":
          requireSources(
            mutation.goal.sourceEventIds,
            proposal.sourceEventIds,
            "Goal consequence",
          );
          break;
        case "upsert-actor-relationship":
          requireSources(
            mutation.relationship.sourceEventIds,
            proposal.sourceEventIds,
            "Relationship consequence",
          );
          break;
        case "upsert-actor-memory":
          requireSources(
            mutation.memory.sourceEventIds,
            proposal.sourceEventIds,
            "Memory consequence",
          );
          if (mutation.memory.salience < 0.5) {
            throw new OperationValidationError(
              "Low-salience conversation details remain working context, not durable memory",
            );
          }
          break;
        case "upsert-actor-commitment":
          requireSources(
            mutation.commitment.sourceEventIds,
            proposal.sourceEventIds,
            "Commitment consequence",
          );
          break;
      }
      mutations.push(mutation as MutationProposal);
    }
    const sourceEventIds = [...new Set(
      input.proposals.flatMap((proposal) => proposal.sourceEventIds),
    )];
    const result = applyConversationConsequencesResultSchema.parse({
      appliedCount: mutations.length,
      mutationKinds: mutations.map((mutation) => mutation.kind),
      sourceEventIds,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: mutations,
      proposedEvents: mutations.length > 0
        ? [{
            type: "rules.conversation-consequences-applied",
            schemaVersion: 1,
            summary: `Applied ${mutations.length} selective durable conversation consequence(s).`,
            relatedEntityIds: [input.actorId],
            scopeIds: input.scopeIds,
            causedByEventIds: sourceEventIds,
            origin: {
              kind: "rules-operation",
              id: "rules.social.apply-conversation-consequences",
            },
            payload: result,
            access: "gm-only",
          }]
        : [],
    };
  },
};

export const placeCallInputSchema = z.object({
  actorId: stableIdSchema,
  service: z.string().trim().min(1),
  message: z.string().trim().min(1),
  durationMs: z.number().int().positive(),
  scopeIds: z.array(stableIdSchema),
  causedByEventIds: z.array(stableIdSchema),
}).strict();

export const placeCallResultSchema = z.object({
  actorId: stableIdSchema,
  service: z.string().trim().min(1),
  message: z.string().trim().min(1),
  durationMs: z.number().int().positive(),
}).strict();

export const callPlacedEventType: EventTypeDefinition<
  z.infer<typeof placeCallResultSchema>
> = {
  type: "rules.call-placed",
  schemaVersion: 1,
  payloadSchema: placeCallResultSchema,
};

export const placeCallOperation: RulesOperation<
  z.infer<typeof placeCallInputSchema>,
  z.infer<typeof placeCallResultSchema>
> = {
  metadata: {
    id: "rules.social.place-call",
    kind: "ordinary",
    description:
      "Place a consequential phone/radio call through an ordinary timed rules operation.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "social", label: "Social" },
      tags: ["communication", "call", "time"],
    },
    applicability: { actionModes: ["communication"] },
  },
  inputSchema: placeCallInputSchema,
  outputSchema: placeCallResultSchema,
  execute(context, input) {
    if (!context.world.entities.some((entity) => entity.id === input.actorId)) {
      throw new OperationValidationError(`Missing caller ${input.actorId}`);
    }
    const result = placeCallResultSchema.parse({
      actorId: input.actorId,
      service: input.service,
      message: input.message,
      durationMs: input.durationMs,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(input.durationMs),
      proposedMutations: [],
      proposedEvents: [{
        type: "rules.call-placed",
        schemaVersion: 1,
        summary: `${input.actorId} called ${input.service}.`,
        relatedEntityIds: [input.actorId],
        scopeIds: input.scopeIds,
        causedByEventIds: input.causedByEventIds,
        origin: { kind: "rules-operation", id: "rules.social.place-call" },
        payload: jsonValueSchema.parse(result),
        access: "public",
      }],
    };
  },
};

export const referenceConversationBindings = Object.freeze({
  recordCommunicationOperationId: "rules.social.record-communication",
  applyConsequencesOperationId: "rules.social.apply-conversation-consequences",
});
