/**
 * The chapters of the in-app help centre, grouped into sections. One markdown file per chapter in
 * docs/help-centre/ (the same disk-read pattern as the user guide — no DB, no API). Each chapter
 * carries the roles it was written for and the name of its training recording; the videos are
 * served by GET /api/v1/docs/help-videos/{file} once recorded (see docs/help-videos.md).
 * The slug is the `?journey=` value on /help.
 */
import manifest from "../../docs/help-centre/index.json";
import type { Role } from "../../hooks/use-role";

export interface JourneyChapter {
  slug: string;
  title: string;
  summary: string;
  /** Roles this chapter was written for; empty means everyone. */
  audiences: readonly string[];
  /** Base name of the training video; served at /api/v1/docs/help-videos/{video}.mp4. */
  video: string;
}

export interface JourneySection {
  id: string;
  label: string;
  chapters: readonly JourneyChapter[];
}

export const HELP_TITLE: string = manifest.title;
export const HELP_SECTIONS: readonly JourneySection[] = manifest.sections as readonly JourneySection[];
export const HELP_CHAPTERS: readonly JourneyChapter[] = HELP_SECTIONS.flatMap((s) => s.chapters);

export const DEFAULT_CHAPTER = HELP_CHAPTERS[0].slug;

/** The chapter for a `?journey=` value; anything unknown falls back to the first chapter. */
export function chapterFor(slug: string | undefined): JourneyChapter {
  return HELP_CHAPTERS.find((c) => c.slug === slug) ?? HELP_CHAPTERS[0];
}

/** The chapters before and after `slug` in reading order, for the links at the foot of a page. */
export function chapterNeighbours(slug: string): { prev?: JourneyChapter; next?: JourneyChapter } {
  const at = HELP_CHAPTERS.findIndex((c) => c.slug === slug);
  return { prev: at > 0 ? HELP_CHAPTERS[at - 1] : undefined, next: at >= 0 ? HELP_CHAPTERS[at + 1] : undefined };
}

/** True when a chapter is written for this role (an empty audience list is for everyone). */
export function chapterIsFor(chapter: JourneyChapter, role: Role | null): boolean {
  return chapter.audiences.length === 0 || (role !== null && chapter.audiences.includes(role));
}
