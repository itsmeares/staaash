# Documentation Index

This folder holds the stable project references for the current rewrite.

Use these docs to understand what Staaash is trying to build, which decisions are already locked in, what phase is active, and what operational guarantees the repo is trying to protect.

## Recommended Reading Order

1. [`../README.md`](../README.md) for the short project overview
2. [`architecture.md`](./architecture.md) for the system shape and storage model
3. [`decision-log.md`](./decision-log.md) for the choices that are not being re-decided casually
4. [`implementation-plan.md`](./implementation-plan.md) for the phased roadmap
5. [`phases/README.md`](./phases/README.md) for the execution index into the phase documents
6. [`operations/backup-restore.md`](./operations/backup-restore.md) for the current backup and restore baseline

## Core Docs Map

### High-level references

- [`architecture.md`](./architecture.md) explains the current system shape, storage model, and design boundaries.
- [`decision-log.md`](./decision-log.md) records the short list of product and architecture decisions that are intentionally stable.
- [`implementation-plan.md`](./implementation-plan.md) is the authoritative roadmap for the current rewrite.

### Execution docs

- [`phases/README.md`](./phases/README.md) links the numbered phase documents in execution order.
- [`operations/backup-restore.md`](./operations/backup-restore.md) describes the current backup baseline and restore expectations.

## Current Build Focus

- implemented phases: 00, 01, 02, 03, 04, 05, 06, 07, and 08
- current validation focus: Phase 08 release-quality verification, especially `pnpm web:e2e`

If you only need to understand the latest shipped scope and remaining release-quality checks, start with [`implementation-plan.md`](./implementation-plan.md) and then open [`phases/08-restore-hardening-and-release-quality.md`](./phases/08-restore-hardening-and-release-quality.md).
