/**
 * A worker's raw error text ("RFC_LOGON_FAILURE: Name or password is incorrect", "ConnectionRefusedError",
 * "SoftTimeLimitExceeded()") read as a plain sentence and the next step to take. The raw text stays available as
 * the technical detail. Pure, so the jobs page, the extraction log and the import history read errors the same way.
 */

export type JobErrorKind = "authority" | "auth" | "unreachable" | "timeout" | "library" | "other";

export interface JobErrorExplanation {
  kind: JobErrorKind;
  /** What went wrong, in one sentence. */
  summary: string;
  /** What to do about it, in one sentence. */
  next: string;
  /** The raw text, trimmed; null when there was none. */
  detail: string | null;
}

/** Checked in order: a missing table authorisation also says "not authorized", so it comes before sign-in. */
const PATTERNS: { kind: Exclude<JobErrorKind, "other">; re: RegExp }[] = [
  { kind: "library", re: /pyrfc_not_installed|no module named ['"]?pyrfc|nwrfcsdk/i },
  { kind: "authority", re: /RFC_NO_AUTHORITY|NO_AUTHORITY|not authori[sz]ed (?:to|for)|no authori[sz]ation|missing authori[sz]ation|S_TABU_DIS|S_TABU_NAM|S_RFC\b|TABLE_NOT_AVAILABLE.*authori/i },
  { kind: "auth", re: /RFC_LOGON_FAILURE|logon fail|log ?on .*fail|password|\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid_client|invalid_grant|authentication|credential|auth_failed|sign-in refused/i },
  { kind: "unreachable", re: /connection refused|ECONNREFUSED|unreachable|name resolution|could not resolve|getaddrinfo|nodename nor servname|no route to host|partner .*not reached|RFC_COMMUNICATION_FAILURE|failed to establish|max retries exceeded|connection reset|connection aborted|ConnectionError|SSL(?:Error| certificate)/i },
  { kind: "timeout", re: /timed? ?out|timeout|deadline exceeded|TimeLimitExceeded/i },
];

const COPY: Record<JobErrorKind, { summary: string; next: string }> = {
  library: {
    summary: "The SAP RFC library is not installed on the worker",
    next: "Ask your administrator to install the SAP NW RFC SDK and pyrfc, or load the data with a file import",
  },
  authority: {
    summary: "SAP refused to let this user read one of the tables",
    next: "Ask your SAP Basis team to grant the connection user read access to the tables (S_TABU_DIS and S_RFC), then retry",
  },
  auth: {
    summary: "SAP refused the sign-in",
    next: "Check the user, password or client secret on the system's connection settings, then retry",
  },
  unreachable: {
    summary: "Meridian could not reach the SAP system",
    next: "Check the host, port and network route (firewall, VPN or SAP router) from the Meridian server, then retry",
  },
  timeout: {
    summary: "The job ran out of time before it finished",
    next: "Retry at a quieter time, or extract fewer objects or only the changes",
  },
  other: {
    summary: "The job stopped with an error",
    next: "Retry it. If it fails again, send the technical detail to your administrator",
  },
};

export function explainJobError(raw: string | null | undefined): JobErrorExplanation | null {
  const detail = raw?.trim() || null;
  if (!detail) return null;
  const kind = PATTERNS.find((p) => p.re.test(detail))?.kind ?? "other";
  return { kind, ...COPY[kind], detail };
}
