# Orchestrator Contract

## Purpose

Define `Myrmex` as a composition root rather than as a bag of ad hoc service calls.

## Core composition

`Myrmex` owns and wires:
- `ShuvCrawlClient`
- `ShuvCrawlFetchBackend`
- `GraphWeaverAco`
- `EventRouter`
- `GraphStore`
- `CheckpointManager`

## Lifecycle

### Inputs
- seed URLs
- runtime config
- backend service base URLs and tokens

### Controls
- `start()`
- `stop()`
- `pause()`
- `resume()`
- `restoreCheckpoint()`
- `stats()`
- `onEvent(cb)`

## State exposed by `stats()`
- running
- paused
- frontier size
- in-flight fetch count
- page count
- error count
- last checkpoint timestamp

## Event normalization

Upstream ACO events are normalized into `MyrmexEvent`:
- `page`
- `error`
- `checkpoint`

This keeps downstream consumers from depending on raw engine internals.

## Responsibilities

Myrmex is responsible for:
- constructing the richer fetch backend
- starting the traversal engine
- routing extracted content into Proxx/OpenPlanner surfaces
- maintaining a small runtime summary
- checkpoint scheduling

Myrmex is not responsible for:
- reinventing ACO traversal
- being the long-term lake itself
- being the graph UI

## Architectural position

This repo is the **bridge organism** between:
- a small traversal brain
- a heavy extraction mouth
- a downstream knowledge lake
