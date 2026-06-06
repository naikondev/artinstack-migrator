# @artinstack/migrator

Stateless content normalizer and migration framework for transforming **WordPress**, **SmugMug**, **Squarespace**, and similar sources into a platform-agnostic schema.

Parsers, normalizer DTOs, and transformers live in this repo. Job orchestration, authentication, storage, and UI are implemented by the **host application** via the `MigrationSink` interface.

## Architecture

See [docs/architecture.md](./docs/architecture.md) for the full blueprint: data flow, DTOs, sink contract, source mappings, streaming media, and phased roadmap.

```
src/
  parsers/          WordPress WXR, SmugMug, Squarespace → normalizer DTOs
  transformers/     HtmlToGrapes (Phase 2+), css-to-styles
  normalizer/       Canonical DTOs + portable idempotency types
  sinks/            MigrationSink interface + runMigration loop
  cli/              artinstack-migrate — validate & enumerate (dry-run)
```

## Install

```bash
pnpm install
pnpm build
```

Requires **Node.js 20+**.

## CLI

```bash
pnpm build
pnpm migrate validate wordpress ./export.xml
pnpm migrate enumerate wordpress ./export.xml --dry-run
```

## Development

```bash
pnpm typecheck
pnpm test
pnpm dev          # watch build
```

## What lives here vs the host

| Piece | `@artinstack/migrator` | Host application |
|-------|------------------------|------------------|
| WordPress / SmugMug / Squarespace parsers | Yes | No |
| HtmlToGrapes transformers | Yes | No |
| Normalizer DTOs + CLI dry-run | Yes | No |
| `MigrationSink` interface | Yes (types only) | Implementation |
| Job queue, worker, credentials, UI | No | Yes |

During early development you can `pnpm link` this package into a host app before publishing to npm.

## License

MIT — see [LICENSE](./LICENSE).
