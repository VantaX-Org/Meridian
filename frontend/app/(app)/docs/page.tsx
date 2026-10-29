import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader } from "@/design";
import { Markdown } from "@/lib/help/markdown";
import { DEFAULT_GUIDE_PAGE, GUIDE_SECTIONS, guideNeighbours, guidePageFor } from "@/lib/help/user-guide";
import { DownloadGuide } from "./download-guide";

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

const LINK = "m-motion-colors flex items-center px-3 m-text-body [height:var(--m-control-h)] [border-radius:var(--m-radius-control)] m-ink-2 [font-weight:400] aria-[current=page]:[background:var(--m-accent-soft)] aria-[current=page]:[color:var(--m-accent-ink)] aria-[current=page]:[font-weight:600]";

/** The user guide: one markdown chapter per page, chosen by `?page=` (URL is state), grouped into sections. */
export default async function DocsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { page } = await searchParams;
  const current = guidePageFor(Array.isArray(page) ? page[0] : page);
  const source = await readGuide(current.slug);
  const { prev, next } = guideNeighbours(current.slug);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="User guide"
        meta="How each part of Meridian works. Part of the help centre"
        actions={<><Button variant="secondary" render={<Link href="/help">Help centre</Link>} /><DownloadGuide /></>}
      />
      <div className="flex flex-col gap-4 md:flex-row">
        <nav aria-label="Guide pages" className="w-full shrink-0 md:w-[220px]">
          {GUIDE_SECTIONS.map((section) => (
            <div key={section.title} className="mb-3">
              <p className="px-3 pb-1 m-text-meta m-ink-3 [font-weight:600]">{section.title}</p>
              <ul className="flex flex-row flex-wrap gap-1 md:flex-col">
                {section.pages.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/docs?page=${p.slug}`} aria-current={p.slug === current.slug ? "page" : undefined} className={LINK}>
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 [max-width:760px]" data-testid="guide-page" data-guide-page={current.slug}>
          {source === null ? (
            <EmptyState
              title="This page is not available"
              detail="The guide file for this page could not be read."
              action={<Button render={<Link href={`/docs?page=${DEFAULT_GUIDE_PAGE}`}>Open the first page</Link>} />}
            />
          ) : (
            <>
              <Card padding="lg">
                <Markdown source={source} />
              </Card>
              <nav aria-label="Previous and next chapter" className="mt-3 flex justify-between gap-2">
                {prev ? <Link href={`/docs?page=${prev.slug}`} className="m-ink-accent m-text-body">Previous: {prev.title}</Link> : <span />}
                {next ? <Link href={`/docs?page=${next.slug}`} className="m-ink-accent m-text-body">Next: {next.title}</Link> : null}
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
