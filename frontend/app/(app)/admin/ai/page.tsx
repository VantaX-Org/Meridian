"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, ErrorState, Field, Notice, PageHeader, Select, Skeleton, Input, toast } from "@/design";
import { SettingsSection, SettingsSheet } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import {
  getLLMConfig,
  getLLMProviders,
  testLLMConnection,
  updateLLMConfig,
  type LLMConfig,
  type LLMConfigUpdate,
  type LLMProvider,
} from "@/lib/api/llm-settings";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

function note(children: ReactNode, tone: "info" | "success" | "danger" = "info") {
  return <Notice tone={tone}>{children}</Notice>;
}

export default function AdminAIPage() {
  const allowed = useRole().can("manage_llm");
  const providers = useQuery({ queryKey: queryKeys.llmProviders(), queryFn: getLLMProviders, enabled: allowed });
  const config = useQuery({ queryKey: queryKeys.llmConfig(), queryFn: getLLMConfig, enabled: allowed });

  if (!allowed) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="AI" meta="Which language model writes summaries and fix proposals" />
        {note("Only administrators change the language model. Ask an administrator to change the provider, model or endpoint.")}
      </div>
    );
  }

  if (providers.isError || config.isError) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          {...apiErrorState(providers.error ?? config.error)}
          onRetry={() => { providers.refetch(); config.refetch(); }}
        />
      </div>
    );
  }

  const c = config.data;
  const loading = config.isLoading;
  if (loading) return <div aria-busy="true" className="flex flex-col gap-4"><Skeleton height={240} /></div>;
  const provider = c ? providers.data?.[c.provider]?.label || c.provider || null : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI" meta="Choose which language model writes summaries and fix proposals. Test the connection, then save" />

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <span className="m-text-meta m-ink-3">Provider</span>
          <span className="m-text-h font-semibold">{loading ? "–" : provider ?? "Not set"}</span>
          <span className="m-text-meta m-ink-3">{provider ? "Writes the narrative" : "Choose a provider below"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="m-text-meta m-ink-3">Model</span>
          <span className="m-text-h font-semibold">{loading ? "–" : c?.model || "Not set"}</span>
          <span className="m-text-meta m-ink-3">{c?.model ? "Used for every request" : "Pick a model below"}</span>
        </div>
        {c && providers.data?.[c.provider]?.requires_api_key !== false ? (
          <div className="flex flex-col gap-1">
            <span className="m-text-meta m-ink-3">API key</span>
            <span className="m-text-h font-semibold">{loading ? "–" : c?.has_api_key ? "Stored" : "Not set"}</span>
            <span className="m-text-meta m-ink-3">{c?.has_api_key ? "Kept on the server" : "Not stored, add one below"}</span>
          </div>
        ) : null}
      </div>

      {note("The model never sees SAP data. It receives aggregated finding summaries and writes narrative and remediation proposals. Every score, count and rate comes from deterministic checks.")}

      {providers.data && c ? <LLMForm key={c.updated_at ?? "env"} providers={providers.data} config={c} /> : <div aria-busy="true"><Skeleton height={320} /></div>}
    </div>
  );
}

function LLMForm({ providers, config }: { providers: Record<string, LLMProvider>; config: LLMConfig }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<LLMConfigUpdate>({
    provider: config.provider,
    model: config.model,
    base_url: config.base_url,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    request_timeout: config.request_timeout,
    azure_deployment: config.azure_deployment,
    azure_api_version: config.azure_api_version,
  });
  const [apiKey, setApiKey] = useState("");
  const p = providers[form.provider];
  const body = (): LLMConfigUpdate => ({ ...form, ...(apiKey ? { api_key: apiKey } : {}) });

  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: () => updateLLMConfig(body()),
    onSuccess: () => {
      setConfirming(false);
      toast.success("Language-model settings saved");
      setApiKey("");
      qc.invalidateQueries({ queryKey: queryKeys.llmConfig() });
    },
    onError: (e) => toast.error(`Settings not saved. ${apiErrorMessage(e)}`),
  });
  const test = useMutation({ mutationFn: () => testLLMConnection(body()) });
  // A provider change is saved after a passing test of exactly these settings, or after a confirmation that says what leaves.
  const [testedBody, setTestedBody] = useState<string | null>(null);
  const changedProvider = form.provider !== config.provider;
  const passed = !!test.data?.success && testedBody === JSON.stringify(body());
  const cloud = !!p?.requires_api_key;
  const onSave = () => (changedProvider && (!passed || cloud) ? setConfirming(true) : save.mutate());

  const set = (patch: Partial<LLMConfigUpdate>) => setForm({ ...form, ...patch });
  const num = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <SettingsSheet>
    <SettingsSection title="Provider" meta={config.source === "database" ? "Set here" : "From environment"}>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider">
          <Select
            value={form.provider}
            options={Object.entries(providers).map(([k, v]) => ({ value: k, label: v.label }))}
            onValueChange={(v) => set({ provider: v, model: providers[v]?.default_model, base_url: providers[v]?.default_base_url })}
          />
        </Field>
        {p?.description ? <p className="m-text-meta -mt-2 sm:col-span-2 m-ink-3">{p.description}</p> : null}

        <Field label="Model" error={!form.model?.trim() ? "Name the model to use" : undefined}>
          <Input value={form.model ?? ""} onChange={(e) => set({ model: e.target.value })} />
        </Field>

        {p?.requires_base_url ? (
          <Field label="Endpoint URL">
            <Input type="url" value={form.base_url ?? ""} onChange={(e) => set({ base_url: e.target.value })} />
          </Field>
        ) : null}

        {p?.requires_api_key ? (
          <Field label="API key">
            <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
        ) : null}
        {p?.requires_api_key ? (
          <p className="m-text-meta -mt-2 sm:col-span-2 m-ink-3">
            {config.has_api_key ? `Stored (${config.api_key_preview}); leave blank to keep it` : "Not set"}
          </p>
        ) : null}

        {form.provider === "azure_openai" ? (
          <>
            <Field label="Azure deployment">
              <Input value={form.azure_deployment ?? ""} onChange={(e) => set({ azure_deployment: e.target.value })} />
            </Field>
            <Field label="Azure API version">
              <Input value={form.azure_api_version ?? ""} onChange={(e) => set({ azure_api_version: e.target.value })} />
            </Field>
          </>
        ) : null}

        <Field label="Temperature">
          <Input type="number" step="0.1" min="0" max="2" value={String(form.temperature ?? "")} onChange={(e) => set({ temperature: num(e.target.value) })} />
        </Field>
        <p className="m-text-meta -mt-2 sm:col-span-2 m-ink-3">How varied the wording is. 0 gives the same words every time; summaries read best at 0.2 to 0.4</p>

        <Field label="Max tokens">
          <Input type="number" min="1" value={String(form.max_tokens ?? "")} onChange={(e) => set({ max_tokens: num(e.target.value) })} />
        </Field>

        <Field label="Request timeout (seconds)">
          <Input type="number" min="1" value={String(form.request_timeout ?? "")} onChange={(e) => set({ request_timeout: num(e.target.value) })} />
        </Field>
        <p className="m-text-meta -mt-2 sm:col-span-2 m-ink-3">The bundled local model needs 120</p>
      </div>

      {test.data ? note(
        <>{test.data.message}{test.data.response_preview ? `: "${test.data.response_preview}"` : ""}</>,
        test.data.success ? "success" : "danger",
      ) : null}
      {test.error ? note(apiErrorMessage(test.error), "danger") : null}

      <div className="flex gap-2">
        <Button variant="secondary" pending={test.isPending} onClick={() => { setTestedBody(JSON.stringify(body())); test.mutate(); }}>
          {test.isPending ? "Testing" : "Test connection"}
        </Button>
        <Button pending={save.isPending} disabled={!form.model?.trim()} onClick={onSave}>
          {save.isPending ? "Saving" : "Save settings"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Switch the language model to ${p?.label ?? form.provider}`}
        body={[
          cloud ? `Aggregated findings will be sent to ${p?.label ?? form.provider}; raw SAP data never leaves this deployment.` : "The model runs inside this deployment; nothing leaves it.",
          passed ? "The connection test passed." : "The connection has not passed a test with these settings; narrative and proposals stop until it works.",
        ].join(" ")}
        confirmLabel={`Use ${p?.label ?? form.provider}`}
        cancelLabel="Keep the current provider"
        pending={save.isPending}
        onConfirm={() => save.mutate()}
      />

      {config.updated_at ? (
        <p className="m-text-meta m-ink-3">
          Last changed {formatDate(config.updated_at, "datetime")} by {config.updated_by ?? "—"}
        </p>
      ) : null}
    </SettingsSection>
    </SettingsSheet>
  );
}
