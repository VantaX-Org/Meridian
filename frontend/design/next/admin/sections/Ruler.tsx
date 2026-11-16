"use client";

import { Chip } from "@/design/next/kit";

/** The policy mark: a count chip beside a rule a policy pack covers, the reason in its accessible name. */
export function PolicyMark({ mark }: { mark: { count: number; title: string } }) {
  return (
    <span role="img" aria-label={mark.title} title={mark.title} data-testid="policy-mark">
      <Chip tone="warn" count={mark.count} />
    </span>
  );
}
