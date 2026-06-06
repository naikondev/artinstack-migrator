#!/usr/bin/env node

import { getAdapter } from "../parsers/index.js";
import type { MigrationPlatform } from "../normalizer/types.js";

const PLATFORMS: MigrationPlatform[] = ["wordpress", "smugmug", "squarespace"];

function printUsage(): void {
  console.log(`artinstack-migrate — enumerate and dry-run platform imports

Usage:
  artinstack-migrate validate <platform> <input-path>
  artinstack-migrate enumerate <platform> <input-path> [--dry-run]

Platforms: ${PLATFORMS.join(", ")}
`);
}

async function main(): Promise<void> {
  const [, , command, platformArg, inputPath, ...rest] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (!platformArg || !PLATFORMS.includes(platformArg as MigrationPlatform)) {
    console.error(`Unknown platform: ${platformArg ?? "(missing)"}`);
    printUsage();
    process.exit(1);
  }

  const platform = platformArg as MigrationPlatform;
  const adapter = getAdapter(platform);
  const dryRun = rest.includes("--dry-run");

  if (command === "validate") {
    const result = await adapter.validateInput({ path: inputPath });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "enumerate") {
    let count = 0;
    for await (const entity of adapter.enumerateEntities({ input: { path: inputPath } })) {
      count += 1;
      if (!dryRun) {
        console.log(JSON.stringify(entity));
      }
    }
    console.error(`Enumerated ${count} entities (${dryRun ? "dry-run" : "stdout"})`);
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
