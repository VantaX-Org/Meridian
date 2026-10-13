"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Dialog, Field, Input, Select } from "@/design";
import { registerSystem } from "@/lib/api/systems";
import { apiErrorMessage } from "@/lib/error";
import { length, oneOf, pattern, required, url, useFormErrors, type Schema } from "@/lib/forms";
import { queryKeys } from "@/lib/query-keys";
import type { SystemType } from "@/types/api";

const TYPES: { value: SystemType; label: string }[] = [
  { value: "ecc", label: "SAP ECC" },
  { value: "s4hana_onprem", label: "S/4HANA on premise" },
  { value: "ewm", label: "Extended Warehouse Management" },
  { value: "s4hana_cloud", label: "S/4HANA Cloud" },
  { value: "successfactors", label: "SuccessFactors" },
  { value: "concur", label: "Concur" },
  { value: "ariba", label: "Ariba" },
  { value: "btp", label: "BTP" },
];
const ENVIRONMENTS = [{ value: "PRD", label: "Production" }, { value: "QAS", label: "Quality" }, { value: "DEV", label: "Development" }];
const RFC_TYPES: readonly SystemType[] = ["ecc", "s4hana_onprem", "ewm"];
const NEEDS_TOKEN_URL: readonly SystemType[] = ["s4hana_cloud", "btp"];

const EMPTY = {
  name: "", system_type: "ecc", environment: "DEV",
  host: "", client: "", sysnr: "", username: "", password: "",
  base_url: "", token_url: "", company_id: "", client_id: "", client_secret: "",
};
type Values = typeof EMPTY;

/** Validation by connection kind: RFC systems need host, client, instance and password; cloud systems a base URL and OAuth client. */
function schemaFor(type: SystemType): Schema<Values> {
  const common: Schema<Values> = {
    name: [required("Enter a system name"), length(1, 100, "Use up to 100 characters")],
    system_type: oneOf(TYPES.map((t) => t.value)),
    environment: oneOf(ENVIRONMENTS.map((e) => e.value)),
  };
  if (RFC_TYPES.includes(type)) {
    return {
      ...common,
      host: [required("Enter the host name"), length(1, 255)],
      client: [required("Enter the 3-digit client"), pattern(/^\d{3}$/, "Enter a 3-digit client")],
      sysnr: [required("Enter the 2-digit instance number"), pattern(/^\d{2}$/, "Enter a 2-digit instance number")],
      password: required("Enter the password"),
    };
  }
  return {
    ...common,
    base_url: [required("Enter the base URL"), url()],
    token_url: NEEDS_TOKEN_URL.includes(type) ? [required("Enter the token URL"), url()] : url(),
    company_id: type === "successfactors" ? required("Enter the company ID") : undefined,
    client_id: required("Enter the client ID"),
    client_secret: required("Enter the client secret"),
  };
}

/** Connect an SAP system: registers it with its credentials (stored encrypted by the API, never shown again). */
export function ConnectSystemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<Values>(EMPTY);
  const type = v.system_type as SystemType;
  const rfc = RFC_TYPES.includes(type);
  const schema = useMemo(() => schemaFor(type), [type]);
  const form = useFormErrors(schema, v);
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const bind = (key: keyof Values) => ({ value: v[key], onChange: set(key), onBlur: () => form.blur(key) });

  const m = useMutation({
    mutationFn: () => registerSystem({
      name: v.name.trim(),
      system_type: type,
      environment: v.environment,
      ...(rfc
        ? { host: v.host.trim(), client: v.client.trim(), sysnr: v.sysnr.trim(), auth_type: "rfc", ...(v.username.trim() ? { username: v.username.trim() } : {}), credentials: { password: v.password } }
        : {
            base_url: v.base_url.trim(), auth_type: "oauth2_client_credentials",
            ...(v.token_url.trim() ? { token_url: v.token_url.trim() } : {}),
            ...(v.company_id.trim() ? { company_id: v.company_id.trim() } : {}),
            credentials: { client_id: v.client_id, client_secret: v.client_secret },
          }),
    }),
    onSuccess: (system) => {
      toast.success(`${system.name} connected`);
      void qc.invalidateQueries({ queryKey: queryKeys.systems() });
      setV(EMPTY);
      onOpenChange(false);
    },
    onError: (e) => toast.error(`Not connected. ${apiErrorMessage(e)}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Connect a system">
      <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); form.touchAll(); if (form.valid) m.mutate(); }}>
        <Field label="Name" error={form.error("name")}><Input {...bind("name")} placeholder="ECC Production" /></Field>
        <Field label="Type"><Select value={v.system_type} onValueChange={(t) => setV((cur) => ({ ...cur, system_type: t }))} options={TYPES} /></Field>
        <Field label="Environment"><Select value={v.environment} onValueChange={(t) => setV((cur) => ({ ...cur, environment: t }))} options={ENVIRONMENTS} /></Field>
        {rfc ? (
          <>
            <Field label="Host" error={form.error("host")}><Input {...bind("host")} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client" error={form.error("client")}><Input {...bind("client")} inputMode="numeric" maxLength={3} /></Field>
              <Field label="Instance number" error={form.error("sysnr")}><Input {...bind("sysnr")} inputMode="numeric" maxLength={2} /></Field>
            </div>
            <Field label="User (optional)"><Input {...bind("username")} autoComplete="off" /></Field>
            <Field label="Password" error={form.error("password")}><Input {...bind("password")} type="password" autoComplete="new-password" /></Field>
          </>
        ) : (
          <>
            <Field label="Base URL" error={form.error("base_url")}><Input {...bind("base_url")} type="url" placeholder="https://" /></Field>
            <Field label={NEEDS_TOKEN_URL.includes(type) ? "Token URL" : "Token URL (optional)"} error={form.error("token_url")}><Input {...bind("token_url")} type="url" placeholder="https://" /></Field>
            {type === "successfactors" && <Field label="Company ID" error={form.error("company_id")}><Input {...bind("company_id")} /></Field>}
            <Field label="Client ID" error={form.error("client_id")}><Input {...bind("client_id")} autoComplete="off" /></Field>
            <Field label="Client secret" error={form.error("client_secret")}><Input {...bind("client_secret")} type="password" autoComplete="new-password" /></Field>
          </>
        )}
        <div className="flex gap-2">
          <Button type="submit" pending={m.isPending} disabled={!form.valid}>Connect system</Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Not now</Button>
        </div>
      </form>
    </Dialog>
  );
}
