# Glossary

## Action pressure

A world-state value describing how tightly circumstances constrain the amount of action a player may describe at once.

Low pressure allows broad intentions spanning long fictional time. High pressure restricts the player to immediate actions spanning seconds or less.

The pressure level should map to a maximum elapsed-time/action-scope budget rather than acting as a combat-mode flag.

## Active scene

The currently relevant people, places, objects, constraints, and events that should be available to the action-resolution loop.

## Authoritative state

Canonical game truth owned by the deterministic simulation and persisted state, rather than invented directly by the LLM.

## Catch-up

Advancing a sleeping/off-screen system from its last simulated fictional time to the current relevant time when that system becomes relevant again.

## Context assembly

Building the LLM's working context from the small always-present rules layer plus selectively retrieved world facts, memories, events, and tools.

## Executable intent

A player intention that has been interpreted and narrowed enough to be resolved by the engine within the current action-pressure constraints.

## Meaningful event

A persisted fact about something that happened in the world and may matter to later simulation, retrieval, causality, or narration.

## Operation

A deterministic engine capability exposed to the LLM-facing orchestration layer, such as observing a location, attempting movement, modifying an object through validated rules, or querying relevant knowledge.

## Sleeping system

A region, town, building, NPC, organization, economy, or other simulation subsystem that is not continuously ticking while irrelevant.

## Tool tree

The hierarchical catalog the orchestration layer uses to discover engine capabilities progressively.

The hierarchy is at least **domain → subsystem → operation**. It is MCP-like conceptually but is local application architecture, not a set of literal MCP servers.

## World event history

The causal record of meaningful world changes. It helps catch-up systems determine what happened while they were inactive and gives context retrieval a grounded source of past events.
