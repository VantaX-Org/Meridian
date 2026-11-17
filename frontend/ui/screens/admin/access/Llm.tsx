"use client";

import { useState } from "react";
import { Button, Card, Code, EmptyState, Field, Input, Select, Toggle } from "@/ui/kit";
import { Facts, Frame, day, useAct, useLlm, useSectionChat, useSync } from "../common";
import { putLlmAggregatesOnly, putLlmConfig, testLlm, type LlmBody } from "@/lib/api/v2/llm";
import { t, tx } from "@/lib/v2/i18n";
import { apiErrorMessage } from "@/lib/error";

export function Llm() {
  const { config, providers } = useLlm();
  const { run, busy } = useAct();
  const c = config.data;
  const provs = providers.data?.providers ?? {};
  const [form, setForm] = useState<LlmBody | null>(null);
  const [test, setTest] = useState<string | null>(null);

  useSync(c, (c) => {
    if (!form) setForm({ provider: c.provider, model: c.model, base_url: c.base_url, temperature: c.temperature, max_tokens: c.max_tokens, request_timeout: c.request_timeout, azure_deployment: c.azure_deployment, azure_api_version: c.azure_api_version, api_key: "" });
  });

  const facts = c
    ? [
        t("Aletheia uses {model} from {provider}.", { model: c.model, provider: provs[c.provider] ? tx(provs[c.provider].label) : c.provider }),
        c.aggregates_only ? t("Only counts and aggregates go to the model.") : t("Row samples may go to the model."),
        c.has_api_key ? t("An API key is stored.") : t("No API key is stored."),
      ]
    : [];
  useSectionChat("llm", t("Language model"), facts, [t("Which model is in use?"), t("Does the model see row data?")]);

  const set = <K extends keyof LlmBody>(k: K, v: LlmBody[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const prov = form ? provs[form.provider] : undefined;
  const pick = (key: string) => {
    const p = provs[key];
    setForm((f) => (f ? { ...f, provider: key, model: p?.default_model ?? f.model, base_url: p?.default_base_url ?? "" } : f));
  };
  const runTest = async () => {
    if (!form) return;
    setTest(null);
    try {
      const r = await testLlm(form);
      setTest(r.success ? t("The model answered: {text}", { text: r.response_preview }) : tx(r.message));
    } catch (e) {
      setTest(tx(apiErrorMessage(e)));
    }
  };

  return (
    <Frame slug="llm" title={t("Language model")} lead={t("Which model answers Aletheia, and whether it sees only aggregates.")} loading={config.isLoading || providers.isLoading} error={config.isError}>
      {!c || !form ? <EmptyState heading={t("No language model is configured")} /> : (
        <>
          <Card title={t("Privacy")} sub={t("When on, only counts and aggregates go to the model, never a row, a mask or a key shape.")}>
            <Toggle label={t("Send aggregates only")} checked={c.aggregates_only} onChange={(v: boolean) => run(() => putLlmAggregatesOnly(v), t("Privacy setting saved."), ["llm-config"])} />
          </Card>
          <Card title={t("Provider and model")} sub={c.source === "environment" ? t("Set by the deployment environment. Saving here takes over.") : t("Saved in this tenant.")}>
            <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => putLlmConfig(form), t("Language model saved."), ["llm-config"]); }}>
              <Field label={t("Provider")} hint={prov ? tx(prov.description) : undefined}>
                <Select value={form.provider} onChange={(e) => pick(e.target.value)} options={Object.entries(provs).map(([k, p]) => ({ value: k, label: tx(p.label) }))} />
              </Field>
              <Field label={t("Model")}><Input value={form.model} onChange={(e) => set("model", e.target.value)} /></Field>
              {prov?.requires_base_url && <Field label={t("Base URL")}><Input value={form.base_url} onChange={(e) => set("base_url", e.target.value)} /></Field>}
              {prov?.requires_api_key && (
                <Field label={t("API key")} hint={c.has_api_key ? t("A key is stored ({preview}). Leave empty to keep it.", { preview: c.api_key_preview }) : t("No key is stored yet.")}>
                  <Input type="password" autoComplete="off" value={form.api_key} onChange={(e) => set("api_key", e.target.value)} />
                </Field>
              )}
              {form.provider === "azure" && (
                <>
                  <Field label={t("Azure deployment")}><Input value={form.azure_deployment} onChange={(e) => set("azure_deployment", e.target.value)} /></Field>
                  <Field label={t("Azure API version")}><Input value={form.azure_api_version} onChange={(e) => set("azure_api_version", e.target.value)} /></Field>
                </>
              )}
              <Field label={t("Temperature")}><Input type="number" step="0.1" min={0} max={2} value={form.temperature} onChange={(e) => set("temperature", Number(e.target.value))} /></Field>
              <Field label={t("Most tokens in an answer")}><Input type="number" min={1} value={form.max_tokens} onChange={(e) => set("max_tokens", Number(e.target.value))} /></Field>
              <Field label={t("Request timeout in seconds")}><Input type="number" min={1} value={form.request_timeout} onChange={(e) => set("request_timeout", Number(e.target.value))} /></Field>
              <div className="mx-links">
                <Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button>
                <Button variant="secondary" type="button" onClick={runTest}>{t("Test the connection")}</Button>
              </div>
              {test && <p role="status" className="mx-muted">{test}</p>}
            </form>
          </Card>
          <Card title={t("Current setting")}>
            <Facts items={[
              [t("Provider"), <Code key="p" code={c.provider} description={provs[c.provider] ? tx(provs[c.provider].label) : c.provider} />],
              [t("Model"), c.model],
              [t("Source"), c.source === "database" ? t("Saved in this tenant") : t("Deployment environment")],
              [t("Last changed"), day(c.updated_at)],
            ]} />
          </Card>
        </>
      )}
    </Frame>
  );
}
