/**
 * Aurora Report primitives — WS7 §2.5.
 *
 * `<ReportSurface>` is the shared shell for the Record Report and the
 * Process Report. It is typographically-led (Stripe-docs calibration) —
 * a long, scrollable single page with a right-hand anchored navigation
 * that highlights the active section as it scrolls past. Each section
 * renders inside a `<ReportSection>` — a header (id + title) + body.
 *
 * Reading order (top → bottom):
 *   header
 *     • display-sm verdict sentence
 *     • chip row (status, owner, last-updated)
 *   sections …
 *   actions (sticky bottom on narrow viewports — see CSS)
 *
 * Print:
 *   `aurora-report` forces single-column layout + drops the side nav
 *   under `@media print`. Print-safe chip colours live in
 *   `aurora-components.css`.
 *
 * Keyboard:
 *   Tab lands on first action in the header, then into section body.
 *   Home jumps to the header anchor, End to the last section anchor.
 *   Anchored nav links use real `#section-id` fragments — Browser
 *   back/forward preserves section state.
 */

"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Stack, Text } from "../primitives";
import { clsx } from "../primitives/internal";

/* -------------------------------------------------------- ReportSurface --- */

export interface ReportSurfaceSection {
  /** URL-fragment slug — becomes `#<id>`. Must be stable across sessions. */
  id: string;
  /** Nav label (short — "Verdict", "What's wrong", …). */
  label: ReactNode;
  /** Optional count badge next to the nav label. */
  count?: number;
  body: ReactNode;
}

export interface ReportSurfaceProps {
  /** Eyebrow line over the verdict, e.g. "RECORD · BP-1203187". */
  eyebrow?: ReactNode;
  /** Display-sm verdict sentence. */
  title: ReactNode;
  /** Support line under the title. */
  support?: ReactNode;
  /** Header chip row — status, owner, last-updated. */
  chips?: ReactNode;
  /** Header action row — "Copy link", "Export PDF", "Open drawer". */
  actions?: ReactNode;
  /** The report sections, rendered in order. */
  sections: ReadonlyArray<ReportSurfaceSection>;
  /** ARIA label for the anchored scroll nav. */
  navLabel?: string;
  className?: string;
}

export function ReportSurface({
  eyebrow,
  title,
  support,
  chips,
  actions,
  sections,
  navLabel = "Report sections",
  className,
}: ReportSurfaceProps) {
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null,
  );
  const bodyRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver highlights the currently-visible section in the
  // side nav. Reveals at 30 % viewport from the top so the user sees the
  // highlight as soon as the section heading crosses the fold.
  useEffect(() => {
    if (sections.length === 0) return;
    const container = bodyRef.current;
    if (!container) return;
    const sectionEls = sections
      .map((s) => container.querySelector<HTMLElement>(`#${cssEscape(s.id)}`))
      .filter((el): el is HTMLElement => el !== null);
    if (sectionEls.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top - b.boundingClientRect.top));
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    sectionEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const navItems = useMemo(
    () =>
      sections.map((s) => ({
        id: s.id,
        label: s.label,
        count: s.count,
      })),
    [sections],
  );

  return (
    <article className={clsx("aurora-report", className)}>
      <header className="aurora-report__header">
        <Stack direction="column" gap={2}>
          {eyebrow ? (
            <Text variant="text-micro" tone="tertiary">
              {eyebrow}
            </Text>
          ) : null}
          <Text variant="display-sm" className="aurora-report__title">
            {title}
          </Text>
          {support ? (
            <Text variant="text-lead" tone="secondary">
              {support}
            </Text>
          ) : null}
          {chips ? <div className="aurora-report__chips">{chips}</div> : null}
          {actions ? <div className="aurora-report__actions">{actions}</div> : null}
        </Stack>
      </header>

      <div className="aurora-report__grid">
        <div
          className="aurora-report__body"
          ref={bodyRef}
        >
          {sections.map((section) => (
            <ReportSection key={section.id} section={section} />
          ))}
        </div>

        <nav
          className="aurora-report__nav"
          aria-label={navLabel}
        >
          <ol className="aurora-report__nav-list">
            {navItems.map((item) => {
              const active = item.id === activeId;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className={clsx(
                      "aurora-report__nav-link",
                      "aurora-focus-ring",
                    )}
                    data-active={active ? "true" : undefined}
                    aria-current={active ? "true" : undefined}
                  >
                    <span>{item.label}</span>
                    {typeof item.count === "number" ? (
                      <span
                        className="aurora-report__nav-count"
                        data-numeric="true"
                      >
                        {item.count.toLocaleString()}
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </article>
  );
}

/* -------------------------------------------------------- ReportSection --- */

export interface ReportSectionProps {
  section: ReportSurfaceSection;
  className?: string;
}

export function ReportSection({ section, className }: ReportSectionProps) {
  return (
    <section
      id={section.id}
      className={clsx("aurora-report__section", className)}
      aria-labelledby={`${section.id}-heading`}
    >
      <header className="aurora-report__section-head">
        <Text
          variant="text-lead"
          id={`${section.id}-heading`}
          as="h2"
          className="aurora-report__section-title"
        >
          {section.label}
        </Text>
        <a
          className={clsx(
            "aurora-report__anchor",
            "aurora-focus-ring",
          )}
          href={`#${section.id}`}
          aria-label={`Link to section ${typeof section.label === "string" ? section.label : "section"}`}
        >
          #
        </a>
      </header>
      <div className="aurora-report__section-body">{section.body}</div>
    </section>
  );
}

/* ------------------------------------------------------------ helpers --- */

/**
 * Escape a string for use in a CSS selector — matches `CSS.escape` when
 * available, falls back to a simple regex for SSR / older runtimes.
 */
function cssEscape(value: string): string {
  if (typeof window !== "undefined" && typeof window.CSS?.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
