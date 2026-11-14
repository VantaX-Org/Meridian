"use client";

import { t } from "@/lib/v2/i18n";

/** The real card geometry with shimmer bars: title row, the chart lead (ring, trend, record bar), sentence, button. */
export function StoryCardSkeleton() {
  return (
    <article className="nx-fd-card" aria-busy="true" aria-label={t("Loading an object")} data-testid="story-skeleton">
      <div className="nx-skeleton-bar nx-fd-sk-title" />
      <div className="nx-fd-visual" data-testid="story-skeleton-visual">
        <span className="nx-skeleton-bar nx-fd-sk-ring" />
        <span className="nx-fd-visual-side">
          <span className="nx-skeleton-bar nx-fd-sk-spark" />
          <span className="nx-skeleton-bar nx-fd-sk-seg" />
        </span>
      </div>
      <div className="nx-skeleton-bar nx-fd-sk-line" />
      <div className="nx-skeleton-bar nx-fd-sk-btn" />
    </article>
  );
}
