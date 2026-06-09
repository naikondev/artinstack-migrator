import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { htmlToTiptap, type HtmlToTiptapOptions, type TiptapDoc } from "../src/transformers/html-to-tiptap/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "fixtures", "tiptap");

export interface TiptapManifestFixture {
  id: string;
  html: string;
  golden: string;
  description: string;
  options?: HtmlToTiptapOptions;
  gates?: string[];
}

interface TiptapManifest {
  fixtures: TiptapManifestFixture[];
}

export interface TiptapFixtureValidationResult {
  id: string;
  ok: boolean;
  errors: string[];
}

function docsEqual(actual: TiptapDoc, expected: TiptapDoc): string | undefined {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) return undefined;
  return "snapshot mismatch: htmlToTiptap output does not match golden JSON";
}

export async function validateTiptapFixture(
  entry: TiptapManifestFixture,
): Promise<TiptapFixtureValidationResult> {
  const errors: string[] = [];
  const htmlPath = join(FIXTURES_ROOT, entry.html);
  const goldenPath = join(FIXTURES_ROOT, entry.golden);

  let html: string;
  let golden: TiptapDoc;
  try {
    html = await readFile(htmlPath, "utf8");
    golden = JSON.parse(await readFile(goldenPath, "utf8")) as TiptapDoc;
  } catch (error) {
    return {
      id: entry.id,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  let actual: TiptapDoc;
  try {
    actual = htmlToTiptap(html, entry.options);
  } catch (error) {
    return {
      id: entry.id,
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const mismatch = docsEqual(actual, golden);
  if (mismatch) errors.push(mismatch);

  const gates = entry.gates ?? [];
  if (gates.includes("inline_marks")) {
    const paragraph = actual.content[0];
    const marks = paragraph?.content?.[1]?.marks?.map((m) => m.type) ?? [];
    if (!marks.includes("bold")) errors.push("inline_marks: expected bold mark");
  }
  if (gates.includes("editorial_post")) {
    if (actual.content[0]?.type !== "heading") {
      errors.push("editorial_post: expected heading root block");
    }
    if (!actual.content.some((node) => node.type === "image")) {
      errors.push("editorial_post: expected image block");
    }
  }
  if (gates.includes("layout_unwrap")) {
    if (JSON.stringify(actual).includes("data-layout")) {
      errors.push("layout_unwrap: data-layout attrs must not appear in doc");
    }
    if (!actual.content.some((node) => node.type === "image")) {
      errors.push("layout_unwrap: expected image from unwrapped column");
    }
  }
  if (gates.includes("lists")) {
    if (!actual.content.some((node) => node.type === "bulletList")) {
      errors.push("lists: expected bulletList");
    }
    if (!actual.content.some((node) => node.type === "orderedList")) {
      errors.push("lists: expected orderedList");
    }
  }
  if (gates.includes("blockquote")) {
    if (actual.content[0]?.type !== "blockquote") {
      errors.push("blockquote: expected blockquote root block");
    }
  }

  return { id: entry.id, ok: errors.length === 0, errors };
}

export async function validateAllTiptapFixtures(): Promise<TiptapFixtureValidationResult[]> {
  const manifestPath = join(FIXTURES_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TiptapManifest;
  const results: TiptapFixtureValidationResult[] = [];
  for (const entry of manifest.fixtures) {
    results.push(await validateTiptapFixture(entry));
  }
  return results;
}

async function main(): Promise<void> {
  const results = await validateAllTiptapFixtures();
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
  console.log(`All ${results.length} Tiptap golden fixture(s) passed.`);
}

const isDirectRun = process.argv[1]?.includes("validate-tiptap-fixtures");
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
