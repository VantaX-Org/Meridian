import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader, Pill } from "@/design";
import { Markdown } from "@/lib/help/markdown";
import { roleLabel } from "@/lib/roles";
import {
  chapterFor, chapterIsFor, chapterNeighbours, DEFAULT_CHAPTER, HELP_SECTIONS,
  type JourneyChapter, type JourneySection,
} from "@/lib/help/journeys";
import { VideoPlayer } from "@/design";
import { RoleFilter } from "./_role-filter";

// Read from disk on request, like /docs: the chapters ship as markdown beside the app
// (next.config.ts traces docs/help-centre into the standalone build).
export const dynamic = "force-dynamic";

const HELP_DIR = path.join(process.cwd(), "docs", "help-centre");

async function readChapter(slug: string): Promise<string | null> {
  try {
    return await readFile(path.join(HELP_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

const LINK =
  "m-motion-colors flex items-center px-3 m-text-body [height:var(--m-control-h)] [border-radius:var(--m-radius-control)] m-ink-2 [font-weight:400] aria-[current=page]:[background:var(--m-accent-soft)] aria-[current=page]:[color:var(--m-accent-ink)] aria-[current=page]:[font-weight:600]";

function Audience({ chapter }: { chapter: JourneyChapter }) {
  if (chapter.audiences.length === 0) return <Pill tone="neutral">Everyone</Pill>;
  return (
    <span className="flex flex-row flex-wrap gap-1">
      {chapter.audiences.slice(0, 3).map((r) => (
        <Pill key={r} tone="neutral">{roleLabel(r)}</Pill>
      ))}
      {chapter.audiences.length > 3 && <Pill tone="neutral">+{chapter.audiences.length - 3}</Pill>}
    </span>
  );
}

/**
 * The help centre: per-role journeys, one markdown chapter per task with its training recording.
 * `?journey=` is the chapter (URL is state); `?role=` narrows the contents to one role's chapters.
 */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ journey?: string | string[]; role?: string | string[] }>;
}) {
  const { journey, role } = await searchParams;
  const roleFilter = Array.isArray(role) ? role[0] : role;
  const current = chapterFor(Array.isArray(journey) ? journey[0] : journey);
  const source = await readChapter(current.slug);
  const { prev, next } = chapterNeighbours(current.slug);

  const visible = (section: JourneySection): readonly JourneyChapter[] =>
    roleFilter ? section.chapters.filter((c) => chapterIsFor(c, roleFilter as never)) : section.chapters;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Help centre"
        meta="Guides for the work each role does here, with a training recording per chapter"
        actions={<Button variant="secondary" render={<Link href={`/docs?page=welcome`}>Documentation library</Link>} />}
        secondary={<RoleFilter />}
      />
      <div className="flex flex-col gap-4 md:flex-row">
        <nav aria-label="Help chapters" className="w-full shrink-0 md:w-[240px]">
          {HELP_SECTIONS.map((section) => {
            const chapters = visible(section);
            if (chapters.length === 0) return null;
            return (
              <div key={section.id} className="mb-3">
                <p className="px-3 pb-1 m-text-meta m-ink-3 [font-weight:600]">{section.label}</p>
                <ul className="flex flex-row flex-wrap gap-1 md:flex-col">
                  {chapters.map((c) => (
                    <li key={c.slug}>
                      <Link
                        href={`/help?journey=${c.slug}${roleFilter ? `&role=${roleFilter}` : ""}`}
                        aria-current={c.slug === current.slug ? "page" : undefined}
                        className={LINK}
                      >
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 [max-width:760px]" data-testid="help-page" data-help-chapter={current.slug}>
          {source === null ? (
            <EmptyState
              title="This chapter is not available"
              detail="The help file for this chapter could not be read."
              action={<Button render={<Link href={`/help?journey=${DEFAULT_CHAPTER}`}>Open the first chapter</Link>} />}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <Card padding="lg">
                <div className="mb-3 flex flex-row flex-wrap items-center gap-2">
                  <Audience chapter={current} />
                </div>
                <Markdown source={source} />
              </Card>
              <VideoPlayer name={current.video} title={current.title} />
              <nav aria-label="Previous and next chapter" className="flex justify-between gap-2">
                {prev ? (
                  <Link href={`/help?journey=${prev.slug}${roleFilter ? `&role=${roleFilter}` : ""}`} className="m-ink-accent m-text-body">
                    Previous: {prev.title}
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link href={`/help?journey=${next.slug}${roleFilter ? `&role=${roleFilter}` : ""}`} className="m-ink-accent m-text-body">
                    Next: {next.title}
                  </Link>
                ) : null}
              </nav>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
