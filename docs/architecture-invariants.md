# Architecture Invariants

These are project-level constraints. Implementation should work within them unless we explicitly decide to revise the architecture.

## Authority

- The simulation and database are authoritative.
- The LLM never directly rewrites canonical world state.
- The LLM may interpret intent, choose relevant operations/checks, reason about NPC intentions, and narrate outcomes.
- State changes must pass through deterministic engine operations that can validate or reject them.

## World operations

- Expose reusable world operations rather than scenario-specific scripted actions.
- Tool access is progressively disclosed.
- The conceptual hierarchy is at least **domain → subsystem → operation**.
- These are application-level tool trees. They are **not literal MCP servers**, and there is no plan to convert them into MCP servers.

## Context and knowledge

- The LLM should receive a small always-present rules/context layer plus selectively retrieved information.
- It should not receive the entire world database.
- NPC ignorance and player ignorance should be enforced by available context, not merely requested in a prompt.
- Relevant memories, facts, world events, and operations should be retrieved based on the current situation and perspective.

## Time

- Time is fictional game time, not wall-clock time.
- The world does not continuously tick every simulated object.
- Off-screen systems sleep and catch up when they become relevant.
- Meaningful events form a causal history that can drive later catch-up and retrieval.

## Action scope

- Do not divide play into a simple combat / non-combat binary.
- Use **action pressure** to constrain how much fictional time and action scope the player may describe at once.
- Low pressure permits broad intentions over long spans.
- High pressure permits only very short, immediate actions.

## Presentation

- The first version is text-first.
- Graphics are presentation only and never authoritative state.
- Portraits, backgrounds, maps, and generated scene art can be layered on later without changing the simulation model.

## Development

- Work should be organized into coherent Codex-sized capability slices, not tiny human-sized tickets.
- Each slice should have observable acceptance scenarios and clear boundaries.
- Prefer a working vertical slice over premature breadth.
