"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WaveStage } from "@/types/api";
import * as rep from "@/lib/api/v2/reports";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useWaves } from "@/lib/v2/admin-queries";
import { useRunParam, useV2Session } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { reassign, sortWaves, waveOf } from "@/lib/v2/waves";
import { Actions, InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Confirm, useDone } from "../admin/kit";
import { ResultFrame, useOutcome } from "./shared";
import { WaveGateEditor } from "./governance";
import { CertificateBlock } from "../screens/step9/Certificate";
import { t } from "@/lib/v2/i18n";

export const STAGES: { value: WaveStage; label: string }[] = [
  { value: "plan", get label() { return t("Plan"); } },
  { value: "mock1", get label() { return t("Mock load 1"); } },
  { value: "mock2", get label() { return t("Mock load 2"); } },
  { value: "dress", get label() { return t("Dress rehearsal"); } },
  { value: "cutover", get label() { return t("Cutover"); } },
];

/** `?open=waves`: which objects move in which wave, and when. Changing waves needs the analyse permission. */
export function WavesPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const run0 = useRunParam();
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
  const objects = landscape.data?.objects ?? [];
  const current = (module: string): string => choice[module] ?? waveOf(module, list)?.id ?? "";
  const modulesChanged = reassign(list, Object.fromEntries(Object.entries(choice).filter(([m, id]) => (waveOf(m, list)?.id ?? "") !== id)));
  const patches = list.flatMap((w) => {
    const patch: rep.WavePatch = {};
    if (names[w.id] !== undefined && names[w.id].trim() && names[w.id].trim() !== w.name) patch.name = names[w.id].trim();
    if (dates[w.id] !== undefined && (dates[w.id] || null) !== (w.target_date?.slice(0, 10) ?? null)) patch.target_date = dates[w.id] || null;
    if (stages[w.id] !== undefined && stages[w.id] !== w.stage) patch.stage = stages[w.id];
    if (modulesChanged[w.id]) patch.modules = modulesChanged[w.id];
    return Object.keys(patch).length ? [{ w, patch }] : [];
  });
  const dirty = patches.length > 0;
  const save = () =>
    void run("save", async () => {
      const before = patches.map(({ w, patch }) => ({ id: w.id, prev: Object.fromEntries(Object.keys(patch).map((k) => [k, (w as unknown as Record<string, unknown>)[k]])) as rep.WavePatch }));
      for (const { w, patch } of patches) await rep.updateWave(w.id, patch);
      await refreshAdmin(qc, "waves");
      setChoice({});
      setDates({});
      setStages({});
      setNames({});
      done(t("Updated {patchesCount} {patchesCount, plural, one {wave} other {waves}}", { patchesCount: patches.length }), async () => {
        for (const b of before) await rep.updateWave(b.id, b.prev);
        await refreshAdmin(qc, "waves");
      });
      return { tone: "ok", title: t("{patchesCount} {patchesCount, plural, one {wave} other {waves}} updated", { patchesCount: patches.length }), detail: t("A changed wave needs a new sign-off.") };
    });
  // Signing off is the data owner's or lead's decision (approve); the server refuses a wave whose verdict is not go.
  const canSignOff = session.can("approve");
  const signOff = (id: string, name: string) =>
    void run(`signoff:${id}`, async () => {
      await rep.signOffWave(id);
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
  return (
    <InspectorFrame title={t("Migration waves")} status={t("{listCount} {listCount, plural, one {wave} other {waves}}", { listCount: list.length })} onClose={onClose}>
      {!allowed ? <p className="m2-prov">{t("Changing waves needs the analyse permission on these systems. You can read them here.")}</p> : null}
      {waves.isError ? <ErrorFrame onRetry={() => void waves.refetch()}>{t("The waves could not be read.")}</ErrorFrame> : null}
      {waves.isLoading ? <Skeleton width="100%" height={100} /> : null}
      {waves.isSuccess && list.length === 0 ? <EmptyFrame>{t("No wave exists yet. Add the first one below, then assign objects to it.")}</EmptyFrame> : null}
      {list.map((w) => (
        <div key={w.id} className="m2-aform" style={{ marginBottom: "var(--m2-s4)", paddingBottom: "var(--m2-s3)", borderBottom: "1px solid var(--m2-rule)" }} role="group" aria-label={t("Wave {name}", { name: w.name })}>
          <label>
            {t("Name")}
            <input value={names[w.id] ?? w.name} disabled={!allowed} onChange={(e) => setNames({ ...names, [w.id]: e.target.value })} />
          </label>
          <label>
            {t("Target date")}
            <input type="date" value={dates[w.id] ?? w.target_date?.slice(0, 10) ?? ""} disabled={!allowed} onChange={(e) => setDates({ ...dates, [w.id]: e.target.value })} />
          </label>
          <label>
            {t("Stage")}
            <select value={stages[w.id] ?? w.stage} disabled={!allowed} onChange={(e) => setStages({ ...stages, [w.id]: e.target.value as WaveStage })}>
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span className="m2-prov" style={{ margin: 0 }}>
            {w.signed_off_at ? t("Signed off {signed_off_at}. Any change clears the sign-off.", { signed_off_at: formatDate(w.signed_off_at) }) : t("Not signed off.")}
          </span>
          {!w.signed_off_at && canSignOff ? (
            <button type="button" className="m2-btn m2-sm" style={{ justifySelf: "start" }} disabled={pending !== null} onClick={() => signOff(w.id, w.name)}>
              {pending === `signoff:${w.id}` ? t("Signing off…") : t("Sign off {name}", { name: w.name })}
            </button>
          ) : null}
          <WaveGateEditor waveId={w.id} />
          <details className="m2-ct" data-testid="wave-certificate">
            <summary>{t("Readiness certificate")}</summary>
            <CertificateBlock waveId={w.id} waveName={w.name} />
          </details>
          {allowed ? (
            <button type="button" className="m2-linkbtn" style={{ justifySelf: "start" }} onClick={() => setRemoving(w.id)}>
              {t("Delete {name}", { name: w.name })}
            </button>
          ) : null}
        </div>
      ))}
      {allowed ? (
        <>
          <h3>{t("Add a wave")}</h3>
          <div className="m2-aform">
            <label>
              {t("Name")}
              <input value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} placeholder={t("Wave 4: warehouse")} />
            </label>
            <label>
              {t("Target date (optional)")}
              <input type="date" value={fresh.date} onChange={(e) => setFresh({ ...fresh, date: e.target.value })} />
            </label>
            <label>
              {t("Stage")}
              <select value={fresh.stage} onChange={(e) => setFresh({ ...fresh, stage: e.target.value as WaveStage })}>
                {STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="m2-acts" style={{ marginTop: "var(--m2-s2)" }}>
            <button type="button" className="m2-btn" disabled={!fresh.name.trim() || pending !== null} onClick={create}>
              {pending === "create" ? t("Adding…") : t("Add the wave")}
            </button>
          </div>
        </>
      ) : null}
      <h3>{t("Objects")}</h3>
      {objects.length === 0 ? (
        <EmptyFrame>{t("No object has been scored yet, so there is nothing to assign.")}</EmptyFrame>
      ) : (
        <div className="m2-frame" tabIndex={0} style={{ maxHeight: 360 }}>
          <table className="m2-tbl" aria-label={t("Objects by wave")}>
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
                    <select className="m2-sel" aria-label={t("Wave of {label}", { label: o.label })} value={current(o.module)} disabled={!allowed || list.length === 0} onChange={(e) => setChoice({ ...choice, [o.module]: e.target.value })}>
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
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button type="button" className="m2-btn m2-strong" disabled={!allowed || !dirty || pending !== null} onClick={save}>
          {pending === "save" ? t("Saving…") : dirty ? t("Save {patchesCount} {patchesCount, plural, one {change} other {changes}}", { patchesCount: patches.length }) : t("Save changes")}
        </button>
        <button type="button" className="m2-btn" disabled={!dirty} onClick={() => (setChoice({}), setDates({}), setStages({}), setNames({}))}>
          {t("Discard")}
        </button>
      </Actions>
      {removing ? (
        <Confirm
          title={t("Delete {name}", { name: list.find((w) => w.id === removing)?.name ?? t("the wave") })}
          body={t("The wave and its sign-off are removed. The objects stay where they are, in no wave.")}
          confirm={t("Delete the wave")}
          danger
          pending={pending === "delete"}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void run("delete", async () => {
              await rep.deleteWave(removing);
              await refreshAdmin(qc, "waves");
              setRemoving(null);
              return { tone: "ok", title: t("Wave deleted") };
            })
          }
        />
      ) : null}
    </InspectorFrame>
  );
}
