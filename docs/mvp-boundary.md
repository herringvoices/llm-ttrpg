# MVP Boundary

## MVP goal

Prove that the engine can support a persistent, coherent, local RPG where natural-language actions interact with an authoritative simulation.

The first milestone succeeds when a player can enter a small world, act freely, affect it, converse with an NPC, leave, return later, and observe plausible changes that occurred while they were away.

## In scope

- Text-first player interface
- One deliberately small playable area
- Freeform natural-language player actions
- Action pressure and executable action scope
- Checks, uncertainty, and deterministic resolution
- Fictional time advancement
- Persistent world state in SQLite
- World event / causality history
- Hierarchical tool discovery
- Context assembly and perspective-aware retrieval
- NPC state, knowledge, goals, relationships, and conversation
- Lazy off-screen simulation / catch-up
- Local LLM integration
- Save/load
- Simulation and diagnostic test harness

## Explicitly deferred

- Pixel-world exploration
- Animated movement/travel
- Character portraits
- Location backgrounds
- Generated scene illustrations
- Large worlds
- Large NPC populations
- Deep graphical inventory/equipment interfaces
- Highly detailed economy or ecology everywhere
- Continuous simulation of the whole world

These are not rejected ideas. They are deferred until the engine proves the core premise.

## Scope philosophy

Simulate what can produce stories or meaningful constraints. Abstract details that cannot.

The initial world should be intentionally small enough that we can understand why something happened when the simulation behaves unexpectedly.
