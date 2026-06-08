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
  transformers/     HtmlToGrapes, css-to-styles, rewrite-inline-images
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

# Installed / linked binary
artinstack-migrate wordpress export.xml --out ./output
artinstack-migrate validate wordpress ./export.xml

# Local clone — no global install
pnpm cli wordpress export.xml --dry-run
node dist/cli/index.js wordpress export.xml --dry-run
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
