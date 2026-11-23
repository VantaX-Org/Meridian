/** Environment of a connected system. Shows only what the system record says: PRD, QAS or DEV. Anything else renders nothing. */
export type SystemEnvironment = "PRD" | "QAS" | "DEV";
const CODE: Record<SystemEnvironment, "PROD" | "QA" | "DEV"> = { PRD: "PROD", QAS: "QA", DEV: "DEV" };

export function envCode(env: string | null | undefined): "PROD" | "QA" | "DEV" | null {
  return env === "PRD" || env === "QAS" || env === "DEV" ? CODE[env] : null;
}

/** The code is the same in every language; only the tooltip is translated. */
export function EnvBadge({ environment, title }: { environment: string | null | undefined; title: string }) {
  const code = envCode(environment);
  return code ? <span className="mx-env" data-env={code.toLowerCase()} title={title}>{code}</span> : null;
}
