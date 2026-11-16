"use client";

import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRole } from "@/hooks/use-role";
import { writeClipboard } from "@/lib/browser";
import { fixtureParam } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useHealth, useLicence, useTenantSettings } from "@/lib/v2/admin-queries";
import { useDiagnostics } from "@/lib/v2/enterprise-queries";
import {
  diagnosticsRef,
  diagnosticsText,
  FROM_RECORDING,
  helpInEnglish,
  helpText,
  isHere,
  loadHelp,
  orderFor,
  screenOf,
  screensFor,
  SCREEN_LABEL,
  searchHelp,
  snippet,
  videoUrl,
  walkthroughFor,
  type HelpChapter,
  type HelpIndex,
} from "@/lib/v2/help";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { APP_VERSION } from "@/lib/version";
import { V2Link } from "@/design/v2/parts";
import { Button, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, InspectorFrame, type BodyProps } from "./frame";

/** A little inline markdown: **bold**, `code` and [text](link) as text. Nothing else is interpreted. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p))
      return (
        <span key={i} className="nx-pn-mono">
          {p.slice(1, -1)}
        </span>
      );
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    return <Fragment key={i}>{link ? link[1] : p}</Fragment>;
  });
}

function Body({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        if (lines.some((l) => l.startsWith("|")))
          return (
            <pre key={i} className="nx-pn-pre" tabIndex={0}>
              {b}
            </pre>
          );
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </>
  );
}

const minutes = (s: number | null): string | null => (s == null ? null : s >= 60 ? t("{m} min {s} s", { m: Math.floor(s / 60), s: Math.round(s % 60) }) : t("{s} s", { s: Math.round(s) }));

/** A recording: the poster frame until it plays, and the captions as a subtitle track. */
function Recording({ chapter }: { chapter: HelpChapter }) {
  const [missing, setMissing] = useState(false);
  if (!chapter.video) return null;
  const length = minutes(chapter.seconds);
  return (
    <figure data-testid="help-video">
      {missing ? (
        <p className="nx-pn-meta" role="status">
          {t("The recording for this chapter is in preparation.")}
        </p>
      ) : (
        <video
          controls
          preload="none"
          playsInline
          poster={videoUrl(chapter.video, "jpg")}
          aria-label={length ? t("{title}: training video, {length}", { title: chapter.title, length }) : t("{title}: training video", { title: chapter.title })}
          onError={() => setMissing(true)}
        >
          <source src={videoUrl(chapter.video, "mp4")} type="video/mp4" onError={() => setMissing(true)} />
          <track kind="captions" src={videoUrl(chapter.video, "vtt")} srcLang="en" label={t("English")} default />
        </video>
      )}
      <figcaption className="nx-pn-meta">{length ? t("Recording, {length}, with captions. No sound.", { length }) : t("Recording, with captions. No sound.")}</figcaption>
    </figure>
  );
}

/** A link into a walkthrough step that keeps the walkthrough open in help, unless the step opens a panel of its own. */
function keepWalk(href: string, chapterId: string): string {
  if (/[?&]open=/.test(href)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}open=help&chapter=${encodeURIComponent(chapterId)}`;
}

/** Same event and storage key as v2, so progress carries over. */
const WALK_EVENT = "m2:walkthrough";
function subscribeWalk(cb: () => void): () => void {
  window.addEventListener(WALK_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(WALK_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function readWalk(key: string): number {
  try {
    const n = Number(window.localStorage.getItem(key));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** A role's five first steps: each names the screen and opens it; the next-step link moves on. Progress stays in this browser. */
function Walkthrough({ chapter }: { chapter: HelpChapter }) {
  const steps = chapter.walkthrough ?? [];
  const key = `meridian:walkthrough:${chapter.slug}`;
  const stored = useSyncExternalStore(subscribeWalk, () => readWalk(key), () => 0);
  const [local, setLocal] = useState<number | null>(null);
  const at = Math.min(local ?? stored, Math.max(0, steps.length - 1));
  if (steps.length === 0) return null;
  const go = (i: number) => {
    setLocal(i);
    try {
      window.localStorage.setItem(key, String(i));
      window.dispatchEvent(new Event(WALK_EVENT));
    } catch {
      /* blocked storage: the step is kept for this view only */
    }
  };
  const next = at < steps.length - 1 ? steps[at + 1] : null;
  return (
    <section className="nx-ib-sec" aria-label={t("Walkthrough")} data-testid="walkthrough">
      <p className="nx-pn-meta" data-testid="walkthrough-at">
        {t("Step {n} of {total}: {screen}", { n: at + 1, total: steps.length, screen: steps[at].screen })}
      </p>
      <ol className="nx-ib-list">
        {steps.map((s, i) => (
          <li key={s.screen + i} className="nx-ib-row" aria-current={i === at ? "step" : undefined}>
            <strong>{s.screen}</strong>
            <span>{s.text}</span>
            <V2Link href={keepWalk(s.href, chapter.id)} onClick={() => go(i)}>
              {t("Open {screen}", { screen: s.screen })}
            </V2Link>
          </li>
        ))}
      </ol>
      {next ? (
        <V2Link href={keepWalk(next.href, chapter.id)} onClick={() => go(at + 1)} data-testid="walkthrough-next">
          {t("Next step: {screen}", { screen: next.screen })}
        </V2Link>
      ) : (
        <p className="nx-pn-meta">{t("That is the fifth step. The chapter below goes deeper.")}</p>
      )}
    </section>
  );
}

function ChapterView({ chapter, onBack }: { chapter: HelpChapter; onBack: () => void }) {
  const screens = screensFor(chapter.id);
  return (
    <div data-testid="help-chapter">
      <button type="button" className="nx-pn-linkbtn" onClick={onBack}>
        {t("All of help")}
      </button>
      <h3>{helpText(chapter.title)}</h3>
      {helpInEnglish() ? (
        <p className="nx-pn-note" data-testid="help-in-english">
          {t("This chapter is in English.")}
        </p>
      ) : null}
      <p className="nx-pn-meta">{`${helpText(chapter.group)}${screens.length ? t(". Applies to: {map}", { map: screens.map((s) => SCREEN_LABEL[s]).join(", ") }) : ""}`}</p>
      <Walkthrough chapter={chapter} />
      <Recording chapter={chapter} />
      <div lang="en">
        {chapter.sections.map((s, i) => (
          <section key={i} className="nx-ib-sec">
            {s.heading ? <h3>{s.heading}</h3> : null}
            <Body text={s.text} />
          </section>
        ))}
      </div>
    </div>
  );
}

/** `?open=help`: the guide and its recordings, the walkthrough and the chapter for this screen first, and support. */
export function HelpBody({ onClose }: BodyProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const screen = screenOf(pathname);
  const session = useV2Session();
  const { role: liveRole } = useRole();
  const role = session.shared ? "viewer" : (session.viewAs ?? (session.fixture ? fixtureParam("role") : liveRole));
  const ctx = useMemo(() => ({ pathname, search, walkthrough: walkthroughFor(session.persona, role) }), [pathname, search, session.persona, role]);
  const [data, setData] = useState<HelpIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [chapterId, setChapterId] = useState<string | null>(() => params.get("chapter"));
  const [copied, setCopied] = useState(false);
  const health = useHealth();
  const tenant = useTenantSettings(session.can("view"));
  const licence = useLicence();
  // The server's own summary (GET /support/diagnostics) rides along with the browser's block.
  const server = useDiagnostics();
  const serverText = server.data ? JSON.stringify(server.data, null, 2) : null;
  useEffect(() => {
    let alive = true;
    loadHelp().then(
      (d) => alive && setData(d),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  // A walkthrough link names the chapter to reopen: follow it when the address changes, as state set during render.
  const asked = params.get("chapter");
  const [seenAsked, setSeenAsked] = useState(asked);
  if (asked !== seenAsked) {
    setSeenAsked(asked);
    if (asked) setChapterId(asked);
  }
  const ordered = useMemo(() => (data ? orderFor(data.chapters, screen, ctx) : []), [data, screen, ctx]);
  const hits = useMemo(() => searchHelp(ordered, query), [ordered, query]);
  const here = hits.filter((h) => isHere(h.chapter, screen, ctx));
  const rest = hits.filter((h) => !isHere(h.chapter, screen, ctx));
  const open = data?.chapters.find((c) => c.id === chapterId) ?? null;
  const diag = {
    version: health.data?.version ?? APP_VERSION,
    tenant: tenant.data?.name ?? null,
    tenantId: (licence.data as { tenant_id?: string } | undefined)?.tenant_id ?? null,
    licence: licence.data ? `${licence.data.tier ?? t("unknown tier")}, ${licence.data.status}` : null,
    user: session.email ?? (session.name || null),
    screen: pathname,
    time: new Date().toISOString(),
    browser: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
  };
  const line = (h: { chapter: HelpChapter; sections: { heading: string; text: string }[] }) => (
    <li key={h.chapter.id}>
      <button type="button" className="nx-pn-linkbtn nx-ib-row" onClick={() => setChapterId(h.chapter.id)}>
        <strong>
          {helpText(h.chapter.title)}
          {helpInEnglish() ? <span className="nx-pn-meta"> {t("in English")}</span> : null}
        </strong>
        <span className="nx-pn-meta">
          {query && h.sections[0]
            ? `${h.sections[0].heading === FROM_RECORDING ? `${t("From the recording")}: ` : ""}${snippet(h.sections[0].text || h.sections[0].heading, query)}`
            : helpText(h.chapter.summary)}
        </span>
        <span className="nx-pn-meta">
          {helpText(h.chapter.group)}
          {h.chapter.walkthrough ? t(", five steps") : ""}
          {h.chapter.video ? t(", with a recording") : ""}
        </span>
      </button>
    </li>
  );
  const copy = () =>
    void writeClipboard(`${diagnosticsRef(diag)}\n${diagnosticsText(diag)}${serverText ? t("\n\nServer summary\n{serverText}", { serverText }) : ""}`).then((ok) => setCopied(ok));
  return (
    <InspectorFrame title={t("Help")} status={screen ? t("You are on {SCREEN_LABEL}", { SCREEN_LABEL: SCREEN_LABEL[screen] }) : undefined} onClose={onClose}>
      {open ? (
        <ChapterView chapter={open} onBack={() => setChapterId(null)} />
      ) : (
        <>
          <div className="nx-pn-form">
            <input type="search" aria-label={t("Search help")} placeholder={t("Search the guide and recordings")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {failed ? (
            <ErrorState
              sentence={t("The help could not be loaded.")}
              onRetry={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            />
          ) : !data ? (
            <Skeleton lines={3} label={t("Help")} />
          ) : hits.length === 0 ? (
            <EmptyState icon="search" heading={t('Nothing in the guide matches "{query}". Try a shorter word, or contact support below.', { query })} />
          ) : (
            <>
              {here.length ? (
                <section className="nx-ib-sec">
                  <h3>{t("On this screen")}</h3>
                  <ul className="nx-ib-list" aria-label={t("Help for this screen")}>
                    {here.map(line)}
                  </ul>
                </section>
              ) : null}
              {rest.length ? (
                <section className="nx-ib-sec">
                  <h3>{here.length ? t("Everything else") : t("All of help")}</h3>
                  <ul className="nx-ib-list" aria-label={t("All help")}>
                    {rest.map(line)}
                  </ul>
                </section>
              ) : null}
            </>
          )}
          <section className="nx-ib-sec">
            <h3>{t("What's new")}</h3>
            {data ? (
              <ul className="nx-ib-list" aria-label={t("What's new")} data-testid="whats-new">
                {data.whatsNew.map((w) => (
                  <li key={w.step} className="nx-ib-row">
                    <span>
                      <span className="nx-pn-meta">{t("{date}. ", { date: formatDate(w.date) })}</span>
                      {w.text}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section className="nx-ib-sec">
            <h3>{t("Keyboard")}</h3>
            <span>
              <Button variant="secondary" size={32} onClick={() => window.dispatchEvent(new Event("m2:shortcuts"))}>
                {t("Keyboard shortcuts")}
              </Button>
            </span>
          </section>
          <section className="nx-ib-sec">
            <h3>{t("Contact support")}</h3>
            <p className="nx-pn-meta">{t("Include this block in your request. It holds no record values and no secrets.")}</p>
            <p className="nx-pn-mono" data-testid="diagnostics-ref">
              {diagnosticsRef(diag)}
            </p>
            <pre className="nx-pn-pre" tabIndex={0} aria-label={t("Diagnostics")}>
              {diagnosticsText(diag)}
            </pre>
            {serverText ? (
              <>
                <p className="nx-pn-meta">{t("The server's summary is attached below.")}</p>
                <pre className="nx-pn-pre" tabIndex={0} aria-label={t("Server summary")} data-testid="diagnostics-summary">
                  {serverText}
                </pre>
              </>
            ) : server.isError ? (
              <p className="nx-pn-meta">{t("The server's summary could not be read; the block above is enough to start.")}</p>
            ) : null}
          </section>
          <Actions>
            <Button variant="secondary" size={32} onClick={copy}>
              {copied ? t("Copied") : t("Copy the diagnostics")}
            </Button>
          </Actions>
        </>
      )}
    </InspectorFrame>
  );
}
