"use client";

import { useQuery } from "@tanstack/react-query";
import { getSystemsExtended } from "@/lib/api/v2/runs";
import { moveKeys, useSetTarget } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Field, Select, Toggle } from "@/ui/kit";
import { Gate } from "../common";

export interface Pick { source: string; target: string }

/** Step 1: the system the data comes from, and the new system it goes to. The target must be flagged as a migration target. */
export function Systems({ pick, onPick, onNext }: { pick: Pick; onPick: (p: Pick) => void; onNext: () => void }) {
  const q = useQuery({ queryKey: moveKeys.systems, queryFn: getSystemsExtended });
  const flag = useSetTarget();
  const all = q.data ?? [];
  const target = all.find((s) => s.id === pick.target);
  const opts = (skip: string) => [{ value: "", label: t("Choose a system") }, ...all.filter((s) => s.id !== skip).map((s) => ({ value: s.id, label: `${s.name} (${s.environment})` }))];
  const ready = !!pick.source && !!target && !!target.migration_target;

  return (
    <Card title={t("Choose the two systems")} sub={t("Everything moves from the source system to the new target system.")}>
      <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the systems")}>
        <div className="mx-col">
          <Field label={t("Move from (source)")} hint={t("The system that holds the data today.")}>
            <Select options={opts(pick.target)} value={pick.source} onChange={(e) => onPick({ ...pick, source: e.target.value })} />
          </Field>
          <Field label={t("Move to (new instance)")} hint={t("The empty system that receives the data.")}>
            <Select options={opts(pick.source)} value={pick.target} onChange={(e) => onPick({ ...pick, target: e.target.value })} />
          </Field>
          {target ? (
            <>
              <Toggle label={t("Use {name} as a migration target", { name: target.name })} checked={!!target.migration_target} disabled={flag.isPending} onChange={(v) => flag.mutate({ id: target.id, target: v })} />
              {!target.migration_target ? <p className="mx-muted" role="status">{t("Switch this on. A system must be flagged as a migration target before anything can be written to it.")}</p> : null}
              {flag.isError ? <p className="mx-field-e" role="alert">{t("The flag could not be saved.")} <Button variant="ghost" onClick={() => flag.mutate({ id: target.id, target: !!flag.variables?.target })}>{t("Try again")}</Button></p> : null}
            </>
          ) : null}
          <div className="mx-actions"><Button variant="primary" disabled={!ready} onClick={onNext}>{t("Continue to scope")}</Button></div>
        </div>
      </Gate>
    </Card>
  );
}
