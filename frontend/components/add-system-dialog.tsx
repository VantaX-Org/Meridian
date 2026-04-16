"use client";

import { useState } from "react";
import { Plus, Loader2, Server, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { registerSystem } from "@/lib/api/connectivity";
import type { SystemType } from "@/types/api";

interface SystemTypeOption {
  value: SystemType;
  label: string;
  icon: "server" | "cloud";
}

const SYSTEM_TYPES: SystemTypeOption[] = [
  { value: "ecc", label: "ECC", icon: "server" },
  { value: "s4hana_onprem", label: "S/4HANA On-Prem", icon: "server" },
  { value: "s4hana_cloud", label: "S/4HANA Cloud", icon: "cloud" },
  { value: "successfactors", label: "SuccessFactors", icon: "cloud" },
  { value: "concur", label: "Concur", icon: "cloud" },
  { value: "ariba", label: "Ariba", icon: "cloud" },
  { value: "ewm", label: "EWM", icon: "server" },
  { value: "fieldglass", label: "Fieldglass", icon: "cloud" },
  { value: "btp", label: "BTP", icon: "cloud" },
];

const RFC_TYPES: SystemType[] = ["ecc", "s4hana_onprem", "ewm"];
const CLOUD_TYPES: SystemType[] = ["s4hana_cloud", "successfactors", "concur", "ariba", "fieldglass", "btp"];

interface FormState {
  name: string;
  system_type: SystemType;
  environment: string;
  description: string;
  // RFC fields
  host: string;
  client: string;
  sysnr: string;
  rfc_user: string;
  rfc_password: string;
  // Cloud fields
  base_url: string;
  company_id: string;
  client_id: string;
  client_secret: string;
  api_key: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  system_type: "ecc",
  environment: "DEV",
  description: "",
  host: "",
  client: "100",
  sysnr: "00",
  rfc_user: "",
  rfc_password: "",
  base_url: "",
  company_id: "",
  client_id: "",
  client_secret: "",
  api_key: "",
};

export function AddSystemDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...INITIAL_FORM });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const isRfc = RFC_TYPES.includes(form.system_type);
  const isCloud = CLOUD_TYPES.includes(form.system_type);

  const mutation = useMutation({
    mutationFn: () => {
      const credentials: Record<string, string> = {};
      if (isRfc) {
        credentials.user = form.rfc_user;
        credentials.password = form.rfc_password;
      } else {
        if (form.client_id) credentials.client_id = form.client_id;
        if (form.client_secret) credentials.client_secret = form.client_secret;
        if (form.api_key) credentials.api_key = form.api_key;
      }
      return registerSystem({
        name: form.name,
        system_type: form.system_type,
        host: isRfc ? form.host : undefined,
        client: isRfc ? form.client : undefined,
        sysnr: isRfc ? form.sysnr : undefined,
        base_url: isCloud ? form.base_url : undefined,
        company_id: isCloud ? form.company_id : undefined,
        auth_type: isRfc ? "rfc" : "oauth2_client_credentials",
        description: form.description || undefined,
        environment: form.environment,
        credentials,
      });
    },
    onSuccess: () => {
      setOpen(false);
      setForm({ ...INITIAL_FORM });
      setError(null);
      qc.invalidateQueries({ queryKey: ["systems"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="gap-2 bg-primary hover:bg-primary/80 text-white" />}
      >
        <Plus className="h-4 w-4" /> Add System
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Register SAP System</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          {/* System type selector */}
          <div>
            <span className="text-xs font-medium text-muted-foreground">System Type</span>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {SYSTEM_TYPES.map((st) => {
                const active = form.system_type === st.value;
                const Icon = st.icon === "cloud" ? Cloud : Server;
                return (
                  <button
                    key={st.value}
                    type="button"
                    onClick={() => set("system_type", st.value)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-all ${
                      active
                        ? "border-primary/40 bg-primary/[0.08] text-primary"
                        : "border-black/[0.08] bg-white/[0.50] text-muted-foreground hover:bg-white/[0.70]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {st.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Common fields */}
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">System Name</span>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="S4H Production"
              className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Environment</span>
              <select
                value={form.environment}
                onChange={(e) => set("environment", e.target.value)}
                className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="PRD">Production</option>
                <option value="QAS">Quality</option>
                <option value="DEV">Development</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Description</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Optional"
                className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          </div>

          {/* RFC-specific fields */}
          {isRfc && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Host</span>
                <input
                  type="text"
                  required
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="sap.example.com"
                  className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Client</span>
                  <input
                    type="text"
                    required
                    value={form.client}
                    onChange={(e) => set("client", e.target.value)}
                    placeholder="100"
                    className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">System Number</span>
                  <input
                    type="text"
                    required
                    value={form.sysnr}
                    onChange={(e) => set("sysnr", e.target.value)}
                    placeholder="00"
                    className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">RFC User</span>
                  <input
                    type="text"
                    required
                    value={form.rfc_user}
                    onChange={(e) => set("rfc_user", e.target.value)}
                    placeholder="MERIDIAN_SVC"
                    className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">RFC Password</span>
                  <input
                    type="password"
                    required
                    value={form.rfc_password}
                    onChange={(e) => set("rfc_password", e.target.value)}
                    placeholder="Encrypted at rest"
                    className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              </div>
            </>
          )}

          {/* Cloud-specific fields */}
          {isCloud && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Base URL</span>
                <input
                  type="url"
                  required
                  value={form.base_url}
                  onChange={(e) => set("base_url", e.target.value)}
                  placeholder="https://api.successfactors.eu"
                  className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Company ID</span>
                <input
                  type="text"
                  value={form.company_id}
                  onChange={(e) => set("company_id", e.target.value)}
                  placeholder="ACME_CORP"
                  className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Client ID</span>
                  <input
                    type="text"
                    required
                    value={form.client_id}
                    onChange={(e) => set("client_id", e.target.value)}
                    placeholder="OAuth Client ID"
                    className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Client Secret</span>
                  <input
                    type="password"
                    required
                    value={form.client_secret}
                    onChange={(e) => set("client_secret", e.target.value)}
                    placeholder="Encrypted at rest"
                    className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              </div>
            </>
          )}

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
