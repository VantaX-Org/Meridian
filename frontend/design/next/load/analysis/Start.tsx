"use client";

/** The start form of a migration analysis: kind, source system and run, target system or release, and the objects. */
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { releaseFor, startMigration, type MigrationMode } from "@/lib/api/v2/migration";
import { getVersionsPage, type VersionHead } from "@/lib/api/v2/runs";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { Button, useToast } from "../../kit";
import { Labelled, MODE, useMig } from "./shared";

/** Complete source runs, newest first: the ones an analysis can read (migration.py _latest_source_version). */
export const completeRuns = (vs: VersionHead[]) => vs.filter((v) => v.status.includes("complete")).sort((a, b) => b.run_at.localeCompare(a.run_at));
export const rowsOf = (v: VersionHead) => Object.values(v.metadata?.module_rows ?? {}).reduce((a, b) => a + b, 0);

/** The start form, shown inside the "Start an analysis" sheet. */
export function StartForm({ onDone, initialSystem = "", initialVersion = "" }: { onDone: () => void; initialSystem?: string; initialVersion?: string }) {
  const land = useLandscape(null);
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<MigrationMode>("s4_dry_run");
  const [src, setSrc] = useState(initialSystem);
  const [ver, setVer] = useState(initialVersion);
  const [dest, setDest] = useState("");
  const [release, setRelease] = useState<"s4hana" | "ecc6">("s4hana");
  const [mods, setMods] = useState<string[]>([]);
  const versions = useMig(["versions", src], () => getVersionsPage({ system_id: src, limit: 50 }), src !== "");
  const runsOf = completeRuns(versions.data?.versions ?? []);
  const picked = runsOf.find((v) => v.id === ver) ?? runsOf[0] ?? null;
  const start = useMutation({
    mutationFn: startMigration,
    onSuccess: () => {
      toast({ text: t("The analysis is queued. It appears in the list when it starts."), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["migration"] });
      onDone();
    },
    onError: (e) => toast({ text: errorSentence(e, t("The analysis could not be started.")), tone: "bad" }),
  });
  const systems = land.data?.systems ?? [];
  const objects = land.data?.objects ?? [];
  const needsDest = mode !== "s4_dry_run";
  const destSys = systems.find((s) => s.id === dest);
  const targetRelease = mode === "s4_dry_run" ? "s4hana" : destSys ? releaseFor(destSys.system_type) : release;
  const ok = src !== "" && picked !== null && mods.length > 0 && (mode !== "source_to_source" || dest !== "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && picked) start.mutate({ mode, source_system_id: src, source_version_id: picked.id, dest_system_id: needsDest && dest ? dest : undefined, target_release: targetRelease, modules: mods });
  };
  return (
    <form className="nx-mig-form" onSubmit={submit} data-testid="mig-start">
      <Labelled label={t("Kind")}>
        <select className="nx-input" value={mode} onChange={(e) => setMode(e.target.value as MigrationMode)}>
          {(Object.keys(MODE) as MigrationMode[]).map((m) => <option key={m} value={m}>{MODE[m]()}</option>)}
        </select>
      </Labelled>
      <Labelled label={t("Source system")}>
        <select className="nx-input" value={src} onChange={(e) => { setSrc(e.target.value); setVer(""); }}>
          <option value="">{t("Choose a system")}</option>
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Labelled>
      {src ? (
        <Labelled label={t("Source run")}>
          <select className="nx-input" data-testid="mig-start-version" value={picked?.id ?? ""} onChange={(e) => setVer(e.target.value)} disabled={runsOf.length === 0}>
            {runsOf.length === 0 ? <option value="">{versions.isPending ? t("Reading the runs") : t("No complete run for this system")}</option> : null}
            {runsOf.map((v, i) => (
              <option key={v.id} value={v.id}>{i === 0 ? t("{date}, {n} rows (latest)", { date: formatDate(v.run_at, "datetime"), n: int(rowsOf(v)) }) : t("{date}, {n} rows", { date: formatDate(v.run_at, "datetime"), n: int(rowsOf(v)) })}</option>
            ))}
          </select>
        </Labelled>
      ) : null}
      {needsDest ? (
        <Labelled label={t("Target system")}>
          <select className="nx-input" value={dest} onChange={(e) => setDest(e.target.value)}>
            <option value="">{mode === "source_to_source" ? t("Choose a system") : t("No target system")}</option>
            {systems.filter((s) => s.id !== src).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Labelled>
      ) : null}
      {needsDest && !destSys ? (
        <Labelled label={t("Target release")}>
          <select className="nx-input" data-testid="mig-start-release" value={release} onChange={(e) => setRelease(e.target.value as "s4hana" | "ecc6")}>
            <option value="s4hana">{t("S/4HANA")}</option>
            <option value="ecc6">{t("ECC 6.0")}</option>
          </select>
        </Labelled>
      ) : null}
      <fieldset className="nx-mig-checks">
        <legend>{t("Objects")}</legend>
        {objects.map((o) => (
          <label key={o.module}>
            <input type="checkbox" checked={mods.includes(o.module)} onChange={(e) => setMods((m) => (e.target.checked ? [...m, o.module] : m.filter((x) => x !== o.module)))} /> {o.label}
          </label>
        ))}
      </fieldset>
      <div className="nx-ld-actions">
        <Button type="submit" variant="primary" disabled={!ok} loading={start.isPending} data-testid="mig-start-submit">{t("Start")}</Button>
      </div>
    </form>
  );
}
