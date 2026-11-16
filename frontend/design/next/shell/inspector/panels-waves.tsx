"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WaveStage } from "@/types/api";
import * as rep from "@/lib/api/v2/reports";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useWaves } from "@/lib/v2/admin-queries";
import { useOpenItem, useRunParam, useV2Session } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { reassign, sortWaves, waveOf } from "@/lib/v2/waves";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { Button, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, InspectorFrame, type BodyProps } from "./frame";
import { Result, useDone, useOutcome } from "./panels-kit";
import { WaveCockpitBlock, WaveGateEditor } from "./panels-waves-cockpit";

const STAGES: { value: WaveStage; label: () => string }[] = [
  { value: "plan", label: () => t("Plan") },
  { value: "mock1", label: () => t("Mock load 1") },
  { value: "mock2", label: () => t("Mock load 2") },
  { value: "dress", label: () => t("Dress rehearsal") },
  { value: "cutover", label: () => t("Cutover") },
];

/** `?open=waves`: which objects move in which wave, and when. `?open=waves:{id}` opens that wave first, its gate
 * on top, the others collapsed. Changing waves needs the analyse permission. */
export function WavesBody({ id, onClose }: BodyProps) {
  const qc = useQueryClient();
  const session = useV2Session();
  const run0 = useRunParam();
  const { hrefFor } = useOpenItem();
  const allowed = session.can("analyse");
  const waves = useWaves();
  const landscape = useLandscape(run0);
  const done = useDone();
  const { outcome, pending, run } = useOutcome();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<Record<string, WaveStage>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState({ name: "", date: "", stage: "plan" as WaveStage });
  const [removing, setRemoving] = useState<string | null>(null);
  const list = sortWaves(waves.data ?? []);
  const chosen = list.some((w) => w.id === id) ? id : "";
  const shown = chosen ? [...list.filter((w) => w.id === chosen), ...list.filter((w) => w.id !== chosen)] : list;
  const objects = landscape.data?.objects ?? [];
  const current = (module: string): string => choice[module] ?? waveOf(module, list)?.id ?? "";
  const modulesChanged = reassign(list, Object.fromEntries(Object.entries(choice).filter(([m, wid]) => (waveOf(m, list)?.id ?? "") !== wid)));
  const patches = list.flatMap((w) => {
    const patch: rep.WavePatch = {};
    if (names[w.id] !== undefined && names[w.id].trim() && names[w.id].trim() !== w.name) patch.name = names[w.id].trim();
    if (dates[w.id] !== undefined && (dates[w.id] || null) !== (w.target_date?.slice(0, 10) ?? null)) patch.target_date = dates[w.id] || null;
    if (stages[w.id] !== undefined && stages[w.id] !== w.stage) patch.stage = stages[w.id];
    if (modulesChanged[w.id]) patch.modules = modulesChanged[w.id];
    return Object.keys(patch).length ? [{ w, patch }] : [];
  });
  const dirty = patches.length > 0;
  const discard = () => {
    setChoice({});
    setDates({});
    setStages({});
    setNames({});
  };
  const save = () =>
    void run("save", async () => {
      const before = patches.map(({ w, patch }) => ({ id: w.id, prev: Object.fromEntries(Object.keys(patch).map((k) => [k, (w as unknown as Record<string, unknown>)[k]])) as rep.WavePatch }));
      for (const { w, patch } of patches) await rep.updateWave(w.id, patch);
      await refreshAdmin(qc, "waves");
      discard();
      done({
        ids: [],
        label: t("Updated {patchesCount} {patchesCount, plural, one {wave} other {waves}}", { patchesCount: patches.length }),
        undo: async () => {
          for (const b of before) await rep.updateWave(b.id, b.prev);
          await refreshAdmin(qc, "waves");
        },
      });
      return { tone: "ok", title: t("{patchesCount} {patchesCount, plural, one {wave} other {waves}} updated", { patchesCount: patches.length }), detail: t("A changed wave needs a new sign-off.") };
    });
  // Signing off is the data owner's or lead's decision (approve); the server refuses a wave whose verdict is not go.
  const canSignOff = session.can("approve");
  const signOff = (wid: string, name: string) =>
    void run(`signoff:${wid}`, async () => {
      await rep.signOffWave(wid);
      await refreshAdmin(qc, "waves");
      return { tone: "ok", title: t("{name} signed off", { name }), detail: t("Any later change to the wave clears the sign-off.") };
    });
  const create = () =>
    void run("create", async () => {
      const w = await rep.createWave({ name: fresh.name.trim(), modules: [], target_date: fresh.date || null, stage: fresh.stage, min_readiness: 95 });
      await refreshAdmin(qc, "waves");
      setFresh({ name: "", date: "", stage: "plan" });
      return { tone: "ok", title: t("Wave {name} created", { name: w.name }), detail: t("Assign objects to it below.") };
    });
  const stageOptions = STAGES.map((s) => (
    <option key={s.value} value={s.value}>
      {s.label()}
    </option>
  ));
  return (
    <InspectorFrame title={t("Migration waves")} status={t("{listCount} {listCount, plural, one {wave} other {waves}}", { listCount: list.length })} onClose={onClose}>
      {!allowed ? <p className="nx-pn-meta">{t("Changing waves needs the analyse permission on these systems. You can read them here.")}</p> : null}
      {waves.isError ? <ErrorState sentence={t("The waves could not be read.")} error={waves.error} onRetry={() => void waves.refetch()} /> : null}
      {waves.isLoading ? <Skeleton lines={4} label={t("Migration waves")} /> : null}
      {waves.isSuccess && list.length === 0 ? <EmptyState heading={t("No wave exists yet. Add the first one below, then assign objects to it.")} /> : null}
      {shown.map((w) => {
        const gate = <WaveGateEditor waveId={w.id} />;
        const form = (
          <div className="nx-pn-form nx-ib-sec" role="group" aria-label={t("Wave {name}", { name: w.name })}>
            <label className="nx-pn-fld">
              <span>{t("Name")}</span>
              <input value={names[w.id] ?? w.name} disabled={!allowed} onChange={(e) => setNames({ ...names, [w.id]: e.target.value })} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Target date")}</span>
              <input type="date" value={dates[w.id] ?? w.target_date?.slice(0, 10) ?? ""} disabled={!allowed} onChange={(e) => setDates({ ...dates, [w.id]: e.target.value })} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Stage")}</span>
              <select value={stages[w.id] ?? w.stage} disabled={!allowed} onChange={(e) => setStages({ ...stages, [w.id]: e.target.value as WaveStage })}>
                {stageOptions}
              </select>
            </label>
            <span className="nx-pn-meta">{w.signed_off_at ? t("Signed off {signed_off_at}. Any change clears the sign-off.", { signed_off_at: formatDate(w.signed_off_at) }) : t("Not signed off.")}</span>
            {!w.signed_off_at && canSignOff ? (
              <span>
                <Button variant="secondary" size={32} disabled={pending !== null} loading={pending === `signoff:${w.id}`} loadingLabel={t("Signing off…")} onClick={() => signOff(w.id, w.name)}>
                  {t("Sign off {name}", { name: w.name })}
                </Button>
              </span>
            ) : null}
            {w.id === chosen ? null : gate}
            <details className="nx-pn-details" data-testid="wave-cockpit-details">
              <summary>{t("Readiness cockpit")}</summary>
              <WaveCockpitBlock wave={w} />
            </details>
            <details className="nx-pn-details" data-testid="wave-certificate">
              <summary>{t("Readiness certificate")}</summary>
              <V2Link href={hrefFor({ kind: "certificate", id: w.id })}>{t("Open the certificate")}</V2Link>
            </details>
            {allowed ? (
              <span>
                <button type="button" className="nx-pn-linkbtn" onClick={() => setRemoving(w.id)}>
                  {t("Delete {name}", { name: w.name })}
                </button>
              </span>
            ) : null}
          </div>
        );
        if (!chosen || w.id === chosen)
          return (
            <div key={w.id}>
              {w.id === chosen ? gate : null}
              {form}
            </div>
          );
        return (
          <details key={w.id} className="nx-pn-details">
            <summary>{w.name}</summary>
            {form}
          </details>
        );
      })}
      {allowed ? (
        <section className="nx-ib-sec" aria-label={t("Add a wave")}>
          <h3>{t("Add a wave")}</h3>
          <div className="nx-pn-form">
            <label className="nx-pn-fld">
              <span>{t("Name")}</span>
              <input value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} placeholder={t("Wave 4: warehouse")} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Target date (optional)")}</span>
              <input type="date" value={fresh.date} onChange={(e) => setFresh({ ...fresh, date: e.target.value })} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Stage")}</span>
              <select value={fresh.stage} onChange={(e) => setFresh({ ...fresh, stage: e.target.value as WaveStage })}>
                {stageOptions}
              </select>
            </label>
            <span>
              <Button variant="secondary" size={32} disabled={!fresh.name.trim() || pending !== null} loading={pending === "create"} loadingLabel={t("Adding…")} onClick={create}>
                {t("Add the wave")}
              </Button>
            </span>
          </div>
        </section>
      ) : null}
      <section className="nx-ib-sec" aria-label={t("Objects")}>
        <h3>{t("Objects")}</h3>
        {objects.length === 0 ? (
          <EmptyState heading={t("No object has been scored yet, so there is nothing to assign.")} />
        ) : (
          <div className="nx-pn-scroll" tabIndex={0}>
            <table className="nx-pn-table" aria-label={t("Objects by wave")}>
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Wave")}</th>
                </tr>
              </thead>
              <tbody>
                {objects.map((o) => (
                  <tr key={o.module}>
                    <th scope="row">{o.label}</th>
                    <td>
                      <select aria-label={t("Wave of {label}", { label: o.label })} value={current(o.module)} disabled={!allowed || list.length === 0} onChange={(e) => setChoice({ ...choice, [o.module]: e.target.value })}>
                        <option value="">{t("No wave")}</option>
                        {list.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Result outcome={outcome} />
      <Actions>
        <Button variant="primary" size={32} disabled={!allowed || !dirty || pending !== null} loading={pending === "save"} loadingLabel={t("Saving…")} onClick={save}>
          {dirty ? t("Save {patchesCount} {patchesCount, plural, one {change} other {changes}}", { patchesCount: patches.length }) : t("Save changes")}
        </Button>
        <Button variant="quiet" size={32} disabled={!dirty} onClick={discard}>
          {t("Discard")}
        </Button>
      </Actions>
      <Confirm
        open={!!removing}
        title={t("Delete {name}", { name: list.find((w) => w.id === removing)?.name ?? t("the wave") })}
        consequence={t("The wave and its sign-off are removed. The objects stay where they are, in no wave.")}
        confirmLabel={t("Delete the wave")}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const wid = removing;
          if (!wid) return;
          void run("delete", async () => {
            await rep.deleteWave(wid);
            await refreshAdmin(qc, "waves");
            setRemoving(null);
            return { tone: "ok", title: t("Wave deleted") };
          });
        }}
      />
    </InspectorFrame>
  );
}
