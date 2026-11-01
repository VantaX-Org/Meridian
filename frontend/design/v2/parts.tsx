"use client";

import Link from "next/link";
import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { useV2Href } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";

/** A link inside the v2 interface: keeps `?fixture=1` when the page is in fixture mode. */
export function V2Link({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const v2Href = useV2Href();
  return <Link href={v2Href(href)} {...rest} />;
}

/** SAP identifiers (check ids, TABLE-FIELD, record keys, run ids) in the mono face, and nowhere else. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  // One notation for SAP fields, SAP's own: TABLE-FIELD (MARA-MEINS), whatever the API sent (MARA.MEINS).
  const text = typeof children === "string" && SAP_FIELD.test(children) ? children.replace(".", "-") : children;
  return <span className={`m2-mono${className ? ` ${className}` : ""}`}>{text}</span>;
}

/** An SAP code with what it means, on one line: the meaning in the text face, the code small in mono (code first for a value:
 *  "EA each"; last for a rule or field: "Material type is mandatory MM003"). No meaning: the code alone, never invented. */
export function Coded({ code, text, first }: { code: string; text?: string | null; first?: boolean }) {
  if (!text || text === code) return <Mono>{code}</Mono>;
  const c = <Mono className="m2-cdc">{code}</Mono>;
  const d = <span className="m2-cdt">{text}</span>;
  return (
    <span className="m2-cd" title={`${text} (${code})`}>
      {first ? c : d}
      {first ? d : c}
    </span>
  );
}

const SAP_FIELD = /^\/?[A-Z][A-Z0-9_/]{2,}\.[A-Z][A-Z0-9_/]+$/;

/** A value as data: SAP codes and keys (no spaces) in the mono face, free text such as a description in the text face. */
export function Value({ value }: { value: string }) {
  return /\s/.test(value.trim()) || value.length > 40 ? <span>{value}</span> : <Mono>{value}</Mono>;
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

/**
 * A canvas while it arrives: the h1's line, the sentence, the next-step button and two blocks, in the final geometry,
 * so nothing moves when the page lands. Busy for assistive technology, with its name said once.
 */
export function CanvasSkeleton({ blocks = 2 }: { blocks?: number }) {
  return (
    <div className="m2-wait" aria-busy="true" data-testid="canvas-loading">
      <span className="m2-sr" role="status">{t("Loading")}</span>
      <Skeleton width={240} height={28} />
      <div className="m2-wait-lines">
        <Skeleton width="min(560px, 100%)" height={14} />
        <Skeleton width="min(420px, 80%)" height={14} />
      </div>
      <Skeleton width={200} height={36} />
      {Array.from({ length: blocks }, (_, i) => (
        <div key={i} className="m2-wait-block">
          <Skeleton width={160} height={16} />
          <Skeleton width="100%" height={i === 0 ? 220 : 160} />
        </div>
      ))}
    </div>
  );
}

/**
 * The inspector while its body arrives: the title and status line, five facts in their two columns and the actions,
 * in the order every inspector keeps.
 */
export function InspectorSkeleton() {
  return (
    <>
      <div className="m2-ih">
        <div className="m2-wait-lines">
          <Skeleton width={220} height={18} />
          <Skeleton width={160} height={13} />
        </div>
      </div>
      <div className="m2-ib">
        <span className="m2-sr" role="status">{t("Loading")}</span>
        <div className="m2-wait-facts">
          {[64, 48, 72, 40, 56].map((w, i) => (
            <div key={i} className="m2-fact">
              <Skeleton width={`${w + 20}%`} height={12} />
              <Skeleton width={`${w}%`} height={12} />
            </div>
          ))}
        </div>
        <div className="m2-acts m2-wait-acts">
          <Skeleton width={120} height={32} />
          <Skeleton width={96} height={32} />
        </div>
      </div>
    </>
  );
}

/**
 * The window title names the page (WCAG 2.4.2): the h1's words, then the product, in the interface's language. The
 * framework writes its own title into the head after the page has painted (the layout's metadata), so the title is
 * held: whenever the head's title changes away from this page's, it is put back. Leaving the page lets go.
 */
export function useWindowTitle(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const h = ref.current;
    const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
    const sub = h?.querySelector(".m2-h1-sub");
    const all = clean(h?.textContent);
    const main = sub ? clean(all.slice(0, all.length - clean(sub.textContent).length)) : all;
    // "People – Owners and stewards": the canvas, then the scope beside it (drawn with a separator the text lacks).
    const words = sub && main ? `${main} \u2013 ${clean(sub.textContent)}` : all;
    if (!words) return;
    // i18n-ignore: the product name, after the translated h1
    const want = `${words} \u2013 Meridian`;
    const hold = () => {
      if (document.title !== want) document.title = want;
    };
    hold();
    if (typeof MutationObserver === "undefined") return;
    const watch = new MutationObserver(hold);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  });
}

/** The canvas title: the one h1 of a v2 page, with the system or scope beside it in the lighter weight. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useWindowTitle(ref);
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
