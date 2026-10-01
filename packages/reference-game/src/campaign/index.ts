import {
  fictionalInstant,
  type Campaign,
  type EventTypeDefinition,
} from "@llm-ttrpg/engine";
import { z } from "zod";

export const noticePostedPayloadSchema = z
  .object({ documentId: z.string().min(1) })
  .strict();

export const noticePostedEventType: EventTypeDefinition<
  z.infer<typeof noticePostedPayloadSchema>
> = {
  type: "campaign.notice-posted",
  schemaVersion: 1,
  payloadSchema: noticePostedPayloadSchema,
};

export const contractFixtureCampaign: Campaign = {
  identity: { id: "nashville-contract-fixture", version: "0.1.0" },
  description:
    "Tiny campaign fixture used only to prove package and content boundaries.",
  setting: { id: "awakening-earth", version: "0.1.0" },
  startTime: fictionalInstant("2026-04-12T14:00:00.000Z"),
  eventTypes: [noticePostedEventType],
  content: {
    entities: [
      {
        id: "campaign.entity.amelia",
        kind: "actor",
        name: "Amelia",
        summary: "An experienced kickboxer with an incorrect theory about gates.",
        data: {
          descriptors: ["experienced-kickboxer", "fire-themed-powers"],
          currentLocation: "campaign.location.brownbag-groceries",
        },
      },
      {
        id: "campaign.location.brownbag-groceries",
        kind: "location",
        name: "Brownbag Groceries",
        summary: "A neighborhood grocery store used by the fixture campaign.",
        data: { open: true },
      },
    ],
    facts: [
      {
        id: "campaign.fact.amelia-location",
        subjectId: "campaign.entity.amelia",
        predicate: "actor.current-location",
        value: "campaign.location.brownbag-groceries",
        visibility: "public",
        tags: ["location"],
      },
    ],
    events: [
      {
        id: "campaign.event.store-notice-posted",
        type: "campaign.notice-posted",
        schemaVersion: 1,
        occurredAt: fictionalInstant("2026-04-12T13:55:00.000Z"),
        relatedEntityIds: ["campaign.location.brownbag-groceries"],
        scopeIds: ["scope.reference-scene"],
        causedByEventIds: [],
        origin: {
          kind: "campaign-initialization",
          id: "nashville-contract-fixture",
        },
        summary: "Brownbag Groceries posted an early-closing notice.",
        payload: {
          documentId: "campaign.document.store-notice",
        },
        access: "public",
      },
    ],
    documents: [
      {
        id: "campaign.document.store-notice",
        metadata: {
          title: "Brownbag Closing Notice",
          kind: "notice",
          authors: ["Brownbag Groceries"],
          tags: ["fixture"],
          relatedEntityIds: ["campaign.location.brownbag-groceries"],
          visibility: "public",
        },
        summary: "A short public notice used to verify document persistence.",
        sections: [
          {
            id: "campaign.document-section.store-hours",
            title: "Store hours",
            summary: "The store closes early today.",
            content: "Brownbag Groceries will close at 6 PM today.",
          },
        ],
      },
    ],
    beliefs: [
      {
        id: "campaign.belief.amelia-gate-origin",
        holder: { kind: "actor", id: "campaign.entity.amelia" },
        subjectId: "setting.entity.awakening-earth",
        proposition: "Gates are a naturally occurring atmospheric phenomenon.",
        truthStatus: "false",
        confidence: 0.8,
      },
    ],
  },
};
