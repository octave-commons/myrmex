# myrmex

**Myrmex** is an ACO-guided web graph orchestrator that uses `@workspace/graph-weaver-aco` as the traversal brain and a ShuvCrawl-backed fetch backend for richer extraction.

## What it does

- seeds and runs a long-lived graph crawl
- routes page/error/checkpoint events
- stores graph nodes and edges
- supports checkpointing and restore hooks
- exposes a small CLI/runtime entrypoint

## Status

Prototype package extracted from the devel workspace.
