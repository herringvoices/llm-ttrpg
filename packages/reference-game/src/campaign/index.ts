import {
  fictionalInstant,
  type Campaign,
  type EventTypeDefinition,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  brownbagConsequenceEventType,
  brownbagDetailCommittedEventType,
  brownbagSocialActionEventType,
} from "../content-situations.js";

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
  identity: { id: "reference-contract-fixture", version: "0.3.0" },
  description:
    "Tiny campaign fixture used only to prove package and content boundaries.",
  setting: { id: "awakening-earth", version: "0.2.0" },
  startTime: fictionalInstant("2026-04-12T14:00:00.000Z"),
  eventTypes: [
    noticePostedEventType,
    brownbagDetailCommittedEventType,
    brownbagConsequenceEventType,
    brownbagSocialActionEventType,
  ],
  content: {
    entities: [
      {
        id: "campaign.entity.amelia",
        kind: "actor",
        name: "Amelia",
        summary: "An experienced kickboxer with an incorrect theory about what caused the Awakening.",
        data: {
          descriptors: ["experienced-kickboxer", "fire-themed-powers"],
          currentLocation: "campaign.location.brownbag-groceries",
          context: {
            locationId: "campaign.location.brownbag-groceries",
            category: "participant",
            prominence: "prominent",
            observable: true,
            activeParticipant: true,
            orchestratorVisible: true,
            knownBy: [
              { kind: "actor", id: "campaign.entity.amelia" },
            ],
            identities: [],
          },
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
        summary: "A locally owned neighborhood grocery store with aging equipment.",
        data: {
          open: true,
          equipment: {
            refrigeration: {
              "age-band": "aging",
              maintenance: "deferred where possible",
            },
          },
          context: {
            locationId: "campaign.location.brownbag-groceries",
            category: "feature",
            prominence: "prominent",
            observable: true,
            activeParticipant: false,
            orchestratorVisible: true,
            knownBy: [],
            identities: [],
            coarseState: { open: true },
          },
        },
      },
      {
        id: "campaign.entity.nina",
        kind: "actor",
        name: "Nina",
        summary: "A Brownbag employee trying to keep steady work despite manager conflict.",
        data: {
          currentLocation: "campaign.location.brownbag-groceries",
          context: {
            locationId: "campaign.location.brownbag-groceries",
            category: "participant",
            prominence: "ambient",
            observable: true,
            activeParticipant: false,
            orchestratorVisible: true,
            knownBy: [{ kind: "actor", id: "campaign.entity.nina" }],
            identities: [],
          },
        },
      },
      {
        id: "campaign.entity.brownbag-manager",
        kind: "actor",
        name: "Morgan",
        summary: "Brownbag's cash-strapped owner-manager.",
        data: {
          currentLocation: "campaign.location.brownbag-groceries",
          context: {
            locationId: "campaign.location.brownbag-groceries",
            category: "participant",
            prominence: "ambient",
            observable: true,
            activeParticipant: false,
            orchestratorVisible: true,
            knownBy: [{ kind: "actor", id: "campaign.entity.brownbag-manager" }],
            identities: [],
          },
        },
      },
      {
        id: "campaign.entity.salt-customer",
        kind: "actor",
        name: "Ellis",
        summary: "A regular customer whose recent salt purchases are unusually large.",
        data: {
          currentLocation: "campaign.location.brownbag-groceries",
          context: {
            locationId: "campaign.location.brownbag-groceries",
            category: "participant",
            prominence: "ambient",
            observable: true,
            activeParticipant: false,
            orchestratorVisible: true,
            knownBy: [],
            identities: [],
          },
        },
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
      {
        id: "campaign.fact.brownbag-aging-equipment",
        subjectId: "campaign.location.brownbag-groceries",
        predicate: "equipment.refrigeration-age",
        value: "aging equipment with deferred maintenance",
        visibility: "public",
        tags: ["equipment", "economy"],
      },
      {
        id: "campaign.fact.brownbag-financial-pressure",
        subjectId: "campaign.location.brownbag-groceries",
        predicate: "institution.financial-pressure",
        value: "cash flow is tight enough to defer some maintenance",
        visibility: "hidden",
        tags: ["economy", "pressure"],
      },
      {
        id: "campaign.fact.salt-purchases",
        subjectId: "campaign.entity.salt-customer",
        predicate: "customer.purchase-pattern",
        value: "repeated unusually large purchases of salt",
        visibility: "public",
        tags: ["behavior", "observation"],
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
          id: "reference-contract-fixture",
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
        id: "campaign.belief.amelia-awakening-cause",
        holder: { kind: "actor", id: "campaign.entity.amelia" },
        subjectId: "setting.entity.awakening-earth",
        proposition:
          "The Awakening was a naturally occurring cosmic or geomagnetic event rather than something deliberately caused.",
        truthStatus: "false",
        confidence: 0.8,
      },
      {
        id: "campaign.belief.nina-salt-rumor",
        holder: { kind: "actor", id: "campaign.entity.nina" },
        subjectId: "campaign.entity.salt-customer",
        proposition: "Ellis may be using the salt to ward off something supernatural.",
        truthStatus: "uncertain",
        confidence: 0.45,
        sources: [{ kind: "testimony", id: "campaign.entity.salt-customer" }],
      },
    ],
  },
  actorSocialStates: [
    {
      actorId: "campaign.entity.nina",
      goals: [{
        id: "campaign.goal.nina-keep-job",
        description: "Keep steady hours at Brownbag long enough to cover rent.",
        priority: 0.85,
        status: "active",
        relatedEntityIds: ["campaign.location.brownbag-groceries"],
        createdAt: fictionalInstant("2026-04-01T14:00:00.000Z"),
      }],
      relationships: [{
        id: "campaign.relationship.nina-manager",
        targetEntityId: "campaign.entity.brownbag-manager",
        dimensions: { trust: -0.35, resentment: 0.55 },
        salience: 0.8,
        tags: ["employment", "conflict"],
        lastUpdatedAt: fictionalInstant("2026-04-12T12:00:00.000Z"),
      }],
      memories: [],
      commitments: [],
    },
    {
      actorId: "campaign.entity.brownbag-manager",
      goals: [{
        id: "campaign.goal.manager-control-costs",
        description: "Keep Brownbag operating despite immediate cash-flow pressure.",
        priority: 0.9,
        status: "active",
        relatedEntityIds: ["campaign.location.brownbag-groceries"],
        createdAt: fictionalInstant("2026-03-15T14:00:00.000Z"),
      }],
      relationships: [],
      memories: [],
      commitments: [],
    },
  ],
};
