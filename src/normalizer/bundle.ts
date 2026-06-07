import type {
  NormalizedAsset,
  NormalizedCategory,
  NormalizedEntity,
  NormalizedPage,
  NormalizedPortfolio,
  NormalizedPost,
  NormalizedTag,
} from "./types.js";

export interface EntityBundle {
  posts: NormalizedPost[];
  pages: NormalizedPage[];
  media: NormalizedAsset[];
  portfolios: NormalizedPortfolio[];
  categories: NormalizedCategory[];
  tags: NormalizedTag[];
}

export function emptyBundle(): EntityBundle {
  return {
    posts: [],
    pages: [],
    media: [],
    portfolios: [],
    categories: [],
    tags: [],
  };
}

export async function collectEntities(
  entities: AsyncIterable<NormalizedEntity>,
): Promise<EntityBundle> {
  const bundle = emptyBundle();

  for await (const entity of entities) {
    switch (entity.type) {
      case "post":
        bundle.posts.push(entity);
        break;
      case "page":
        bundle.pages.push(entity);
        break;
      case "asset":
        bundle.media.push(entity);
        break;
      case "portfolio":
        bundle.portfolios.push(entity);
        break;
      case "category":
        bundle.categories.push(entity);
        break;
      case "tag":
        bundle.tags.push(entity);
        break;
      default: {
        const _exhaustive: never = entity;
        throw new Error(`Unknown entity type: ${(_exhaustive as NormalizedEntity).type}`);
      }
    }
  }

  return bundle;
}

export interface BundleCounts {
  posts: number;
  pages: number;
  assets: number;
  portfolios: number;
  categories: number;
  tags: number;
}

export function bundleCounts(bundle: EntityBundle): BundleCounts {
  return {
    posts: bundle.posts.length,
    pages: bundle.pages.length,
    assets: bundle.media.length,
    portfolios: bundle.portfolios.length,
    categories: bundle.categories.length,
    tags: bundle.tags.length,
  };
}
