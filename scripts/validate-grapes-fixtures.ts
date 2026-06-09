import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { htmlToGrapes, type GrapesProjectSnapshot, type HtmlToGrapesOptions } from "../src/transformers/html-to-grapes/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "fixtures", "grapes");

export interface GrapesManifestFixture {
  id: string;
  html: string;
  golden: string;
  description: string;
  options?: HtmlToGrapesOptions;
  gates?: string[];
}

interface GrapesManifest {
  fixtures: GrapesManifestFixture[];
}

export interface GrapesFixtureValidationResult {
  id: string;
  ok: boolean;
  errors: string[];
}

function snapshotsEqual(actual: GrapesProjectSnapshot, expected: GrapesProjectSnapshot): string | undefined {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) return undefined;
  return "snapshot mismatch: htmlToGrapes output does not match golden JSON";
}

export async function validateGrapesFixture(
  entry: GrapesManifestFixture,
): Promise<GrapesFixtureValidationResult> {
  const errors: string[] = [];
  const htmlPath = join(FIXTURES_ROOT, entry.html);
  const goldenPath = join(FIXTURES_ROOT, entry.golden);

  let html: string;
  let golden: GrapesProjectSnapshot;
  try {
    html = await readFile(htmlPath, "utf8");
    golden = JSON.parse(await readFile(goldenPath, "utf8")) as GrapesProjectSnapshot;
  } catch (error) {
    return {
      id: entry.id,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  let actual: GrapesProjectSnapshot;
  try {
    actual = htmlToGrapes(html, entry.options);
  } catch (error) {
    return {
      id: entry.id,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const mismatch = snapshotsEqual(actual, golden);
  if (mismatch) errors.push(mismatch);

  const gates = entry.gates ?? [];
  if (gates.includes("inline_text") && actual.content[0]?.type !== "text") {
    errors.push("inline_text: expected first component type text");
  }
  if (gates.includes("global_styles") && actual.styles.length === 0) {
    errors.push("global_styles: expected extracted root styles");
  }
  if (gates.includes("component_map") && actual.content[0]?.type !== "section") {
    errors.push("component_map: expected mapped component type section");
  }
  if (gates.includes("table_layout") && actual.content[0]?.tagName !== "table") {
    errors.push("table_layout: expected table root component");
  }
  if (gates.includes("hero_image") && actual.content[0]?.type !== "image") {
    errors.push("hero_image: expected image component");
  }
  if (gates.includes("editorial_page")) {
    if (!actual.contentHtml?.includes("<article>")) {
      errors.push("editorial_page: expected article in contentHtml");
    }
    if (actual.styles.length === 0) {
      errors.push("editorial_page: expected .lead style rule");
    }
  }
  if (gates.includes("data_layout")) {
    if (actual.content[0]?.type !== "section") {
      errors.push("data_layout: expected section root from data-layout marker");
    }
    if (actual.content[0]?.components?.[0]?.type !== "row") {
      errors.push("data_layout: expected row child from data-cols row marker");
    }
  }
  if (gates.includes("tag_map")) {
    if (actual.content[0]?.type !== "heading") {
      errors.push("tag_map: expected heading from h2 tagMap");
    }
    if (actual.content[2]?.type !== "section") {
      errors.push("tag_map: expected section from componentMap over tagMap");
    }
  }
  return { id: entry.id, ok: errors.length === 0, errors };
}

export async function validateAllGrapesFixtures(): Promise<GrapesFixtureValidationResult[]> {
  const manifestPath = join(FIXTURES_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as GrapesManifest;
  const results: GrapesFixtureValidationResult[] = [];
  for (const entry of manifest.fixtures) {
    results.push(await validateGrapesFixture(entry));
  }
  return results;
}

async function main(): Promise<void> {
  const results = await validateAllGrapesFixtures();
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    for (const result of failed) {
      console.error(`FAIL ${result.id}:`);
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
    }
    process.exit(1);
  }
  console.log(`All ${results.length} Grapes golden fixture(s) passed.`);
}

const isDirectRun = process.argv[1]?.includes("validate-grapes-fixtures");
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
