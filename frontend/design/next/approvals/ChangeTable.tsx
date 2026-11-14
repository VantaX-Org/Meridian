"use client";

import { t } from "@/lib/v2/i18n";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { Chip } from "../kit";
import type { ChangeRow } from "@/lib/api/next/approvals";

/** Each changed field as the value Meridian found next to the value the write-back sets. */
export function ChangeTable({ changes }: { changes: ChangeRow[] }) {
  return (
    <div className="nx-ap-scroll">
      <table className="nx-ap-changes" data-testid="change-table">
        <caption className="nx-sr">{t("Changes this request makes, before and after")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Field")}</th>
            <th scope="col">{t("Record")}</th>
            <th scope="col">{t("Before")}</th>
            <th scope="col">{t("After")}</th>
            <th scope="col">{t("Delivery")}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c, i) => (
            <tr key={`${c.record_key}|${c.field}|${i}`}>
              <td>
                <span className="nx-mono">{sapField(c.field)}</span>
                {describeField(c.field) ? <span className="nx-ap-text">{describeField(c.field)}</span> : null}
              </td>
              <td className="nx-mono">{c.record_key}</td>
              <td className="nx-ap-before nx-mono">{c.before ? c.before : <em>{t("empty")}</em>}</td>
              <td className="nx-ap-after nx-mono">{c.after}</td>
              <td>
                {c.delivery === "bapi" ? <Chip tone="good">{t("Written by {bapi}", { bapi: c.bapi ?? "BAPI" })}</Chip> : <Chip tone="warn">{t("Export for manual load")}</Chip>}
                {c.reason ? <span className="nx-ap-text">{c.reason}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
