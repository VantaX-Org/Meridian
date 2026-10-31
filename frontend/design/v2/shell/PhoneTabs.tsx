"use client";

import { usePathname } from "next/navigation";
import { useOpenItem, usePhone } from "@/lib/v2/hooks";
import { useUnread } from "@/lib/v2/approvals-queries";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "../parts";

/** The phone's main navigation: four places, thumb height. Shown at 760px and narrower only. */
export function PhoneTabs() {
  const phone = usePhone();
  const pathname = usePathname();
  const { open, openItem, close } = useOpenItem();
  const unread = useUnread().data;
  if (!phone) return null;
  const at = (p: string) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`));
  const links = [
    { href: "/", label: t("Landscape") },
    { href: "/work", label: t("Work") },
    { href: "/runs", label: t("Runs") },
  ];
  const inboxOpen = open?.kind === "inbox";
  return (
    <nav className="m2-ptabs" aria-label={t("Main")}>
      {links.map((l) => (
        <V2Link key={l.href} href={l.href} aria-current={at(l.href) && !inboxOpen ? "page" : undefined}>
          {l.label}
        </V2Link>
      ))}
      <button type="button" aria-haspopup="dialog" aria-expanded={inboxOpen} aria-current={inboxOpen ? "page" : undefined} onClick={() => (inboxOpen ? close() : openItem({ kind: "inbox", id: "" }))}>
        {t("Inbox")} {unread ? int(unread.count) : ""}
      </button>
    </nav>
  );
}
