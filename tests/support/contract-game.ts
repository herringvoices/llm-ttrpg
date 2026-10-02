import {
  fictionalDurationMs,
  OperationValidationError,
  type EventTypeDefinition,
  type GameDefinition,
  type ResolutionOperation,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";
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
  .object({ total: z.number().int(), success: z.boolean() })
  .strict();

const effortPayloadSchema = z
  .object({ total: z.number().int(), difficulty: z.number().int() })
  .strict();

const effortEventType: EventTypeDefinition<z.infer<typeof effortPayloadSchema>> = {
  type: "test.effort-resolved",
  schemaVersion: 1,
  payloadSchema: effortPayloadSchema,
};

export const resolveEffortFixtureOperation: RulesOperation<
  z.infer<typeof effortInputSchema>,
  z.infer<typeof effortResultSchema>
> = {
  metadata: {
    id: "test.actions.resolve-effort",
    kind: "ordinary",
    description: "Test-only deterministic operation-registry fixture.",
    category: {
      domain: { id: "test", label: "Test" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["fixture"],
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
          type: "test.effort-resolved",
          schemaVersion: 1,
          summary: `Resolved test effort at ${total} against ${input.difficulty}.`,
          relatedEntityIds: [input.actorId],
          scopeIds: input.scopeId ? [input.scopeId] : [],
          causedByEventIds: [],
          origin: {
            kind: "rules-operation",
            id: "test.actions.resolve-effort",
          },
          payload: { total, difficulty: input.difficulty },
          access: "public",
        },
      ],
    };
  },
};

const resolutionModeSchema = z.enum([
  "automatic",
  "impossible",
  "uncertain-random",
  "uncertain-no-random",
  "opposed",
]);

export const contractResolutionInputSchema = z
  .object({
    actorId: z.string().min(1),
    mode: resolutionModeSchema,
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

const preparedSchema = z
  .object({
    actorId: z.string().min(1),
    mode: z.enum(["uncertain-random", "uncertain-no-random", "opposed"]),
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

const resolutionPayloadSchema = z
  .object({
    mode: resolutionModeSchema,
    outcome: contractResolutionResultSchema.shape.outcome,
    score: z.number().int().optional(),
  })
  .strict();

const resolutionEventType: EventTypeDefinition<
  z.infer<typeof resolutionPayloadSchema>
> = {
  type: "test.contract-resolution-recorded",
  schemaVersion: 1,
  payloadSchema: resolutionPayloadSchema,
};

type Input = z.infer<typeof contractResolutionInputSchema>;
type Prepared = z.infer<typeof preparedSchema>;
type Result = z.infer<typeof contractResolutionResultSchema>;

function fixtureOutcome(prepared: Input | Prepared, result: Result) {
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
        type: "test.contract-resolution-recorded",
        schemaVersion: 1,
        summary: `Recorded ${prepared.mode} test-contract resolution.`,
        relatedEntityIds: [
          prepared.actorId,
          ...(prepared.counterpartId ? [prepared.counterpartId] : []),
        ],
        scopeIds: [],
        causedByEventIds: [],
        origin: {
          kind: "rules-operation" as const,
          id: "test.resolution.resolve-contract-fixture",
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

function fixtureBand(score: number): Result {
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
  Input,
  Prepared,
  Result
> = {
  metadata: {
    id: "test.resolution.resolve-contract-fixture",
    kind: "resolution",
    description: "Test-only generic resolution and RNG contract fixture.",
    category: {
      domain: { id: "test", label: "Test" },
      subsystem: { id: "resolution", label: "Resolution" },
      tags: ["fixture"],
    },
  },
  inputSchema: contractResolutionInputSchema,
  preparedSchema,
  outputSchema: contractResolutionResultSchema,
  assess(context, intent, input) {
    if (input.actorId !== intent.actorId) {
      throw new OperationValidationError(
        `Fixture actor ${input.actorId} does not match executable intent actor ${intent.actorId}`,
      );
    }
    const ids = new Set(context.world.entities.map((entity) => entity.id));
    if (!ids.has(input.actorId) || (input.counterpartId && !ids.has(input.counterpartId))) {
      throw new OperationValidationError("Fixture references a missing participant");
    }
    const basis = {
      fixtureMetric: "echo-position",
      modifier: input.modifier,
      participants: [input.actorId, ...(input.counterpartId ? [input.counterpartId] : [])],
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
    return { path: "uncertain", basis, prepared: preparedSchema.parse(input) };
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
        outcome: spread > 15
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

export const contractTestGameDefinition: GameDefinition = {
  ...referenceGameDefinition,
  ruleset: {
    ...referenceGameDefinition.ruleset,
    description: "Isolated test-only operation and resolution fixtures.",
    toolCatalog: {
      domains: [
        { id: "test", description: "Test-only engine contract fixtures." },
      ],
      subsystems: [
        {
          id: "actions",
          domainId: "test",
          description: "Test-only ordinary operation fixtures.",
        },
        {
          id: "resolution",
          domainId: "test",
          description: "Test-only resolution/RNG fixtures.",
        },
      ],
      queries: [],
    },
    operations: [
      resolveEffortFixtureOperation,
      resolveContractFixtureOperation,
    ],
    eventTypes: [
      effortEventType,
      resolutionEventType,
    ],
  },
  adapter: {
    ...referenceGameDefinition.adapter,
    description: "Test adapter with no setting mappings.",
    mappings: [],
  },
};
