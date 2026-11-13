"use client";

/**
 * Load files of one object: the load options, then a download for the blank template and for each template the
 * object keeps. The options go to the API as load_mode, since and all_entities; the blank template takes only
 * all_entities (it carries no rows, so the load mode does not change it).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, ErrorState, Skeleton } from "@/design/next/kit";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { downloadBlankTemplate, exportTemplate, getTemplates, type LoadFileFormat, type TargetTemplate } from "@/lib/api/v2/migration";
import { t } from "@/lib/v2/i18n";
import { DEFAULT_LOAD, LoadOptions, loadOptionsProblem, toLoadOptions, type LoadChoice } from "./LoadOptions";

export function LoadFilesPanel({ module }: { module: string }) {
  const fx = useFixture();
  const [choice, setChoice] = useState<LoadChoice>(DEFAULT_LOAD);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["next", "load-templates", fx, module] as const, queryFn: () => getTemplates(module) });
  const problem = loadOptionsProblem(choice);

  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    setFailed(null);
    try { await job(); } catch (e) { setFailed(errorSentence(e, t("The load file could not be built."))); } finally { setBusy(null); }
  };
  const get = (tpl: TargetTemplate, fmt: LoadFileFormat) => run(`${tpl.id}-${fmt}`, () => exportTemplate(module, tpl, fmt, toLoadOptions(choice)));

  return (
    <section className="nx-card nx-load-files" aria-label={t("Load files")} data-testid="load-files">
      <h3 className="nx-cycle-h">{t("Load files")}</h3>
      <LoadOptions value={choice} onChange={setChoice} />
      {failed && <p role="alert" className="nx-load-error">{failed}</p>}
      <div className="nx-load-actions">
        <Button variant="secondary" loading={busy === "blank"} loadingLabel={t("Building")} onClick={() => run("blank", () => downloadBlankTemplate(module, choice.all_entities))}>{t("Download blank template")}</Button>
      </div>
      {list.isLoading ? <Skeleton /> : list.isError ? <ErrorState sentence={errorSentence(list.error, t("The templates could not be read."))} onRetry={() => void list.refetch()} /> : !list.data?.templates.length ? (
        <EmptyState heading={t("No template kept for this object")}>{t("Upload the target system's template on the Cycle tab to build a load file in its columns.")}</EmptyState>
      ) : (
        <ul className="nx-load-list">
          {list.data.templates.map((tpl) => (
            <li key={tpl.id} className="nx-load-actions">
              <span>{tpl.name}</span>
              {(["xlsx", "csv"] as const).map((fmt) => (
                <Button key={fmt} size={32} disabled={!!problem} reason={problem} loading={busy === `${tpl.id}-${fmt}`} loadingLabel={t("Building")} onClick={() => void get(tpl, fmt)}>
                  {fmt === "xlsx" ? t("Download as Excel") : t("Download as CSV")}
                </Button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
