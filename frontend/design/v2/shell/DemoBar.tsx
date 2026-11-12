"use client";

import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import "../roles.css";

/**
 * The "Demo data" bar: one line at the top of every page while fixture mode is on (`?fixture=1`), so a figure read
 * from lib/api/v2/fixtures can never pass for a measurement of the customer's SAP data. It cannot be dismissed; it
 * goes when fixture mode goes (`?fixture=0`, a new tab, or a build that does not allow it).
 */
export function DemoBar({ on }: { on?: boolean }) {
  const fixture = useFixture();
  if (!(on ?? fixture)) return null;
  return (
    <div className="m2-demobar" role="status" data-testid="demo-bar">
      <strong>{t("Demo data")}</strong>
      <span className="m2-demobar-long">{t("Every figure on this page is sample data built into the interface, not read from your SAP systems.")}</span>
      {/* On a phone the bar keeps to one line, so it does not push the page's first screen down. */}
      <span className="m2-demobar-short">{t("Sample figures, not your SAP data.")}</span>
    </div>
  );
}
