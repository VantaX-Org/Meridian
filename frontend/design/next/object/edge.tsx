"use client";

/** Small parts for the edge states of the object page: a big count in short form, a long name cut with its full text on hover, and the no-access screen. */
import type { ReactNode } from "react";
import { EmptyState } from "@/design/next/kit";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";

const SHORT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** 1234567 reads "1.2M" in a table cell, below 10 000 it stays whole. */
export function compactCount(n: number): string {
  return Math.abs(n) < 10_000 ? int(n) : SHORT.format(n);
}

/** The short form with the exact number as its tooltip. */
export function Count({ n }: { n: number }) {
  return <span className="nx-num" title={int(n)}>{compactCount(n)}</span>;
}

/** One line, cut with an ellipsis, the full text as tooltip. */
export function Trunc({ text, children }: { text: string; children?: ReactNode }) {
  return <span className="nx-trunc" title={text}>{children ?? text}</span>;
}

export const isDenied = (err: unknown): boolean => (err as { response?: { status?: number } } | null)?.response?.status === 403;

export function Denied({ what }: { what: string }) {
  return (
    <div data-testid="access-denied">
      <EmptyState icon="alert" heading={t("You do not have access to {what}", { what })}>{t("Ask an administrator to grant access, then reload this page.")}</EmptyState>
    </div>
  );
}
