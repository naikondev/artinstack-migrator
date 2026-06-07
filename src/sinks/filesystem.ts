import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { EntityBundle } from "../normalizer/bundle.js";
import type { ConflictReport } from "./conflicts.js";
import type { MigrationReport } from "./migration-report.js";

export interface WriteFilesystemOptions {
  outDir: string;
  bundle: EntityBundle;
  conflicts?: ConflictReport;
  report?: MigrationReport;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function writeFilesystemExport(options: WriteFilesystemOptions): Promise<void> {
  await mkdir(options.outDir, { recursive: true });

  await writeJson(join(options.outDir, "posts.json"), options.bundle.posts);
  await writeJson(join(options.outDir, "pages.json"), options.bundle.pages);
  await writeJson(join(options.outDir, "media.json"), options.bundle.media);
  await writeJson(join(options.outDir, "portfolios.json"), options.bundle.portfolios);
  await writeJson(join(options.outDir, "categories.json"), options.bundle.categories);
  await writeJson(join(options.outDir, "tags.json"), options.bundle.tags);

  if (options.conflicts) {
    await writeJson(join(options.outDir, "conflicts.json"), options.conflicts);
  }
  if (options.report) {
    await writeJson(join(options.outDir, "migration-report.json"), options.report);
  }
}

export function bundleToCombinedJson(bundle: EntityBundle): Record<string, unknown> {
  return {
    posts: bundle.posts,
    pages: bundle.pages,
    media: bundle.media,
    portfolios: bundle.portfolios,
    categories: bundle.categories,
    tags: bundle.tags,
  };
}
