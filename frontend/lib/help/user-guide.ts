/**
 * The chapters of the user guide, grouped into sections. One markdown file per chapter in
 * docs/user-guide/; the order and titles come from docs/user-guide/index.json, which the API reads
 * too when it renders the same chapters as the PDF manual. The slug is the `?page=` value on /docs.
 */
import manifest from "../../docs/user-guide/index.json";

export interface GuidePage {
  slug: string;
  title: string;
}

export interface GuideSection {
  title: string;
  pages: readonly GuidePage[];
}

export const GUIDE_TITLE: string = manifest.title;
export const GUIDE_SECTIONS: readonly GuideSection[] = manifest.sections;
export const GUIDE_PAGES: readonly GuidePage[] = GUIDE_SECTIONS.flatMap((s) => s.pages);

export const DEFAULT_GUIDE_PAGE = GUIDE_PAGES[0].slug;

/** The page for a `?page=` value; anything unknown falls back to the first page. */
export function guidePageFor(slug: string | undefined): GuidePage {
  return GUIDE_PAGES.find((p) => p.slug === slug) ?? GUIDE_PAGES[0];
}

/** The chapters before and after `slug` in reading order, for the links at the foot of a page. */
export function guideNeighbours(slug: string): { prev?: GuidePage; next?: GuidePage } {
  const at = GUIDE_PAGES.findIndex((p) => p.slug === slug);
  return { prev: at > 0 ? GUIDE_PAGES[at - 1] : undefined, next: at >= 0 ? GUIDE_PAGES[at + 1] : undefined };
}
