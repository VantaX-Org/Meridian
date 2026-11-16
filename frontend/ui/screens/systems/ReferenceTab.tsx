"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { deleteReference, getReferenceLists, uploadReference } from "@/lib/api/v2/admin";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Button, Card, Confirm, FieldChip, useToast } from "@/ui/kit";
import { errMsg, Gate } from "./shared";

type Kind = "postal-codes" | "bic";
const KINDS: { kind: Kind; title: () => string; hint: () => string }[] = [
  { kind: "postal-codes", title: () => t("Postal codes"), hint: () => t("A CSV of valid postal codes by country.") },
  { kind: "bic", title: () => t("Bank identifier codes"), hint: () => t("A CSV of BIC codes for bank checks.") },
];

export function ReferenceTab({ id }: { id: string }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const pick = useRef<Kind>("postal-codes");
  const file = useRef<HTMLInputElement>(null);
  const [del, setDel] = useState<Kind | null>(null);
  const q = useQuery({ queryKey: ["v2", "reference-lists", fx, id] as const, queryFn: () => getReferenceLists(id), retry: false });
  const can = me.can("manage_systems");
  const refresh = () => qc.invalidateQueries({ queryKey: ["v2"] });
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try { await uploadReference(id, pick.current, await f.text()); toast(t("Reference list loaded."), "good"); await refresh(); } catch (e) { toast(errMsg(e), "bad"); } finally { if (file.current) file.current.value = ""; }
  };
  const remove = async () => {
    const k = del; setDel(null);
    if (!k) return;
    try { await deleteReference(id, k); toast(t("Reference list removed."), "good"); await refresh(); } catch (e) { toast(errMsg(e), "bad"); }
  };
  return (
    <div className="mx-col">
      <input ref={file} type="file" accept=".csv,text/csv" hidden aria-label={t("Reference file")} onChange={(e) => void upload(e.target.files?.[0])} />
      <Gate q={q} empty={{ heading: t("No reference files yet") }}>
        {(lists) => (
          <>
            {KINDS.map((k) => {
              const have = lists.find((l) => l.kind === k.kind);
              return (
                <Card key={k.kind} title={k.title()} sub={k.hint()} action={can ? <span className="mx-links">
                  <Button variant="secondary" onClick={() => { pick.current = k.kind; file.current?.click(); }}>{have ? t("Replace") : t("Upload")}</Button>
                  {have ? <Button variant="ghost" onClick={() => setDel(k.kind)}>{t("Remove")}</Button> : null}
                </span> : undefined}>
                  {have ? (
                    <>
                      <p>{t("{n} records", { n: whole(have.records) })}</p>
                      <p className="mx-links">{have.countries.map((c) => <FieldChip key={c} code={c} />)}</p>
                    </>
                  ) : <p className="mx-muted">{t("Not loaded. Checks that need this list are skipped.")}</p>}
                </Card>
              );
            })}
          </>
        )}
      </Gate>
      <Confirm open={del !== null} title={t("Remove this reference list?")} confirmLabel={t("Remove")} cancelLabel={t("Cancel")} danger onConfirm={() => void remove()} onCancel={() => setDel(null)}>
        {t("Checks that use it stop running. A list used by an enabled rule cannot be removed.")}
      </Confirm>
    </div>
  );
}
