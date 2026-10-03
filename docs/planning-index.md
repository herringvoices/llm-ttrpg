# Planning Index

This file records the current GitHub Project placement for the seeded issues.

## Project Reference

- #1 — Project North Star
- #2 — Architecture Invariants
- #3 — MVP Boundary
- #4 — Glossary & Core Terms

## Needs Design

| Issue | Capability | Suggested subsystem labels |
| --- | --- | --- |
| #13 | NPC State, Knowledge, Goals & Relationships | NPCs & Social, Time & World Simulation |
| #14 | NPC Interaction & Conversation | NPCs & Social, Context & Tools |
| #16 | Simulation & Test Harness | Dev Tools / Testing, Core Engine |
| #18 | Reference Game Rules & World Model Integration | Core Engine, Actions & Rules, World / Content |
| #19 | First End-to-End Playable Loop | Core Engine, Player UX, Dev Tools / Testing |
| #22 | Character Progression & Abilities | Actions & Rules, World / Content |
| #25 | Player Fantasy & Starting Situation | World / Content, Player UX |
| #26 | Content & Encounter Principles | NPCs & Social, World / Content |
| #28 | Campaign Planning & Narrative Direction | Core Engine, Context & Tools, World / Content |

## Ready for Dev

| Issue | Capability | Suggested subsystem labels |
| --- | --- | --- |
| #17 | Starting Region Generation & Local World Seeding | World / Content, Player UX |

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
