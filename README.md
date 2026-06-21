# @artinstack/migrator

Stateless content normalizer and migration framework for transforming **WordPress**, **SmugMug**, **Squarespace**, **Wix**, and similar sources into a platform-agnostic schema.

Portable parsers and JSON export are useful without any specific host. Job orchestration, credentials, and UI are implemented separately via `MigrationSink`.

See [docs/architecture.md](./docs/architecture.md) for the high-level blueprint: data flow, DTOs, sink contract, and source mappings.

## Package layout

```
src/
  parsers/          WordPress, SmugMug, Squarespace, Wix → normalizer DTOs
    wordpress/      WXR parse, builder flattening (theme registry)
  normalizer/       Canonical DTOs + portable idempotency types
  sinks/            filesystem export, MigrationSink interface
  cli/              artinstack-migrate
  transformers/     HtmlToGrapes, css-to-styles, inline image rewrite, media ref expand
  lib/              media-urls, utility (shared helpers)
  test/             unit tests (mirrors src/ layout; vitest only)
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

## Supported input formats

The `@artinstack/migrator` is a pure **content schema and layout migrator**, not a full-site systems restoration tool.

### Unsupported formats

These files contain runtime theme binaries, core PHP files, and raw database dumps. They **cannot** be fed directly into the migrator:

- **All-in-One WP Migration** (`.wpress`)
- **Duplicator / UpdraftPlus** backups (`.zip`, `.tar.gz`)

### Supported formats (by platform)

| Platform | Accepted input |
|----------|----------------|
| **WordPress** | **WXR (XML)** — Tools → Export in wp-admin |
| **Wix** | Blog RSS/Atom, REST export, static HTML snapshots |
| **Squarespace** | json-pretty export |
| **SmugMug** | API crawl or export JSON |

### Recommended workflow (`.wpress` → WXR)

If your client or source site only provided an All-in-One WP Migration (`.wpress`) file:

1. **Restore** — Spin up a temporary local WordPress instance (e.g. LocalWP) and restore the `.wpress` file.
2. **Export** — Inside the restored WP dashboard, go to **Tools → Export**, select **All content** (or specific pages/posts), and download the **WXR (XML)** file.
3. **Migrate** — Feed the resulting WXR file into `artinstack-migrate wordpress …`.

See [architecture.md § Supported input formats](./docs/architecture.md#supported-input-formats) for the full `.wpress` assessment.

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
| `--rewrite-gateway <url>` | WordPress: legacy API-gateway base (use with `--rewrite-public`) |
| `--rewrite-public <url>` | WordPress: public origin for `/wp-content/` asset paths |
| `--sink filesystem` | Run through `MigrationSink` before writing (requires `--out`) |
| `--urls <file>` | Wix only: URL list or `sitemap.xml` for static page snapshots |

**Examples:**

```bash
# Export normalized JSON
artinstack-migrate wordpress export.xml --out ./output

# Preview conflicts without writing content
artinstack-migrate wordpress export.xml --dry-run --report ./preview/

# WordPress: rewrite legacy gateway URLs before dry-run / export (e.g. API Gateway → public CDN)
artinstack-migrate wordpress export.xml \
  --rewrite-gateway "https://gateway.example/prod" \
  --rewrite-public "https://www.example.com" \
  --dry-run --report ./preview/

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

## Migration media refs

WordPress `contentHtml` is stamped with `artinstack-migration://asset/…` refs by default (not CDN URLs). Rationale, ref format, and OSS/host split: [docs/architecture.md § Migration media refs](./docs/architecture.md#migration-media-refs).

**Host — expand refs before persist** (`htmlToGrapes`, hero promotion, sink write):

```ts
import {
  expandMigrationMediaRefs,
  formatMigrationMediaRef,
  isMigrationMediaRef,
  parseMigrationMediaRef,
  rewriteInlineImages,
  stampMigrationMediaRefs,
} from "@artinstack/migrator";

const { html, unresolved } = expandMigrationMediaRefs(contentHtml, (sourceId) =>
  lookupPublicUrl(sourceId), // migration_entities → CDN
);
```

**CLI / JSON export:** use `--rewrite-gateway` + `--rewrite-public` so gateway uploads normalize before refs are stamped. Unresolved upload URLs stay in HTML and appear in `conflicts.json` as `unresolvedInlineImages`.

**Tests:** `fixtures/wordpress/pages-export.test.ts` (naikonpixels pages WXR).

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
| WordPress builder flattening + origin URL rewrite (pre-DTO) | Yes | Optional same config on adapter input |
| Stamp `artinstack-migration://asset/…` refs in content HTML | Yes | No |
| Expand refs → CDN URLs at persist | Exported helper | Call site + DB lookup |
| Page `layoutHints` (e.g. theme hero slider alias) | Yes — on `NormalizedPage` when meta references chrome outside body | Rebuild slider / hero at import |
| CLI + filesystem JSON export | Yes | No |
| `MigrationSink` interface | Yes | Implementation |
| Map `data-wp-widget` stubs → platform blocks; populate slider heroes from hints | No | Yes |
| Jobs, worker, credentials, UI | No | Yes |

## License

MIT — see [LICENSE](./LICENSE).
