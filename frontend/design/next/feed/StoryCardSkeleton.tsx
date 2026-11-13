"use client";

import { t } from "@/lib/v2/i18n";

/** The real card geometry with shimmer bars: title row, hero score, sentence, button. */
export function StoryCardSkeleton() {
  return (
    <article className="nx-fd-card" aria-busy="true" aria-label={t("Loading an object")} data-testid="story-skeleton">
      <div className="nx-skeleton-bar nx-fd-sk-title" />
      <div className="nx-skeleton-bar nx-fd-sk-score" />
      <div className="nx-skeleton-bar nx-fd-sk-line" />
      <div className="nx-skeleton-bar nx-fd-sk-btn" />
    </article>
  );
}
