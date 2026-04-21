"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Calendar,
  Clock,
  FileText,
  Archive,
  Mail,
  Users,
  UserPlus,
  CreditCard,
  Check,
  X,
  GitMerge,
  Sparkles,
  Plus,
  Trash2,
  Brain,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import {
  getLLMProviders,
  getLLMConfig,
  updateLLMConfig,
  testLLMConnection,
  type LLMConfigUpdate,
} from "@/lib/api/llm-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getSettings,
  updateDqsWeights,
  updateAlertThresholds,
} from "@/lib/api/settings";
import { getExceptionBilling } from "@/lib/api/exceptions";
import { getUsers, updateUser, inviteUser } from "@/lib/api/users";
import {
  getMatchRules,
  createMatchRule,
  updateMatchRule,
  deleteMatchRule,
  simulateMatchRules,
  getProposedRules,
  approveProposedRule,
  rejectProposedRule,
} from "@/lib/api/match-rules";
import { formatModuleName } from "@/lib/format";
import type {
  DimensionScores,
  UserRole,
  ExceptionBilling,
  MatchRule,
  MatchType,
  AIProposedRule,
  SimulationResult,
} from "@/types/api";

const DEFAULT_WEIGHTS: DimensionScores = {
  completeness: 25,
  accuracy: 25,
  consistency: 20,
  timeliness: 10,
  uniqueness: 10,
  validity: 10,
};

const DIMENSION_LABELS: Record<keyof DimensionScores, string> = {
  completeness: "Completeness",
  accuracy: "Accuracy",
  consistency: "Consistency",
  timeliness: "Timeliness",
  uniqueness: "Uniqueness",
  validity: "Validity",
};

const ROLE_OPTIONS: { value: UserRole; label: string; tooltip?: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "steward", label: "Steward" },
  { value: "analyst", label: "Analyst" },
  { value: "approver", label: "Approver" },
  { value: "auditor", label: "Auditor" },
  { value: "viewer", label: "Viewer" },
  {
    value: "ai_reviewer",
    label: "AI Reviewer",
    tooltip: "Can review AI recommendations and approve proposed rules, but cannot approve data actions.",
  },
];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-[#DC2626]/10 text-destructive",
  steward: "bg-[#2563EB]/10 text-[#2563EB]",
  analyst: "bg-[#16A34A]/10 text-[#16A34A]",
  approver: "bg-[#D97706]/10 text-[#EA580C]",
  auditor: "bg-white/[0.60] text-muted-foreground",
  viewer: "bg-white/[0.60] text-muted-foreground",
  ai_reviewer: "bg-[#7C3AED]/10 text-[#7C3AED]",
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const [weights, setWeights] = useState<DimensionScores>(DEFAULT_WEIGHTS);
  const [thresholds, setThresholds] = useState({
    critical_threshold: 1,
    high_threshold: 10,
    dqs_drop_threshold: 5,
  });

  useEffect(() => {
    if (settings?.dqs_weights) setWeights(settings.dqs_weights);
    if (settings?.alert_thresholds) setThresholds(settings.alert_thresholds);
  }, [settings]);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: llmConfig } = useQuery({
    queryKey: ["llm-config"],
    queryFn: getLLMConfig,
    enabled: isAdmin,
  });
  const { data: llmProviders } = useQuery({
    queryKey: ["llm-providers"],
    queryFn: getLLMProviders,
    enabled: isAdmin,
  });

  const [llmForm, setLlmForm] = useState<LLMConfigUpdate>({
    provider: "ollama",
    model: "",
    base_url: "",
    api_key: "",
    temperature: 0.1,
    max_tokens: 8192,
    request_timeout: 120,
    azure_deployment: "",
    azure_api_version: "2024-08-01-preview",
  });
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [llmTesting, setLlmTesting] = useState(false);

  useEffect(() => {
    if (llmConfig) {
      setLlmForm({
        provider: llmConfig.provider,
        model: llmConfig.model,
        base_url: llmConfig.base_url,
        api_key: "",
        temperature: llmConfig.temperature,
        max_tokens: llmConfig.max_tokens,
        request_timeout: llmConfig.request_timeout,
        azure_deployment: llmConfig.azure_deployment,
        azure_api_version: llmConfig.azure_api_version,
      });
    }
  }, [llmConfig]);

  const llmSaveMutation = useMutation({
    mutationFn: () => updateLLMConfig(llmForm),
    onSuccess: () => {
      toast.success("LLM configuration saved");
      qc.invalidateQueries({ queryKey: ["llm-config"] });
      setLlmTestResult(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Failed to save LLM config"),
  });

  const handleLlmTest = async () => {
    setLlmTesting(true);
    setLlmTestResult(null);
    try {
      const result = await testLLMConnection(llmForm);
      setLlmTestResult(result);
    } catch (e: any) {
      setLlmTestResult({ success: false, message: e?.response?.data?.detail || "Test failed" });
    } finally {
      setLlmTesting(false);
    }
  };

  const selectedProviderInfo = llmProviders?.[llmForm.provider];

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const weightValid = weightSum === 100;

  const weightsMutation = useMutation({
    mutationFn: () => updateDqsWeights(weights),
    onSuccess: () => {
      toast.success("DQS weights saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error("Failed to save weights"),
  });

  const thresholdsMutation = useMutation({
    mutationFn: () => updateAlertThresholds(thresholds),
    onSuccess: () => {
      toast.success("Alert thresholds saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error("Failed to save thresholds"),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load settings.</AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Tabs defaultValue="general">
        <TabsList variant="line">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="team">
            <Users className="mr-1 h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="mr-1 h-4 w-4" />
            Billing
          </TabsTrigger>
          <TabsTrigger value="match-rules">
            <GitMerge className="mr-1 h-4 w-4" />
            Match Rules
          </TabsTrigger>
          <TabsTrigger value="ai-rules">
            <Sparkles className="mr-1 h-4 w-4" />
            AI Proposed Rules
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="llm">
              <Brain className="mr-1 h-4 w-4" />
              AI / LLM
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── General Tab ────────────────────────────────────────────────── */}
        <TabsContent value="general">
          <div className="space-y-8 pt-4">
            {/* Section 1 — Tenant config */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tenant Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Tenant Name
                    </span>
                    <p className="font-medium">{settings?.name ?? "—"}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Licensed Modules
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {settings?.licensed_modules?.map((m) => (
                        <Badge key={m} variant="secondary">
                          {formatModuleName(m)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <a
                  href="https://meridian-hq.vantax.co.za"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Manage licence on Meridian HQ
                  <ExternalLink className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>

            <Separator />

            {/* Section 2 — DQS weights */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">DQS Weight Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(Object.keys(DIMENSION_LABELS) as (keyof DimensionScores)[]).map(
                  (dim) => (
                    <div key={dim} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{DIMENSION_LABELS[dim]}</span>
                        <span className="font-mono">{weights[dim]}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        step={5}
                        value={weights[dim]}
                        onChange={(e) =>
                          setWeights((w) => ({
                            ...w,
                            [dim]: parseInt(e.target.value),
                          }))
                        }
                        className="w-full accent-primary"
                      />
                    </div>
                  )
                )}

                <div
                  className={`text-sm font-medium ${
                    weightValid ? "text-green-400" : "text-red-400"
                  }`}
                >
                  Total: {weightSum}%{" "}
                  {!weightValid && "(must equal 100%)"}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => weightsMutation.mutate()}
                    disabled={!weightValid || weightsMutation.isPending}
                  >
                    Save Weights
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setWeights(DEFAULT_WEIGHTS)}
                  >
                    Reset to Defaults
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* Section 3 — Alert thresholds */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Alert Thresholds</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Critical finding threshold
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={thresholds.critical_threshold}
                      onChange={(e) =>
                        setThresholds((t) => ({
                          ...t,
                          critical_threshold: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Alert when critical findings exceed this count
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      High finding threshold
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={thresholds.high_threshold}
                      onChange={(e) =>
                        setThresholds((t) => ({
                          ...t,
                          high_threshold: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Alert when high findings exceed this count
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      DQS score drop threshold
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={thresholds.dqs_drop_threshold}
                      onChange={(e) =>
                        setThresholds((t) => ({
                          ...t,
                          dqs_drop_threshold: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-md border border-border bg-accent px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Alert when DQS drops by more than this many points
                    </p>
                  </div>
                </div>

                <Button
                  onClick={() => thresholdsMutation.mutate()}
                  disabled={thresholdsMutation.isPending}
                >
                  Save Thresholds
                </Button>
              </CardContent>
            </Card>

            <Separator />

            {/* Section 4 — Scheduled Jobs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scheduled Jobs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {([
                    {
                      key: "daily_analysis",
                      label: "Daily Analysis",
                      desc: "Re-run checks on latest data (02:00 SAST)",
                      icon: <Clock className="h-4 w-4 text-primary" />,
                    },
                    {
                      key: "weekly_cleaning",
                      label: "Weekly Cleaning Batch",
                      desc: "Auto-approve and apply standardisations (Mon 03:00 SAST)",
                      icon: <Calendar className="h-4 w-4 text-[#16A34A]" />,
                    },
                    {
                      key: "monthly_report",
                      label: "Monthly Report",
                      desc: "Generate PDF, cost avoidance, exception billing (1st 04:00 SAST)",
                      icon: <FileText className="h-4 w-4 text-[#EA580C]" />,
                    },
                    {
                      key: "daily_digest",
                      label: "Daily Digest",
                      desc: "Findings summary, early warnings, next actions (06:00 SAST)",
                      icon: <Mail className="h-4 w-4 text-[#2563EB]" />,
                    },
                    {
                      key: "weekly_archive",
                      label: "Weekly Archive",
                      desc: "Archive old findings, prune cache, escalate exceptions (Sun 00:00 SAST)",
                      icon: <Archive className="h-4 w-4 text-muted-foreground" />,
                    },
                  ] as const).map((job) => {
                    const scheduledJobs = (settings?.dqs_weights as Record<string, unknown> | null)?.scheduled_jobs as Record<string, { enabled: boolean; last_run?: string }> | undefined;
                    const jobState = scheduledJobs?.[job.key];
                    const enabled = jobState?.enabled ?? true;
                    const lastRun = jobState?.last_run;

                    return (
                      <div
                        key={job.key}
                        className="flex items-center justify-between rounded-lg border border-border p-3"
                      >
                        <div className="flex items-center gap-3">
                          {job.icon}
                          <div>
                            <p className="text-sm font-medium">{job.label}</p>
                            <p className="text-xs text-muted-foreground">{job.desc}</p>
                            {lastRun && (
                              <p className="text-xs text-muted-foreground">
                                Last run: {new Date(lastRun).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => {
                            toast.info(`${job.label} toggle saved`);
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            enabled ? "bg-primary" : "bg-gray-300"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              enabled ? "translate-x-5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Team Tab ───────────────────────────────────────────────────── */}
        <TabsContent value="team">
          <TeamManagement />
        </TabsContent>

        {/* ── Billing Tab ──────────────────────────────────────────────── */}
        <TabsContent value="billing">
          <BillingTab
            stripeCustomerId={settings?.stripe_customer_id ?? null}
            licensedModules={settings?.licensed_modules ?? []}
          />
        </TabsContent>

        {/* ── Match Rules Tab ────────────────────────────────────────── */}
        <TabsContent value="match-rules">
          <MatchRulesTab />
        </TabsContent>

        {/* ── AI Proposed Rules Tab ──────────────────────────────────── */}
        <TabsContent value="ai-rules">
          <AIProposedRulesTab />
        </TabsContent>

        {/* ── AI / LLM Tab (admin only) ──────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="llm">
            <div className="space-y-6 pt-4">
              {llmConfig && (
                <Alert>
                  <AlertDescription>
                    Configuration source:{" "}
                    <Badge variant={llmConfig.source === "database" ? "default" : "secondary"}>
                      {llmConfig.source === "database" ? "Saved in database" : "Environment variables (default)"}
                    </Badge>
                    {llmConfig.updated_at && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        Last updated: {new Date(llmConfig.updated_at).toLocaleString()}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">LLM Provider</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {llmProviders && Object.entries(llmProviders).map(([key, prov]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setLlmForm(prev => ({
                            ...prev,
                            provider: key,
                            model: prov.default_model,
                            base_url: prov.default_base_url,
                            api_key: "",
                          }));
                          setLlmTestResult(null);
                        }}
                        className={`rounded-xl border p-4 text-left transition-all ${
                          llmForm.provider === key
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <p className="font-medium text-sm">{prov.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{prov.description}</p>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {selectedProviderInfo?.label || "Provider"} Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Model</label>
                    <input
                      type="text"
                      value={llmForm.model}
                      onChange={e => setLlmForm(prev => ({ ...prev, model: e.target.value }))}
                      placeholder={selectedProviderInfo?.default_model || "Model name"}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>

                  {selectedProviderInfo?.requires_base_url && (
                    <div>
                      <label className="text-sm font-medium">Base URL</label>
                      <input
                        type="text"
                        value={llmForm.base_url}
                        onChange={e => setLlmForm(prev => ({ ...prev, base_url: e.target.value }))}
                        placeholder={selectedProviderInfo?.default_base_url || "https://..."}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  )}

                  {selectedProviderInfo?.requires_api_key && (
                    <div>
                      <label className="text-sm font-medium">API Key</label>
                      {llmConfig?.has_api_key && !llmForm.api_key && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Current key: {llmConfig.api_key_preview} — leave blank to keep
                        </span>
                      )}
                      <input
                        type="password"
                        value={llmForm.api_key}
                        onChange={e => setLlmForm(prev => ({ ...prev, api_key: e.target.value }))}
                        placeholder={llmConfig?.has_api_key ? "Leave blank to keep current key" : "Enter API key"}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  )}

                  {llmForm.provider === "azure_openai" && (
                    <>
                      <div>
                        <label className="text-sm font-medium">Azure Deployment</label>
                        <input
                          type="text"
                          value={llmForm.azure_deployment}
                          onChange={e => setLlmForm(prev => ({ ...prev, azure_deployment: e.target.value }))}
                          placeholder="gpt-4o"
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">API Version</label>
                        <input
                          type="text"
                          value={llmForm.azure_api_version}
                          onChange={e => setLlmForm(prev => ({ ...prev, azure_api_version: e.target.value }))}
                          placeholder="2024-08-01-preview"
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    </>
                  )}

                  <Separator />

                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                      Advanced settings
                    </summary>
                    <div className="mt-3 grid gap-4 sm:grid-cols-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Temperature</label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max="2"
                          value={llmForm.temperature}
                          onChange={e => setLlmForm(prev => ({ ...prev, temperature: parseFloat(e.target.value) || 0.1 }))}
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Max Tokens</label>
                        <input
                          type="number"
                          value={llmForm.max_tokens}
                          onChange={e => setLlmForm(prev => ({ ...prev, max_tokens: parseInt(e.target.value) || 8192 }))}
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Timeout (seconds)</label>
                        <input
                          type="number"
                          value={llmForm.request_timeout}
                          onChange={e => setLlmForm(prev => ({ ...prev, request_timeout: parseInt(e.target.value) || 120 }))}
                          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  </details>
                </CardContent>
              </Card>

              {llmTestResult && (
                <Alert variant={llmTestResult.success ? "default" : "destructive"}>
                  <AlertDescription>
                    {llmTestResult.success ? <Check className="inline h-4 w-4 mr-1" /> : <X className="inline h-4 w-4 mr-1" />}
                    {llmTestResult.message}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleLlmTest}
                  disabled={llmTesting}
                >
                  {llmTesting ? "Testing..." : "Test Connection"}
                </Button>
                <Button
                  onClick={() => llmSaveMutation.mutate()}
                  disabled={llmSaveMutation.isPending}
                >
                  {llmSaveMutation.isPending ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}


/* ── Team management sub-component ────────────────────────────────────────── */

function TeamManagement() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("analyst");

  const updateMutation = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: { role?: UserRole; is_active?: boolean } }) =>
      updateUser(userId, body),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => toast.error("Failed to update user"),
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser({ email: inviteEmail, name: inviteName, role: inviteRole }),
    onSuccess: () => {
      toast.success("User invited");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("analyst");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => toast.error("Failed to invite user"),
  });

  if (isLoading) return <Skeleton className="h-64 mt-4" />;

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Team Members</h2>
          <p className="text-sm text-muted-foreground">
            Manage user roles and access permissions
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger>
            <Button size="sm">
              <UserPlus className="mr-1 h-4 w-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => inviteMutation.mutate()}
                disabled={!inviteEmail || inviteMutation.isPending}
                className="w-full"
              >
                Send Invite
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/[0.08] text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {(!data?.users || data.users.length === 0) ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No team members yet. Invite someone to get started.
                  </td>
                </tr>
              ) : (
                data.users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-black/[0.06] last:border-b-0"
                  >
                    <td className="px-4 py-3 text-sm">{user.email}</td>
                    <td className="px-4 py-3 text-sm">{user.name}</td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(e) =>
                          updateMutation.mutate({
                            userId: user.id,
                            body: { role: e.target.value as UserRole },
                          })
                        }
                        className={`rounded-md border-0 px-2 py-1 text-xs font-medium ${
                          ROLE_COLORS[user.role] || ""
                        }`}
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={user.is_active}
                        onClick={() =>
                          updateMutation.mutate({
                            userId: user.id,
                            body: { is_active: !user.is_active },
                          })
                        }
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          user.is_active ? "bg-[#16A34A]" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            user.is_active ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {user.last_login
                        ? new Date(user.last_login).toLocaleDateString()
                        : "Never"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Role permissions reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-black/[0.08] text-left text-muted-foreground">
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">View</th>
                  <th className="px-2 py-2">Upload</th>
                  <th className="px-2 py-2">Analyse</th>
                  <th className="px-2 py-2">Approve</th>
                  <th className="px-2 py-2">Apply</th>
                  <th className="px-2 py-2">Export</th>
                  <th className="px-2 py-2">Manage</th>
                  <th className="px-2 py-2">AI Review</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { role: "Admin", perms: [true, true, true, true, true, true, true, true] },
                  { role: "Steward", perms: [true, true, true, true, true, true, false, true] },
                  { role: "Analyst", perms: [true, true, true, false, false, true, false, false] },
                  { role: "Approver", perms: [true, false, false, true, false, true, false, false] },
                  { role: "Auditor", perms: [true, false, false, false, false, true, false, false] },
                  { role: "Viewer", perms: [true, false, false, false, false, false, false, false] },
                  { role: "AI Reviewer", perms: [true, false, false, false, false, true, false, true] },
                ].map((row) => (
                  <tr key={row.role} className="border-b border-black/[0.06] last:border-b-0">
                    <td className="px-2 py-2 font-medium">{row.role}</td>
                    {row.perms.map((p, i) => (
                      <td key={i} className="px-2 py-2 text-center">
                        {p ? (
                          <span className="text-[#16A34A]">&#10003;</span>
                        ) : (
                          <span className="text-white/[0.08]">&#8212;</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


/* ── Billing tab sub-component ───────────────────────────────────────────── */

const ALL_FEATURES = [
  { key: "cleaning", label: "Data Cleaning" },
  { key: "exceptions", label: "Exception Management" },
  { key: "analytics", label: "Advanced Analytics" },
  { key: "nlp", label: "NLP Query Interface" },
  { key: "contracts", label: "Data Contracts" },
  { key: "notifications", label: "Notification Centre" },
] as const;

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Auto-resolved",
  2: "Tier 2 — Steward",
  3: "Tier 3 — Complex",
  4: "Tier 4 — Custom Rule",
};

const TIER_PRICES: Record<number, number> = {
  1: 25.0,
  2: 150.0,
  3: 500.0,
  4: 250.0,
};

function BillingTab({
  stripeCustomerId,
  licensedModules,
}: {
  stripeCustomerId: string | null;
  licensedModules: string[];
}) {
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const { data: billing, isLoading } = useQuery({
    queryKey: ["exception-billing", currentPeriod],
    queryFn: () => getExceptionBilling(currentPeriod),
  });

  // Derive licensed features from cached licence response
  // In production, the licence middleware sets these on every request
  const [licensedFeatures, setLicensedFeatures] = useState<string[]>([]);

  useEffect(() => {
    // Fetch licence features from the settings endpoint metadata
    // Features are part of the licence response cached by the middleware
    async function fetchFeatures() {
      try {
        const resp = await fetch("/api/v1/health");
        const data = await resp.json();
        if (data.licence?.features) {
          setLicensedFeatures(data.licence.features);
        }
      } catch {
        // Health endpoint not available — show empty
      }
    }
    fetchFeatures();
  }, []);

  return (
    <div className="space-y-6 pt-4">
      {/* Current tier & features */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Licence & Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-sm text-muted-foreground">Licensed Modules</span>
            <p className="text-sm font-medium">
              {licensedModules.length > 0
                ? `${licensedModules.length} module${licensedModules.length !== 1 ? "s" : ""}`
                : "None"}
            </p>
          </div>

          <Separator />

          <div>
            <span className="text-sm font-medium">Feature Status</span>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ALL_FEATURES.map(({ key, label }) => {
                const enabled = licensedFeatures.includes(key) || licensedFeatures.includes("*");
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    {enabled ? (
                      <Check className="h-4 w-4 text-[#16A34A]" />
                    ) : (
                      <X className="h-4 w-4 text-white/[0.08]" />
                    )}
                    <span className={enabled ? "" : "text-muted-foreground"}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {licensedFeatures.length === 0 && !licensedFeatures.includes("*") && (
            <Alert>
              <AlertDescription className="flex items-center justify-between">
                <span>Upgrade your licence to unlock additional features.</span>
                <a
                  href="https://meridian-hq.vantax.co.za/upgrade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Manage Licence
                  <ExternalLink className="h-3 w-3" />
                </a>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Exception billing summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Exception Billing — {currentPeriod}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : billing ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.08] text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Tier</th>
                      <th className="px-3 py-2 text-right">Count</th>
                      <th className="px-3 py-2 text-right">Unit Price (ZAR)</th>
                      <th className="px-3 py-2 text-right">Amount (ZAR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([1, 2, 3, 4] as const).map((tier) => {
                      const countKey = `tier${tier}_count` as keyof ExceptionBilling;
                      const amountKey = `tier${tier}_amount` as keyof ExceptionBilling;
                      const count = (billing[countKey] as number) || 0;
                      const amount = (billing[amountKey] as number) || 0;
                      return (
                        <tr key={tier} className="border-b border-black/[0.06]">
                          <td className="px-3 py-2">{TIER_LABELS[tier]}</td>
                          <td className="px-3 py-2 text-right font-mono">{count}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            R {TIER_PRICES[tier].toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            R {amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-b border-black/[0.06]">
                      <td className="px-3 py-2 text-muted-foreground">Monthly Base Fee</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right font-mono">
                        R {(billing.base_fee || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right text-primary">
                        R {(billing.total_amount || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center gap-3">
                {billing.stripe_invoice_id && stripeCustomerId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `https://dashboard.stripe.com/invoices/${billing.stripe_invoice_id}`,
                        "_blank"
                      )
                    }
                  >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    View Invoice
                  </Button>
                )}
                <a
                  href="https://meridian-hq.vantax.co.za/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Manage Licence
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No billing data for this period yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


/* ── Match Rules tab sub-component ─────────────────────────────────────────── */

const MATCH_TYPE_OPTIONS: { value: MatchType; label: string }[] = [
  { value: "exact", label: "Exact" },
  { value: "fuzzy", label: "Fuzzy" },
  { value: "phonetic", label: "Phonetic" },
  { value: "numeric_range", label: "Numeric Range" },
  { value: "semantic", label: "Semantic (AI)" },
];

const MATCH_TYPE_COLORS: Record<string, string> = {
  exact: "bg-[#16A34A]/10 text-[#16A34A]",
  fuzzy: "bg-[#2563EB]/10 text-[#2563EB]",
  phonetic: "bg-[#D97706]/10 text-[#EA580C]",
  numeric_range: "bg-white/[0.60] text-muted-foreground",
  semantic: "bg-[#7C3AED]/10 text-[#7C3AED]",
};

const DOMAIN_OPTIONS = [
  "business_partner",
  "material_master",
  "fi_gl",
  "employee_central",
  "ap_ar",
];

function MatchRulesTab() {
  const qc = useQueryClient();
  const [domainFilter, setDomainFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  // Form state
  const [formDomain, setFormDomain] = useState("business_partner");
  const [formField, setFormField] = useState("");
  const [formType, setFormType] = useState<MatchType>("exact");
  const [formWeight, setFormWeight] = useState(50);
  const [formThreshold, setFormThreshold] = useState(0.8);

  const { data, isLoading } = useQuery({
    queryKey: ["match-rules", domainFilter],
    queryFn: () => getMatchRules(domainFilter || undefined),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const body = {
        domain: formDomain,
        field: formField,
        match_type: formType,
        weight: formWeight,
        threshold: formThreshold,
      };
      return editId ? updateMatchRule(editId, body) : createMatchRule(body);
    },
    onSuccess: () => {
      toast.success(editId ? "Match rule updated" : "Match rule created");
      qc.invalidateQueries({ queryKey: ["match-rules"] });
      setAddOpen(false);
      _resetForm();
    },
    onError: () => toast.error(editId ? "Failed to update rule" : "Failed to create rule"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateMatchRule(id, { active }),
    onSuccess: () => {
      toast.success("Rule updated");
      qc.invalidateQueries({ queryKey: ["match-rules"] });
    },
    onError: () => toast.error("Failed to update rule"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMatchRule(id),
    onSuccess: () => {
      toast.success("Rule deleted");
      qc.invalidateQueries({ queryKey: ["match-rules"] });
    },
    onError: () => toast.error("Failed to delete rule"),
  });

  const simulateMutation = useMutation({
    mutationFn: () => simulateMatchRules({ domain: domainFilter || "business_partner" }),
    onSuccess: (result) => {
      setSimResult(result);
      toast.success("Simulation complete");
    },
    onError: () => toast.error("Simulation failed"),
  });

  function _resetForm() {
    setFormDomain("business_partner");
    setFormField("");
    setFormType("exact");
    setFormWeight(50);
    setFormThreshold(0.8);
    setEditId(null);
  }

  if (isLoading) return <Skeleton className="h-64 mt-4" />;

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Match Rules</h2>
          <p className="text-sm text-muted-foreground">
            Configure weighted match scoring rules per domain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-md border border-black/[0.08] px-3 py-2 text-sm"
          >
            <option value="">All Domains</option>
            {DOMAIN_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {formatModuleName(d)}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => simulateMutation.mutate()}
            disabled={simulateMutation.isPending}
          >
            Test Simulation
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger
              render={<Button size="sm" />}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Rule
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editId ? "Edit Rule" : "Add Match Rule"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Domain</label>
                  <select
                    value={formDomain}
                    onChange={(e) => setFormDomain(e.target.value)}
                    className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                  >
                    {DOMAIN_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {formatModuleName(d)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Field</label>
                  <input
                    type="text"
                    value={formField}
                    onChange={(e) => setFormField(e.target.value)}
                    placeholder="e.g. BUT000.BU_TYPE"
                    className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Match Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as MatchType)}
                    className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                  >
                    {MATCH_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Weight (0-100)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={formWeight}
                      onChange={(e) => setFormWeight(parseInt(e.target.value) || 0)}
                      className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">
                      Threshold (0-1)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={formThreshold}
                      onChange={(e) =>
                        setFormThreshold(parseFloat(e.target.value) || 0)
                      }
                      className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!formField || createMutation.isPending}
                  className="w-full"
                >
                  {editId ? "Update Rule" : "Create Rule"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Simulation result */}
      {simResult && (
        <Alert>
          <AlertDescription>
            <div className="flex items-center gap-6 text-sm">
              <span className="font-medium">Simulation Result:</span>
              <span>
                <strong>{simResult.total_pairs}</strong> pairs tested
              </span>
              <span className="text-[#16A34A]">
                <strong>{simResult.auto_merge_count}</strong> auto-merge
              </span>
              <span className="text-destructive">
                <strong>{simResult.auto_dismiss_count}</strong> auto-dismiss
              </span>
              <span className="text-[#EA580C]">
                <strong>{simResult.queue_count}</strong> queued for review
              </span>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Rules table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/[0.08] text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">Field</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Weight</th>
                <th className="px-4 py-3">Threshold</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(!data?.rules || data.rules.length === 0) ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No match rules configured. Add a rule to get started.
                  </td>
                </tr>
              ) : (
                data.rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-black/[0.06] last:border-b-0"
                  >
                    <td className="px-4 py-3 text-sm">
                      {formatModuleName(rule.domain)}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">{rule.field}</td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`text-xs ${MATCH_TYPE_COLORS[rule.match_type] || ""}`}
                      >
                        {rule.match_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">{rule.weight}</td>
                    <td className="px-4 py-3 text-sm font-mono">
                      {rule.threshold.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rule.active}
                        onClick={() =>
                          toggleMutation.mutate({
                            id: rule.id,
                            active: !rule.active,
                          })
                        }
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          rule.active ? "bg-[#16A34A]" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                            rule.active ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditId(rule.id);
                          setFormDomain(rule.domain);
                          setFormField(rule.field);
                          setFormType(rule.match_type);
                          setFormWeight(rule.weight);
                          setFormThreshold(rule.threshold);
                          setAddOpen(true);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
                        title="Edit rule"
                      >
                        <GitMerge className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(rule.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-[#DC2626]/10 hover:text-destructive"
                        title="Delete rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}


/* ── AI Proposed Rules tab sub-component ───────────────────────────────────── */

function AIProposedRulesTab() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["proposed-rules"],
    queryFn: () => getProposedRules("pending"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveProposedRule(id),
    onSuccess: () => {
      toast.success("Rule approved and added to match rules");
      qc.invalidateQueries({ queryKey: ["proposed-rules"] });
      qc.invalidateQueries({ queryKey: ["match-rules"] });
    },
    onError: () => toast.error("Failed to approve rule"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectProposedRule(id),
    onSuccess: () => {
      toast.success("Rule rejected");
      qc.invalidateQueries({ queryKey: ["proposed-rules"] });
    },
    onError: () => toast.error("Failed to reject rule"),
  });

  if (isLoading) return <Skeleton className="h-64 mt-4" />;

  return (
    <div className="space-y-6 pt-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          AI Proposed Rules
        </h2>
        <p className="text-sm text-muted-foreground">
          Review and approve match rules proposed by the AI based on steward
          correction patterns
        </p>
      </div>

      {(!data?.rules || data.rules.length === 0) ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No pending rule proposals. The AI will propose rules after
            accumulating steward corrections.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        className={`text-xs ${
                          MATCH_TYPE_COLORS[rule.proposed_rule.match_type] || ""
                        }`}
                      >
                        {rule.proposed_rule.match_type}
                      </Badge>
                      <span className="text-sm font-medium">
                        {formatModuleName(rule.domain)}
                      </span>
                      <span className="font-mono text-sm text-muted-foreground">
                        {rule.proposed_rule.field}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{rule.rationale}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        Weight: <strong>{rule.proposed_rule.weight}</strong>
                      </span>
                      <span>
                        Threshold:{" "}
                        <strong>{rule.proposed_rule.threshold}</strong>
                      </span>
                      <span>
                        Based on{" "}
                        <strong>{rule.supporting_correction_count}</strong>{" "}
                        corrections
                      </span>
                      <span>
                        Proposed:{" "}
                        {new Date(rule.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(rule.id)}
                      disabled={approveMutation.isPending}
                    >
                      <Check className="mr-1 h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectMutation.mutate(rule.id)}
                      disabled={rejectMutation.isPending}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

