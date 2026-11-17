"use client";

import { TermDetail } from "./TermDetail";

/** Body of the `term` sheet: open it with ?open=term:<glossary term id>. */
export function TermSheet({ arg }: { arg: unknown }) {
  return typeof arg === "string" && arg ? <TermDetail id={arg} /> : null;
}
