import {
  fictionalDurationMs,
  OperationValidationError,
  type EventTypeDefinition,
  type ResolutionOperation,
  type RulesOperation,
  type Ruleset,
} from "@llm-ttrpg/engine";
import { z } from "zod";

export const effortInputSchema = z
  .object({
    actorId: z.string().min(1),
    base: z.number().int(),
    modifier: z.number().int(),
    difficulty: z.number().int(),
    scopeId: z.string().min(1).optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const effortResultSchema = z
  .object({
    total: z.number().int(),
    success: z.boolean(),
  })
  .strict();

export const effortResolvedPayloadSchema = z
  .object({
    total: z.number().int(),
    difficulty: z.number().int(),
  })
  .strict();

export const effortResolvedEventType: EventTypeDefinition<
  z.infer<typeof effortResolvedPayloadSchema>
> = {
  type: "rules.effort-resolved",
  schemaVersion: 1,
  payloadSchema: effortResolvedPayloadSchema,
};

export const resolveEffortOperation: RulesOperation<
  z.infer<typeof effortInputSchema>,
  z.infer<typeof effortResultSchema>
> = {
  metadata: {
    id: "rules.actions.resolve-effort",
    kind: "ordinary",
    description:
      "Resolve a tiny deterministic effort total for the contract fixture.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["deterministic", "fixture"],
    },
  },
  inputSchema: effortInputSchema,
  outputSchema: effortResultSchema,
  execute(_context, input) {
    const total = input.base + input.modifier;
    return {
      result: { total, success: total >= input.difficulty },
      advanceTimeByMs: fictionalDurationMs(input.durationMs ?? 0),
      proposedMutations: [],
      proposedEvents: [
        {
          type: "rules.effort-resolved",
          schemaVersion: 1,
          summary: `Resolved effort at ${total} against ${input.difficulty}.`,
          relatedEntityIds: [input.actorId],
          scopeIds: input.scopeId ? [input.scopeId] : [],
          causedByEventIds: [],
          origin: {
            kind: "rules-operation",
            id: "rules.actions.resolve-effort",
          },
          payload: {
            total,
            difficulty: input.difficulty,
          },
          access: "public",
        },
      ],
    };
  },
};

const contractResolutionModeSchema = z.enum([
  "automatic",
  "impossible",
  "uncertain-random",
  "uncertain-no-random",
  "opposed",
]);

export const contractResolutionInputSchema = z
  .object({
    actorId: z.string().min(1),
    mode: contractResolutionModeSchema,
    modifier: z.number().int(),
    counterpartId: z.string().min(1).optional(),
    durationMs: z.number().int().nonnegative(),
    setStatus: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "opposed" && !input.counterpartId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Opposed fixture resolution requires counterpartId",
        path: ["counterpartId"],
      });
    }
  });

const contractResolutionPreparedSchema = z
  .object({
    actorId: z.string().min(1),
    mode: z.enum([
      "uncertain-random",
      "uncertain-no-random",
      "opposed",
    ]),
    modifier: z.number().int(),
    counterpartId: z.string().min(1).optional(),
    durationMs: z.number().int().nonnegative(),
    setStatus: z.string().min(1).optional(),
  })
  .strict();

export const contractResolutionResultSchema = z
  .object({
    outcome: z.enum([
      "automatic-complete",
      "locally-blocked",
      "clear",
      "complicated",
      "setback",
      "initiator-edge",
      "balanced",
      "counterpart-edge",
    ]),
    score: z.number().int().optional(),
    facets: z.array(z.string().min(1)),
  })
  .strict();

export const contractResolutionPayloadSchema = z
  .object({
    mode: contractResolutionModeSchema,
    outcome: contractResolutionResultSchema.shape.outcome,
    score: z.number().int().optional(),
  })
  .strict();

export const contractResolutionEventType: EventTypeDefinition<
  z.infer<typeof contractResolutionPayloadSchema>
> = {
  type: "rules.contract-resolution-recorded",
  schemaVersion: 1,
  payloadSchema: contractResolutionPayloadSchema,
};

type ContractResolutionInput = z.infer<typeof contractResolutionInputSchema>;
type ContractResolutionPrepared = z.infer<
  typeof contractResolutionPreparedSchema
>;
type ContractResolutionResult = z.infer<
  typeof contractResolutionResultSchema
>;

function fixtureOutcome(
  prepared: ContractResolutionInput | ContractResolutionPrepared,
  result: ContractResolutionResult,
) {
  return {
    result,
    advanceTimeByMs: fictionalDurationMs(prepared.durationMs),
    proposedMutations: prepared.setStatus
      ? [
          {
            kind: "set-entity-data" as const,
            entityId: prepared.actorId,
            key: "status",
            value: prepared.setStatus,
          },
        ]
      : [],
    proposedEvents: [
      {
        type: "rules.contract-resolution-recorded",
        schemaVersion: 1,
        summary: `Recorded ${prepared.mode} contract-fixture resolution.`,
        relatedEntityIds: [
          prepared.actorId,
          ...(prepared.counterpartId ? [prepared.counterpartId] : []),
        ],
        scopeIds: [],
        causedByEventIds: [],
        origin: {
          kind: "rules-operation",
          id: "rules.resolution.resolve-contract-fixture",
        },
        payload: {
          mode: prepared.mode,
          outcome: result.outcome,
          ...(result.score === undefined ? {} : { score: result.score }),
        },
        access: "public" as const,
      },
    ],
  };
}

function fixtureBand(score: number): ContractResolutionResult {
  if (score >= 125) {
    return { outcome: "clear", score, facets: ["position-held", "echo-gained"] };
  }
  if (score >= 70) {
    return {
      outcome: "complicated",
      score,
      facets: ["position-held", "attention-drawn"],
    };
  }
  return { outcome: "setback", score, facets: ["position-lost"] };
}

export const resolveContractFixtureOperation: ResolutionOperation<
  ContractResolutionInput,
  ContractResolutionPrepared,
  ContractResolutionResult
> = {
  metadata: {
    id: "rules.resolution.resolve-contract-fixture",
    kind: "resolution",
    description:
      "Exercise generic resolution contracts with deliberately disposable fixture semantics.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "resolution", label: "Resolution" },
      tags: ["contract", "fixture"],
    },
  },
  inputSchema: contractResolutionInputSchema,
  preparedSchema: contractResolutionPreparedSchema,
  outputSchema: contractResolutionResultSchema,
  assess(context, _intent, input) {
    const actorExists = context.world.entities.some(
      (entity) => entity.id === input.actorId,
    );
    const counterpartExists = !input.counterpartId || context.world.entities.some(
      (entity) => entity.id === input.counterpartId,
    );
    if (!actorExists || !counterpartExists) {
      throw new OperationValidationError(
        "Contract fixture resolution references a missing participant",
      );
    }
    const basis = {
      fixtureMetric: "echo-position",
      modifier: input.modifier,
      participants: [
        input.actorId,
        ...(input.counterpartId ? [input.counterpartId] : []),
      ],
    };
    if (input.mode === "automatic") {
      return {
        path: "automatic",
        basis,
        outcome: fixtureOutcome(input, {
          outcome: "automatic-complete",
          facets: ["no-uncertainty"],
        }),
      };
    }
    if (input.mode === "impossible") {
      return {
        path: "impossible",
        basis,
        outcome: fixtureOutcome(input, {
          outcome: "locally-blocked",
          facets: ["approach-blocked", "goal-may-have-alternatives"],
        }),
      };
    }
    return {
      path: "uncertain",
      basis,
      prepared: contractResolutionPreparedSchema.parse(input),
    };
  },
  resolve(context, prepared) {
    if (prepared.mode === "uncertain-no-random") {
      return fixtureOutcome(prepared, fixtureBand(80 + prepared.modifier));
    }
    const first = Math.floor(context.rng.next() * 100);
    const second = Math.floor(context.rng.next() * 100);
    if (prepared.mode === "opposed") {
      const spread = first + prepared.modifier - second;
      return fixtureOutcome(prepared, {
        outcome:
          spread > 15
            ? "initiator-edge"
            : spread < -15
              ? "counterpart-edge"
              : "balanced",
        score: spread,
        facets: ["ruleset-owned-opposition", "two-sided-position"],
      });
    }
    return fixtureOutcome(
      prepared,
      fixtureBand(first + second + prepared.modifier),
    );
  },
};

export const referenceRuleset: Ruleset = {
  identity: { id: "reference-rules", version: "0.1.0" },
  description: "Minimal rules fixture; not the real game rules.",
  operations: [resolveEffortOperation, resolveContractFixtureOperation],
  eventTypes: [effortResolvedEventType, contractResolutionEventType],
};
