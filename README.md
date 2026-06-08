# @artinstack/migrator

Stateless content normalizer and migration framework for transforming **WordPress**, **SmugMug**, **Squarespace**, **Wix**, and similar sources into a platform-agnostic schema.

Portable parsers and JSON export are useful without any specific host. Job orchestration, credentials, and UI are implemented separately via `MigrationSink`.

See [docs/architecture.md](./docs/architecture.md) for the high-level blueprint: data flow, DTOs, sink contract, and source mappings.

## Package layout

```
src/
  parsers/          WordPress, SmugMug, Squarespace, Wix → normalizer DTOs
  normalizer/       Canonical DTOs + portable idempotency types
  sinks/            filesystem export, MigrationSink interface
  cli/              artinstack-migrate
  transformers/     HtmlToGrapes, css-to-styles, rewrite-inline-images
```

## Install

**From npm:**

```bash
pnpm add @artinstack/migrator
# or: npm install @artinstack/migrator
```

The `artinstack-migrate` binary is on your PATH after install (or use `npx artinstack-migrate`).

**From source** (development):

```bash
pnpm install
pnpm build
pnpm link --global   # optional: artinstack-migrate on PATH
```

Requires **Node.js 20+**.

## CLI

```bash
artinstack-migrate <platform> <export-file> [options]
artinstack-migrate validate <platform> <export-file>
```

**Platforms:** `wordpress`, `smugmug`, `squarespace`, `wix`

**Options:**

| Flag | Description |
|------|-------------|
| `--out <dir>` | Write normalized JSON files to a directory |
| `--format json` | Print combined JSON to stdout (no files written) |
| `--dry-run` | Parse and analyze only; no export files |
| `--report <dir>` | With `--dry-run`, write `conflicts.json` and `migration-report.json` |
| `--offline` | Skip network HEAD requests for asset size estimates |
| `--sink filesystem` | Run through `MigrationSink` before writing (requires `--out`) |
| `--urls <file>` | Wix only: URL list or `sitemap.xml` for static page snapshots |

**Examples:**

```bash
# Export normalized JSON
artinstack-migrate wordpress export.xml --out ./output

# Preview conflicts without writing content
artinstack-migrate wordpress export.xml --dry-run --report ./preview/

# Validate export structure (JSON result on stdout, exit 0/1)
artinstack-migrate validate wordpress export.xml

# Wix: blog feed + static pages from a URL list
artinstack-migrate wix feed.xml --urls page-urls.txt --out ./output

# Local clone
pnpm cli wordpress export.xml --dry-run
```

### Output

**`--out ./output`** writes grouped JSON:

```
output/
  posts.json
  pages.json
  media.json
  portfolios.json
  portfolio-media.json
  categories.json
  tags.json
  conflicts.json          # when generated
  migration-report.json   # when generated
```

Each file contains an array of normalized DTOs (`NormalizedPost`, `NormalizedPage`, `NormalizedAsset`, etc.). See [docs/architecture.md](./docs/architecture.md) for schema and per-platform input formats.

**`--format json`** prints the same entities as one combined JSON object to stdout.

**`validate`** prints a validation result JSON object (`ok`, `issues`, `summary` counts) and exits `0` on success, `1` on failure.

**`--dry-run`** exits `0` (clean), `2` (warnings), or `1` (blocking conflicts).

Per-platform export file formats and API client usage are documented in [docs/architecture.md](./docs/architecture.md).

## Development

```bash
pnpm typecheck
pnpm test
pnpm test:validate-fixtures   # golden fixtures (wordpress, smugmug, squarespace, grapes, wix)
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
