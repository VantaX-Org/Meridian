import { t } from "@/lib/v2/i18n";
import { V2Link } from "../parts";

/** Work ledger and post-clean monitoring: one place, two views. */
export function WorkTabs({ current }: { current: "ledger" | "monitor" }) {
  return (
    <nav className="m2-tabs" aria-label={t("Views of Work")}>
      <V2Link href="/work" className="m2-tab" aria-current={current === "ledger" ? "page" : undefined}>
        {t("Ledger")}
      </V2Link>
      <V2Link href="/work/monitor" className="m2-tab" aria-current={current === "monitor" ? "page" : undefined}>
        {t("Monitor")}
      </V2Link>
    </nav>
  );
}
