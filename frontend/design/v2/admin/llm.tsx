"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getLlmConfig, getLlmProviders, putLlmConfig, testLlm, type LlmBody, type LlmConfig, type LlmProvider } from "@/lib/api/v2/llm";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Block, Fld, Loaded, useCan, useUnsaved } from "./kit";

type Draft = Omit<LlmBody, "temperature" | "max_tokens" | "request_timeout"> & { temperature: string; max_tokens: string; request_timeout: string };

const draftOf = (c: LlmConfig): Draft => ({
  provider: c.provider, model: c.model, base_url: c.base_url, api_key: "", azure_deployment: c.azure_deployment, azure_api_version: c.azure_api_version,
  temperature: String(c.temperature), max_tokens: String(c.max_tokens), request_timeout: String(c.request_timeout),
});

function Editor({ config, providers }: { config: LlmConfig; providers: Record<string, LlmProvider> }) {
  const qc = useQueryClient();
  const f = useFixture();
  const [d, setD] = useState<Draft>(() => draftOf(config));
  const dirty = useUnsaved(d);
  const { outcome, pending, run } = useOutcome("llm");
  const p = providers[d.provider];
  // A different provider keeps no key: the stored key belongs to the saved provider.
  const keyStored = config.has_api_key && d.provider === config.provider;
  const temp = Number(d.temperature), tokens = Number(d.max_tokens), timeout = Number(d.request_timeout);
  const errs = {
    key: p?.requires_api_key && !d.api_key && !keyStored ? t("{provider} needs an API key.", { provider: p.label }) : null,
    url: p?.requires_base_url && !d.base_url && !p.default_base_url ? t("{provider} needs a base URL.", { provider: p.label }) : null,
    temp: d.temperature.trim() !== "" && temp >= 0 && temp <= 2 ? null : t("Between 0 and 2"),
    tokens: Number.isInteger(tokens) && tokens >= 1 ? null : t("A whole number above 0"),
    timeout: Number.isInteger(timeout) && timeout >= 1 ? null : t("A whole number of seconds"),
  };
  const valid = !Object.values(errs).some(Boolean);
  const body = (): LlmBody => ({ ...d, model: d.model.trim(), base_url: d.base_url.trim(), temperature: temp, max_tokens: tokens, request_timeout: timeout });
  const pick = (provider: string) => {
    const n = providers[provider];
    setD({ ...d, provider, api_key: "", model: n?.default_model ?? "", base_url: n?.default_base_url ?? "" });
  };
  return (
    <>
      <div className="m2-fgrid">
        <Fld label={t("Provider")}>
          <select value={d.provider} onChange={(e) => pick(e.target.value)}>
            {Object.entries(providers).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Fld>
        <Fld label={t("Model")} mono hint={p ? t("Empty uses {model}.", { model: p.default_model }) : undefined}>
          <input value={d.model} placeholder={p?.default_model} onChange={(e) => setD({ ...d, model: e.target.value })} />
        </Fld>
        {p?.requires_base_url || d.base_url ? (
          <Fld label={t("Base URL")} mono error={errs.url}>
            <input type="url" value={d.base_url} placeholder={p?.default_base_url || "https://"} onChange={(e) => setD({ ...d, base_url: e.target.value })} />
          </Fld>
        ) : null}
        {p?.requires_api_key || d.provider === "custom" ? (
          <Fld label={t("API key")} error={errs.key} hint={keyStored ? t("A key ending {preview} is stored. Leave empty to keep it.", { preview: config.api_key_preview.slice(-4) }) : undefined}>
            <input type="password" autoComplete="new-password" value={d.api_key} onChange={(e) => setD({ ...d, api_key: e.target.value })} />
          </Fld>
        ) : null}
        {d.provider === "azure_openai" ? (
          <>
            <Fld label={t("Azure deployment")} mono>
              <input value={d.azure_deployment} onChange={(e) => setD({ ...d, azure_deployment: e.target.value })} />
            </Fld>
            <Fld label={t("Azure API version")} mono>
              <input value={d.azure_api_version} onChange={(e) => setD({ ...d, azure_api_version: e.target.value })} />
            </Fld>
          </>
        ) : null}
        <Fld label={t("Temperature")} error={errs.temp} hint={t("0 gives the same answer each time.")}>
          <input type="number" min={0} max={2} step={0.1} value={d.temperature} onChange={(e) => setD({ ...d, temperature: e.target.value })} />
        </Fld>
        <Fld label={t("Longest answer, tokens")} error={errs.tokens}>
          <input type="number" min={1} value={d.max_tokens} onChange={(e) => setD({ ...d, max_tokens: e.target.value })} />
        </Fld>
        <Fld label={t("Time limit, seconds")} error={errs.timeout}>
          <input type="number" min={1} value={d.request_timeout} onChange={(e) => setD({ ...d, request_timeout: e.target.value })} />
        </Fld>
      </div>
      {d.provider === "ollama" ? <p className="m2-prov">{t("The bundled model runs inside this deployment. No finding leaves the server.")}</p> : <p className="m2-prov">{t("Aletheia sends aggregated findings to this provider, never SAP records.")}</p>}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button
          type="button"
          className="m2-btn m2-ghost"
          disabled={!valid || pending !== null}
          onClick={() =>
            void run("test", async () => {
              const r = await testLlm(body());
              return { tone: r.success ? "ok" : "fail", title: r.success ? t("The model answered") : t("The model did not answer"), detail: r.message };
            })
          }
        >
          {pending === "test" ? t("Testing…") : t("Test the model")}
        </button>
        <button
          type="button"
          className="m2-btn"
          disabled={!dirty || !valid || pending !== null}
          onClick={() =>
            void run("save", async () => {
              const r = await putLlmConfig(body());
              await qc.invalidateQueries({ queryKey: ["v2", "llm", f] });
              return { tone: "ok", title: t("Aletheia now uses {model}", { model: r.model }) };
            })
          }
        >
          {pending === "save" ? t("Saving…") : t("Save the model")}
        </button>
      </div>
    </>
  );
}

/**
 * Admin › Settings › Language model: the provider and model Aletheia answers with. Read and changed under manage_llm,
 * as the routes are. Until saved here the deployment's environment decides.
 */
export function LlmBlock() {
  const can = useCan()("manage_llm");
  const f = useFixture();
  const cfg = useQuery({ queryKey: ["v2", "llm", f], queryFn: getLlmConfig, enabled: can, retry: false });
  const prov = useQuery({ queryKey: ["v2", "llm", f, "providers"], queryFn: getLlmProviders, enabled: can, retry: false, staleTime: Infinity });
  if (!can) return null;
  return (
    <Block id="llm" title={t("Language model")} hint={t("The model behind Aletheia's answers. It sees aggregated findings only; every number comes from the deterministic checks.")}>
      <Loaded q={cfg} what={t("The language model settings")} rows={3}>
        {(c) => (
          <>
            <p className="m2-prov" data-testid="llm-source">
              {c.source === "environment"
                ? t("Set by the deployment's environment. Saving here overrides it for this tenant.")
                : t("Saved here {when}.", { when: c.updated_at ? formatDate(c.updated_at, "datetime") : "" })}
            </p>
            <Loaded q={prov} what={t("The providers")} rows={2}>
              {(pv) => <Editor key={JSON.stringify(c)} config={c} providers={pv.providers} />}
            </Loaded>
          </>
        )}
      </Loaded>
    </Block>
  );
}
