"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/v2/admin";
import { refreshAdmin, useReference } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, Confirm, DataTable, DropZone, EmptyState } from "../kit";
import { DataBlock, DataLoaded, DataPage, Field, NeedsPermission, useAct, useCan } from "./data-parts";

type Kind = "postal-codes" | "bic";
type RefRow = { kind: string; records: number; countries: string[] };

const KIND_LABEL: Record<string, () => string> = {
  "postal-codes": () => t("Postal codes"),
  postal_codes: () => t("Postal codes"),
  postal: () => t("Postal codes"),
  bic: () => t("Bank codes (SWIFT BIC)"),
  bics: () => t("Bank codes (SWIFT BIC)"),
};
const kindLabel = (k: string): string => KIND_LABEL[k]?.() ?? labelText(k);

/** Admin › Reference data: the postal code and bank code lists held per system. Uploading replaces a system's list. */
export function ReferenceSection() {
  const can = useCan();
  const qc = useQueryClient();
  const systems = useSystemsExtended();
  const [picked, setPicked] = useState("");
  const id = picked || systems.data?.[0]?.id || "";
  const lists = useReference(id);
  const write = can("manage_systems");
  const [kind, setKind] = useState<Kind>("postal-codes");
  const [csv, setCsv] = useState("");
  const { pending, act } = useAct();
  const system = systems.data?.find((s) => s.id === id);
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <DataPage lead={t("Official postal code and bank code lists, per system, that address and bank rules compare against. Until a list is loaded those rules check the format only.")}>
      <div className="nx-data-form">
        <Field label={t("System")}>
          <select className="nx-input" value={id} onChange={(e) => setPicked(e.target.value)}>
            {(systems.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {systems.isSuccess && (systems.data ?? []).length === 0 ? (
        <EmptyState heading={t("Reference lists belong to a system. Connect a system first, from the landscape.")} />
      ) : (
        <>
          <DataBlock title={t("Reference data")}>
            <DataLoaded q={lists} what={t("The reference lists")} rows={2}>
              {(rows) => (
                <DataTable<RefRow>
                  caption={t("Reference lists")}
                  rows={rows}
                  rowKey={(r) => r.kind}
                  rowLabel={(r) => kindLabel(r.kind)}
                  empty={{ heading: t("No reference data is loaded for {name}. Upload a list below.", { name: system?.name ?? t("this system") }) }}
                  columns={[
                    { id: "list", label: t("List"), cell: (r) => kindLabel(r.kind) },
                    { id: "records", label: t("Records"), align: "end", cell: (r) => int(r.records), compare: (a, b) => a.records - b.records },
                    { id: "countries", label: t("Countries"), cell: (r) => r.countries.join(", ") || "—" },
                    ...(write
                      ? [
                          {
                            id: "remove",
                            label: t("Remove"),
                            cell: (r: RefRow) => (
                              <Button size={32} aria-label={t("Remove {name}", { name: kindLabel(r.kind) })} onClick={() => setRemoving(r.kind)}>
                                {t("Remove")}
                              </Button>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </DataLoaded>
          </DataBlock>
          <Confirm
            open={removing !== null}
            title={t("Remove {name}", { name: kindLabel(removing ?? "") })}
            consequence={t("The list is deleted from {system}. The address and bank checks generated from it stop at the next analysis and fall back to the format check. A rule that still names the list blocks the removal.", { system: system?.name ?? t("this system") })}
            confirmLabel={t("Remove the list")}
            danger
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const k = removing as Kind;
              void act("remove", async () => {
                const r = await api.deleteReference(id, k);
                await refreshAdmin(qc, "reference");
                return `${t("{kindLabel} removed", { kindLabel: kindLabel(r.kind) })}. ${t("{records} records deleted.", { records: int(r.records) })}`;
              }).then(() => setRemoving(null));
            }}
          />
          {write ? (
            <DataBlock
              title={t("Upload or replace a list")}
              hint={t("Postal codes: a CSV with the columns country, postcode (the SAP country key), and optionally city and region, so address rules also check each record's city and region against its postal code. Bank codes: the licensed SWIFT BIC directory as CSV, BIC in the first column. An upload replaces the system's current list.")}
            >
              <div className="nx-data-form">
                <Field label={t("List")}>
                  <select className="nx-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                    <option value="postal-codes">{t("Postal codes")}</option>
                    <option value="bic">{t("Bank codes (SWIFT BIC)")}</option>
                  </select>
                </Field>
                <div className="nx-data-wide">
                  <DropZone label={t("File")} accept=".csv,text/csv,text/plain" hint={t("Choose a file, or paste the lines here.")} onFiles={(files) => void files[0]?.text().then(setCsv)} />
                </div>
                {/* i18n-ignore: CSV is the file format name, as v2 shows it */}
                <Field label="CSV" wide hint={csv ? t("{filterCount} lines ready", { filterCount: csv.split(/\r?\n/).filter(Boolean).length }) : t("Choose a file, or paste the lines here.")}>
                  <textarea className="nx-input" rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} data-testid="reference-csv" />
                </Field>
              </div>
              <div className="nx-data-actions">
                <Button
                  variant="primary"
                  disabled={!csv.trim() || !id || pending !== null}
                  loading={pending === "upload"}
                  loadingLabel={t("Uploading…")}
                  onClick={() =>
                    void act("upload", async () => {
                      const r = await api.uploadReference(id, kind, csv);
                      await refreshAdmin(qc, "reference");
                      setCsv("");
                      return `${t("{kindLabel} loaded", { kindLabel: kindLabel(r.kind) })}. ${t("{records} records{value}.", { records: int(r.records), value: r.countries.length ? t(" for {countries}", { countries: r.countries.join(", ") }) : "" })}`;
                    })
                  }
                >
                  {t("Upload the list")}
                </Button>
              </div>
            </DataBlock>
          ) : (
            <NeedsPermission what={t("Uploading reference data")} permission="manage_systems" />
          )}
        </>
      )}
    </DataPage>
  );
}
