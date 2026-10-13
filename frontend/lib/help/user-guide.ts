/**
 * The pages of the in-app user guide: one markdown file per workspace in
 * docs/user-guide/. The slug is the file name and the `?page=` value on /docs.
 */
export interface GuidePage {
  slug: string;
  title: string;
}

export const GUIDE_PAGES: readonly GuidePage[] = [
  { slug: "home", title: "Home" },
  { slug: "systems", title: "Systems" },
  { slug: "objects", title: "Objects" },
  { slug: "runs", title: "Runs" },
  { slug: "rules", title: "Rules" },
  { slug: "insights", title: "Insights" },
  { slug: "mdm", title: "Master data" },
  { slug: "migration", title: "Migration" },
  { slug: "inbox", title: "Inbox" },
  { slug: "fix", title: "Fix" },
  { slug: "admin", title: "Admin" },
];

export const DEFAULT_GUIDE_PAGE = "home";

/** The page for a `?page=` value; anything unknown falls back to the first page. */
export function guidePageFor(slug: string | undefined): GuidePage {
  return GUIDE_PAGES.find((p) => p.slug === slug) ?? GUIDE_PAGES[0];
}
