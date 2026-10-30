"use client";

import Link from "next/link";
import type { ComponentStatus, OverallStatus, StatusPage } from "@/lib/api/v2/enterprise";
import { formatDate } from "@/lib/format";
import { useStatusPage } from "@/lib/v2/enterprise-queries";
import { fixed } from "@/lib/v2/format";
import { currentMaintenance, dayCells, overallVerdict, overallWord, statusWord, type DayCell } from "@/lib/v2/status";
import { productName, useTenantTheme } from "@/lib/v2/theme";
import { Mark, VerdictMark } from "../marks";
import { ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import "../status.css";
import { t } from "@/lib/v2/i18n";

const VERDICT: Record<ComponentStatus, "go" | "at-risk" | "no-go" | null> = { up: "go", degraded: "at-risk", down: "no-go", not_configured: null };

const pctText = (p: number | null | undefined): string => (p == null ? "—" : `${fixed(p, 2)}%`);

function overallSentence(s: OverallStatus): string {
  return s === "operational" ? t("Every part of the platform is working.") : s === "degraded" ? t("Part of the platform is slower or less available than usual.") : t("A core part of the platform is down.");
}

function dayWord(c: DayCell): string {
  return c.state === "none" ? t("No checks recorded") : c.state === "ok" ? t("Operational") : c.state === "degraded" ? t("Degraded") : t("Down");
}

function dayLabel(c: DayCell): string {
  const date = formatDate(`${c.day}T12:00:00Z`, "date");
  if (c.state === "none") return t("{date}: No checks recorded", { date });
  return t("{date}: {dayWord}, {pct} of {slots} checks up", { date, dayWord: dayWord(c), pct: pctText(c.uptimePct), slots: c.slots });
}

/** One bar of thirty day cells from the server's per-day uptime. Hue only where a day was degraded or down; the word beside the bar says it. */
export function UptimeBar({ page }: { page: StatusPage }) {
  const cells = dayCells(page.uptime, page.generated_at, 30);
  const degraded = cells.filter((c) => c.state === "degraded").length;
  const down = cells.filter((c) => c.state === "down").length;
  const state: ComponentStatus = down > 0 ? "down" : degraded > 0 ? "degraded" : "up";
  const verdict = VERDICT[state];
  const pct = page.uptime.overall_pct;
  const summary = t("{value} over the last 30 days. {down} {down, plural, one {day} other {days}} down, {degraded} {degraded, plural, one {day} other {days}} degraded.", { value: pct == null ? t("Uptime not measured") : t("{pct}% uptime", { pct: fixed(pct, 2) }), down, degraded });
  return (
    <div className="m2-up" data-testid="uptime">
      <div className="m2-upbar" role="img" aria-label={summary}>
        {cells.map((c) => (
          <span key={c.day} className="m2-upcell" data-state={c.state} title={dayLabel(c)} />
        ))}
      </div>
      <div className="m2-upword">
        {state === "up" || !verdict ? null : <VerdictMark verdict={verdict} />}
        <span>{statusWord(state)}</span>
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
  const uptime = new Map(page.uptime.components.map((c) => [c.id, c.uptime_pct]));
  return (
    <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Components and their state")}>
      <table className="m2-tbl m2-stat-tbl">
        <caption className="m2-sr">{t("Components and their state")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Component")}</th>
            <th scope="col">{t("State")}</th>
            <th scope="col">{t("Detail")}</th>
            <th scope="col" className="m2-r">{t("Response")}</th>
            <th scope="col" className="m2-r">{t("30-day uptime")}</th>
          </tr>
        </thead>
        <tbody>
          {page.components.map((c) => {
            const v = VERDICT[c.status];
            return (
              <tr key={c.id}>
                <th scope="row">{c.label}</th>
                <td>
                  <span className="m2-v">
                    {v ? <VerdictMark verdict={v} /> : null}
                    {statusWord(c.status)}
                  </span>
                </td>
                <td className="m2-wrap">{c.detail ?? "—"}</td>
                <td className="m2-r">{c.latency_ms == null ? "—" : t("{latency} ms", { latency: c.latency_ms })}</td>
                <td className="m2-r">{pctText(uptime.get(c.id))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Incidents({ page }: { page: StatusPage }) {
  if (page.incidents.length === 0) return <p className="m2-prov">{t("No server error in the last 24 hours.")}</p>;
  return (
    <ul className="m2-incs">
      {page.incidents.map((i) => (
        <li key={i.reference}>
          <div>
            <Mono>{i.reference}</Mono>{" "}
            <span className="m2-meta">{t("{count, plural, one {# error} other {# errors}}", { count: i.count })}</span>
          </div>
          <div className="m2-meta">{t("First seen {first_seen}, last seen {last_seen}", { first_seen: formatDate(i.first_seen, "datetime"), last_seen: formatDate(i.last_seen, "datetime") })}</div>
          {i.areas.length ? (
            <div className="m2-meta">
              {t("Where:")}{" "}
              {i.areas.map((a, n) => (
                <span key={a}>
                  {n > 0 ? ", " : null}
                  <Mono>{a}</Mono>
                </span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Maintenance({ page }: { page: StatusPage }) {
  const m = currentMaintenance(page.maintenance);
  if (!m) return null;
  const more = page.maintenance.length - 1;
  return (
    <section className="m2-maint" aria-label={t("Planned maintenance")} data-testid="maintenance">
      <h2 className="m2-h2">{m.in_progress ? t("Maintenance in progress") : t("Planned maintenance")}</h2>
      <p>
        <strong>{m.title}</strong>
        {" "}
        {t("From {from} to {to}.", { from: formatDate(m.starts_at, "datetime"), to: formatDate(m.ends_at, "datetime") })}
        {m.detail ? ` ${m.detail}` : ""}
      </p>
      {more > 0 ? <p className="m2-prov">{t("{more, plural, one {# more window is} other {# more windows are}} planned.", { more })}</p> : null}
    </section>
  );
}

/**
 * The status page at `/status`, readable signed out and signed in. Components and their state, the
 * 30-day uptime bar, incidents and planned maintenance, read from GET /status/page and read again every 60 seconds.
 */
export function StatusScreen({ signedIn = false }: { signedIn?: boolean }) {
  const q = useStatusPage();
  const theme = useTenantTheme();
  const page = q.data;
  const overall = page?.status ?? null;
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
          <V2Link href="/" className="m2-btn m2-sm">
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
                <VerdictMark verdict={overallVerdict(overall)} />
                <strong>{overallWord(overall)}</strong>
              </span>{" "}
              {overallSentence(overall)}
            </p>
            <p className="m2-prov">{t("Checked {updated}. This page reads the status again every minute.", { updated: formatDate(page.generated_at, "datetime") })}</p>
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
              <h2 className="m2-h2" id="m2-st-i">{t("Server errors, last 24 hours")}</h2>
              <Incidents page={page} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
