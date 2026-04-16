"use client";

import { useState } from "react";
import {
  Server,
  Plus,
  Plug,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Edit2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSystems,
  registerSystem,
  deleteSystem,
  testConnection,
  triggerSync,
  getSyncProfiles,
} from "@/lib/api/systems";
import { relativeTime, formatModuleName } from "@/lib/format";
import type { SAPSystem, SyncProfile } from "@/types/api";

const ENV_COLORS: Record<string, string> = {
  PRD: "bg-destructive/10 text-destructive border-destructive/20",
  QAS: "bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20",
  DEV: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle className="h-4 w-4 text-[#16A34A]" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  running: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
};

function AddSystemDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    host: "",
    client: "100",
    sysnr: "00",
    description: "",
    environment: "DEV",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: registerSystem,
    onSuccess: () => {
      setOpen(false);
      setForm({ name: "", host: "", client: "100", sysnr: "00", description: "", environment: "DEV", password: "" });
      setError(null);
      onSuccess();
    },
    onError: (e: Error) => setError(e.message),
  });

  const fields = [
    { key: "name", label: "System Name", placeholder: "S4H Production", type: "text" },
    { key: "host", label: "Host", placeholder: "sap.example.com", type: "text" },
    { key: "client", label: "Client", placeholder: "100", type: "text" },
    { key: "sysnr", label: "System Number", placeholder: "00", type: "text" },
    { key: "description", label: "Description", placeholder: "Optional", type: "text" },
    { key: "password", label: "RFC Password", placeholder: "Encrypted at rest", type: "password" },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="gap-2 bg-primary hover:bg-primary/80 text-white" />}
      >
        <Plus className="h-4 w-4" /> Add System
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Register SAP System</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(form);
          }}
          className="space-y-3"
        >
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
              <input
                type={f.type}
                required={f.key !== "description"}
                value={form[f.key as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Environment</span>
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value })}
              className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="PRD">Production</option>
              <option value="QAS">Quality</option>
              <option value="DEV">Development</option>
            </select>
          </label>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-full bg-primary hover:bg-primary/80 text-white"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Register System"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SystemCard({ system }: { system: SAPSystem }) {
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; message: string } | null>(null);

  const { data: profiles } = useQuery({
    queryKey: ["sync-profiles", system.id],
    queryFn: () => getSyncProfiles(system.id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSystem(system.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["systems"] }),
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(system.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["systems"] }),
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(system.id);
      setTestResult(result);
    } catch {
      setTestResult({ connected: false, message: "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const domainChips = profiles?.map((p: SyncProfile) => p.domain) ?? [];

  return (
    <Card className="border-black/[0.08] bg-white/[0.70]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.65]">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{system.name}</h3>
              <p className="text-xs text-muted-foreground">
                {system.host} &middot; Client {system.client} &middot; SysNr {system.sysnr}
              </p>
            </div>
          </div>
          <Badge variant="outline" className={ENV_COLORS[system.environment] ?? ""}>
            {system.environment}
          </Badge>
        </div>

        {system.description && (
          <p className="mt-2 text-sm text-muted-foreground">{system.description}</p>
        )}

        {/* Domain coverage chips */}
        {domainChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {domainChips.map((d: string) => (
              <span
                key={d}
                className="rounded-full bg-white/[0.60] px-2.5 py-0.5 text-xs font-medium text-foreground"
              >
                {formatModuleName(d)}
              </span>
            ))}
          </div>
        )}

        {/* Sync status */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          {system.last_sync_status && STATUS_ICONS[system.last_sync_status]}
          {system.last_sync_at ? (
            <span>Last sync: {relativeTime(system.last_sync_at)}</span>
          ) : (
            <span>No syncs yet</span>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`mt-2 rounded-md px-3 py-1.5 text-xs ${
            testResult.connected
              ? "bg-[#16A34A]/10 text-[#16A34A]"
              : "bg-destructive/10 text-destructive"
          }`}>
            {testResult.connected ? "Connected" : testResult.message}
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
            className="gap-1 text-xs border-black/[0.08] text-foreground"
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
            Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="gap-1 text-xs border-black/[0.08] text-foreground"
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Sync Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Delete this system and all its sync profiles?")) {
                deleteMutation.mutate();
              }
            }}
            className="gap-1 text-xs border-destructive/20 text-destructive hover:bg-destructive/5 ml-auto"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SystemsPage() {
  const qc = useQueryClient();

  const { data: systems, isLoading } = useQuery({
    queryKey: ["systems"],
    queryFn: getSystems,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">SAP Systems</h1>
          <p className="text-sm text-muted-foreground">
            Register and manage SAP system connections for automated data sync
          </p>
        </div>
        <AddSystemDialog onSuccess={() => qc.invalidateQueries({ queryKey: ["systems"] })} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !systems || systems.length === 0 ? (
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Server className="h-12 w-12 text-white/[0.08]" />
            <h3 className="mt-4 font-semibold text-foreground">No SAP systems registered</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first SAP system to enable automated data sync
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((sys) => (
            <SystemCard key={sys.id} system={sys} />
          ))}
        </div>
      )}
    </div>
  );
}
