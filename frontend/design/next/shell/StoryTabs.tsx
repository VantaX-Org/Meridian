"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useV2Href } from "@/lib/v2/hooks";
import { useAttentionCount } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { PATHS, TABS } from "@/lib/next/nav-defaults";
import { Glyph, LABEL, destAt } from "./dest";

/** Five text pills under the header; on a phone the same five become a bottom bar with a glyph over the label. */
export function StoryTabs() {
  const href = useV2Href();
  const here = destAt(usePathname());
  const a = useAttentionCount().data;
  const badge = a ? a.critical + a.high : 0;
  return (
    <nav id="nx-tabs" className="nx-tabs-bar nx-glass" aria-label={t("Main")}>
      {TABS.map((id) => (
        <Link key={id} href={href(PATHS[id])} className="nx-stab" aria-current={here === id ? "page" : undefined}>
          <Glyph id={id} />
          <span className="nx-stab-label">{LABEL[id]()}</span>
          {id === "work" && badge ? <span className="nx-stab-badge" aria-label={t("{n} need attention", { n: badge })}>{badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
