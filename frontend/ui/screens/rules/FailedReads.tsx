"use client";

import { t } from "@/lib/v2/i18n";
import { ErrorState } from "@/ui/kit";

/** One retry banner for the secondary reads of a screen: shows only when some failed, and retries just those. */
export function FailedReads({ qs }: { qs: { isError: boolean; refetch: () => unknown }[] }) {
  const bad = qs.filter((q) => q.isError);
  if (!bad.length) return null;
  return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => bad.forEach((q) => void q.refetch())} />;
}
