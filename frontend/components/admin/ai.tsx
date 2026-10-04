"use client";

/**
 * Admin → AI: the language-model provider for narrative and proposals. The
 * model only ever receives aggregated finding summaries, never SAP records;
 * every number in Meridian comes from deterministic checks.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, Field, Input, KpiRail, Panel, Select, Stack, Stat, Text } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { getLLMConfig, getLLMProviders, testLLMConnection, updateLLMConfig, type LLMConfig, type LLMConfigUpdate, type LLMProvider } from "@/lib/api/llm-settings";

export function AISurface() {
  const { can } = useRole();
  const allowed = can("manage_llm");
  const providers = useQuery({ queryKey: ["llm.providers"], queryFn: getLLMProviders, enabled: allowed });
  const config = useQuery({ queryKey: ["llm.config"], queryFn: getLLMConfig, enabled: allowed });
  if (!allowed) {
    return <Stack gap={5} className="aurora-page"><Banner tone="info" title="Administrators change the language model">Ask an administrator to change the provider, model or endpoint.</Banner></Stack>;
  }
  const c = config.data;
  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Provider" value={c ? (providers.data?.[c.provider]?.label || c.provider || "not set") : "—"} tone={c && !c.provider ? "warning" : "neutral"} />
        <Stat label="Model" value={c?.model || "—"} />
        <Stat label="API key" value={c ? (c.has_api_key ? "stored" : "not set") : "—"} tone={c?.has_api_key ? "success" : "neutral"} />
        <Stat label="Configured" value={c ? (c.source === "database" ? "here" : "environment") : "—"} />
      </KpiRail>
      <Banner tone="info" title="The model never sees SAP data">It receives aggregated finding summaries and writes narrative and remediation proposals. Every score, count and rate comes from deterministic checks.</Banner>
      {providers.data && c ? <LLMForm key={c.updated_at ?? "env"} providers={providers.data} config={c} /> : <Text tone="muted">Reading the language-model settings.</Text>}
    </Stack>
  );
}

function LLMForm({ providers, config }: { providers: Record<string, LLMProvider>; config: LLMConfig }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<LLMConfigUpdate>({
    provider: config.provider, model: config.model, base_url: config.base_url, temperature: config.temperature, max_tokens: config.max_tokens,
    request_timeout: config.request_timeout, azure_deployment: config.azure_deployment, azure_api_version: config.azure_api_version,
  });
  const [apiKey, setApiKey] = useState("");
  const p = providers[form.provider];
  const body = (): LLMConfigUpdate => ({ ...form, ...(apiKey ? { api_key: apiKey } : {}) });
  const save = useMutation({
    mutationFn: () => updateLLMConfig(body()),
    onSuccess: () => { toast.success("Language-model settings saved"); setApiKey(""); qc.invalidateQueries({ queryKey: ["llm.config"] }); },
    onError: (e) => toast.error((e as Error).message || "Settings not saved"),
  });
  const test = useMutation({ mutationFn: () => testLLMConnection(body()) });
  const set = (patch: Partial<LLMConfigUpdate>) => setForm({ ...form, ...patch });
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const text = (k: keyof LLMConfigUpdate, label: string, props: Partial<React.ComponentProps<typeof Input>> = {}, helper?: string) => (
    <Field label={label} helper={helper}>{({ controlId }) => <Input id={controlId} value={String(form[k] ?? "")} onChange={(e) => set({ [k]: props.type === "number" ? num(e.target.value) : e.target.value })} {...props} />}</Field>
  );
  return (
    <Panel title="Provider" action={<Chip tone={config.source === "database" ? "info" : "neutral"}>{config.source === "database" ? "set here" : "from environment"}</Chip>}>
      <Stack gap={4}>
        <Stack direction="row" gap={3} wrap className="aurora-filters">
          <Field label="Provider" helper={p?.description}>{({ controlId }) => (
            <Select id={controlId} value={form.provider} options={Object.entries(providers).map(([k, v]) => ({ value: k, label: v.label }))}
              onValueChange={(v) => set({ provider: v, model: providers[v]?.default_model, base_url: providers[v]?.default_base_url })} />)}</Field>
          {text("model", "Model")}
          {p?.requires_base_url ? text("base_url", "Endpoint URL", { type: "url", className: "aurora-number" }) : null}
          {p?.requires_api_key ? (
            <Field label="API key" helper={config.has_api_key ? `Stored (${config.api_key_preview}); leave blank to keep it` : "Not set"}>
              {({ controlId }) => <Input id={controlId} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />}
            </Field>
          ) : null}
          {form.provider === "azure_openai" ? <>{text("azure_deployment", "Azure deployment")}{text("azure_api_version", "Azure API version")}</> : null}
        </Stack>
        <Stack direction="row" gap={3} wrap className="aurora-filters">
          {text("temperature", "Temperature", { type: "number", step: "0.1", min: "0", max: "2" }, "0 is deterministic; narrative reads best at 0.2 to 0.4")}
          {text("max_tokens", "Max tokens", { type: "number", min: "1" })}
          {text("request_timeout", "Request timeout", { type: "number", min: "1" }, "seconds; bundled Ollama needs 120")}
        </Stack>
        {test.data ? <Banner tone={test.data.success ? "success" : "danger"} title={test.data.success ? "Connection works" : "Connection failed"}>{test.data.message}{test.data.response_preview ? ` — “${test.data.response_preview}”` : ""}</Banner> : null}
        {test.error ? <Banner tone="danger" title="Test refused">{(test.error as Error).message}</Banner> : null}
        <Stack direction="row" gap={2}>
          <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? "Testing…" : "Test connection"}</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save settings"}</Button>
        </Stack>
        {config.updated_at ? <Text variant="text-small" tone="muted">Last changed {new Date(config.updated_at).toLocaleString()} by {config.updated_by ?? "—"}</Text> : null}
      </Stack>
    </Panel>
  );
}
