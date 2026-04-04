# myrmex

**Myrmex** is an ACO-guided web graph orchestrator that uses `@workspace/graph-weaver-aco` as the traversal brain and a ShuvCrawl-backed fetch backend for richer extraction.

## Reading order

1. `docs/INDEX.md`
2. `docs/FORK_TALES_SOURCE_MAP.md`
3. `specs/orchestrator-contract.md`
4. `specs/event-and-storage-flow.md`
5. `specs/checkpoint-and-recovery.md`
6. `specs/deployment-lattice.md`

## What it does

- seeds and runs a long-lived graph crawl
- routes page/error/checkpoint events
- stores graph nodes and edges
- supports checkpointing and restore hooks
- exposes a small CLI/runtime entrypoint

## Status

Prototype package extracted from the devel workspace.

## Adjacent repos

- `octave-commons/graph-weaver-aco` — traversal brain
- `octave-commons/graph-weaver` — graph service/UI surface
