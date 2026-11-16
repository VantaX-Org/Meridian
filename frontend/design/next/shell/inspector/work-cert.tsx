"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { ANY_SYSTEM, moduleSlug } from "@/lib/v2/score";
import { downloadCertificate, gateRefusalOf, issueCertificate, signCertificate, type CertificateList, type CertVersion, type GateRefusal } from "@/lib/api/v2/step9";
import { useWaves } from "@/lib/v2/admin-queries";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshStep9, useCertificates } from "@/lib/v2/step9-queries";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, InspectorFrame, type BodyProps } from "./frame";
import { Note, OutcomeLine, Sec, type Outcome } from "./work-common";

/**
 * Who may do what with a certificate, as api/routes/wave_certificates.py decides it: an owner of the wave's objects or
 * a programme lead issues; the owners sign (a lead signs only a wave without owners); downloading needs export.
 */
function certificateRights(list: CertificateList | undefined, me: string | null, can: (a: string) => boolean, live: boolean) {
  const signers = list?.required_signers ?? [];
  const signer = Boolean(me) && signers.some((s) => s.user_id === me);
  const lead = can("approve") && can("view_audit");
  return {
    signer,
    issue: live && (signer || lead),
    sign: (v: CertVersion) => live && (signers.length ? signer : lead) && !v.signatures.some((s) => s.user_id === me),
    download: can("export"),
  };
}

const said = (ok: boolean, text: string): Outcome => (ok ? { tone: "ok", title: t("Done"), detail: text } : { tone: "fail", title: t("It did not go through"), detail: text });

function Refusal({ r }: { r: GateRefusal }) {
  const { hrefFor } = useOpenItem();
  return (
    <div className="nx-wk-alert" role="alert" data-testid="certificate-refusal">
      <p>
        <Chip tone="bad">{t("No-go")}</Chip> {r.detail}
      </p>
      <ul className="nx-ib-list">
        {r.objects.map((o) => (
          <li key={o.module} className="nx-ib-row">
            <V2Link href={`/o/${ANY_SYSTEM}/${moduleSlug(o.module)}`}>{moduleText(o.module)}</V2Link>
            <span className="nx-ib-meta">{o.reason === "never measured" ? t("never measured") : t("critical rules failing")}</span>
            {(o.rules ?? []).map((id) => (
              <V2Link key={id} href={hrefFor({ kind: "rule", id })} className="nx-wk-mono">
                {id}
              </V2Link>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Rights = ReturnType<typeof certificateRights>;

function Version({ waveId, v, list, rights, latest, me }: { waveId: string; v: CertVersion; list: CertificateList; rights: Rights; latest: boolean; me: string | null }) {
  const qc = useQueryClient();
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState<"sign" | "pdf" | null>(null);
  const [out, setOut] = useState<Outcome | null>(null);
  const sign = async () => {
    setBusy("sign");
    setOut(null);
    try {
      const r = await signCertificate(waveId, v.id, statement);
      await refreshStep9(qc, "certs");
      setOut(said(true, r.status === "signed" ? t("Signed. Every required owner has signed version {version}.", { version: v.version }) : t("Signed. Waiting for {n} more {n, plural, one {owner} other {owners}}.", { n: r.waiting_for.length })));
    } catch (e) {
      setOut(said(false, failureText(e)));
    } finally {
      setBusy(null);
    }
  };
  const pdf = async () => {
    setBusy("pdf");
    setOut(null);
    try {
      const name = await downloadCertificate(waveId, v.id, v.version);
      setOut(said(true, t("Saved {name}.", { name })));
    } catch (e) {
      setOut(said(false, failureText(e)));
    } finally {
      setBusy(null);
    }
  };
  const measured = v.measured_on.length ? v.measured_on.map((m) => `${moduleText(m.module)} ${m.run_at ? formatDate(m.run_at, "date") : t("never")}`).join(", ") : t("no object");
  return (
    <li className="nx-ib-sec" data-testid="certificate-version">
      <h4>
        {t("Version {version}", { version: v.version })}{" "}
        <Chip tone={v.status === "signed" ? "good" : "neutral"}>{v.status === "signed" ? t("Signed by every owner") : t("Issued, waiting for signatures")}</Chip>
        {latest ? <span className="nx-ib-meta"> {t("latest")}</span> : null}
      </h4>
      <p className="nx-ib-meta">
        {`${v.issued_by ? t("Issued {when} by {who}.", { when: formatDate(v.issued_at, "datetime"), who: v.issued_by }) : t("Issued {when}.", { when: formatDate(v.issued_at, "datetime") })} ${t("Measured on {list}.", { list: measured })}`}
      </p>
      <p className="nx-wk-mono">{`SHA-256 ${v.sha256}` /* i18n-ignore */}</p>
      <ul className="nx-ib-list" aria-label={t("Signatures of version {version}", { version: v.version })}>
        {list.required_signers.map((s) => {
          const sig = v.signatures.find((x) => x.user_id === s.user_id);
          return (
            <li key={s.user_id} className="nx-ib-row">
              <span>
                <Chip tone={sig ? "good" : "neutral"}>{s.name}</Chip> <span className="nx-ib-meta">{s.modules.map(moduleText).join(", ")}</span>
              </span>
              <span>{sig ? (sig.statement ? t("signed {when}: \"{statement}\"", { when: formatDate(sig.signed_at, "datetime"), statement: sig.statement }) : t("signed {when}", { when: formatDate(sig.signed_at, "datetime") })) : t("not signed yet")}</span>
            </li>
          );
        })}
        {v.signatures
          .filter((x) => !list.required_signers.some((s) => s.user_id === x.user_id))
          .map((x) => (
            <li key={x.user_id} className="nx-ib-row">
              <Chip tone="good">{x.user ?? t("A programme lead")}</Chip>
              <span>{t("signed {when}", { when: formatDate(x.signed_at, "datetime") })}</span>
            </li>
          ))}
      </ul>
      {rights.sign(v) ? (
        <label className="nx-wk-form">
          <span>{t("Statement")}</span>
          <input placeholder={t("Statement (optional)")} value={statement} maxLength={2000} onChange={(e) => setStatement(e.target.value)} />
        </label>
      ) : null}
      <Actions>
        {rights.sign(v) ? (
          <Button variant="primary" size={32} disabled={busy !== null} loading={busy === "sign"} loadingLabel={t("Signing…")} onClick={() => void sign()}>
            {t("Sign version {version}", { version: v.version })}
          </Button>
        ) : rights.signer && v.signatures.some((s) => s.user_id === me) ? (
          <Note>{t("You have signed this version.")}</Note>
        ) : !rights.signer ? (
          <Note>{list.required_signers.length ? t("Only the owners of the wave's objects sign.") : t("This wave has no owners: a programme lead signs it.")}</Note>
        ) : null}
        {rights.download ? (
          <Button size={32} disabled={busy !== null} loading={busy === "pdf"} loadingLabel={t("Saving…")} onClick={() => void pdf()}>
            {t("Download PDF")}
          </Button>
        ) : null}
      </Actions>
      {out ? <OutcomeLine outcome={out} /> : null}
    </li>
  );
}

function CertificateBody({ waveId, waveName }: { waveId: string; waveName: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useCertificates(waveId);
  const [issuing, setIssuing] = useState(false);
  const [refusal, setRefusal] = useState<GateRefusal | null>(null);
  const [out, setOut] = useState<Outcome | null>(null);
  const rights = certificateRights(q.data, session.id, session.can, !session.shared && !session.viewAs);
  const issue = async () => {
    setIssuing(true);
    setRefusal(null);
    setOut(null);
    try {
      const r = await issueCertificate(waveId);
      await refreshStep9(qc, "certs");
      setOut(said(true, t("Version {version} issued. {n} {n, plural, one {owner signs} other {owners sign}} it.", { version: r.version, n: r.required_signers.length })));
    } catch (e) {
      const r = gateRefusalOf(e);
      if (r) setRefusal(r);
      else setOut(said(false, failureText(e)));
    } finally {
      setIssuing(false);
    }
  };
  if (q.isError) return <ErrorState sentence={t("The certificate of {name} could not be read.", { name: waveName })} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={4} label={t("Readiness certificate")} />;
  const list = q.data;
  return (
    <div data-testid="certificate-block">
      <Note>
        {list.required_signers.length ? t("Required signers: {list}.", { list: list.required_signers.map((s) => `${s.name} (${s.modules.map(moduleText).join(", ")})`).join("; ") }) : t("No object of this wave has an owner, so a programme lead signs.")}
      </Note>
      {list.versions.length === 0 ? (
        <EmptyState heading={t("Not issued")}>{t("No certificate has been issued for {name}. Issue one when every object is measured and no critical rule is failing.", { name: waveName })}</EmptyState>
      ) : (
        <ul className="nx-ib-list" aria-label={t("Certificate versions of {name}", { name: waveName })}>
          {list.versions.map((v, i) => (
            <Version key={v.id} waveId={waveId} v={v} list={list} rights={rights} latest={i === 0} me={session.id} />
          ))}
        </ul>
      )}
      <Actions>
        {rights.issue ? (
          <Button variant="primary" disabled={issuing} loading={issuing} loadingLabel={t("Issuing…")} onClick={() => void issue()} data-testid="issue-certificate">
            {list.versions.length ? t("Issue version {version}", { version: list.versions[0].version + 1 }) : t("Issue the certificate")}
          </Button>
        ) : (
          <Note>{t("Issuing needs an owner of the wave's objects or a programme lead.")}</Note>
        )}
      </Actions>
      {refusal ? <Refusal r={refusal} /> : null}
      {out ? <OutcomeLine outcome={out} /> : null}
    </div>
  );
}

/** `?open=certificate:<wave id>`: one wave's readiness certificate, its versions and signatures; issue, sign, download. */
export function CertificateBodyView({ id, onClose }: BodyProps) {
  const waves = useWaves();
  const q = useCertificates(id);
  const w = waves.data?.find((x) => x.id === id);
  const latest = q.data?.versions[0];
  const status = latest ? (latest.status === "signed" ? t("Version {version}, signed", { version: latest.version }) : t("Version {version}, waiting for signatures", { version: latest.version })) : q.data ? t("Not issued") : undefined;
  return (
    <InspectorFrame title={w ? t("Readiness certificate, {name}", { name: w.name }) : t("Readiness certificate")} status={status} onClose={onClose}>
      {waves.isError ? (
        <ErrorState sentence={t("The waves could not be read.")} onRetry={() => void waves.refetch()} />
      ) : waves.data && !w ? (
        <EmptyState heading={t("Not found")}>{t("This wave does not exist. It may have been deleted.")}</EmptyState>
      ) : (
        <CertificateBody waveId={id} waveName={w?.name ?? t("this wave")} />
      )}
      <Sec title={t("Readiness certificate")}>
        <Note>{t("A certificate fixes the score of each object of the wave at its latest run, with the exceptions and contracts behind it, and a SHA-256 of that content. A new version replaces nothing: every version stays.")}</Note>
      </Sec>
    </InspectorFrame>
  );
}
