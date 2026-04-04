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

## Runtime configuration

Primary lake path now targets OpenPlanner directly so Myrmex can write into the
same lake Knoxx already uses:

- `OPENPLANNER_BASE_URL` — default `http://localhost:7777`
- `OPENPLANNER_API_KEY` — default `change-me`

Legacy/future compatibility:

- `PROXX_BASE_URL`
- `PROXX_AUTH_TOKEN`

If `OPENPLANNER_BASE_URL` is set, Myrmex writes graph events to
`POST /v1/events`. Otherwise it falls back to the planned Proxx lake surface at
`POST /api/v1/lake/events`.

## Adjacent repos

- `octave-commons/graph-weaver-aco` — traversal brain
- `octave-commons/graph-weaver` — graph service/UI surface
