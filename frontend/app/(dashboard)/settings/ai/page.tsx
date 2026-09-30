"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, Field, Input, Panel, Select, Stack, Text } from "@/components/aurora";
import { PageHead } from "@/components/meridian/atoms";
import {
  getLLMConfig,
  getLLMProviders,
  testLLMConnection,
  updateLLMConfig,
  type LLMConfig,
  type LLMConfigUpdate,
} from "@/lib/api/llm-settings";
import { useRole } from "@/hooks/use-role";

export default function AISettingsPage() {
  const { can } = useRole();
  const { data: providers } = useQuery({ queryKey: ["llm.providers"], queryFn: getLLMProviders, enabled: can("manage_llm") });
  const { data: config } = useQuery({ queryKey: ["llm.config"], queryFn: getLLMConfig, enabled: can("manage_llm") });

  if (!can("manage_llm")) {
    return (
      <div data-theme="light" className="space-y-6">
        <PageHead title="AI settings" route="/settings/ai" />
        <Banner tone="info" title="Admins only">Ask an administrator to change the language-model provider.</Banner>
      </div>
    );
  }
  return (
    <div data-theme="light" className="space-y-6">
      <PageHead
        title="AI settings"
        route="/settings/ai"
        sub="The language model only ever receives aggregated finding summaries — never SAP records. Every number in Meridian comes from deterministic checks; the model writes narrative and proposals."
      />
      {providers && config && <LLMForm key={config.updated_at ?? "env"} providers={providers} config={config} />}
    </div>
  );
}

function LLMForm({ providers, config }: { providers: Awaited<ReturnType<typeof getLLMProviders>>; config: LLMConfig }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<LLMConfigUpdate>({
    provider: config.provider, model: config.model, base_url: config.base_url, temperature: config.temperature,
    max_tokens: config.max_tokens, request_timeout: config.request_timeout,
    azure_deployment: config.azure_deployment, azure_api_version: config.azure_api_version,
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

  return (
    <Panel title="Provider" action={<Chip>{config.source === "database" ? "set here" : "from environment"}</Chip>}>
      <Stack gap={4}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Provider" helper={p?.description}>
            {({ controlId }) => (
              <Select id={controlId} value={form.provider}
                options={Object.entries(providers).map(([k, v]) => ({ value: k, label: v.label }))}
                onValueChange={(v) => set({ provider: v, model: providers[v]?.default_model, base_url: providers[v]?.default_base_url })} />
            )}
          </Field>
          <Field label="Model">
            {({ controlId }) => <Input id={controlId} value={form.model ?? ""} onChange={(e) => set({ model: e.target.value })} />}
          </Field>
          {p?.requires_base_url && (
            <Field label="Endpoint URL">
              {({ controlId }) => <Input id={controlId} value={form.base_url ?? ""} onChange={(e) => set({ base_url: e.target.value })} />}
            </Field>
          )}
          {p?.requires_api_key && (
            <Field label="API key" helper={config.has_api_key ? `Stored (${config.api_key_preview}) — leave blank to keep it` : "Not set"}>
              {({ controlId }) => <Input id={controlId} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />}
            </Field>
          )}
          {form.provider === "azure_openai" && (
            <>
              <Field label="Azure deployment">
                {({ controlId }) => <Input id={controlId} value={form.azure_deployment ?? ""} onChange={(e) => set({ azure_deployment: e.target.value })} />}
              </Field>
              <Field label="Azure API version">
                {({ controlId }) => <Input id={controlId} value={form.azure_api_version ?? ""} onChange={(e) => set({ azure_api_version: e.target.value })} />}
              </Field>
            </>
          )}
          <Field label="Temperature">
            {({ controlId }) => <Input id={controlId} type="number" step="0.1" min="0" max="2" value={form.temperature ?? ""} onChange={(e) => set({ temperature: num(e.target.value) })} />}
          </Field>
          <Field label="Max tokens">
            {({ controlId }) => <Input id={controlId} type="number" min="1" value={form.max_tokens ?? ""} onChange={(e) => set({ max_tokens: num(e.target.value) })} />}
          </Field>
          <Field label="Request timeout (s)">
            {({ controlId }) => <Input id={controlId} type="number" min="1" value={form.request_timeout ?? ""} onChange={(e) => set({ request_timeout: num(e.target.value) })} />}
          </Field>
        </div>
        {test.data && (
          <Banner tone={test.data.success ? "success" : "danger"} title={test.data.success ? "Connection works" : "Connection failed"}>
            {test.data.message}
          </Banner>
        )}
        {test.error && <Banner tone="danger" title="Test refused">{(test.error as Error).message}</Banner>}
        <Stack direction="row" gap={2}>
          <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
        </Stack>
        {config.updated_at && (
          <Text variant="text-small" tone="muted">Last changed {new Date(config.updated_at).toLocaleString()} by {config.updated_by ?? "—"}</Text>
        )}
      </Stack>
    </Panel>
  );
}
