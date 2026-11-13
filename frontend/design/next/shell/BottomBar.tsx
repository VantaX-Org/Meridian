"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useV2Href } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { PATHS, type DestId } from "@/lib/next/nav-defaults";
import { Glyph, LABEL, destAt } from "./dest";

/** Under 1100 px the rail gives way to this bar: the five destinations, a solid surface and a hairline, no blur. */
export function BottomBar({ order, workBadge = 0 }: { order: DestId[]; workBadge?: number }) {
  const pathname = usePathname();
  const href = useV2Href();
  const here = destAt(pathname);
  return (
    <nav className="nx-bottom" aria-label={t("Main")}>
      {order.map((id) => (
        <Link key={id} href={href(PATHS[id])} aria-current={here === id ? "page" : undefined}>
          <Glyph id={id} />
          <span>{LABEL[id]()}</span>
          {id === "work" && workBadge > 0 ? <span className="nx-rail-badge" aria-label={t("{n} open", { n: workBadge })}>{workBadge > 99 ? "99+" : workBadge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
