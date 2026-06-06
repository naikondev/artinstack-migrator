# @artinstack/migrator

Stateless content normalizer and migration framework for transforming **WordPress**, **SmugMug**, **Squarespace**, and similar sources into a platform-agnostic schema.

**Public from day one.** Portable parsers and JSON export are useful without any specific host. Job orchestration, credentials, and UI are implemented separately via `MigrationSink`.

See [docs/architecture.md](./docs/architecture.md) for the high-level blueprint: data flow, DTOs, sink contract, and source mappings.

## Package layout

```
src/
  parsers/          WordPress, SmugMug, Squarespace → normalizer DTOs
  normalizer/       Canonical DTOs + portable idempotency types
  sinks/            filesystem export, MigrationSink interface
  cli/              artinstack-migrate
  transformers/     HtmlToGrapes (later)
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

# Export normalized DTOs to a directory
artinstack-migrate wordpress export.xml --out ./output

# Validate before running
artinstack-migrate validate wordpress ./export.xml
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
| Parsers + normalizer DTOs | Yes | No |
| CLI + filesystem JSON export | Yes | No |
| `MigrationSink` interface | Yes | Implementation |
| Jobs, worker, credentials, UI | No | Yes |

## License

MIT — see [LICENSE](./LICENSE).
