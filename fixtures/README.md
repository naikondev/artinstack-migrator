# Migration fixtures

Golden inputs and expected outputs for adapter and transformer tests. Run the full gate with:

```bash
pnpm test:validate-fixtures
```

## Layout

| Directory | Purpose |
|-----------|---------|
| `wordpress/` | WXR benchmark exports + `manifest.json` |
| `smugmug/` | Portfolio vault JSON + mapping matrix |
| `squarespace/` | Site export JSON + wire json-pretty samples |
| `grapes/` | HTML inputs + golden `GrapesProjectSnapshot` JSON for `htmlToGrapes()` |
| `wix/` | W0 RSS/Atom XML, W1 API JSON, W2 page HTML snapshots |
| `ghost/`, `blogger/` | Planned optional adapters (M0e-B) — not yet present |

## Grapes golden fixtures

Each entry in `grapes/manifest.json` pairs:

- `html/<id>.html` — source HTML fragment
- `golden/<id>.snapshot.json` — expected `htmlToGrapes()` output (`content`, `styles`, optional `contentHtml` / `contentCss`)

Validated via `fixtures/grapes/benchmarks.test.ts` as part of:

```bash
pnpm test:validate-fixtures
```

To refresh goldens after an intentional converter change, rebuild and regenerate from the manifest inputs (keep snapshots deterministic).
