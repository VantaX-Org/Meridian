"use client";

import "../../step10.css";
import type { Receipt } from "@/lib/api/v2/types";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "../../parts";
import { PolicyMark } from "../../Ruler";

/** On the receipt: the applied policy classes this run breaches, each with its authority and the failing critical rules. */
export function PolicyBreaches({ receipt }: { receipt: Receipt }) {
  const { hrefFor } = useOpenItem();
  const classes = receipt.policy_breach_classes ?? [];
  if (!classes.length) return null;
  return (
    <section className="m2-s10-policy" aria-label={t("Policy classes breached")} data-testid="receipt-policy">
      <h2 className="m2-h2 m2-sec">
        <PolicyMark mark={{ count: classes.length, title: t("{count} policy {count, plural, one {class} other {classes}} breached: a critical rule evidencing an applied policy pack fails", { count: classes.length }) }} /> {t("Policy classes breached")}
      </h2>
      <ul className="m2-breaches">
        {classes.map((c) => (
          <li key={`${c.pack_id}:${c.class_id}`}>
            <span>
              <V2Link href={hrefFor({ kind: "policypack", id: c.pack_id })}>{c.label}</V2Link>
              <span className="m2-s10-auth">{c.authority}</span>
            </span>
            <span className="m2-meta">
              {c.rules.map((r, n) => (
                <span key={r}>
                  {n > 0 ? ", " : ""}
                  <V2Link href={hrefFor({ kind: "rule", id: r })} className="m2-mono">
                    {r}
                  </V2Link>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

