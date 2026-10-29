"use client";

import Link from "next/link";
import type { ComponentStatus, StatusPage } from "@/lib/api/v2/enterprise";
import { formatDate } from "@/lib/format";
import { useStatusPage } from "@/lib/v2/enterprise-queries";
import { fixed } from "@/lib/v2/format";
import { dayCells, maintenanceState, overallStatus, statusWord, type DayCell } from "@/lib/v2/status";
import { productName, useTenantTheme } from "@/lib/v2/theme";
import { Mark, VerdictMark } from "../marks";
import { ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import "../status.css";
import { t } from "@/lib/v2/i18n";

const VERDICT: Record<ComponentStatus, "go" | "at-risk" | "no-go"> = { ok: "go", degraded: "at-risk", down: "no-go" };


function overallSentence(s: ComponentStatus): string {
  return s === "ok" ? t("Every part of the platform is working.") : s === "degraded" ? t("Part of the platform is slower or less available than usual.") : t("Part of the platform is down.");
}

function dayWord(c: DayCell): string {
  return c.state === "none" ? t("No checks recorded") : c.state === "ok" ? t("Operational") : c.state === "degraded" ? t("Degraded") : t("Down");
}

function dayLabel(c: DayCell): string {
  const date = formatDate(`${c.day}T12:00:00Z`, "date");
  if (c.state === "none") return t("{date}: No checks recorded", { date });
  return t("{date}: {dayWord}, {count} of {total} checks passed", { date, dayWord: dayWord(c), count: c.total - c.failed, total: c.total });
}

/** One bar of thirty day cells. Hue only where a day was degraded or down; the word beside the bar says it in words. */
export function UptimeBar({ page }: { page: StatusPage }) {
  const cells = dayCells(page.samples, 30);
  const degraded = cells.filter((c) => c.state === "degraded").length;
  const down = cells.filter((c) => c.state === "down").length;
  const state: ComponentStatus = down > 0 ? "down" : degraded > 0 ? "degraded" : "ok";
  const word = statusWord(state);
  const pct = page.uptime_30d_pct;
  const summary = t("{value} over the last 30 days. {down} {down, plural, one {day} other {days}} down, {degraded} {degraded, plural, one {day} other {days}} degraded.", { value: pct == null ? t("Uptime not measured") : t("{pct}% uptime", { pct: fixed(pct, 2) }), down, degraded });
  return (
    <div className="m2-up" data-testid="uptime">
      <div className="m2-upbar" role="img" aria-label={summary}>
        {cells.map((c) => (
          <span key={c.day} className="m2-upcell" data-state={c.state} title={dayLabel(c)} />
        ))}
      </div>
      <div className="m2-upword">
        {state === "ok" ? null : <VerdictMark verdict={VERDICT[state]} />}
        <span>{word}</span>
      </div>
      <p className="m2-prov">{summary}</p>
      <div className="m2-upaxis" aria-hidden="true">
        <span>{t("30 days ago")}</span>
        <span>{t("Today")}</span>
      </div>
    </div>
  );
}

function Components({ page }: { page: StatusPage }) {
  return (
    <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Components and their state")}>
      <table className="m2-tbl m2-stat-tbl">
        <caption className="m2-sr">{t("Components and their state")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Component")}</th>
            <th scope="col">{t("State")}</th>
            <th scope="col">{t("Detail")}</th>
            <th scope="col">{t("Measured")}</th>
          </tr>
        </thead>
        <tbody>
          {page.components.map((c) => (
            <tr key={c.name}>
              <th scope="row">{c.name}</th>
              <td>
                <span className="m2-v">
                  <VerdictMark verdict={VERDICT[c.status]} />
                  {statusWord(c.status)}
                </span>
              </td>
              <td className="m2-wrap">{c.detail ?? "—"}</td>
              <td>{formatDate(c.measured_at, "datetime")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Incidents({ page }: { page: StatusPage }) {
  if (page.incidents.length === 0) return <p className="m2-prov">{t("No incident in the last 30 days.")}</p>;
  return (
    <ul className="m2-incs">
      {page.incidents.map((i) => (
        <li key={i.reference}>
          <div>
            <Mono>{i.reference}</Mono>
            <span className="m2-meta">{t(" {count} {count, plural, one {error} other {errors}}", { count: i.count })}</span>
          </div>
          <div className="m2-meta">{t("First seen {first_seen}, last seen {last_seen}", { first_seen: formatDate(i.first_seen, "datetime"), last_seen: formatDate(i.last_seen, "datetime") })}</div>
          {i.path ? (
            <div className="m2-meta">
              {t("On ")}
              <Mono>{i.path}</Mono>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Maintenance({ page }: { page: StatusPage }) {
  const m = page.maintenance;
  const when = maintenanceState(m);
  if (!m || when === "over") return null;
  return (
    <section className="m2-maint" aria-label={t("Planned maintenance")} data-testid="maintenance">
      <h2 className="m2-h2">{when === "now" ? t("Maintenance in progress") : t("Planned maintenance")}</h2>
      <p>{t("From {from} to {to}. {note}", { from: formatDate(m.from, "datetime"), to: formatDate(m.to, "datetime"), note: m.note })}</p>
    </section>
  );
}

/**
 * The status page: `/v2/status` (readable signed out) and `/status` (signed in). Components and their state, the
 * 30-day uptime bar, incidents and planned maintenance, read from GET /status/page and read again every 60 seconds.
 */
export function StatusScreen({ signedIn = false }: { signedIn?: boolean }) {
  const q = useStatusPage();
  const theme = useTenantTheme();
  const page = q.data;
  const overall = page ? overallStatus(page.components) : null;
  return (
    <div className="m2-stat-page">
      <a className="m2-skip" href="#m2-status-main">
        {t("Skip to content")}
      </a>
      <header className="m2-stat-head">
        <span className="m2-stat-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a tenant logo from a data URL or its own host; next/image would need every host configured */}
          {theme?.logo_url ? <img src={theme.logo_url} alt="" className="m2-logo" /> : <Mark />}
          <span>{productName(theme)}</span>
        </span>
        {signedIn ? (
          <V2Link href="/v2" className="m2-btn m2-sm">
            {t("Back to Meridian")}
          </V2Link>
        ) : (
          <Link href="/sign-in" className="m2-btn m2-sm">
            {t("Sign in")}
          </Link>
        )}
      </header>
      <main id="m2-status-main" tabIndex={-1} className="m2-stat-main">
        <PageTitle>{t("Status")}</PageTitle>
        {q.isError ? (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("The status could not be read. The server may be restarting.")}</ErrorFrame>
        ) : !page || !overall ? (
          <div aria-busy="true">
            <Skeleton width="60%" height={20} />
          </div>
        ) : (
          <>
            <p className="m2-stat-sum" role="status" data-testid="status-overall">
              <span className="m2-v">
                <VerdictMark verdict={VERDICT[overall]} />
                <strong>{statusWord(overall)}</strong>
              </span>{" "}
              {overallSentence(overall)}
            </p>
            <p className="m2-prov">{t("Updated {updated}. This page reads the status again every minute.", { updated: formatDate(new Date(q.dataUpdatedAt), "datetime") })}</p>
            <Maintenance page={page} />
            <section className="m2-sec" aria-labelledby="m2-st-up">
              <h2 className="m2-h2" id="m2-st-up">{t("Last 30 days")}</h2>
              <UptimeBar page={page} />
            </section>
            <section className="m2-sec" aria-labelledby="m2-st-c">
              <h2 className="m2-h2" id="m2-st-c">{t("Components")}</h2>
              <Components page={page} />
            </section>
            <section className="m2-sec" aria-labelledby="m2-st-i">
              <h2 className="m2-h2" id="m2-st-i">{t("Incidents")}</h2>
              <Incidents page={page} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
