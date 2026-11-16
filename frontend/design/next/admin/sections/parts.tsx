"use client";

import Link from "next/link";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { Code, EmptyState, ErrorState, LargeTitle, Skeleton as KitSkeleton } from "@/design/next/kit";
import { useV2Href } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { describeField, describeTable } from "@/lib/v2/sap-fields";

/** A link inside the v2 interface: keeps `?fixture=1` when the page is in fixture mode. */
export function V2Link({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const v2Href = useV2Href();
  return <Link href={v2Href(href)} {...rest} />;
}

/** SAP identifiers (check ids, TABLE-FIELD, record keys, run ids) in the kit code face, and nowhere else. */
export function Mono({ children }: { children: ReactNode; className?: string }) {
  // One notation for SAP fields, SAP's own: TABLE-FIELD (MARA-MEINS), whatever the API sent (MARA.MEINS).
  const text = typeof children === "string" && SAP_FIELD.test(children) ? children.replace(".", "-") : children;
  return <code className="nx-code">{text}</code>;
}

/** An SAP code with what it means, on one line (the kit Code). No meaning: the code alone, never invented. */
export function Coded({ code, text }: { code: string; text?: string | null; first?: boolean }) {
  if (!text || text === code) return <Mono>{code}</Mono>;
  return (
    <span title={`${text} (${code})`}>
      <Code code={code} text={text} />
    </span>
  );
}

const SAP_FIELD = /^\/?[A-Z][A-Z0-9_/]{2,}\.[A-Z][A-Z0-9_/]+$/;

/** A value as data: SAP codes and keys (no spaces) in the code face, free text such as a description in the text face. */
export function Value({ value }: { value: string }) {
  return /\s/.test(value.trim()) || value.length > 40 ? <span>{value}</span> : <Mono>{value}</Mono>;
}

/** A separator between two facts on one line. The spaces keep the text readable aloud. */
export function Dot() {
  return <span aria-hidden="true">{" \u2013 "}</span>;
}

/** A missing value: a dash that says why on hover. */
export function Dash({ why }: { why?: string }) {
  return (
    <span className="nx-reason" title={why}>
      {"\u2014"}
    </span>
  );
}

/** An empty frame: the kit EmptyState, with what would put something here and the one action. */
export function EmptyFrame({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div data-testid="empty-frame">
      {typeof children === "string" ? <EmptyState heading={children} action={action} /> : <EmptyState heading={t("Nothing here")} action={action}>{children}</EmptyState>}
    </div>
  );
}

/** A failed block: the kit ErrorState, one sentence on what failed and Retry. */
export function ErrorFrame({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div data-testid="error-frame">
      <ErrorState sentence={typeof children === "string" ? children : undefined} onRetry={onRetry} />
      {typeof children === "string" ? null : <div className="nx-reason">{children}</div>}
    </div>
  );
}

/** A loading line: the kit Skeleton. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- callers pass v2 sizing; the kit Skeleton sizes itself
export function Skeleton(_props: { width?: number | string; height?: number }) {
  return <KitSkeleton lines={1} />;
}

/** A canvas while it arrives: busy for assistive technology, with its name said once. */
export function CanvasSkeleton({ blocks = 2 }: { blocks?: number }) {
  return (
    <div aria-busy="true" data-testid="canvas-loading">
      <KitSkeleton lines={2 + blocks * 2} label={t("Loading")} />
    </div>
  );
}

/** The inspector while its body arrives. */
export function InspectorSkeleton() {
  return <KitSkeleton lines={6} label={t("Loading")} />;
}

/**
 * The window title names the page (WCAG 2.4.2): the title's words, then the product. The framework writes its own title
 * into the head after the page has painted, so the title is held: whenever the head's title changes away, it is put back.
 */
export function useWindowTitle(words: string): void {
  useEffect(() => {
    if (!words) return;
    // i18n-ignore: the product name, after the translated title
    const want = `${words} \u2013 Meridian`;
    const hold = () => {
      if (document.title !== want) document.title = want;
    };
    hold();
    if (typeof MutationObserver === "undefined") return;
    const watch = new MutationObserver(hold);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  }, [words]);
}

/** The canvas title: the kit LargeTitle, with the sentence or scope under it. */
export function PageTitle({ children, sub }: { children: string; sub?: ReactNode }) {
  useWindowTitle(children);
  return <LargeTitle title={children} subtitle={sub} />;
}

/** A SAP field or table code with its standard text before it, when the text is known: "Base unit of measure MARA-MEINS". */
export function SapCode({ field, table, text }: { field?: string; table?: string; text?: string | null }) {
  const code = field ?? table ?? "";
  const d = text ?? (field ? describeField(field) : describeTable(code));
  return <>{d ? `${d} ` : null}<Mono>{code}</Mono></>;
}
