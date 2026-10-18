import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader } from "@/design";
import { Markdown } from "@/lib/help/markdown";
import { GUIDE_PAGES, guidePageFor } from "@/lib/help/user-guide";

// Read from disk on request: the guide ships as markdown beside the app (next.config.ts traces it into the standalone build).
export const dynamic = "force-dynamic";

const GUIDE_DIR = path.join(process.cwd(), "docs", "user-guide");

async function readGuide(slug: string): Promise<string | null> {
  try {
    return await readFile(path.join(GUIDE_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

/** The user guide: one markdown page per workspace, chosen by `?page=` (URL is state). */
export default async function DocsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { page } = await searchParams;
  const current = guidePageFor(Array.isArray(page) ? page[0] : page);
  const source = await readGuide(current.slug);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Documentation" meta="How each part of Meridian works" />
      <div className="flex flex-col gap-4 md:flex-row">
        <nav aria-label="Guide pages" className="w-full shrink-0 md:w-[200px]">
          <ul className="flex flex-row flex-wrap gap-1 md:flex-col">
            {GUIDE_PAGES.map((p) => {
              const active = p.slug === current.slug;
              return (
                <li key={p.slug}>
                  <Link
                    href={`/docs?page=${p.slug}`}
                    aria-current={active ? "page" : undefined}
                    className="m-motion-colors flex items-center px-3 m-text-body [height:var(--m-control-h)] [border-radius:var(--m-radius-control)] m-ink-2 [font-weight:400] aria-[current=page]:[background:var(--m-accent-soft)] aria-[current=page]:[color:var(--m-accent-ink)] aria-[current=page]:[font-weight:600]"
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 [max-width:720px]" data-testid="guide-page" data-guide-page={current.slug}>
          {source === null ? (
            <EmptyState
              title="This page is not available"
              detail="The guide file for this page could not be read."
              action={<Button render={<Link href="/docs?page=home">Open the first page</Link>} />}
            />
          ) : (
            <Card padding="lg">
              <Markdown source={source} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
