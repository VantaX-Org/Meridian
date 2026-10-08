"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, ErrorState, Field, Select } from "@/design";
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
import { apiErrorMessage } from "@/lib/api/optional";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

function note(children: ReactNode, tone: "info" | "success" | "danger" = "info") {
  const color = tone === "danger" ? "var(--m-critical)" : tone === "success" ? "var(--m-pass)" : "var(--m-ink-3)";
  return (
    <div role={tone === "danger" ? "alert" : undefined} className="text-[13px] rounded border p-3" style={{ borderColor: color, color }}>
      {children}
    </div>
  );
}

export default function AdminAIPage() {
  const allowed = useRole().can("manage_llm");
  const providers = useQuery({ queryKey: queryKeys.llmProviders(), queryFn: getLLMProviders, enabled: allowed });
  const config = useQuery({ queryKey: queryKeys.llmConfig(), queryFn: getLLMConfig, enabled: allowed });

  if (!allowed) {
    return (
      <div className="flex flex-col gap-6 p-6">
        {note("Administrators change the language model. Ask an administrator to change the provider, model or endpoint.")}
      </div>
    );
  }

  if (providers.isError || config.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <ErrorState
          message={(providers.error as Error)?.message || (config.error as Error)?.message || "Could not load the language-model settings."}
          onRetry={() => { providers.refetch(); config.refetch(); }}
        />
      </div>
    );
  }

  const c = config.data;
  const loading = config.isLoading;
  const provider = c ? providers.data?.[c.provider]?.label || c.provider || null : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <strong className="text-[17px]">AI</strong>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          The language model that writes narrative and remediation proposals.
        </p>
      </header>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Provider</span>
          <span className="text-[18px] font-semibold">{loading ? "–" : provider ?? "Not set"}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{provider ? "Writes the narrative." : "Choose a provider below."}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Model</span>
          <span className="text-[18px] font-semibold">{loading ? "–" : c?.model || "Not set"}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{c?.model ? "Used for every request." : "Pick a model below."}</span>
        </div>
        {c && providers.data?.[c.provider]?.requires_api_key !== false ? (
          <div className="flex flex-col gap-1">
            <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>API key</span>
            <span className="text-[18px] font-semibold">{loading ? "–" : c?.has_api_key ? "Stored" : "Not set"}</span>
            <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{c?.has_api_key ? "Kept on the server." : "Not stored. Add one below."}</span>
          </div>
        ) : null}
      </div>

      {note("The model never sees SAP data. It receives aggregated finding summaries and writes narrative and remediation proposals. Every score, count and rate comes from deterministic checks.")}

      {providers.data && c ? <LLMForm key={c.updated_at ?? "env"} providers={providers.data} config={c} /> : <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Reading the language-model settings.</p>}
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

  const save = useMutation({
    mutationFn: () => updateLLMConfig(body()),
    onSuccess: () => {
      toast.success("Language-model settings saved");
      setApiKey("");
      qc.invalidateQueries({ queryKey: queryKeys.llmConfig() });
    },
    onError: (e) => toast.error(`Settings not saved. ${apiErrorMessage(e)}`),
  });
  const test = useMutation({ mutationFn: () => testLLMConnection(body()) });

  const set = (patch: Partial<LLMConfigUpdate>) => setForm({ ...form, ...patch });
  const num = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <section className="flex flex-col gap-4 rounded border p-4" style={{ borderColor: "var(--m-line)" }}>
      <div className="flex items-center justify-between">
        <strong className="text-[14px]">Provider</strong>
        <span className="text-[11px] rounded px-2 py-0.5" style={{ background: "var(--m-sheet-raised)", color: "var(--m-ink-3)" }}>
          {config.source === "database" ? "set here" : "from environment"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider">
          <Select
            value={form.provider}
            options={Object.entries(providers).map(([k, v]) => ({ value: k, label: v.label }))}
            onValueChange={(v) => set({ provider: v, model: providers[v]?.default_model, base_url: providers[v]?.default_base_url })}
          />
        </Field>
        {p?.description ? <p className="text-[12px] -mt-2 sm:col-span-2" style={{ color: "var(--m-ink-3)" }}>{p.description}</p> : null}

        <Field label="Model">
          <input value={form.model ?? ""} onChange={(e) => set({ model: e.target.value })} />
        </Field>

        {p?.requires_base_url ? (
          <Field label="Endpoint URL">
            <input type="url" className="font-mono" value={form.base_url ?? ""} onChange={(e) => set({ base_url: e.target.value })} />
          </Field>
        ) : null}

        {p?.requires_api_key ? (
          <Field label="API key">
            <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
        ) : null}
        {p?.requires_api_key ? (
          <p className="text-[12px] -mt-2 sm:col-span-2" style={{ color: "var(--m-ink-3)" }}>
            {config.has_api_key ? `Stored (${config.api_key_preview}); leave blank to keep it` : "Not set"}
          </p>
        ) : null}

        {form.provider === "azure_openai" ? (
          <>
            <Field label="Azure deployment">
              <input value={form.azure_deployment ?? ""} onChange={(e) => set({ azure_deployment: e.target.value })} />
            </Field>
            <Field label="Azure API version">
              <input value={form.azure_api_version ?? ""} onChange={(e) => set({ azure_api_version: e.target.value })} />
            </Field>
          </>
        ) : null}

        <Field label="Temperature">
          <input type="number" step="0.1" min="0" max="2" value={String(form.temperature ?? "")} onChange={(e) => set({ temperature: num(e.target.value) })} />
        </Field>
        <p className="text-[12px] -mt-2 sm:col-span-2" style={{ color: "var(--m-ink-3)" }}>0 is deterministic; narrative reads best at 0.2 to 0.4</p>

        <Field label="Max tokens">
          <input type="number" min="1" value={String(form.max_tokens ?? "")} onChange={(e) => set({ max_tokens: num(e.target.value) })} />
        </Field>

        <Field label="Request timeout">
          <input type="number" min="1" value={String(form.request_timeout ?? "")} onChange={(e) => set({ request_timeout: num(e.target.value) })} />
        </Field>
        <p className="text-[12px] -mt-2 sm:col-span-2" style={{ color: "var(--m-ink-3)" }}>seconds; bundled Ollama needs 120</p>
      </div>

      {test.data ? note(
        <>{test.data.message}{test.data.response_preview ? ` — "${test.data.response_preview}"` : ""}</>,
        test.data.success ? "success" : "danger",
      ) : null}
      {test.error ? note(apiErrorMessage(test.error), "danger") : null}

      <div className="flex gap-2">
        <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? "Testing…" : "Test connection"}
        </Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>

      {config.updated_at ? (
        <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
          Last changed {formatDate(config.updated_at, "datetime")} by {config.updated_by ?? "—"}
        </p>
      ) : null}
    </section>
  );
}
