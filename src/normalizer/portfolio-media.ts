import type { EntityBundle } from "./bundle.js";
import type { PortfolioMediaLink } from "./types.js";

/** Derive portfolio↔asset M2M rows from assets carrying `portfolioSourceId`. */
export function buildPortfolioMediaLinks(bundle: EntityBundle): PortfolioMediaLink[] {
  const links: PortfolioMediaLink[] = [];

  for (const asset of bundle.media) {
    if (!asset.portfolioSourceId) continue;
    links.push({
      portfolioSourceId: asset.portfolioSourceId,
      assetSourceId: asset.sourceId,
      sort: asset.sort ?? 0,
    });
  }

  links.sort((a, b) => {
    if (a.portfolioSourceId !== b.portfolioSourceId) {
      return a.portfolioSourceId.localeCompare(b.portfolioSourceId);
    }
    return a.sort - b.sort || a.assetSourceId.localeCompare(b.assetSourceId);
  });

  return links;
}
