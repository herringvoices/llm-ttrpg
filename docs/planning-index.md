# Planning Index

This file records the current GitHub Project placement for the seeded issues.

## Project Reference

- #1 — Project North Star
- #2 — Architecture Invariants
- #3 — MVP Boundary
- #4 — Glossary & Core Terms

## Done

- #5 — Project Shell & Persistence Foundation
  - Labels: Core Engine, Persistence
- #6 — World State, Fictional Time & Event History
  - Labels: Core Engine, Time & World Simulation, Persistence
- #7 — Action Pressure & Executable Intent
  - Labels: Actions & Rules, Core Engine
- #8 — Checks, Resolution & RNG
  - Labels: Actions & Rules, Core Engine
- #9 — Hierarchical Tool Catalog
  - Labels: Context & Tools, Core Engine
- #10 — Context Assembly & Knowledge Retrieval
  - Labels: Context & Tools
- #11 — Player Action Execution Pipeline
  - Labels: Core Engine, Actions & Rules, Context & Tools
- #12 — Lazy World Simulation & Catch-Up
  - Labels: Time & World Simulation, Persistence
- #15 — Local LLM Runtime Adapter
  - Labels: LLM Runtime, Core Engine
- #21 — Core Game Rules & Resolution Model
  - Labels: Actions & Rules, World / Content
- #23 — Setting & World Premise
  - Labels: World / Content
- #24 — Institutions, Economy & Society
  - Labels: Time & World Simulation, World / Content
- #27 — Game Package Contracts & Content Model
  - Labels: Core Engine
- #22 — Character Progression & Abilities
  - Labels: Actions & Rules, World / Content
- #35 — Monster Design, Threat Calibration & Encounter Composition
  - Labels: Actions & Rules, World / Content, Dev Tools / Testing
  - Design complete; runtime obligations are carried by #16, #17, #18, #19, #26, and #34
- #13 — NPC State, Knowledge, Goals & Relationships
  - Labels: NPCs & Social, Time & World Simulation
- #17 — Starting Region Generation & Local World Seeding
  - Labels: World / Content, Player UX
- #25 — Player Fantasy & Starting Situation
  - Labels: World / Content, Player UX
- #34 — Character & Creature Mechanical Generation
  - Labels: Actions & Rules, NPCs & Social, World / Content
- #26 — Content & Encounter Principles
  - Labels: NPCs & Social, World / Content
- #18 — Reference Game Rules & World Model Integration
  - Labels: Core Engine, Actions & Rules, World / Content
- #14 — NPC Interaction & Conversation
  - Labels: NPCs & Social, Context & Tools
- #16 — Simulation & Test Harness
  - Labels: Dev Tools / Testing, Core Engine
- #28 — Campaign Planning & Narrative Direction
  - Labels: Core Engine, Context & Tools, World / Content
- #19 — First End-to-End Playable Loop
  - Labels: Core Engine, Player UX, Dev Tools / Testing
- #37 — Reduce model orchestration responsibility in player-action execution
  - Labels: Core Engine, Actions & Rules, Context & Tools
- #39 — Narration & Presentation System
  - Labels: Player UX, Core Engine

## Verify / Playtest

- #38 — Upgrade bundled local model and establish hardware-aware model tiers
  - Installer/runtime compatibility is verified; comparative quality and representative 16 GB playtesting remain

## Ready for Dev

- #40 — Structured Initial Character Questionnaire
- #41 — Delete Saved Campaigns from the Landing Screen
- #42 — Render the Play Transcript as Chat-Style Bubbles
- #43 — Show Submitted Messages Immediately and Surface Real Turn Progress

## Icebox

- #20 — Graphics & Presentation Layer
  - Suggested labels: Later / Graphics, Player UX

## Status workflow

Move capability issues through:

**Needs Design → Ready for Dev → In Progress → Verify / Playtest → Done**

Use **Blocked** as a label rather than a status column.

## Suggested subsystem labels

- Core Engine
- Time & World Simulation
- Actions & Rules
- Context & Tools
- NPCs & Social
- LLM Runtime
- Persistence
- World / Content
- Player UX
- Dev Tools / Testing
- Later / Graphics
- Blocked

GitHub issue labels and GitHub Project status fields are intentionally separate: status represents workflow; labels represent the subsystem(s) a capability touches.
