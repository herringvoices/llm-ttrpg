# Planning Index

This file records the intended initial GitHub Project placement for the seeded issues.

## Project Reference

- #1 — Project North Star
- #2 — Architecture Invariants
- #3 — MVP Boundary
- #4 — Glossary & Core Terms

## Needs Design

| Issue | Capability | Suggested subsystem labels |
| --- | --- | --- |
| #5 | Project Shell & Persistence Foundation | Core Engine, Persistence |
| #6 | World State, Fictional Time & Event History | Core Engine, Time & World Simulation, Persistence |
| #7 | Action Pressure & Executable Intent | Actions & Rules, Core Engine |
| #8 | Checks, Resolution & RNG | Actions & Rules, Core Engine |
| #9 | Hierarchical Tool Catalog | Context & Tools, Core Engine |
| #10 | Context Assembly & Knowledge Retrieval | Context & Tools |
| #11 | Player Action Execution Pipeline | Core Engine, Actions & Rules, Context & Tools |
| #12 | Lazy World Simulation & Catch-Up | Time & World Simulation, Persistence |
| #13 | NPC State, Knowledge, Goals & Relationships | NPCs & Social, Time & World Simulation |
| #14 | NPC Interaction & Conversation | NPCs & Social, Context & Tools |
| #15 | Local LLM Runtime Adapter | LLM Runtime, Core Engine |
| #16 | Simulation & Test Harness | Dev Tools / Testing, Core Engine |
| #17 | First Playable World Slice | World / Content, Player UX |
| #18 | Hunter/LitRPG Rules & World Model | World / Content, Actions & Rules |
| #19 | First End-to-End Playable Loop | Core Engine, Player UX, Dev Tools / Testing |

## Icebox

- #20 — Graphics & Presentation Layer
  - Suggested labels: Later / Graphics, Player UX

## Status workflow

Move capability issues through:

**Needs Design → Ready for Codex → In Progress → Verify / Playtest → Done**

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
