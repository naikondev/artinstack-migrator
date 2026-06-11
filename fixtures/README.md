# Migration fixtures

Sample exports and golden expected outputs for parser and transformer contract tests.

```bash
pnpm test                    # unit tests (src/test/) + fixture benchmarks
pnpm test:validate-fixtures  # fixture benchmarks only
```

## Where tests live

| Kind | Location | When to use |
|------|----------|-------------|
| **Unit tests** | `src/test/` (mirrors `src/` layout) | Logic, edge cases, mocked I/O, fast feedback |
| **Fixture benchmarks** | `fixtures/**/benchmarks.test.ts` | End-to-end contract on real or golden inputs |

**Rule of thumb:** if you are proving “this function behaves correctly on these inputs,” use `src/test/`. If you are locking a **stable input → output contract** (WXR export, HTML fragment → Grapes/Tiptap JSON), add or extend a fixture here.

Internal implementation backlog IDs (e.g. OSS-13) live in `docs/migration-assistance.md` only. Fixture `id`s, filenames, and `description` fields should name **behavior** (`wp-widget-map`, `data-layout-tree`), not issue numbers.

## Finding things

1. Open the relevant `manifest.json` — it is the index for that fixture family.
2. Grep `description` or `gates` in the manifest, or grep fixture `id` across the repo.
3. For WordPress dogfood, start with `fixtures/wordpress/pages-export.test.ts` and `posts-export.test.ts`, not the tiny HTML snippets under `grapes/`.

## Layout

| Directory | Purpose |
|-----------|---------|
| `wordpress/` | WXR benchmark exports; pages/posts export tests |
| `smugmug/` | Portfolio vault JSON + mapping matrix |
| `squarespace/` | Site export JSON + wire json-pretty samples |
| `grapes/` | Minimal HTML → golden `GrapesProjectSnapshot` for `htmlToGrapes()` |
| `tiptap/` | Minimal HTML → golden ProseMirror `doc` for `htmlToTiptap()` |
| `wix/` | RSS/Atom XML, API wire JSON, page HTML snapshots |
| `ghost/`, `blogger/` | Planned optional adapters — not yet present |

## Naming convention

Use **short, behavior-first** ids shared across html, golden, and manifest:

```
{id}.html              → html/{id}.html
{id}.snapshot.json     → golden/{id}.snapshot.json
manifest entry         → "id": "{id}"
```

Examples: `inline-text`, `data-layout-tree`, `wp-widget-map`, `hero-image`.

- **One behavior per fixture** — HTML inputs are often 1–3 lines on purpose; composite cases use ids like `editorial-page`.
- **Group by prefix when a family grows** — e.g. `wp-widget-map`, `wp-widget-contact`, `wp-widget-embed` (not separate folders until the flat list gets hard to scan).
- **`gates`** in the manifest are optional smoke checks in `scripts/validate-*-fixtures.ts` (e.g. `wp_widget`, `data_layout`); keep them stable snake_case.

## Grapes golden fixtures (`grapes/`)

Each `manifest.json` entry pairs:

- `html/<id>.html` — source HTML fragment passed to `htmlToGrapes()`
- `golden/<id>.snapshot.json` — expected output (`content`, `styles`, optional `contentHtml` / `contentCss`)
- `options` — optional `HtmlToGrapesOptions` (e.g. `tagMap`, `componentMap`)
- `gates` — optional validator hooks

Validated by `fixtures/grapes/benchmarks.test.ts` via `scripts/validate-grapes-fixtures.ts`.

### Add a new Grapes fixture

1. Add `html/<id>.html` (smallest HTML that exercises one rule).
2. Run `htmlToGrapes()` and write `golden/<id>.snapshot.json` (see refresh below).
3. Register in `grapes/manifest.json` with a plain-language `description`.
4. Add `gates` if the validate script should assert structural invariants beyond JSON equality.
5. Prefer a focused case in `src/test/transformers/html-to-grapes.test.ts` for regression detail; use grapes goldens for the published contract.

## Tiptap golden fixtures (`tiptap/`)

Same pattern as grapes: `html/` + `golden/` + `manifest.json`, validated by `fixtures/tiptap/benchmarks.test.ts`.

## Platform export fixtures (`wordpress/`, `smugmug/`, …)

Full or partial real exports for adapter enumeration, conflict analysis, and dogfood matrices. See each directory’s `manifest.json` where present. These are **not** minimal HTML snippets — they represent source-platform shape and scale.

## Refresh goldens after an intentional converter change

```bash
pnpm build
```

Regenerate snapshot JSON from manifest HTML inputs (example for one grapes fixture):

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { htmlToGrapes } from './dist/transformers/index.js';
const html = readFileSync('fixtures/grapes/html/wp-widget-map.html', 'utf8');
writeFileSync(
  'fixtures/grapes/golden/wp-widget-map.snapshot.json',
  JSON.stringify(htmlToGrapes(html), null, 2) + '\n',
);
"
```

Then run `pnpm test:validate-fixtures` and commit html + golden + manifest together. Keep output deterministic (no timestamps or environment-specific URLs in goldens).
