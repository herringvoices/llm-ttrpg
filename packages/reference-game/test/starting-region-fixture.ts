import {
  fictionalInstant,
  type GenerationIssue,
} from "@llm-ttrpg/engine";
import {
  ATTRIBUTE_IDS,
  createDefaultMundaneProgression,
  type StartingRegionProposalModel,
  type StartingRegionSeed,
  type StartingRegionWorkingState,
} from "@llm-ttrpg/reference-game";

const start = fictionalInstant("2041-05-01T15:00:00.000Z");

const provenance = (kind: "player-established" | "real-world-anchor" |
  "setting-derived" | "generator-chosen" = "generator-chosen") => ({
  class: kind,
  sourceIds: kind === "player-established" ? ["player.input"] : ["setting.awakening-earth"],
  rationale: "Deterministic integration fixture provenance.",
});

const attributes = Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, 54]));
const nearBaselineEvidence = ATTRIBUTE_IDS.map((attributeId) => ({
  attributeId,
  direction: "near-baseline" as const,
  rationale: "No established biography fact moves this attribute from baseline.",
  sourceFactIds: [],
}));

const playerMechanics = {
  mechanics: {
    attributes,
    skills: [{
      id: "skill.customer-service",
      name: "Customer Service",
      description: "Sustained experience helping grocery customers.",
      specificity: 2 as const,
      sp: 50,
    }],
    stress: { injury: 0, fear: 0, anger: 0, exhaustion: 0, insecurity: 0 },
    statuses: [],
    progression: createDefaultMundaneProgression(),
    isPlayerCharacter: true,
  },
  attributeEvidence: nearBaselineEvidence,
  skillEvidence: [{
    skillId: "skill.customer-service",
    rationale: "The player explicitly works at a grocery store.",
    sourceFactIds: ["player.fact.work"],
  }],
};

const playerSocial = {
  actorId: "generated.actor.player",
  goals: [{
    id: "goal.player.protect-sibling",
    description: "Protect their sibling while understanding the Awakening.",
    priority: 0.9,
    status: "active" as const,
    relatedEntityIds: ["generated.actor.alice"],
    createdAt: start,
  }],
  relationships: [{
    id: "relationship.player-alice",
    targetEntityId: "generated.actor.alice",
    dimensions: { trust: 0.8, affection: 0.9 },
    salience: 0.9,
    tags: ["family"],
    lastUpdatedAt: start,
  }],
  memories: [],
  commitments: [{
    id: "commitment.player.shift",
    label: "Work the evening grocery shift",
    start: fictionalInstant("2041-05-01T21:00:00.000Z"),
    end: fictionalInstant("2041-05-02T02:00:00.000Z"),
    availabilityImpact: "occupied" as const,
    relatedEntityIds: ["generated.location.grocery"],
    tags: ["work"],
  }],
};

const aliceSocial = {
  actorId: "generated.actor.alice",
  goals: [{
    id: "goal.alice.finish-shift",
    description: "Finish the shift and get home safely.",
    priority: 0.7,
    status: "active" as const,
    relatedEntityIds: ["generated.location.grocery"],
    createdAt: start,
  }],
  relationships: [{
    id: "relationship.alice-player",
    targetEntityId: "generated.actor.player",
    dimensions: { trust: 0.4, concern: 0.8 },
    salience: 0.8,
    tags: ["family"],
    lastUpdatedAt: start,
  }],
  memories: [{
    id: "memory.alice.blue-light",
    summary: "Alice saw blue light pulse behind the loading dock.",
    formedAt: start,
    salience: 0.9,
    relatedEntityIds: ["generated.location.grocery"],
    sourceEventIds: [],
    tags: ["witnessed", "supernatural"],
  }],
  commitments: [{
    id: "commitment.alice.shift",
    label: "Cover the evening register",
    start: fictionalInstant("2041-05-01T20:00:00.000Z"),
    end: fictionalInstant("2041-05-02T03:00:00.000Z"),
    availabilityImpact: "occupied" as const,
    relatedEntityIds: ["generated.location.grocery"],
    tags: ["work"],
  }],
};

const bobSocial = {
  actorId: "generated.actor.bob",
  goals: [{
    id: "goal.bob.keep-clinic-open",
    description: "Keep the neighborhood clinic supplied.",
    priority: 0.8,
    status: "blocked" as const,
    relatedEntityIds: ["generated.institution.clinic"],
    createdAt: start,
  }],
  relationships: [{
    id: "relationship.bob-player",
    targetEntityId: "generated.actor.player",
    dimensions: { trust: -0.2, respect: 0.3 },
    salience: 0.5,
    tags: ["acquaintance"],
    lastUpdatedAt: start,
  }],
  memories: [{
    id: "memory.bob.supply-delay",
    summary: "Bob remembers the clinic delivery failing to arrive.",
    formedAt: start,
    salience: 0.6,
    relatedEntityIds: ["generated.institution.clinic"],
    sourceEventIds: [],
    tags: ["work", "shortage"],
  }],
  commitments: [{
    id: "commitment.bob.clinic",
    label: "Staff the clinic intake desk",
    start: fictionalInstant("2041-05-02T13:00:00.000Z"),
    end: fictionalInstant("2041-05-02T21:00:00.000Z"),
    availabilityImpact: "unavailable" as const,
    relatedEntityIds: ["generated.institution.clinic"],
    tags: ["clinic"],
  }],
};

export const startingRegionRequestFixture = {
  locationDescription: "Medium-sized city in the Pacific Northwest.",
  player: {
    description:
      "Rowan works at a grocery store, rents an apartment, and wants to protect their sibling.",
    powerGuidance: "Prefer protective or spatial powers; no mind control.",
  },
  startTime: start,
  campaignId: "generated-campaign",
  controlSeed: 4242,
};

function validLocality() {
  return {
    id: "generated.locality.riverside",
    name: "Riverside",
    summary: "A walkable mixed-use neighborhood near the river.",
    locations: [
      {
        id: "generated.location.apartment",
        kind: "location",
        name: "Rowan's Apartment",
        summary: "A modest apartment near work.",
        data: {},
      },
      {
        id: "generated.location.grocery",
        kind: "location",
        name: "Riverside Grocery",
        summary: "The ordinary anchor of Rowan's working life.",
        data: {},
      },
      {
        id: "generated.location.riverwalk",
        kind: "location",
        name: "Riverwalk",
        summary: "A public path where strange tracks appeared.",
        data: {},
      },
    ],
    routes: [
      {
        fromId: "generated.location.apartment",
        toId: "generated.location.grocery",
        summary: "A ten-minute walk along ordinary streets.",
      },
      {
        fromId: "generated.location.grocery",
        toId: "generated.location.riverwalk",
        summary: "A service road reaches the river path.",
      },
    ],
    ordinaryWeekCoverage: ["home", "work", "groceries", "clinic", "public transit"],
    provenance: provenance(),
  };
}

export function startingRegionStageOutputs() {
  return {
    normalize: {
      geographyMode: "fictional-in-real-region",
      geographicDescription: "A medium-sized Pacific Northwest city.",
      settlementScale: "medium-city",
      explicitConstraints: [{
        id: "constraint.location.pnw-city",
        statement: "The campaign starts in a medium-sized Pacific Northwest city.",
        sourceText: "Medium-sized city in the Pacific Northwest.",
      }],
      realWorldAnchors: [{
        id: "anchor.pacific-northwest",
        description: "Pacific Northwest climate and regional geography.",
      }],
      followUpQuestions: [],
      player: {
        establishedFacts: [
          {
            id: "player.fact.work",
            category: "work-school",
            statement: "Rowan works at a grocery store.",
            sourceText: "works at a grocery store",
          },
          {
            id: "player.fact.home",
            category: "living-situation",
            statement: "Rowan rents an apartment.",
            sourceText: "rents an apartment",
          },
          {
            id: "player.fact.goal",
            category: "goal",
            statement: "Rowan wants to protect their sibling.",
            sourceText: "wants to protect their sibling",
          },
        ],
        unspecifiedAreas: ["age", "appearance", "education"],
        currentWants: ["protect their sibling"],
        powerPreferences: {
          positive: [{ description: "protective or spatial powers", strength: "prefer" }],
          negative: ["mind control"],
          surpriseMe: false,
        },
        followUpQuestions: [],
      },
    },
    region: {
      id: "generated.region.cascade",
      name: "Cascade Reach",
      broadGeography: "A river valley west of the Cascade crest.",
      climate: "Mild wet winters and dry summers.",
      terrain: ["river valley", "forested hills"],
      settlementPattern: "One medium city with smaller satellite towns.",
      transportationConnectivity: "Highway, regional bus, and freight rail.",
      economicContext: "Health care, logistics, retail, and light industry.",
      supernaturalPressureBaseline: "Recent Gates remain uncommon but publicly known.",
      gateHistory: "One contained Gate event occurred outside the city.",
      nearestPopulationCenters: ["Portland", "Seattle"],
      provenance: provenance("real-world-anchor"),
    },
    settlement: {
      id: "generated.settlement.haven",
      name: "Haven",
      approximatePopulation: 180000,
      settlementType: "medium-sized regional city",
      economy: ["health care", "logistics", "retail"],
      districts: [{ id: "district.riverside", name: "Riverside", summary: "Mixed-use river neighborhood." }],
      transportation: ["bus network", "freight rail", "interstate"],
      supernaturalHistory: "Public preparedness increased after a distant Gate incident.",
      institutionalCapacity: "Municipal emergency response with limited magical expertise.",
      traits: ["rainy", "connected", "uneasy"],
      provenance: provenance(),
    },
    institutions: [
      {
        entity: {
          id: "generated.institution.clinic",
          kind: "institution",
          name: "Riverside Clinic",
          summary: "A neighborhood clinic under supply pressure.",
          data: {},
        },
        institutionType: "healthcare-clinic",
        serviceAreaEntityId: "generated.locality.riverside",
        goals: ["keep routine care available"],
        capabilities: ["urgent care", "basic diagnostics"],
        resources: ["small staff"],
        constraints: ["delayed medical deliveries"],
        currentPressures: ["supply shortage"],
        provenance: provenance("setting-derived"),
      },
    ],
    locality: validLocality(),
    "player-context": {
      entity: {
        id: "generated.actor.player",
        kind: "actor",
        name: "Rowan",
        summary: "A grocery worker trying to protect their sibling.",
        data: {},
      },
      homeLocationId: "generated.location.apartment",
      routineLocationIds: ["generated.location.grocery"],
      accessEntityIds: ["generated.location.apartment", "generated.location.grocery"],
      currentObligations: ["evening grocery shift"],
      ordinaryPressures: ["rent", "work schedule", "family safety"],
      socialState: playerSocial,
      mechanics: playerMechanics,
      provenance: provenance("player-established"),
    },
    npcs: [
      {
        entity: {
          id: "generated.actor.alice",
          kind: "actor",
          name: "Alice",
          summary: "Rowan's sibling and coworker, who witnessed something strange.",
          data: {},
        },
        simulationReasons: ["family relationship", "supernatural witness"],
        socialState: aliceSocial,
        mechanicallyRelevantConstraints: [{
          id: "constraint.alice.retail-work",
          summary: "Alice has sustained retail experience.",
          sourceId: "generated.actor.alice",
        }],
        provenance: provenance(),
      },
      {
        entity: {
          id: "generated.actor.bob",
          kind: "actor",
          name: "Bob",
          summary: "A clinic worker worried about delayed supplies.",
          data: {},
        },
        simulationReasons: ["clinic pressure owner", "local information source"],
        socialState: bobSocial,
        mechanicallyRelevantConstraints: [{
          id: "constraint.bob.clinic-work",
          summary: "Bob has practical clinic intake experience.",
          sourceId: "generated.actor.bob",
        }],
        provenance: provenance(),
      },
    ],
    pressures: {
      pressures: [
        {
          id: "generated.pressure.rent",
          category: "ordinary",
          summary: "Rent is due",
          currentState: "Rowan needs this week's pay.",
          cause: "ordinary household expense",
          likelyTrajectory: "late fees if ignored",
          actorEntityIds: ["generated.actor.player"],
          scopeId: "scope.generated.locality.riverside",
          changeConditions: ["earn money", "negotiate with landlord"],
          provenance: provenance(),
        },
        {
          id: "generated.pressure.clinic",
          category: "social-institutional",
          summary: "Clinic supplies are delayed",
          currentState: "The clinic is rationing basic supplies.",
          cause: "regional logistics disruption",
          likelyTrajectory: "reduced neighborhood care",
          actorEntityIds: ["generated.actor.bob"],
          scopeId: "scope.generated.settlement.haven",
          changeConditions: ["delivery arrives", "alternate supplier found"],
          provenance: provenance("setting-derived"),
        },
        {
          id: "generated.pressure.tracks",
          category: "supernatural",
          summary: "Unnatural tracks by the river",
          currentState: "Blue-lit tracks appeared overnight.",
          cause: "a newly emerged magical creature",
          likelyTrajectory: "the creature approaches denser streets",
          actorEntityIds: ["generated.actor.alice"],
          scopeId: "scope.generated.region.cascade",
          changeConditions: ["investigated", "creature moves", "authorities respond"],
          provenance: provenance("setting-derived"),
        },
      ],
      creatures: [{
        entity: {
          id: "generated.creature.frost-cat",
          kind: "creature",
          name: "Frost Cat",
          summary: "A panther-sized magical predator leaving blue frost.",
          data: {},
        },
        origin: "transformed-terrestrial-life",
        morphology: "panther-sized feline with crystalline whiskers",
        behavior: "territorial ambush predator avoiding crowds",
        corePrinciple: "steals heat to create short-lived frost paths",
        observedTraits: ["large tracks", "blue frost"],
        nearTermPlayerFacing: true,
        threatEnvelope: {
          challengeBand: "Hard",
          overallThreat: "Dangerous alone but readable and avoidable.",
          offensivePressure: 0.65,
          survivability: 0.55,
          mobilityReach: 0.8,
          controlDenial: 0.45,
          sensoryInformation: 0.6,
          multiTargetPressure: 0.2,
          resourcePressure: 0.5,
          hardCounterRisks: ["cold immunity"],
          requiredSignatureCapabilities: ["heat theft"],
          requiredTells: ["crystalline whiskers brighten before heat theft"],
          requiredCounterplay: ["break line of sight or introduce strong heat source"],
          allowedGrowthRange: "May grow through survival, never hidden party scaling.",
        },
        provenance: provenance("setting-derived"),
      }],
      knowledge: {
        facts: [{
          id: "generated.fact.clinic-shortage",
          subjectId: "generated.institution.clinic",
          predicate: "supplies.status",
          value: "delayed",
          visibility: "public",
          tags: ["institution", "pressure"],
        }],
        beliefs: [
          {
            id: "generated.belief.alice-blue-light",
            holder: { kind: "actor", id: "generated.actor.alice" },
            subjectId: "generated.creature.frost-cat",
            proposition: "Something supernatural moved behind the loading dock.",
            truthStatus: "true",
            confidence: 0.8,
            sources: [{ kind: "memory", id: "memory.alice.blue-light" }],
          },
          {
            id: "generated.belief.bob-truck",
            holder: { kind: "actor", id: "generated.actor.bob" },
            subjectId: "generated.creature.frost-cat",
            proposition: "The strange reports are probably a delivery truck's coolant leak.",
            truthStatus: "false",
            confidence: 0.6,
            sources: [{ kind: "memory", id: "memory.bob.supply-delay" }],
          },
        ],
      },
      processes: [
        {
          id: "generated.process.rent",
          scopeId: "scope.generated.locality.riverside",
          pressureId: "generated.pressure.rent",
          changePerDay: 1,
          summary: "Rent pressure grows each day.",
        },
        {
          id: "generated.process.clinic",
          scopeId: "scope.generated.settlement.haven",
          pressureId: "generated.pressure.clinic",
          changePerDay: 0.5,
          summary: "Clinic shortages worsen while deliveries remain delayed.",
        },
        {
          id: "generated.process.tracks",
          scopeId: "scope.generated.region.cascade",
          pressureId: "generated.pressure.tracks",
          changePerDay: 0.25,
          summary: "The creature's territory expands slowly.",
        },
      ],
    },
    "opening-situation": {
      ordinaryAnchorEntityIds: ["generated.location.grocery", "generated.actor.alice"],
      openingMode: "supernatural-inciting-incident",
      supernaturalFocus: "creature",
      awakeningEvent: "A shelf buckles as blue frost races across the loading dock.",
      manifestationOpportunity: "Rowan can instinctively protect Alice as the danger reaches them.",
      manifestationTargetTurn: 2,
      manifestationDeadlineTurns: 3,
      combatRequired: false,
      unresolvedConsequences: ["the creature remains nearby", "the clinic delivery is still missing"],
      actionableDirections: {
        social: ["check on Alice and alert the store manager"],
        investigative: ["follow the frost trail toward the riverwalk"],
        risky: ["draw the creature away from the loading dock"],
      },
      mandatoryQuest: false,
    },
  };
}

export class DeterministicStartingRegionModel implements StartingRegionProposalModel {
  readonly proposals = startingRegionStageOutputs();
  readonly calls: string[] = [];

  constructor(
    private readonly options: {
      readonly repairLocalityOnce?: boolean;
      readonly alwaysFailLocality?: boolean;
      readonly needsInput?: boolean;
    } = {},
  ) {}

  propose(stageId: string, _context: Readonly<StartingRegionWorkingState>) {
    this.calls.push(`propose:${stageId}`);
    if (stageId === "normalize" && this.options.needsInput) {
      return {
        ...this.proposals.normalize,
        followUpQuestions: [{
          id: "question.location-scale",
          question: "Should the settlement itself be fictional?",
          materialImpact: "This changes which real-world locality facts are authoritative.",
        }],
      };
    }
    if (stageId === "locality" && (this.options.repairLocalityOnce || this.options.alwaysFailLocality)) {
      return { ...this.proposals.locality, routes: [] };
    }
    return this.proposals[stageId as keyof typeof this.proposals];
  }

  repair(
    stageId: string,
    _candidate: unknown,
    _issues: readonly GenerationIssue[],
    _context: Readonly<StartingRegionWorkingState>,
  ) {
    this.calls.push(`repair:${stageId}`);
    if (stageId === "locality" && this.options.alwaysFailLocality) {
      return { ...this.proposals.locality, routes: [] };
    }
    return this.proposals[stageId as keyof typeof this.proposals];
  }

  audit(_seed: StartingRegionSeed) {
    this.calls.push("audit");
    return { issues: [] };
  }
}

export { aliceSocial, bobSocial, playerMechanics, start as generatedStart };
