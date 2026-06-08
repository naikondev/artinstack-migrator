import type { EntityBundle } from "../normalizer/bundle.js";
import { emptyBundle } from "../normalizer/bundle.js";
import { buildPortfolioMediaLinks } from "../normalizer/portfolio-media.js";
import type {
  NormalizedAsset,
  NormalizedCategory,
  NormalizedPage,
  NormalizedPortfolio,
  NormalizedPost,
  NormalizedTag,
  PortfolioMediaLink,
} from "../normalizer/types.js";
import type {
  CreatePageResult,
  CreatePostResult,
  MigrationRedirect,
  MigrationSink,
  UploadAssetInput,
  UploadAssetResult,
} from "./types.js";
import { writeFilesystemExport, type WriteFilesystemOptions } from "./filesystem.js";

/** Reference MigrationSink that accumulates entities and writes M0 JSON bundles. */
export class FilesystemMigrationSink implements MigrationSink {
  readonly bundle: EntityBundle = emptyBundle();
  readonly portfolioMediaLinks: PortfolioMediaLink[] = [];
  readonly redirects: MigrationRedirect[] = [];

  async createCategory(category: NormalizedCategory): Promise<{ targetId: string }> {
    this.bundle.categories.push(category);
    return { targetId: category.sourceId };
  }

  async createTag(tag: NormalizedTag): Promise<{ targetId: string }> {
    this.bundle.tags.push(tag);
    return { targetId: tag.sourceId };
  }

  async uploadAsset(input: UploadAssetInput): Promise<UploadAssetResult> {
    this.bundle.media.push(input.asset);
    return {
      targetId: input.asset.sourceId,
      publicUrl: input.asset.sourceUrl,
    };
  }

  async createPortfolio(portfolio: NormalizedPortfolio): Promise<{ targetId: string }> {
    this.bundle.portfolios.push(portfolio);
    return { targetId: portfolio.sourceId };
  }

  async createPost(post: NormalizedPost): Promise<CreatePostResult> {
    this.bundle.posts.push(post);
    return {
      targetId: post.sourceId,
      publicPath: post.source.path ?? `/${post.slug}`,
    };
  }

  async createPage(page: NormalizedPage): Promise<CreatePageResult> {
    this.bundle.pages.push(page);
    return {
      targetId: page.sourceId,
      publicPath: page.source.path ?? `/${page.slug}`,
    };
  }

  async linkPortfolioMedia(link: PortfolioMediaLink): Promise<void> {
    this.portfolioMediaLinks.push(link);
  }

  async writeRedirect(redirect: MigrationRedirect): Promise<void> {
    this.redirects.push(redirect);
  }

  async flush(options: WriteFilesystemOptions): Promise<void> {
    await writeFilesystemExport({
      ...options,
      bundle: this.bundle,
    });
  }
}

export function createFilesystemMigrationSink(): FilesystemMigrationSink {
  return new FilesystemMigrationSink();
}

/** Verify sink-produced M2M links match bundle-derived index. */
export function portfolioMediaMatchesBundle(
  sink: FilesystemMigrationSink,
): boolean {
  const expected = buildPortfolioMediaLinks(sink.bundle);
  if (expected.length !== sink.portfolioMediaLinks.length) return false;
  return expected.every((link, index) => {
    const actual = sink.portfolioMediaLinks[index];
    return (
      actual?.portfolioSourceId === link.portfolioSourceId &&
      actual?.assetSourceId === link.assetSourceId &&
      actual?.sort === link.sort
    );
  });
}
