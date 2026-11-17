"use client";

import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import "./demobar.css";

/**
 * The "Demo data" bar: one line at the top of every page while fixture mode is on (`?fixture=1`), so a figure read
 * from lib/api/v2/fixtures can never pass for a measurement of the customer's SAP data. It cannot be dismissed; it
 * goes when fixture mode goes.
 */
export function DemoBar() {
  if (!useFixture()) return null;
  return (
    <div className="mx-demobar" role="status" data-testid="demo-bar">
      <strong>{t("Demo data")}</strong>
      <span className="mx-demobar-long">{t("Every figure on this page is sample data built into the interface, not read from your SAP systems.")}</span>
      <span className="mx-demobar-short">{t("Sample figures, not your SAP data.")}</span>
    </div>
  );
}
