"use client";

import "../../step9.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { downloadCertificate, gateRefusalOf, issueCertificate, signCertificate, type CertificateList, type CertVersion, type GateRefusal } from "@/lib/api/v2/step9";
import { useWaves } from "@/lib/v2/admin-queries";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshStep9, useCertificates } from "@/lib/v2/step9-queries";
import { InspectorFrame } from "../../Inspector";
import { VerdictMark } from "../../marks";
import { EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../../parts";

/**
 * Who may do what with a certificate, as api/routes/wave_certificates.py decides it: an owner of the wave's objects or
 * a programme lead issues; the owners sign (a lead signs only a wave without owners); downloading needs export. The
 * lead roles are the ones holding both approve and view_audit (programme lead, manager, admin, platform admin).
 */
export function certificateRights(list: CertificateList | undefined, me: string | null, can: (a: string) => boolean, live: boolean): { signer: boolean; issue: boolean; sign: (v: CertVersion) => boolean; download: boolean } {
  const signers = list?.required_signers ?? [];
  const signer = Boolean(me) && signers.some((s) => s.user_id === me);
  const lead = can("approve") && can("view_audit");
  return {
    signer,
    issue: live && (signer || lead),
    sign: (v) => live && (signers.length ? signer : lead) && !v.signatures.some((s) => s.user_id === me),
    download: can("export"),
  };
}

function Refusal({ r }: { r: GateRefusal }) {
  const { hrefFor } = useOpenItem();
  return (
    <div className="m2-result" role="alert" data-tone="fail" data-testid="certificate-refusal">
      <span className="m2-result-t">
        <VerdictMark verdict="no-go" />
        {r.detail}
      </span>
      <ul className="m2-cert-sig">
        {r.objects.map((o) => (
          <li key={o.module}>
            <b>{moduleText(o.module)}</b>
            <span>{o.reason === "never measured" ? t("never measured") : t("critical rules over tolerance")}</span>
            {(o.rules ?? []).map((id) => (
              <V2Link key={id} href={hrefFor({ kind: "rule", id })} className="m2-mono">
                {id}
              </V2Link>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Version({ waveId, v, list, rights, latest, me }: { waveId: string; v: CertVersion; list: CertificateList; rights: ReturnType<typeof certificateRights>; latest: boolean; me: string | null }) {
  const qc = useQueryClient();
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState<"sign" | "pdf" | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const sign = async () => {
    setBusy("sign");
    setSaid(null);
    try {
      const r = await signCertificate(waveId, v.id, statement);
      await refreshStep9(qc, "certs");
      setSaid({ ok: true, text: r.status === "signed" ? t("Signed. Every required owner has signed version {version}.", { version: v.version }) : t("Signed. Waiting for {n} more {n, plural, one {owner} other {owners}}.", { n: r.waiting_for.length }) });
    } catch (e) {
      setSaid({ ok: false, text: failureText(e) });
    } finally {
      setBusy(null);
    }
  };
  const pdf = async () => {
    setBusy("pdf");
    setSaid(null);
    try {
      const name = await downloadCertificate(waveId, v.id, v.version);
      setSaid({ ok: true, text: t("Saved {name}.", { name }) });
    } catch (e) {
      setSaid({ ok: false, text: failureText(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="m2-cert-v" data-testid="certificate-version">
      <h4>
        <span>{t("Version {version}", { version: v.version })}</span>
        <span className="m2-v">
          <VerdictMark verdict={v.status === "signed" ? "go" : "at-risk"} />
          {v.status === "signed" ? t("Signed by every owner") : t("Issued, waiting for signatures")}
        </span>
        {latest ? <span className="m2-meta">{t("latest")}</span> : null}
      </h4>
      <p className="m2-meta" style={{ margin: 0 }}>{`${v.issued_by ? t("Issued {when} by {who}.", { when: formatDate(v.issued_at, "datetime"), who: v.issued_by }) : t("Issued {when}.", { when: formatDate(v.issued_at, "datetime") })} ${t("Measured on {list}.", { list: v.measured_on.length ? v.measured_on.map((m) => `${moduleText(m.module)} ${m.run_at ? formatDate(m.run_at, "date") : t("never")}`).join(", ") : t("no object") })}`}</p>
      <p className="m2-cert-hash" style={{ margin: "4px 0 0" }}>{`SHA-256 ${v.sha256}` /* i18n-ignore */}</p>
      <ul className="m2-cert-sig" aria-label={t("Signatures of version {version}", { version: v.version })}>
        {list.required_signers.map((s) => {
          const sig = v.signatures.find((x) => x.user_id === s.user_id);
          return (
            <li key={s.user_id}>
              <span className="m2-v">
                <VerdictMark verdict={sig ? "go" : "at-risk"} />
                {s.name}
              </span>
              <span className="m2-meta">{s.modules.map(moduleText).join(", ")}</span>
              <span>{sig ? (sig.statement ? t("signed {when}: \"{statement}\"", { when: formatDate(sig.signed_at, "datetime"), statement: sig.statement }) : t("signed {when}", { when: formatDate(sig.signed_at, "datetime") })) : t("not signed yet")}</span>
            </li>
          );
        })}
        {v.signatures
          .filter((x) => !list.required_signers.some((s) => s.user_id === x.user_id))
          .map((x) => (
            <li key={x.user_id}>
              <span className="m2-v">
                <VerdictMark verdict="go" />
                {x.user ?? t("A programme lead")}
              </span>
              <span>{t("signed {when}", { when: formatDate(x.signed_at, "datetime") })}</span>
            </li>
          ))}
      </ul>
      <div className="m2-cert-acts">
        {rights.sign(v) ? (
          <>
            <label className="m2-sr" htmlFor={`stmt-${v.id}`}>
              {t("Statement")}
            </label>
            <input id={`stmt-${v.id}`} className="m2-inp" placeholder={t("Statement (optional)")} value={statement} maxLength={2000} onChange={(e) => setStatement(e.target.value)} />
            <button type="button" className="m2-btn m2-sm m2-strong" disabled={busy !== null} onClick={() => void sign()}>
              {busy === "sign" ? t("Signing…") : t("Sign version {version}", { version: v.version })}
            </button>
          </>
        ) : rights.signer && v.signatures.some((s) => s.user_id === me) ? (
          <span className="m2-meta">{t("You have signed this version.")}</span>
        ) : !rights.signer ? (
          <span className="m2-meta">{list.required_signers.length ? t("Only the owners of the wave's objects sign.") : t("This wave has no owners: a programme lead signs it.")}</span>
        ) : null}
        {rights.download ? (
          <button type="button" className="m2-btn m2-sm" disabled={busy !== null} onClick={() => void pdf()}>
            {busy === "pdf" ? t("Saving…") : t("Download PDF")}
          </button>
        ) : null}
      </div>
      {said ? (
        <p className={said.ok ? "m2-prov" : "m2-s9-err"} role={said.ok ? "status" : "alert"}>
          {said.text}
        </p>
      ) : null}
    </li>
  );
}

/** A wave's readiness certificate: who must sign, every version with its signatures, issue, sign and download. */
export function CertificateBlock({ waveId, waveName }: { waveId: string; waveName: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useCertificates(waveId);
  const [issuing, setIssuing] = useState(false);
  const [refusal, setRefusal] = useState<GateRefusal | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const rights = certificateRights(q.data, session.id, session.can, !session.shared && !session.viewAs);
  const issue = async () => {
    setIssuing(true);
    setRefusal(null);
    setSaid(null);
    try {
      const r = await issueCertificate(waveId);
      await refreshStep9(qc, "certs");
      setSaid({ ok: true, text: t("Version {version} issued. {n} {n, plural, one {owner signs} other {owners sign}} it.", { version: r.version, n: r.required_signers.length }) });
    } catch (e) {
      const r = gateRefusalOf(e);
      if (r) setRefusal(r);
      else setSaid({ ok: false, text: failureText(e) });
    } finally {
      setIssuing(false);
    }
  };
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The certificate of {name} could not be read.", { name: waveName })}</ErrorFrame>;
  if (!q.data) return <Skeleton width="100%" height={80} />;
  const list = q.data;
  return (
    <div data-testid="certificate-block">
      <p className="m2-prov" style={{ marginTop: 0 }}>
        {list.required_signers.length ? t("Required signers: {list}.", { list: list.required_signers.map((s) => `${s.name} (${s.modules.map(moduleText).join(", ")})`).join("; ") }) : t("No object of this wave has an owner, so a programme lead signs.")}
      </p>
      {list.versions.length === 0 ? <EmptyFrame>{t("No certificate has been issued for {name}. Issue one when every object is measured and no critical rule is over tolerance.", { name: waveName })}</EmptyFrame> : null}
      <ul className="m2-s9-list" aria-label={t("Certificate versions of {name}", { name: waveName })} style={{ border: 0 }}>
        {list.versions.map((v, i) => (
          <Version key={v.id} waveId={waveId} v={v} list={list} rights={rights} latest={i === 0} me={session.id} />
        ))}
      </ul>
      {rights.issue ? (
        <button type="button" className="m2-btn" disabled={issuing} onClick={() => void issue()} data-testid="issue-certificate">
          {issuing ? t("Issuing…") : list.versions.length ? t("Issue version {version}", { version: list.versions[0].version + 1 }) : t("Issue the certificate")}
        </button>
      ) : (
        <p className="m2-meta">{t("Issuing needs an owner of the wave's objects or a programme lead.")}</p>
      )}
      {refusal ? <Refusal r={refusal} /> : null}
      {said ? (
        <p className={said.ok ? "m2-prov" : "m2-s9-err"} role={said.ok ? "status" : "alert"}>
          {said.text}
        </p>
      ) : null}
    </div>
  );
}

/** `?open=certificate:<wave id>`: one wave's readiness certificate in the inspector. */
export function CertificateInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const waves = useWaves();
  const q = useCertificates(id);
  const w = waves.data?.find((x) => x.id === id);
  const latest = q.data?.versions[0];
  const status = latest ? (latest.status === "signed" ? t("Version {version}, signed", { version: latest.version }) : t("Version {version}, waiting for signatures", { version: latest.version })) : q.data ? t("Not issued") : undefined;
  return (
    <InspectorFrame title={w ? t("Readiness certificate, {name}", { name: w.name }) : t("Readiness certificate")} status={status} onClose={onClose}>
      {waves.isError ? <ErrorFrame onRetry={() => void waves.refetch()}>{t("The waves could not be read.")}</ErrorFrame> : waves.data && !w ? <EmptyFrame>{t("This wave does not exist. It may have been deleted.")}</EmptyFrame> : <CertificateBlock waveId={id} waveName={w?.name ?? t("this wave")} />}
      <p className="m2-prov">{t("A certificate fixes the score of each object of the wave at its latest run, with the exceptions and contracts behind it, and a SHA-256 of that content. A new version replaces nothing: every version stays.")}</p>
    </InspectorFrame>
  );
}

