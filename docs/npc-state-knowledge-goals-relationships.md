# NPC State, Knowledge, Goals & Relationships

**Status:** Settled and implemented by Issue #13
**Scope:** Durable actor social/intentional state, knowledge boundaries, memories, relationships, goals, commitments, perspective retrieval, and lazy-simulation integration.

## Implemented seam

The engine now validates durable per-actor goals, directed relationships, episodic memories, and commitments as authoritative social state separate from rules mechanics. Beliefs support multi-source provenance, catalog retrieval enforces actor perspective, targeted mutations participate in the ordinary atomic runtime path, and checkpoints preserve the state through SQLite save/reopen. Generated-region integration coverage exercises two distinct NPC perspectives without introducing actor-specific simulation scopes or continuously running models.

## Purpose

Issue #13 defines the durable state that lets the same NPC remain the same person across conversations, time jumps, save/reload, and off-screen simulation without requiring a continuously running LLM agent.

This design deliberately separates:

- **identity and fictional truth** from social/intentional state;
- **knowledge/belief** from objective truth;
- **NPC social persistence** from ruleset mechanics;
- **actor state** from campaign planning;
- **world/social resolution** from mechanical realization.

Character-sheet and monster mechanical generation are owned by Issue #34, not this issue.

## Ownership

### Engine

The engine owns generic, game-agnostic contracts for:

- durable actor social state;
- actor/group belief boundaries;
- directed relationships;
- durable goals;
- episodic memories;
- commitments/availability windows;
- perspective-aware retrieval;
- validated mutations;
- persistence/checkpoint integration;
- lazy-simulation participation.

### Ruleset

The active ruleset owns mechanically meaningful character state such as Attributes, Skills, stress, statuses, progression, Powers, Mana, or analogous mechanics.

### Setting and campaign

The setting/campaign own actual people, cultures, biographies, institutions, relationships, goals, schedules, knowledge, and starting circumstances.

### Setting adapter

The adapter binds setting-specific traits or species to selected rules mechanics where required.

### Campaign planning

Issue #28 may consume NPC goals, relationships, beliefs, memories, and status as planning inputs. A plan never becomes an NPC's canonical goal, belief, memory, or action merely because the planner proposed it.

## Persistent actor boundary

Issue #17 owns the world/population resolution ladder:

1. statistical population;
2. ephemeral scene person;
3. identified person;
4. persistent simulation actor.

A **persistent simulation actor** is an identified entity whose individual social/intentional state now matters enough to persist and participate in later simulation.

Promotion to persistent actor state may be justified by:

- repeated player interaction;
- an ongoing relationship;
- a recurring institutional role;
- a durable goal;
- relevant specialized knowledge;
- an obligation/conflict;
- participation in a pressure or process;
- responsibility for mutable world state;
- repeated-interaction potential.

Promotion adds specificity but may not contradict prior authoritative observations.

Persistent social state does **not** imply a complete character sheet. Mechanical realization is a separate axis owned by #34.

## Actor social state

Represent durable social/intentional state as one generic coarse record per persistent actor, keyed by the actor entity ID.

The canonical record contains:

- goals;
- outgoing relationships;
- episodic memories;
- commitments.

Identity, biography, current location, inventory/resources, and other world facts remain ordinary entity/fact/campaign data rather than being copied into the social-state record.

Ruleset mechanics remain outside this record.

### Goals

A goal is a durable actor intention, not a plot instruction.

A goal records:

- stable ID;
- concise description;
- priority from 0 through 1;
- status: `active`, `blocked`, `satisfied`, or `abandoned`;
- related entity IDs;
- optional source event IDs;
- created fictional instant;
- optional last-updated fictional instant.

Examples:

- protect Ashton Ridge;
- keep this job until the lease renewal;
- repair the relationship with a sibling;
- learn what caused the hospital incident.

Non-example:

- betray the player during Act III.

That is a possible campaign-plan development, not present canonical intent.

### Relationships

Relationships are **directed**.

Alice's relationship toward Bob is not required to equal Bob's relationship toward Alice.

A relationship records:

- stable ID;
- target entity ID;
- open-ended numeric dimensions keyed by stable IDs, each in the range -1 through 1;
- salience from 0 through 1;
- tags;
- optional source event IDs;
- last-updated fictional instant.

The engine validates the generic structure but does not assign universal semantics to dimension IDs.

A game may use dimensions such as:

- trust;
- affinity;
- respect;
- fear;
- resentment;
- obligation.

A relationship is not reduced to one universal friendship score.

Mechanically meaningful consequences of relationship state remain ruleset/adapter operations.

### Episodic memories

A memory is a durable recollection that is worth retaining because it may affect later behavior or conversation.

A memory records:

- stable ID;
- concise summary;
- formed-at fictional instant;
- optional occurred-at fictional instant;
- salience from 0 through 1;
- related entity IDs;
- source event IDs when available;
- tags.

Memories are **not transcripts** and are not the canonical truth system.

A memory can say:

> Bob remembers that the player stayed with him during the evacuation.

Whether Bob's interpretation of why the player did so is true belongs in beliefs, not in the memory record.

Conversation transcript retention/extraction belongs to #14.

### Commitments and availability

A commitment represents a concrete time-bounded obligation or intended activity that can matter to availability and lazy simulation.

A commitment records:

- stable ID;
- label/summary;
- start fictional instant;
- end fictional instant;
- availability impact: `available`, `occupied`, or `unavailable`;
- related entity/location IDs;
- optional source event IDs;
- tags.

The generic engine stores absolute fictional intervals.

Recurring schedules are **not** encoded through a universal Gregorian recurrence language. A setting/campaign process may materialize future commitments according to its own calendar/routine semantics.

Current location, physical condition, rules statuses, and other canonical circumstance are retrieved from ordinary world state rather than duplicated as an NPC-status blob.

## Knowledge and beliefs

Do not create a second NPC knowledge database.

Issue #10 already establishes:

- canonical facts;
- actor/group beliefs;
- perspective-aware retrieval;
- hidden truth-status from actor-facing context;
- explicit role/perspective boundaries.

Issue #13 builds on those contracts.

### Public fact semantics

A `public` canonical fact means **generally/commonly perspective-safe knowledge**, not merely "the fact is not classified."

If one NPC witnesses something another NPC did not, the observation should normally create/update that NPC's belief rather than turning the underlying fact public to everyone.

### Belief provenance

Extend belief provenance beyond the current single optional fact link.

A belief may cite one or more sources such as:

- canonical fact;
- canonical event;
- actor/group testimony;
- document;
- memory.

The engine may retain a private truth assessment for validation/diagnostics, but actor-facing retrieval continues to omit it.

A rumor is therefore normally a belief with social provenance and an appropriate confidence, not another special knowledge-state type.

### Knowledge change

Learning, disclosure, deception, observation, investigation, and communication may create/update beliefs only through normal validated operations/events.

Conversation prose is not by itself durable knowledge.

## Retrieval and perspective

Actor-facing context may receive:

- the focal actor's own goals;
- their outgoing relationships relevant to the current situation;
- relevant memories;
- current commitments/availability;
- their own/group beliefs;
- common/public facts permitted by the existing knowledge contract.

Actor context must not expose another actor's private goals, memories, relationship dimensions, or beliefs merely because the model knows the other entity exists.

Privileged orchestrator/planner/debug roles may receive separately authorized projections.

Retrieval should remain bounded and relevance-driven rather than dumping the full life history on every turn.

## State mutation

Actor social state is authoritative World State.

Mutations happen through validated engine/runtime boundaries, not direct LLM writes.

The implementation should support targeted mutations such as:

- upsert/update/retire goal;
- upsert relationship dimensions/salience;
- add/update memory;
- add/update/cancel commitment;
- belief-source/provenance changes through the existing belief mutation path.

Meaningful social changes may also emit canonical events when they can durably matter to future causality, planning, history, or narration.

Not every numeric relationship adjustment requires its own event.

## Persistence

Persist actor social state as one coarse generic record per actor rather than creating separate SQL schemas for every future relationship or goal mechanic.

A practical persistence shape is:

- `actor_social_states` keyed by world + actor entity ID;
- validated JSON payload for goals/relationships/memories/commitments.

The exact SQL name is implementation detail; the architectural requirement is that:

- the engine exposes no SQL concepts;
- state is included in current World State;
- checkpoint/save/reload preserves it exactly;
- atomic operation/catch-up commits include actor-state changes with their associated events.

## Lazy simulation

Do **not** create one simulation scope per NPC by default.

Issue #12 already establishes that scopes are simulation boundaries, not entities.

Most NPC state should catch up through the locality, household, institution, faction, or other scope/process that already explains the elapsed behavior.

Examples:

- a work-shift process advances commitments for several employees;
- a relationship/obligation process may cool a relationship after repeated missed commitments;
- an institution process changes an NPC's role/status through an ordinary event;
- a household process may update availability across elapsed time.

Only unusually important package behavior should justify an individual actor scope.

Actor-state catch-up uses deterministic/stochastic package world processes. It does not continuously call an LLM for every NPC.

## LLM-assisted reflection

Continuous autonomous NPC agents are out of scope.

Issue #13 does not require a real model-reflection pass.

Model-assisted reflection may later be used selectively when an important actor needs a structured interpretation of several meaningful developments that cannot be represented by an obvious deterministic update.

Any such reflection must:

- receive bounded perspective-safe state;
- produce validated proposals only;
- commit through normal actor-state/belief operations;
- never become a freeform personality rewrite.

Conversation-driven memory extraction and NPC intent/prose belong primarily to #14.

## Mechanical-generation boundary

An NPC's durable social state and their rules character sheet are independent.

Examples:

- a recurring bartender can have memories, goals, beliefs, commitments, and a relationship with the player while having only constrained mechanical information;
- a nameless attacker may need partial combat mechanics without becoming a persistent social actor.

Issue #34 owns:

- unrealized/constrained/partial/complete mechanical realization;
- human/NPC character-sheet generation;
- monster/creature mechanical generation;
- demand-driven mechanical densification;
- mechanics-inspection abilities that force fuller realization;
- no-retcon generation of missing rules data.

Issue #13 must not generate Attributes, Skills, Powers, monster stats, or other rules-owned mechanics merely because social actor state is created.

## Acceptance Criteria

- persistent actor identity remains anchored to an authoritative Entity;
- actor social state persists separately from rules mechanics;
- goals have durable status/priority and can influence later reasoning;
- relationships are directed and may change through validated events/operations;
- episodic memories persist without becoming transcripts or objective truth;
- commitments provide absolute fictional-time availability windows;
- NPC knowledge reuses actor/group beliefs rather than creating a parallel knowledge system;
- belief provenance can represent fact/event/social/document/memory sources;
- public facts are treated as common/perspective-safe knowledge, not merely "not secret";
- actor-facing retrieval cannot read another NPC's private goals/memories/relationship state;
- actor social state survives checkpoint/save/reload;
- off-screen actor state can catch up through existing generic simulation scopes without continuous model execution;
- no default one-scope-per-NPC architecture is introduced;
- social persistence does not require a complete character sheet;
- tests show two NPCs producing different retrieved state because of different beliefs, memories, goals, relationships, and commitments.

## Verification Scenario

1. Create Alice and Bob as persistent actors in the same locality.
2. Alice witnessed a hidden event; Bob did not.
3. Alice trusts the player because of one prior meaningful event; Bob is wary because of another.
4. Alice and Bob have different goals and different upcoming commitments.
5. Advance fictional time while the locality sleeps.
6. Catch up the locality through existing world-process infrastructure.
7. Commit a new relationship-changing event involving only Alice.
8. Save, close, reopen.
9. Retrieve actor-perspective state for Alice and Bob.
10. Verify:
   - their beliefs differ;
   - their memories differ;
   - their directed relationship state differs;
   - their goals/commitments differ;
   - no private state leaks between perspectives;
   - every difference is explained by persisted authoritative state/history;
   - neither actor required a continuously running model or a full mechanical character sheet.

## Non-Goals

- character-sheet or monster stat generation (#34);
- final dialogue/prose generation (#14);
- conversation transcript persistence policy (#14);
- full population simulation (#17);
- continuous autonomous LLM agents;
- fixed universal personality trait taxonomy;
- universal social-check mechanics;
- campaign plotting or forced NPC arcs (#28).
