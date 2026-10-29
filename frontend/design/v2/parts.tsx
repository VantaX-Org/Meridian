"use client";

import Link from "next/link";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { useV2Href } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";

/** A link inside the v2 interface: keeps `?fixture=1` when the page is in fixture mode. */
export function V2Link({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const v2Href = useV2Href();
  return <Link href={v2Href(href)} {...rest} />;
}

/** SAP identifiers (check ids, TABLE.FIELD, record keys, run ids) in the mono face, and nowhere else. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`m2-mono${className ? ` ${className}` : ""}`}>{children}</span>;
}

/** A middle-dot separator drawn by CSS, so no separator glyph sits in the copy. The spaces keep the text readable aloud. */
export function Dot() {
  return (
    <>
      {" "}
      <span className="m2-dot" aria-hidden="true" />{" "}
    </>
  );
}

/** A missing value: a grey dash that says why on hover. */
export function Dash({ why }: { why?: string }) {
  return (
    <span className="m2-dash" title={why}>
      {"—"}
    </span>
  );
}

/** A designed empty frame: what would put something here, and the one action. */
export function EmptyFrame({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="m2-empty" data-testid="empty-frame">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** A failed block: one sentence on what failed, and Retry. Inside the block, never a full-screen banner. */
export function ErrorFrame({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="m2-errbox" role="alert" data-testid="error-frame">
      <p>{children}</p>
      {onRetry ? (
        <button type="button" className="m2-btn m2-sm" onClick={onRetry}>
          {t("Retry")}
        </button>
      ) : null}
    </div>
  );
}

/** A flat grey bar at the real size of the value it stands in for: the loading state keeps the layout. */
export function Skeleton({ width = 120, height = 16 }: { width?: number | string; height?: number }) {
  return <span className="m2-skel" style={{ width, height }} aria-hidden="true" />;
}

/** The canvas title: the one h1 of a v2 page, with the system or scope beside it in the lighter weight. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // The window title names the page (WCAG 2.4.2): the h1's words, then the product, in the interface's language.
  useEffect(() => {
    const words = ref.current?.textContent?.replace(/\s+/g, " ").trim();
    // i18n-ignore: the product name, after the translated h1
    if (words) document.title = `${words} \u2013 Meridian`;
  });
  return (
    <h1 className="m2-h1" ref={ref}>
      {children}
      {sub ? (
        <>
          <Dot />
          <span className="m2-h1-sub">{sub}</span>
        </>
      ) : null}
    </h1>
  );
}
