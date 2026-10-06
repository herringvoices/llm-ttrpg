import {
  canonicalFactSchema,
  entitySchema,
  fictionalInstant,
  type Campaign,
  type EventTypeDefinition,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import { openingSituationSchema } from "./player-creation.js";

export const OPENING_PHENOMENON_ENTITY_ID = "generated.phenomenon.opening";

export const MUNDANE_OPENING_CONTEXT_EVENT_ID = "generated.opening.mundane-context";

const mundaneOpeningContextPayloadSchema = z.object({
  playerActorId: z.string().trim().min(1),
  locationId: z.string().trim().min(1).optional(),
  ordinaryAnchorEntityIds: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const mundaneOpeningContextEstablishedEventType: EventTypeDefinition<
  z.infer<typeof mundaneOpeningContextPayloadSchema>
> = {
  type: "campaign.opening-context-established",
  schemaVersion: 1,
  payloadSchema: mundaneOpeningContextPayloadSchema,
};


const openingPhenomenonRealizedPayloadSchema = z.object({
  phenomenonId: z.literal(OPENING_PHENOMENON_ENTITY_ID),
  playerActorId: z.string().trim().min(1),
  locationId: z.string().trim().min(1).optional(),
  ordinaryAnchorEntityIds: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const openingPhenomenonRealizedEventType: EventTypeDefinition<
  z.infer<typeof openingPhenomenonRealizedPayloadSchema>
> = {
  type: "campaign.opening-phenomenon-realized",
  schemaVersion: 1,
  payloadSchema: openingPhenomenonRealizedPayloadSchema,
};


export function realizeMundaneOpeningCampaign(input: {
  readonly campaign: Campaign;
  readonly openingSituation: unknown;
  readonly playerActorId: string;
  readonly occurredAt: string;
}): Campaign {
  const opening = openingSituationSchema.parse(input.openingSituation);
  if (
    opening.openingMode !== "mundane-manifestation" ||
    opening.supernaturalFocus !== "none"
  ) {
    throw new Error(
      "Mundane opening realization requires a mundane-manifestation opening",
    );
  }

  const player = input.campaign.content.entities.find(
    (entity) => entity.id === input.playerActorId,
  );
  if (!player) throw new Error(`Missing opening player ${input.playerActorId}`);

  const anchorIds = opening.ordinaryAnchorEntityIds.filter((id) =>
    input.campaign.content.entities.some((entity) => entity.id === id)
  );
  if (anchorIds.length === 0) {
    throw new Error("Mundane opening has no canonical ordinary anchor");
  }

  const playerLocation = typeof player.data.currentLocation === "string"
    ? player.data.currentLocation
    : undefined;
  const locationId = playerLocation &&
      input.campaign.content.entities.some((entity) =>
        entity.id === playerLocation && entity.kind === "location"
      )
    ? playerLocation
    : anchorIds.find((id) =>
      input.campaign.content.entities.some((entity) =>
        entity.id === id && entity.kind === "location"
      )
    );

  if (input.campaign.content.events.some(
    (event) => event.id === MUNDANE_OPENING_CONTEXT_EVENT_ID,
  )) {
    throw new Error(
      `Mundane opening would duplicate canonical record ${MUNDANE_OPENING_CONTEXT_EVENT_ID}`,
    );
  }

  const localityScopeIds = input.campaign.worldSimulation?.scopes
    ?.filter((scope) => scope.kind === "campaign-locality")
    .map((scope) => scope.id) ?? [];
  const payload = mundaneOpeningContextPayloadSchema.parse({
    playerActorId: input.playerActorId,
    ...(locationId ? { locationId } : {}),
    ordinaryAnchorEntityIds: anchorIds,
  });
  const event = {
    id: MUNDANE_OPENING_CONTEXT_EVENT_ID,
    type: "campaign.opening-context-established",
    schemaVersion: 1,
    occurredAt: fictionalInstant(input.occurredAt),
    relatedEntityIds: [input.playerActorId, ...anchorIds],
    scopeIds: localityScopeIds,
    causedByEventIds: [],
    origin: {
      kind: "campaign-initialization" as const,
      id: input.campaign.identity.id,
    },
    summary: `Ordinary opening context established around ${player.name}.`,
    payload,
    access: "public" as const,
  };

  return {
    ...input.campaign,
    identity: { ...input.campaign.identity, version: "0.2.0" },
    description:
      `${input.campaign.description} Includes one validated generated mundane opening context.`,
    content: {
      ...input.campaign.content,
      events: [...input.campaign.content.events, event],
    },
    eventTypes: [
      ...input.campaign.eventTypes,
      mundaneOpeningContextEstablishedEventType,
    ],
  };
}

export function realizeOpeningPhenomenonCampaign(input: {
  readonly campaign: Campaign;
  readonly openingSituation: unknown;
  readonly playerActorId: string;
  readonly occurredAt: string;
}): Campaign {
  const opening = openingSituationSchema.parse(input.openingSituation);
  if (
    opening.openingMode !== "supernatural-inciting-incident" ||
    opening.supernaturalFocus !== "phenomenon"
  ) {
    throw new Error(
      "Opening phenomenon realization requires a supernatural-inciting phenomenon opening",
    );
  }

  const player = input.campaign.content.entities.find(
    (entity) => entity.id === input.playerActorId,
  );
  if (!player) throw new Error(`Missing opening player ${input.playerActorId}`);

  const anchorIds = opening.ordinaryAnchorEntityIds.filter((id) =>
    input.campaign.content.entities.some((entity) => entity.id === id)
  );
  if (anchorIds.length === 0) {
    throw new Error("Opening phenomenon has no canonical ordinary anchor");
  }

  const playerLocation = typeof player.data.currentLocation === "string"
    ? player.data.currentLocation
    : undefined;
  const locationId = playerLocation &&
      input.campaign.content.entities.some((entity) =>
        entity.id === playerLocation && entity.kind === "location"
      )
    ? playerLocation
    : anchorIds.find((id) =>
      input.campaign.content.entities.some((entity) =>
        entity.id === id && entity.kind === "location"
      )
    );

  const existingIds = new Set([
    ...input.campaign.content.entities.map((entity) => entity.id),
    ...input.campaign.content.facts.map((fact) => fact.id),
    ...input.campaign.content.events.map((event) => event.id),
  ]);
  const activeFactId = `${OPENING_PHENOMENON_ENTITY_ID}.active`;
  const eventId = `${OPENING_PHENOMENON_ENTITY_ID}.realized`;
  for (const id of [OPENING_PHENOMENON_ENTITY_ID, activeFactId, eventId]) {
    if (existingIds.has(id)) {
      throw new Error(`Opening phenomenon would duplicate canonical record ${id}`);
    }
  }

  const phenomenon = entitySchema.parse({
    id: OPENING_PHENOMENON_ENTITY_ID,
    kind: "supernatural-phenomenon",
    name: "Opening Supernatural Phenomenon",
    summary: opening.awakeningEvent,
    data: {
      ...(locationId ? { locationId } : {}),
      ordinaryAnchorEntityIds: anchorIds,
      context: {
        ...(locationId ? { locationId } : {}),
        category: "feature",
        prominence: "prominent",
        observable: true,
        activeParticipant: false,
        orchestratorVisible: true,
        knownBy: [],
        identities: [],
      },
    },
  });
  const activeFact = canonicalFactSchema.parse({
    id: activeFactId,
    subjectId: OPENING_PHENOMENON_ENTITY_ID,
    predicate: "supernatural-phenomenon.active",
    value: true,
    visibility: "public",
    tags: ["supernatural", "opening", "phenomenon"],
  });
  const localityScopeIds = input.campaign.worldSimulation?.scopes
    ?.filter((scope) => scope.kind === "campaign-locality")
    .map((scope) => scope.id) ?? [];
  const payload = openingPhenomenonRealizedPayloadSchema.parse({
    phenomenonId: OPENING_PHENOMENON_ENTITY_ID,
    playerActorId: input.playerActorId,
    ...(locationId ? { locationId } : {}),
    ordinaryAnchorEntityIds: anchorIds,
  });
  const event = {
    id: eventId,
    type: "campaign.opening-phenomenon-realized",
    schemaVersion: 1,
    occurredAt: fictionalInstant(input.occurredAt),
    relatedEntityIds: [
      OPENING_PHENOMENON_ENTITY_ID,
      input.playerActorId,
      ...anchorIds,
    ],
    scopeIds: localityScopeIds,
    causedByEventIds: [],
    origin: {
      kind: "campaign-initialization" as const,
      id: input.campaign.identity.id,
    },
    summary: opening.awakeningEvent,
    payload,
    access: "public" as const,
  };

  return {
    ...input.campaign,
    identity: { ...input.campaign.identity, version: "0.2.0" },
    description:
      `${input.campaign.description} Includes one validated generated opening supernatural phenomenon.`,
    content: {
      ...input.campaign.content,
      entities: [...input.campaign.content.entities, phenomenon],
      facts: [...input.campaign.content.facts, activeFact],
      events: [...input.campaign.content.events, event],
    },
    eventTypes: [
      ...input.campaign.eventTypes,
      openingPhenomenonRealizedEventType,
    ],
  };
}
