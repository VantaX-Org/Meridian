import { t } from "@/lib/v2/i18n";
import { V2Link } from "../parts";

/** Work ledger, post-clean monitoring, work analytics and exceptions: one place, four views. */
export function WorkTabs({ current }: { current: "ledger" | "monitor" | "analytics" | "exceptions" }) {
  return (
    <nav className="m2-tabs" aria-label={t("Views of Work")}>
      <V2Link href="/work" className="m2-tab" aria-current={current === "ledger" ? "page" : undefined}>
        {t("Ledger")}
      </V2Link>
      <V2Link href="/work/monitor" className="m2-tab" aria-current={current === "monitor" ? "page" : undefined}>
        {t("Monitor")}
      </V2Link>
      <V2Link href="/work/analytics" className="m2-tab" aria-current={current === "analytics" ? "page" : undefined}>
        {t("Analytics")}
      </V2Link>
      <V2Link href="/work/exceptions" className="m2-tab" aria-current={current === "exceptions" ? "page" : undefined}>
        {t("Exceptions")}
      </V2Link>
    </nav>
  );
}
