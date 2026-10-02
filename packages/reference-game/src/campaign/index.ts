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
          mechanics: {
            attributes: {
              strength: 58,
              endurance: 62,
              durability: 55,
              agility: 68,
              perception: 57,
              "fine-motor-skills": 52,
              "critical-thinking": 48,
              learning: 50,
              focus: 55,
              memory: 46,
              creativity: 51,
              improvisation: 59,
              presence: 60,
              empathy: 47,
              attractiveness: 56,
              cool: 64,
              "social-fluency": 54,
              "self-awareness": 49,
            },
            skills: [
              {
                id: "skill.fighting",
                name: "Fighting",
                description:
                  "Broad competency in reading and participating in physical contests.",
                specificity: 1,
                sp: 80,
              },
              {
                id: "skill.kickboxing",
                name: "Kickboxing",
                description:
                  "Focused striking, footwork, defense, and timing used in kickboxing.",
                specificity: 3,
                sp: 157,
              },
            ],
            stress: {
              injury: 0,
              fear: 0,
              anger: 0,
              exhaustion: 0,
              insecurity: 0,
            },
            statuses: [],
            progression: {
              characterLevel: 1,
              skillPointsPerCharacterLevel: 5,
              skillLearningRateMultiplier: 1,
              skillUseEvidence: [],
            },
            isPlayerCharacter: false,
          },
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
