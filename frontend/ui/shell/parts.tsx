"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getCommand } from "@/lib/api/v2/landscape";
import { nlQuestion, nlTarget } from "@/lib/v2/step10";
import { useNl } from "@/lib/v2/step10-queries";
import type { Command } from "@/ui/kit/CommandPalette";
import { startViewAs, stopViewAs } from "@/lib/api/v2/roles";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { failureText } from "@/lib/v2/errors";
import { installViewAsHeader, ROLE_NAMES, setShareMode, setViewAs, VIEW_AS_ROLES } from "@/lib/v2/view-as";
import { formatDate } from "@/lib/format";
import { useStatus } from "@/lib/v2/queries";
import { useSandbox } from "@/lib/v2/step10-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { useV2Jobs } from "@/lib/v2/runs-queries";
import { firstSentence, JOB_KIND_LABEL, jobObject, openFailures } from "@/lib/v2/jobs";
import { useStatusPage } from "@/lib/v2/enterprise-queries";
import { overallWord } from "@/lib/v2/status";
import { useUnread } from "@/lib/v2/approvals-queries";
import { int } from "@/lib/v2/score";
import { t, tx } from "@/lib/v2/i18n";
import { Button, Field, Select, Sheet } from "@/ui/kit";
import "./shell.css";

const onLine = (fire: () => void) => {
  window.addEventListener("online", fire);
  window.addEventListener("offline", fire);
  return () => { window.removeEventListener("online", fire); window.removeEventListener("offline", fire); };
};

/**
 * One band under the top bar, one at a time: offline first, then sandbox, then viewing as a role or a shared link,
 * each with its way out. The demo notice is DemoBar. Also installs the X-View-As-Role request header once.
 */
export function Banners() {
  const offline = useSyncExternalStore(onLine, () => !navigator.onLine, () => false);
  const session = useV2Session();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const sandbox = useStatus().data?.sandbox === true;
  const s = useSandbox(sandbox).data;
  useEffect(() => installViewAsHeader(), []);
  const stop = async () => {
    setError(null);
    try { await stopViewAs(); } catch (e) { setError(failureText(e)); }
    setViewAs(null);
    await qc.invalidateQueries();
  };
  if (offline) {
    return <div className="mx-banner" data-tone="warn" role="status" data-testid="offline-banner"><p><strong>{t("You are offline.")}</strong> {t("Changes will not save until the connection is back.")}</p></div>;
  }
  if (sandbox) {
    const since = s?.since ? (s.by ? t("Since {when}, by {who}.", { when: formatDate(s.since, "datetime"), who: s.by }) : t("Since {when}.", { when: formatDate(s.since, "datetime") })) : null;
    return (
      <div className="mx-banner" data-tone="warn" role="status" data-testid="sandbox-banner">
        <p><strong>{t("Sandbox: nothing leaves this deployment.")}</strong> {since}</p>
        <Link href="/admin/settings#sandbox">{t("Sandbox settings")}</Link>
      </div>
    );
  }
  if (session.viewAs) {
    return (
      <div className="mx-banner" role="status" data-testid="view-as-banner">
        <p><strong>{t("Viewing as {ROLE_NAMES}.", { ROLE_NAMES: ROLE_NAMES[session.viewAs] ?? session.viewAs })}</strong> {t("Read-only: you see what this role sees, and nothing can be changed until you stop.")}</p>
        <Button onClick={() => void stop()}>{t("Stop viewing as")}</Button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    );
  }
  if (session.shared) {
    return (
      <div className="mx-banner" role="status" data-testid="shared-banner">
        <p><strong>{t("Shared view.")}</strong> {t("Read-only, as a viewer.")}</p>
        <Button onClick={() => setShareMode(null)}>{t("Leave the shared view")}</Button>
      </div>
    );
  }
  return null;
}

/** An administrator picks a role and sees the interface as that role, read-only, until the banner's Stop. */
export function ViewAsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState(VIEW_AS_ROLES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await startViewAs(role);
      setViewAs(role);
      onClose();
      await qc.invalidateQueries();
    } catch (e) { setError(failureText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} label={t("View as a role")} closeLabel={t("Close")}>
      <p className="mx-muted">{t("Read-only: you see what this role sees, and nothing can be changed until you stop.")}</p>
      <Field label={t("Role")} error={error ?? undefined}>
        <Select value={role} onChange={(e) => setRole(e.target.value)} options={VIEW_AS_ROLES.map((r) => ({ value: r, label: ROLE_NAMES[r] ?? r }))} />
      </Field>
      <Button variant="primary" disabled={busy} onClick={() => void start()}>{t("View as this role")}</Button>
    </Sheet>
  );
}

/** The newest failed job nobody has dealt with, in one line with a link to the jobs list. Nothing otherwise. */
export function FailedJobLine() {
  const fx = useFixture();
  const failed = openFailures(useV2Jobs().jobs)[0];
  if (!failed) return null;
  const why = firstSentence(failed.error);
  return (
    <div className="mx-banner" data-tone="bad" role="status" data-testid="status-failure">
      <p>{t("{JOB_KIND_LABEL} of {jobObject} failed{value}", { JOB_KIND_LABEL: JOB_KIND_LABEL[failed.kind], jobObject: jobObject(failed), value: why ? `: ${why}` : "" })}</p>
      <Link href={withFixture("/runs?view=jobs", fx)}>{t("Open")}</Link>
    </div>
  );
}

/** The platform's health in one word, a link to the status page; nothing until the status page has answered. */
export function HealthWord() {
  const q = useStatusPage();
  if (!q.data) return null;
  const word = overallWord(q.data.status);
  return <Link href="/status" className="mx-topbtn" data-testid="status-health" aria-label={t("Platform {statusWord}, open the status page", { statusWord: word })}>{word}</Link>;
}

/** The unread count; opens the inbox. */
export function InboxButton() {
  const fx = useFixture();
  const unread = useUnread().data;
  const inbox = unread ? int(unread.count) : "—";
  return <Link href={withFixture("/me/notifications", fx)} className="mx-topbtn" data-testid="inbox" aria-label={t("Inbox {inbox}, unread", { inbox })}>{t("Inbox")} <b>{inbox}</b></Link>;
}

/**
 * Server rows for the palette, for the typed text: GET /command hits (a material number opens the record, a rule id the rule),
 * or, after a leading "?", the natural-language answer as one row that opens the filtered list it names.
 */
export function usePaletteSearch(q: string): Command[] {
  const fx = useFixture();
  const router = useRouter();
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 120);
    return () => clearTimeout(id);
  }, [q]);
  const groups = useQuery({
    queryKey: ["v2", "command", fx, debounced],
    queryFn: () => getCommand(debounced),
    enabled: debounced.length > 0 && !debounced.startsWith("?"),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  }).data?.groups;
  const question = nlQuestion(debounced);
  const nl = useNl(question ?? "", Boolean(question)).data;
  if (!debounced) return [];
  if (question) return nl ? [{ id: "__nl", label: nl.explanation, hint: t("Open"), run: () => router.push(withFixture(nlTarget(nl), fx)) }] : [];
  return (groups ?? []).flatMap((g, i) => g.items.map((x) => ({ id: `found-${i}-${x.id}`, label: x.title, hint: tx(g.label), run: () => router.push(withFixture(x.href, fx)) })));
}
