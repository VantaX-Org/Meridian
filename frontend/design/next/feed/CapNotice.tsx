"use client";

import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import type { PortfolioPage } from "@/lib/api/next/portfolio";
import { Button } from "../kit";

/** Says when the list holds fewer objects than exist, with one way to load them all. Nothing when all are shown. */
export function CapNotice({ page, onAll, loading }: { page: PortfolioPage | undefined; onAll: () => void; loading?: boolean }) {
  if (!page || page.objects.length >= page.total) return null;
  return (
    <p className="nx-fd-capnote" role="status" data-testid="cap-notice">
      {t("Showing {n} of {total} objects.", { n: formatInt(page.objects.length), total: formatInt(page.total) })}{" "}
      <Button variant="quiet" size={32} onClick={onAll} loading={loading}>{t("Show all {total}", { total: formatInt(page.total) })}</Button>
    </p>
  );
}
