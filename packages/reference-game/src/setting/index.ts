import type { Setting } from "@llm-ttrpg/engine";

export const awakeningEarthModernBaseline =
  "Awakening Earth is contemporary modern Earth in the campaign's calendar year: cars and trucks, paved roads, electricity, phones, internet, modern construction, retail, schools, medicine, emergency services, media, and government remain ordinary. Rural, remote, traditional, or poor communities are still modern rather than medieval or preindustrial.";

export const awakeningEarthSetting: Setting = {
  identity: { id: "awakening-earth", version: "0.2.0" },
  description:
    "Modern Earth a few months after an instantaneous planet-wide magical Awakening, with ordinary life adapting around monsters, individualized human powers, magical loot, and rapidly evolving institutions.",
  eventTypes: [],
  content: {
    entities: [
      {
        id: "setting.entity.awakening-earth",
        kind: "world",
        name: "Awakening Earth",
        summary:
          "Modern Earth a few months after an instantaneous planet-wide magical Awakening.",
        data: {
          technologyLevel: "modern",
          awakeningAge: "few-months",
          awakenedPopulationShareEstimate: 0.005,
          ordinaryLifeContinues: true,
          monsterIncidentBaselines: {
            ruralPersonalEncounterDays: 30,
            urbanPersonalEncounterDays: 60,
          },
        },
      },
      {
        id: "setting.entity.magic",
        kind: "setting-concept",
        name: "Magic",
        summary:
          "A fundamental, flexible feature of reality that tends toward movement, change, life, and chaos.",
        data: {
          tendencies: ["movement", "change", "life", "chaos"],
          sentientMindsCanImposeStructure: true,
        },
      },
      {
        id: "setting.entity.gates",
        kind: "setting-concept",
        name: "Gates",
        summary:
          "Naturally forming magical spatial anomalies that commonly open into temporary pocket environments sustained by concentrated ambient magic.",
        data: {
          origin: "ambient-magic-self-organization",
          separateMetaphysics: false,
          alienConstructs: false,
          typicalDestination: "temporary-pocket-environment",
          traversableBothDirectionsWhileStable: true,
          interiorMayExceedLocalFootprint: true,
          notAllMonstersComeFromGates: true,
        },
      },
      {
        id: "setting.entity.monsters",
        kind: "setting-concept",
        name: "Monsters",
        summary:
          "Magical life that may emerge from transformed terrestrial organisms or spontaneous magical generation.",
        data: {
          origins: [
            "transformed-terrestrial-life",
            "spontaneous-magical-generation",
          ],
          canGrowMoreDangerousOverTime: true,
          disintegrateAfterDeath: true,
          deathNormallyManifestsLoot: true,
        },
      },
      {
        id: "setting.entity.awakened-humans",
        kind: "setting-concept",
        name: "Awakened Humans",
        summary:
          "Humans who develop highly individualized supernatural powers and begin progression near the bottom rather than awakening already powerful.",
        data: {
          powerDevelopment: "highly-individualized",
          beginWeak: true,
          becomingMoreCommon: true,
          monsterKillsCanContributeToAwakeningAndProgression: true,
          thresholdGrowthAffects: ["body", "mind", "powers"],
        },
      },
      {
        id: "setting.entity.monster-response",
        kind: "institution-model",
        name: "Monster Response",
        summary:
          "A public-dispatch-centered response ecology in which weak threats are primarily public, medium threats create work for independents, and major threats support large private firms.",
        data: {
          dispatchDefault: "public-emergency-services",
          threatResponseDefaults: [
            {
              threat: "weak",
              typicalResponder: "public-response",
              ordinaryLootRights: "agency-or-government-while-on-duty",
            },
            {
              threat: "medium",
              typicalResponder: "independent-or-small-team",
              ordinaryLootRights: "responders-unless-contract-says-otherwise",
            },
            {
              threat: "major",
              typicalResponder: "large-private-firm",
              ordinaryLootRights: "employment-contract-dependent",
            },
          ],
          regionDerivationInputs: [
            "settlement-size",
            "population",
            "geography-remoteness",
            "wealth-tax-base",
            "nearby-population-centers",
            "monster-pressure-history",
            "gate-pressure-history",
            "local-response-capacity",
            "transportation-access",
            "private-firm-coverage",
          ],
        },
      },
      {
        id: "setting.entity.responder-licensing",
        kind: "institution-model",
        name: "Responder Licensing",
        summary:
          "Responder license colors are broad supernatural-advancement bands, while professional training and certifications separately represent competence and authorization.",
        data: {
          colorBands: [
            "Red",
            "Orange",
            "Yellow",
            "Green",
            "Blue",
            "Purple",
            "Pink",
            "Silver",
            "Gold",
          ],
          colorMeasures: "supernatural-advancement",
          professionalCertificationSeparate: true,
          universalAwakenedRegistration: false,
          goldPresentAtCampaignStart: false,
          trainingModel: "decentralized-and-employer-driven",
          trainingPaths: [
            "public-agency",
            "private-firm",
            "private-course",
            "combat-school-or-gym",
            "experienced-mentor",
            "specialist-certification",
          ],
          baselineCertificationPurpose:
            "safe-professional-operation-at-emergency-scenes",
        },
      },
      {
        id: "setting.entity.monster-loot",
        kind: "economic-model",
        name: "Monster Loot",
        summary:
          "Monsters normally disintegrate into economically valuable magical loot, while preserving an intact body prevents ordinary loot manifestation.",
        data: {
          defaultOwnership: "threat-ending-responders",
          contractCanReassignOwnership: true,
          ordinaryCarcassHarvest: false,
          preservationPreventsLootManifestation: true,
          marketChannels: [
            "appraisers",
            "brokers",
            "dealers",
            "processors",
            "researchers",
            "auctions",
          ],
          hazardousLootMayBeRegulated: true,
        },
      },
      {
        id: "setting.entity.magical-medicine",
        kind: "institution-model",
        name: "Magical Medicine",
        summary:
          "Magical treatment supplements ordinary medicine through regeneration, cleansing, restoration, and disease-specific curative effects.",
        data: {
          categories: [
            "regeneration",
            "cleansing-purification",
            "restoration",
            "curative",
          ],
          ordinaryMedicineRemainsRelevant: true,
          regeneration: {
            acceleratesGrowthAndRepair: true,
            carcinogenicRisk: true,
            canAcceleratePoisonsAndPathologicalProcesses: true,
            diseaseIsNotAutomaticallyDamage: true,
          },
        },
      },
      {
        id: "setting.entity.awakened-society",
        kind: "institution-model",
        name: "Awakened Society",
        summary:
          "Existing modern class, law, media, and public institutions persist while adapting unevenly to supernatural power.",
        data: {
          publicOpinion: "fragmented-and-event-driven",
          reputationScale: "often-local-before-national",
          existingClassStructuresPersist: true,
          progressionCanCompoundEconomicAdvantage: true,
          lawRegulatesActivitiesRatherThanAwakenedExistence: true,
          universalAwakenedRegistration: false,
          ordinaryPolicingBroadlyFunctionalEarly: true,
          enforcementAdaptations: [
            "magical-equipment",
            "awakened-officers",
            "specialized-tactical-teams",
            "mutual-aid",
            "public-response-cooperation",
            "contracted-assistance",
          ],
          longTermTension:
            "legal-authority-may-outgrow-practically-enforceable-authority",
        },
      },
      {
        id: "setting.entity.supernatural-insurance",
        kind: "institution-model",
        name: "Supernatural Insurance and Liability",
        summary:
          "Ordinary insurance and liability systems adapt to monster damage, responder collateral damage, and local response capacity.",
        data: {
          monsterDamageInsurable: true,
          localResponseCapacityAffectsRisk: true,
          publicRespondersGovernmentCovered: true,
          firmsCarryOrganizationalLiability: true,
          independentsGenerallyNeedProfessionalLiability: true,
          catastrophicGovernmentBackstopsExist: true,
        },
      },
    ],
    facts: [
      {
        id: "setting.fact.awakening-recent",
        subjectId: "setting.entity.awakening-earth",
        predicate: "awakening.age",
        value: "few-months",
        visibility: "public",
        tags: ["awakening", "public-knowledge"],
      },
      {
        id: "setting.fact.awakening-planet-wide",
        subjectId: "setting.entity.awakening-earth",
        predicate: "awakening.scope",
        value: "planet-wide",
        visibility: "public",
        tags: ["awakening", "public-knowledge"],
      },
      {
        id: "setting.fact.awakening-seed-hidden",
        subjectId: "setting.entity.awakening-earth",
        predicate: "awakening.true-cause",
        value: {
          cause: "extraterrestrial-magical-seed",
          depositedIn: "Pacific-Ocean",
          destination: "planetary-core",
          deliberate: true,
        },
        visibility: "hidden",
        tags: ["awakening", "secret", "extraterrestrial"],
      },
      {
        id: "setting.fact.awakening-purpose-hidden",
        subjectId: "setting.entity.awakening-earth",
        predicate: "awakening.external-purpose",
        value:
          "Established magical civilizations use newly awakened worlds as dangerous growth environments while presenting the practice as altruistic uplift.",
        visibility: "hidden",
        tags: ["awakening", "secret", "extraterrestrial"],
      },
      {
        id: "setting.fact.magic-public",
        subjectId: "setting.entity.magic",
        predicate: "magic.observable-reality",
        value: true,
        visibility: "public",
        tags: ["magic", "public-knowledge"],
      },
      {
        id: "setting.fact.magic-fundamental-hidden",
        subjectId: "setting.entity.magic",
        predicate: "magic.fundamental-reality",
        value: true,
        visibility: "hidden",
        tags: ["magic", "secret"],
      },
      {
        id: "setting.fact.gates-public",
        subjectId: "setting.entity.gates",
        predicate: "gates.observable-reality",
        value: true,
        visibility: "public",
        tags: ["gates", "public-knowledge"],
      },
      {
        id: "setting.fact.gates-origin",
        subjectId: "setting.entity.gates",
        predicate: "gates.origin",
        value: "ambient-magic-self-organizes-around-movement-and-change",
        visibility: "hidden",
        tags: ["gates", "magic", "canonical-truth"],
      },
      {
        id: "setting.fact.gates-pocket-environments",
        subjectId: "setting.entity.gates",
        predicate: "gates.typical-structure",
        value: "temporary-magic-shaped-pocket-environment",
        visibility: "public",
        tags: ["gates", "public-knowledge"],
      },
      {
        id: "setting.fact.gates-not-exclusive-monster-origin",
        subjectId: "setting.entity.gates",
        predicate: "gates.monster-origin-exclusivity",
        value: false,
        visibility: "public",
        tags: ["gates", "monsters", "public-knowledge"],
      },
      {
        id: "setting.fact.human-powers-individualized",
        subjectId: "setting.entity.awakened-humans",
        predicate: "human-powers.pattern",
        value: "highly-individualized",
        visibility: "public",
        tags: ["awakening", "powers", "public-knowledge"],
      },
      {
        id: "setting.fact.human-powers-anomalous-hidden",
        subjectId: "setting.entity.awakened-humans",
        predicate: "human-powers.galactic-comparison",
        value:
          "unusually-individualized-compared-with-known-intelligent-species",
        visibility: "hidden",
        tags: ["powers", "secret", "extraterrestrial"],
      },
      {
        id: "setting.fact.monsters-transformed-life",
        subjectId: "setting.entity.monsters",
        predicate: "monsters.origin",
        value: "transformed-terrestrial-life",
        visibility: "public",
        tags: ["monsters", "public-knowledge"],
      },
      {
        id: "setting.fact.monsters-spontaneous",
        subjectId: "setting.entity.monsters",
        predicate: "monsters.additional-origin",
        value: "spontaneous-magical-generation",
        visibility: "public",
        tags: ["monsters", "public-knowledge"],
      },
      {
        id: "setting.fact.monsters-grow-over-time",
        subjectId: "setting.entity.monsters",
        predicate: "monsters.survival-growth",
        value: true,
        visibility: "public",
        tags: ["monsters", "public-knowledge", "world-pressure"],
      },
      {
        id: "setting.fact.magical-resistance",
        subjectId: "setting.entity.magic",
        predicate: "magic.interaction-rule",
        value: "magic-resists-mundane-and-magic-interacts-with-magic",
        visibility: "public",
        tags: ["magic", "mechanical-mapping", "public-knowledge"],
      },
      {
        id: "setting.fact.wielded-object-empowerment",
        subjectId: "setting.entity.awakened-humans",
        predicate: "magic.direct-empowerment",
        value:
          "awakened-people-can-extend-magical-interaction-through-directly-wielded-objects",
        visibility: "public",
        tags: ["magic", "mechanical-mapping", "public-knowledge"],
      },
      {
        id: "setting.fact.ranged-empowerment-dissipates",
        subjectId: "setting.entity.awakened-humans",
        predicate: "magic.projectile-empowerment",
        value:
          "ambient-reinforcement-normally-dissipates-after-a-mundane-projectile-leaves-the-awakened-persons-proximity",
        visibility: "public",
        tags: ["magic", "mechanical-mapping", "public-knowledge"],
      },
      {
        id: "setting.fact.monsters-disintegrate-to-loot",
        subjectId: "setting.entity.monsters",
        predicate: "monsters.death-resolution",
        value: "disintegrate-and-normally-manifest-loot",
        visibility: "public",
        tags: ["monsters", "loot", "public-knowledge"],
      },
      {
        id: "setting.fact.preservation-prevents-loot",
        subjectId: "setting.entity.monster-loot",
        predicate: "loot.preservation-tradeoff",
        value: true,
        visibility: "public",
        tags: ["monsters", "loot", "research", "public-knowledge"],
      },
      {
        id: "setting.fact.response-ecology",
        subjectId: "setting.entity.monster-response",
        predicate: "response.default-ecology",
        value: {
          weak: "public",
          medium: "independent-small-team",
          major: "large-private-firm",
        },
        visibility: "public",
        tags: ["institutions", "response", "public-knowledge"],
      },
      {
        id: "setting.fact.license-colors",
        subjectId: "setting.entity.responder-licensing",
        predicate: "licensing.color-bands",
        value: [
          "Red",
          "Orange",
          "Yellow",
          "Green",
          "Blue",
          "Purple",
          "Pink",
          "Silver",
          "Gold",
        ],
        visibility: "public",
        tags: ["institutions", "licensing", "public-knowledge"],
      },
      {
        id: "setting.fact.monster-kills-can-awaken",
        subjectId: "setting.entity.awakened-humans",
        predicate: "awakening.monster-kill-participation",
        value: "can-contribute-to-awakening-and-progression",
        visibility: "public",
        tags: ["awakening", "progression", "public-knowledge"],
      },
      {
        id: "setting.fact.threshold-growth-broad",
        subjectId: "setting.entity.awakened-humans",
        predicate: "progression.threshold-growth",
        value: ["body", "mind", "powers"],
        visibility: "public",
        tags: ["awakening", "progression", "public-knowledge"],
      },
      {
        id: "setting.fact.no-universal-awakened-registration",
        subjectId: "setting.entity.awakened-society",
        predicate: "law.universal-awakened-registration",
        value: false,
        visibility: "public",
        tags: ["institutions", "law", "public-knowledge"],
      },
      {
        id: "setting.fact.reputation-local",
        subjectId: "setting.entity.awakened-society",
        predicate: "reputation.default-scale",
        value: "local-and-event-driven",
        visibility: "public",
        tags: ["institutions", "media", "reputation", "public-knowledge"],
      },
      {
        id: "setting.fact.progression-compounds-inequality",
        subjectId: "setting.entity.awakened-society",
        predicate: "economy.progression-feedback",
        value:
          "success-can-compound-through-progression-loot-equipment-training-and-access-to-harder-threats",
        visibility: "public",
        tags: ["institutions", "economy", "progression", "public-knowledge"],
      },
      {
        id: "setting.fact.regeneration-risks",
        subjectId: "setting.entity.magical-medicine",
        predicate: "medicine.regeneration-risks",
        value: [
          "increased-carcinogenic-risk",
          "accelerated-poisons-and-pathological-processes",
        ],
        visibility: "public",
        tags: ["medicine", "public-knowledge"],
      },
      {
        id: "setting.fact.ordinary-life-continues",
        subjectId: "setting.entity.awakening-earth",
        predicate: "society.ordinary-life-continues",
        value: true,
        visibility: "public",
        tags: ["society", "public-knowledge"],
      },
    ],
    events: [],
    documents: [
      {
        id: "setting.document.public-awakening-primer",
        metadata: {
          title: "Public Primer: Monsters, Magic, and Emergency Response",
          kind: "public-guidance",
          authors: ["Public safety agencies"],
          tags: ["awakening", "monsters", "safety"],
          relatedEntityIds: [
            "setting.entity.awakening-earth",
            "setting.entity.monsters",
            "setting.entity.gates",
            "setting.entity.monster-response",
          ],
          visibility: "public",
        },
        summary:
          "Practical public guidance reflecting what people can reasonably know a few months after the Awakening.",
        sections: [
          {
            id: "setting.document-section.what-is-known",
            title: "What is known",
            summary:
              "Magic is real, human powers vary widely, monsters have multiple observed origins, and Gates can form as spatial anomalies.",
            content:
              "The Awakening affected the whole planet. Some ordinary organisms transform into magical creatures, other monsters appear without an obvious mundane precursor, awakened humans develop highly varied powers, and Gates can open into temporary magic-shaped pocket environments. No accepted explanation exists for why the Awakening happened.",
          },
          {
            id: "setting.document-section.monster-danger",
            title: "Why monsters are dangerous",
            summary:
              "Monsters resist ordinary harm, can grow more dangerous over time, and normally disintegrate into magical loot when killed.",
            content:
              "Magical creatures resist nonmagical force far better than ordinary organisms do. Awakened people and magical effects can interact with them much more effectively. Surviving monsters may become more dangerous over time, so reporting them promptly matters.",
          },
          {
            id: "setting.document-section.gates",
            title: "Gates",
            summary:
              "Stable Gates are traversable magical spatial anomalies that may contain concentrated hazards and resources.",
            content:
              "A stable Gate can open into a temporary pocket environment with unusually concentrated magical activity. Monsters, materials, and strange environmental conditions may exist inside, but not every monster originates from a Gate. Civilians should report a newly discovered Gate and avoid entering an unsecured one.",
          },
          {
            id: "setting.document-section.civilian-response",
            title: "Civilian response",
            summary:
              "Civilians should withdraw, call public emergency services, and let dispatch coordinate the response.",
            content:
              "Do not assume an awakened bystander is a trained responder. Move away from immediate danger, contact public emergency services, report what you observed, and follow evacuation or perimeter instructions.",
          },
        ],
      },
    ],
    beliefs: [],
  },
};
