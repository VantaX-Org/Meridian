import { length, oneOf, pattern, required, url, type FormErrors, type Rule, type Schema } from "@/lib/forms";
import type { ExtractionPath, ReadFunction, SystemType } from "@/types/api";

/** The pure part of the connect and edit forms (types, auth options, hints, validation, the request bodies), shared by the
 * current interface's dialog and the v2 connection form. */

export const TYPES: { value: SystemType; label: string }[] = [
  { value: "ecc", label: "SAP ECC" },
  { value: "s4hana_onprem", label: "S/4HANA on premise" },
  { value: "ewm", label: "Extended Warehouse Management" },
  { value: "s4hana_cloud", label: "S/4HANA Cloud" },
  { value: "successfactors", label: "SuccessFactors" },
  { value: "concur", label: "Concur" },
  { value: "ariba", label: "Ariba" },
  { value: "btp", label: "BTP" },
];
export const ENVIRONMENTS = [{ value: "PRD", label: "Production" }, { value: "QAS", label: "Quality" }, { value: "DEV", label: "Development" }];
export const environmentLabel = (v: string) => ENVIRONMENTS.find((e) => e.value === v)?.label ?? v;
export const RFC_TYPES: readonly SystemType[] = ["ecc", "s4hana_onprem", "ewm"];
/** How an ABAP system's tables are read (sap/extraction_plan.py EXTRACTION_PATHS); odata is S/4HANA on premise only. */
export const EXTRACTION_PATHS = ["table_reader", "odp", "auto", "odata"] as const;
export const pathsFor = (type: SystemType): readonly string[] => (type === "s4hana_onprem" ? EXTRACTION_PATHS : EXTRACTION_PATHS.filter((p) => p !== "odata"));
/** The table readers of sap/rfc.py; "" keeps the deployment's default. */
export const READ_FUNCTIONS = ["", "RFC_READ_TABLE", "/BODS/RFC_READ_TABLE2", "BBP_RFC_READ_TABLE", "auto"] as const;
/** Cloud types whose OAuth flow has no default token endpoint (sap/s4hana_cloud.py, sap/btp.py, sap/ariba.py). */
export const NEEDS_TOKEN_URL: readonly SystemType[] = ["s4hana_cloud", "btp", "ariba"];

/**
 * The auth types each cloud connector accepts (sap/*.py `connect`): SuccessFactors takes Basic
 * (user@company ID and password) or OAuth client credentials; every other cloud type is OAuth only,
 * Ariba with an API key beside it. RFC systems are always "rfc".
 */
const OAUTH = { value: "oauth2_client_credentials", label: "OAuth client credentials" };
const BASIC = { value: "basic", label: "User and password" };
export function authOptions(type: SystemType): { value: string; label: string }[] {
  if (RFC_TYPES.includes(type)) return [{ value: "rfc", label: "RFC user and password" }];
  return type === "successfactors" ? [OAUTH, BASIC] : [OAUTH];
}
export const defaultAuth = (type: SystemType): string => authOptions(type)[0]!.value;
/** The stored auth type when this type accepts it, else the type's default. */
export const authFor = (type: SystemType, stored: string | null | undefined): string =>
  authOptions(type).some((o) => o.value === stored) ? (stored as string) : defaultAuth(type);

/** One line under each SAP field, the same in the connect dialog and the edit form. */
export const HINT = {
  host: "Host name or IP of the application server, for example sap-ecc.internal",
  client: "3 digits, for example 100",
  sysnr: "2 digits, for example 00",
  username: "Leave empty to use the deployment's default RFC user",
  basic_username: "The API user; Meridian signs in as user@company ID",
  base_url: "The tenant's API root, for example https://my123456.s4hana.cloud.sap",
  token_url: "The XSUAA /oauth/token endpoint",
  company_id: "The SuccessFactors company ID",
  realm: "The Ariba realm, for example mycompany-T",
  client_id: "OAuth client ID from the service key",
  api_key: "The application key from the Ariba developer portal",
};
export const TOKEN_HINT: Partial<Record<SystemType, string>> = {
  successfactors: "The SuccessFactors /oauth/token endpoint",
  concur: "Leave empty to use Concur's default token endpoint",
  ariba: "The Ariba OAuth endpoint, for example https://api.ariba.com/v2/oauth/token",
};

export const EMPTY = {
  name: "", system_type: "ecc", environment: "DEV", auth_type: "rfc",
  host: "", client: "", sysnr: "", username: "", password: "",
  base_url: "", token_url: "", company_id: "", client_id: "", client_secret: "", api_key: "",
  extraction_path: "table_reader", read_function: "",
};
export type ConnectionValues = typeof EMPTY;
export type Key = keyof ConnectionValues;

/** The fields a connection test reads; a change to any of them makes an earlier test result stale. */
export const CONNECTION_KEYS: readonly Key[] = [
  "system_type", "auth_type", "host", "client", "sysnr", "username", "password",
  "base_url", "token_url", "company_id", "client_id", "client_secret", "api_key",
];
export const connectionKey = (v: ConnectionValues): string => JSON.stringify(CONNECTION_KEYS.map((k) => v[k].trim()));

/** How each field is named in the "to test, complete ..." hint. */
const FIELD_NAMES: Partial<Record<Key, string>> = {
  host: "the host", client: "the client", sysnr: "the instance number", username: "the user", password: "the password",
  base_url: "the base URL", token_url: "the token URL", company_id: "the company ID", client_id: "the client ID", client_secret: "the client secret", api_key: "the API key",
};

/**
 * Validation by connection kind: RFC systems need host, client, instance and password; cloud systems a base URL and
 * the secrets of their auth type. `secretsOptional` (the edit form) lets a secret stay empty: the stored one is kept.
 */
/** `odataPath`: an S/4HANA on premise system read through its Gateway, which then needs the Gateway base URL. */
export function schemaFor(type: SystemType, auth: string, { secretsOptional = false, odataPath = false } = {}): Schema<ConnectionValues> {
  const secret = (message: string): Rule | undefined => (secretsOptional ? undefined : required(message));
  const common: Schema<ConnectionValues> = {
    name: [required("Enter a system name"), length(1, 100, "Use up to 100 characters")],
    system_type: oneOf(TYPES.map((t) => t.value)),
    environment: oneOf(ENVIRONMENTS.map((e) => e.value)),
  };
  if (RFC_TYPES.includes(type)) {
    return {
      ...common,
      extraction_path: oneOf([...pathsFor(type)]),
      read_function: oneOf([...READ_FUNCTIONS]),
      base_url: odataPath ? [required("Enter the Gateway base URL"), url()] : url(),
      host: [required("Enter the host name"), length(1, 255)],
      client: [required("Enter the 3-digit client"), pattern(/^\d{3}$/, "Enter a 3-digit client")],
      sysnr: [required("Enter the 2-digit instance number"), pattern(/^\d{2}$/, "Enter a 2-digit instance number")],
      password: secret("Enter the password"),
    };
  }
  const basic = auth === "basic";
  return {
    ...common,
    auth_type: oneOf(authOptions(type).map((o) => o.value)),
    base_url: [required("Enter the base URL"), url()],
    token_url: !basic && (NEEDS_TOKEN_URL.includes(type) || type === "successfactors") ? [required("Enter the token URL"), url()] : url(),
    company_id: type === "successfactors" ? required("Enter the company ID") : type === "ariba" ? required("Enter the realm") : undefined,
    ...(basic
      ? { username: required("Enter the user"), password: secret("Enter the password") }
      : { client_id: secret("Enter the client ID"), client_secret: secret("Enter the client secret") }),
    ...(type === "ariba" ? { api_key: secret("Enter the API key") } : {}),
  };
}

/** Why Test connection is disabled, as one line: the connection fields still missing or invalid. Null when it can run. */
export function testBlockedHint(errors: FormErrors<ConnectionValues>, type: SystemType): string | null {
  const name = (k: Key) => (k === "company_id" && type === "ariba" ? "the realm" : FIELD_NAMES[k] ?? k);
  const missing = CONNECTION_KEYS.filter((k) => errors[k]).map(name);
  if (!missing.length) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `To test, complete ${list}`;
}

/** The connection part of a register, update or test body, with only the secrets that were typed. */
export function connectionOf(v: ConnectionValues): {
  connection: { host?: string; client?: string; sysnr?: string; username?: string; base_url?: string; token_url?: string; company_id?: string; auth_type: string; extraction_path?: ExtractionPath; read_function?: ReadFunction };
  credentials: Record<string, string>;
} {
  const type = v.system_type as SystemType;
  const typed = (keys: readonly Key[]) => Object.fromEntries(keys.filter((k) => v[k]).map((k) => [k, v[k]]));
  const username = v.username.trim();
  if (RFC_TYPES.includes(type)) {
    return {
      connection: {
        host: v.host.trim(), client: v.client.trim(), sysnr: v.sysnr.trim(), auth_type: "rfc", ...(username ? { username } : {}),
        extraction_path: (pathsFor(type).includes(v.extraction_path) ? v.extraction_path : "table_reader") as ExtractionPath,
        ...(v.read_function ? { read_function: v.read_function as ReadFunction } : {}),
        ...(type === "s4hana_onprem" && v.base_url.trim() ? { base_url: v.base_url.trim() } : {}),
      },
      credentials: typed(["password"]),
    };
  }
  const auth = authFor(type, v.auth_type);
  const basic = auth === "basic";
  return {
    connection: {
      base_url: v.base_url.trim(), auth_type: auth,
      ...(v.token_url.trim() ? { token_url: v.token_url.trim() } : {}),
      ...(v.company_id.trim() ? { company_id: v.company_id.trim() } : {}),
      ...(basic && username ? { username } : {}),
    },
    credentials: typed(basic ? ["password"] : type === "ariba" ? ["client_id", "client_secret", "api_key"] : ["client_id", "client_secret"]),
  };
}

