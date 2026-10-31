"use client";

import "../step10.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { enterSandbox, exitSandbox } from "@/lib/api/v2/step10";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { refreshStep10, useSandbox } from "@/lib/v2/step10-queries";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Mono, V2Link } from "../parts";
import { Block, Confirm, Kv, Loaded, StatusWord, useCan } from "./kit";

/** Rows per table in words: "1 analysis_versions, 794 findings". */
const rowsWords = (m: Record<string, number>): string => Object.entries(m).map(([k, v]) => `${int(v)} ${k}`).join(", ");

/**
 * Admin › Settings › Sandbox mode: copy the latest run into a sandbox and decide on it with nothing leaving the
 * deployment, then exit and discard it. Entering and exiting need manage_system; anyone with view reads the state.
 */
export function SandboxBlock() {
  const qc = useQueryClient();
  const can = useCan()("manage_system");
  const q = useSandbox();
  const [asking, setAsking] = useState<"enter" | "exit" | null>(null);
  const { outcome, pending, run } = useOutcome("sandbox");
  return (
    <Block id="sandbox" title={t("Sandbox mode")} hint={t("A copy of the latest run to decide on, to rehearse or to train people, with nothing leaving the deployment: notifications, webhooks, digests, report mailouts and SAP write-backs are held back and logged.")}>
      <Loaded q={q} what={t("The sandbox state")} rows={2}>
        {(s) => (
          <>
            <Kv
              rows={[
                [t("State"), <StatusWord key="s" tone={s.sandbox ? "at-risk" : "neutral"}>{s.sandbox ? t("In sandbox") : t("Off")}</StatusWord>],
                [t("Since"), s.since ? (s.by ? t("{when}, by {who}", { when: formatDate(s.since, "datetime"), who: s.by }) : formatDate(s.since, "datetime")) : "—"],
                [
                  t("Runs copied"),
                  s.runs.length ? (
                    <span key="r">
                      {s.runs.map((r, n) => (
                        <span key={r}>
                          {n > 0 ? ", " : ""}
                          <V2Link href={`/run/${r}`}>
                            <Mono>{r.slice(0, 12)}</Mono>
                          </V2Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    t("None")
                  ),
                ],
                [t("Deliveries held back"), int(s.skipped_deliveries)],
              ]}
            />
            {outcome ? <ResultFrame outcome={outcome} /> : null}
            {can ? (
              <div className="m2-adm-acts">
                <button type="button" role="switch" aria-checked={s.sandbox} className="m2-switch" disabled={pending !== null} onClick={() => setAsking(s.sandbox ? "exit" : "enter")}>
                  <span className="m2-switch-knob" aria-hidden="true" />
                  {pending ? t("Working…") : s.sandbox ? t("Exit sandbox mode") : t("Enter sandbox mode")}
                </button>
              </div>
            ) : (
              <p className="m2-prov">{t("Entering and exiting sandbox mode needs the manage system permission.")}</p>
            )}
            {asking === "enter" ? (
              <Confirm
                title={t("Enter sandbox mode")}
                body={t("The latest finished run is copied into a sandbox run. Until you exit, decisions land on the copy only and nothing leaves this deployment. Decisions on the real run are refused.")}
                confirm={t("Copy the latest run and enter")}
                pending={pending === "enter"}
                onCancel={() => setAsking(null)}
                onConfirm={() =>
                  void run("enter", async () => {
                    const r = await enterSandbox(true);
                    setAsking(null);
                    await refreshStep10(qc, "sandbox");
                    return { tone: "ok", title: t("Sandbox mode is on"), detail: r.sandbox_run_id ? t("Copied run {run}: {rows}.", { run: r.sandbox_run_id.slice(0, 12), rows: rowsWords(r.copied) || t("no rows") }) : t("No finished run to copy: the flag alone is on.") };
                  })
                }
              />
            ) : null}
            {asking === "exit" ? (
              <Confirm
                title={t("Exit sandbox mode")}
                body={t("The sandbox runs and every decision made on them are discarded. Deliveries held back are not sent afterwards.")}
                confirm={t("Discard the sandbox and exit")}
                danger
                pending={pending === "exit"}
                onCancel={() => setAsking(null)}
                onConfirm={() =>
                  void run("exit", async () => {
                    const r = await exitSandbox();
                    setAsking(null);
                    await refreshStep10(qc, "sandbox");
                    return { tone: "ok", title: t("Sandbox mode is off"), detail: Object.keys(r.discarded).length ? t("Discarded: {rows}.", { rows: rowsWords(r.discarded) }) : undefined };
                  })
                }
              />
            ) : null}
          </>
        )}
      </Loaded>
    </Block>
  );
}
