"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuroraPrefs } from "@/hooks/use-theme";
import { usePreferences } from "@/hooks/use-preferences";
import { useFixture } from "@/lib/api/v2/fixture";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { localeOptions, setPreferences, timezoneOptions, type DensityTier, type DigestFrequency, type PreferencesPatch, type Theme } from "@/lib/preferences";
import { diagnosticsRef, diagnosticsText, loadHelp, orderFor, screenOf, screensFor, SCREEN_LABEL, searchHelp, snippet, appliesTo, type HelpChapter, type HelpIndex } from "@/lib/v2/help";
import { PERSONA_LABEL, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { f1, int } from "@/lib/v2/score";
import { readUiCookie, setUiCookie, subscribeUiCookie, UI_V2 } from "@/lib/v2/switch";
import { setKeyHints, setPersonaOverride, useKeyHints, usePersonaOverride } from "@/lib/v2/prefs";
import { useHealth, useLicence, useTenantSettings } from "@/lib/v2/admin-queries";
import { useDiagnostics } from "@/lib/v2/enterprise-queries";
import { t as tr, LANGUAGES, langOf, type Lang } from "@/lib/v2/i18n";
import { APP_VERSION } from "@/lib/version";
import releaseNotes from "../../../whats-new.json";
import { Actions, InspectorFrame } from "../Inspector";
import { EmptyFrame, Skeleton, V2Link } from "../parts";
import { copyText } from "../admin/kit";
import { ResultFrame, useOutcome } from "./shared";
import { SubscriptionsBlock } from "./collab";

/* ── Preferences ── */

const AUTO = "";

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="m2-segs">
      {options.map((o) => (
        <button key={o.value} type="button" className="m2-seg" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** `?open=preferences`: how Meridian looks and reads for this person, and where it tells them things. */
export function PreferencesPanel({ onClose }: { onClose: () => void }) {
  const fixture = useFixture();
  const { theme, density, setTheme, setDensity } = useAuroraPrefs();
  const { prefs } = usePreferences();
  const persona = usePersonaOverride();
  const hints = useKeyHints();
  const session = useV2Session();
  const useCurrent = useSyncExternalStore(subscribeUiCookie, () => readUiCookie() !== UI_V2, () => false);
  const { outcome, run } = useOutcome();
  // A change is saved at once, locally and (live) by the sync mounted in the shell. In fixture mode there is no sync, so
  // the same change goes to the fixture's /me/preferences.
  const save = (patch: PreferencesPatch) => {
    setPreferences(patch);
    if (fixture) void api.patchMyPreferences(patch);
  };
  const locales = useMemo(() => {
    const base = [...new Set([...localeOptions(), ...LANGUAGES.map((l) => l.tag)])];
    const own = prefs.locale && !base.includes(prefs.locale) ? [prefs.locale] : [];
    return [...own, ...base];
  }, [prefs.locale]);
  const lang = langOf(prefs.locale);
  // A new language starts in its own region; the same language keeps the region already chosen (de-CH stays de-CH).
  const chooseLang = (next: Lang) => save({ locale: next === lang && prefs.locale ? prefs.locale : (LANGUAGES.find((l) => l.lang === next)?.tag ?? null) });
  const zones = useMemo(() => {
    const all = timezoneOptions();
    return prefs.timezone && !all.includes(prefs.timezone) ? [prefs.timezone, ...all] : all;
  }, [prefs.timezone]);
  const sample = new Date("2026-10-16T05:17:00Z");
  const digest = prefs.notifications?.digest ?? "off";
  const critical = prefs.notifications?.immediate_critical ?? false;
  const email = prefs.notifications?.channels?.email ?? false;
  return (
    <InspectorFrame title={tr("Preferences")} status={session.name || undefined} onClose={onClose}>
      <h3>{tr("Display")}</h3>
      <div className="m2-aform">
        <div>
          <div className="m2-lbl m2-meta" style={{ fontSize: 12, marginBottom: 4 }}>{tr("Theme")}</div>
          <Seg<Theme>
            label={tr("Theme")}
            value={theme}
            options={[{ value: "light", label: tr("Light") }, { value: "dark", label: tr("Dark") }, { value: "system", label: tr("System") }]}
            onChange={(t) => (setTheme(t), fixture && void api.patchMyPreferences({ theme: t }))}
          />
        </div>
        <div>
          <div className="m2-lbl m2-meta" style={{ fontSize: 12, marginBottom: 4 }}>{tr("Row density")}</div>
          <Seg<DensityTier>
            label={tr("Row density")}
            value={density}
            options={[{ value: "compact", label: tr("Compact") }, { value: "default", label: tr("Default") }, { value: "comfortable", label: tr("Comfortable") }]}
            onChange={(d) => (setDensity(d), fixture && void api.patchMyPreferences({ density: d }))}
          />
        </div>
      </div>
      <h3>{tr("Language and region")}</h3>
      <div className="m2-aform">
        <label>
          {tr("Language")}
          <select value={lang} onChange={(e) => chooseLang(e.target.value as Lang)} data-testid="language-picker">
            {LANGUAGES.map((l) => (
              <option key={l.lang} value={l.lang} lang={l.tag}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tr("Number and date format")}
          <select value={prefs.locale ?? AUTO} onChange={(e) => save({ locale: e.target.value || null })}>
            <option value={AUTO}>{tr("Browser default")}</option>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tr("Time zone")}
          <select value={prefs.timezone ?? AUTO} onChange={(e) => save({ timezone: e.target.value || null })}>
            <option value={AUTO}>{tr("UTC (default)")}</option>
            {zones.filter((z) => z !== "UTC").map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="m2-prov" data-testid="format-sample">
        {tr("Dates read {sample}, scores {value}, counts {value2}.", { sample: formatDate(sample, "datetime"), value: f1(71.8), value2: int(1234567) })}
      </p>
      <h3>{tr("Start screen")}</h3>
      <div className="m2-aform">
        <label>
          {tr("Open Meridian as")}
          <select value={persona ?? AUTO} onChange={(e) => setPersonaOverride((e.target.value || null) as V2Persona | null)}>
            <option value={AUTO}>{tr("My role's default ({PERSONA_LABEL})", { PERSONA_LABEL: PERSONA_LABEL[session.persona] })}</option>
            {(Object.keys(PERSONA_LABEL) as V2Persona[]).map((p) => (
              <option key={p} value={p}>
                {PERSONA_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="m2-prov">{tr("It changes the next step on the landscape and the work it shows first. Your access does not change.")}</p>
      <h3>{tr("Keyboard")}</h3>
      <label className="m2-sw" style={{ display: "flex", gap: 8 }}>
        <input type="checkbox" checked={hints} onChange={(e) => setKeyHints(e.target.checked)} />
        <span>{tr("Show keyboard hints beside menu items and places")}</span>
      </label>
      <h3>{tr("Notifications")}</h3>
      <div className="m2-aform">
        <label>
          {tr("Digest of your open items")}
          <select value={digest} onChange={(e) => save({ notifications: { digest: e.target.value as DigestFrequency } })}>
            <option value="off">{tr("Off")}</option>
            <option value="daily">{tr("Daily")}</option>
            <option value="weekly">{tr("Weekly")}</option>
          </select>
        </label>
        <label className="m2-sw" style={{ display: "flex", gap: 8 }}>
          <input type="checkbox" checked={critical} onChange={(e) => save({ notifications: { immediate_critical: e.target.checked } })} />
          <span>{tr("Tell me at once about critical findings")}</span>
        </label>
        <label className="m2-sw" style={{ display: "flex", gap: 8 }}>
          <input type="checkbox" checked={email} onChange={(e) => save({ notifications: { channels: { email: e.target.checked } } })} />
          <span>{tr("Also email me")}</span>
        </label>
      </div>
      <p className="m2-prov">
        <V2Link href="/v2/work?open=triage">{tr("Inbox and triage settings")}</V2Link>
        {tr(" decide what reaches your inbox and who covers it.")}
      </p>
      <SubscriptionsBlock />
      <h3>{tr("Interface")}</h3>
      <label className="m2-sw" style={{ display: "flex", gap: 8 }}>
        <input
          type="checkbox"
          checked={useCurrent}
          onChange={(e) =>
            void run("ui", async () => {
              setUiCookie(e.target.checked ? null : UI_V2);
              return e.target.checked ? { tone: "info", title: tr("The current interface opens next time"), detail: tr("This browser now starts in the current interface. You can come back from its account menu.") } : { tone: "ok", title: tr("This browser keeps the new interface") };
            })
          }
        />
        <span>{tr("Use the current interface")}</span>
      </label>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button type="button" className="m2-btn" onClick={onClose}>
          {tr("Done")}
        </button>
      </Actions>
    </InspectorFrame>
  );
}

/* ── Help ── */

/** A little inline markdown: **bold**, `code` and [text](link) as text. Nothing else is interpreted. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <span key={i} className="m2-mono">{p.slice(1, -1)}</span>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    return link ? <Fragment key={i}>{link[1]}</Fragment> : <Fragment key={i}>{p}</Fragment>;
  });
}

function Body({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
              ))}
            </ul>
          );
        }
        if (lines.some((l) => l.startsWith("|"))) return <pre key={i} className="m2-code" tabIndex={0}>{b}</pre>;
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </>
  );
}

function Recording({ chapter }: { chapter: HelpChapter }) {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  if (!chapter.video) return null;
  return (
    <div>
      {open ? (
        missing ? (
          <p className="m2-prov" role="status">{tr("The recording for this chapter is in preparation.")}</p>
        ) : (
          <video controls preload="metadata" aria-label={tr("{title}: training video", { title: chapter.title })} src={`/api/v1/docs/help-videos/${chapter.video}.mp4`} onError={() => setMissing(true)} />
        )
      ) : (
        <button type="button" className="m2-btn" onClick={() => setOpen(true)}>
          {tr("Watch the recording")}
        </button>
      )}
    </div>
  );
}

function ChapterView({ chapter, onBack }: { chapter: HelpChapter; onBack: () => void }) {
  const screens = screensFor(chapter.id);
  return (
    <div className="m2-hbody" data-testid="help-chapter">
      <button type="button" className="m2-linkbtn" onClick={onBack}>
        {tr("All of help")}
      </button>
      <h3 style={{ fontSize: 16, marginTop: 8 }}>{chapter.title}</h3>
      <p className="m2-hs2">{`${chapter.group}${screens.length ? tr(". Applies to: {map}", { map: screens.map((s) => SCREEN_LABEL[s]).join(", ") }) : ""}`}</p>
      <Recording chapter={chapter} />
      {chapter.sections.map((s, i) => (
        <section key={i}>
          {s.heading ? <h3>{s.heading}</h3> : null}
          <Body text={s.text} />
        </section>
      ))}
    </div>
  );
}

interface Release { version: string; date: string; items: { title: string; body: string }[] }

/** `?open=help`: the guide and the training recordings, the chapters for this canvas first, and how to reach support. */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const screen = screenOf(pathname);
  const session = useV2Session();
  const [data, setData] = useState<HelpIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const health = useHealth();
  const tenant = useTenantSettings(session.can("view"));
  const licence = useLicence();
  // The server's own summary (GET /support/diagnostics) rides along with the browser's block.
  const server = useDiagnostics();
  const serverText = server.data ? JSON.stringify(server.data, null, 2) : null;
  useEffect(() => {
    let alive = true;
    loadHelp().then((d) => alive && setData(d), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  const ordered = useMemo(() => (data ? orderFor(data.chapters, screen) : []), [data, screen]);
  const hits = useMemo(() => searchHelp(ordered, query), [ordered, query]);
  const here = hits.filter((h) => appliesTo(h.chapter.id, screen));
  const rest = hits.filter((h) => !appliesTo(h.chapter.id, screen));
  const open = data?.chapters.find((c) => c.id === chapterId) ?? null;
  const diag = {
    version: health.data?.version ?? APP_VERSION,
    tenant: tenant.data?.name ?? null,
    tenantId: (licence.data as { tenant_id?: string } | undefined)?.tenant_id ?? null,
    licence: licence.data ? `${licence.data.tier ?? tr("unknown tier")}, ${licence.data.status}` : null,
    user: session.email ?? (session.name || null),
    screen: pathname,
    time: new Date().toISOString(),
    browser: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
  };
  const releases = releaseNotes as readonly Release[];
  const line = (h: { chapter: HelpChapter; sections: { heading: string; text: string }[] }) => (
    <li key={h.chapter.id}>
      <button type="button" className="m2-hitem" onClick={() => setChapterId(h.chapter.id)}>
        <span className="m2-ht">{h.chapter.title}</span>
        <span className="m2-hs2">{query && h.sections[0] ? snippet(h.sections[0].text || h.sections[0].heading, query) : h.chapter.summary}</span>
        <span className="m2-hs2">
          {h.chapter.group}
          {h.chapter.video ? tr(", with a recording") : ""}
        </span>
      </button>
    </li>
  );
  return (
    <InspectorFrame title={tr("Help")} status={screen ? tr("You are on {SCREEN_LABEL}", { SCREEN_LABEL: SCREEN_LABEL[screen] }) : undefined} onClose={onClose}>
      {open ? (
        <ChapterView chapter={open} onBack={() => setChapterId(null)} />
      ) : (
        <>
          <input ref={search} type="search" className="m2-hsearch" aria-label={tr("Search help")} placeholder={tr("Search the guide and recordings")} value={query} onChange={(e) => setQuery(e.target.value)} />
          {failed ? <p className="m2-prov" role="alert">{tr("The help could not be loaded.")}</p> : !data ? <Skeleton width="100%" height={80} /> : hits.length === 0 ? <EmptyFrame>{tr("Nothing in the guide matches \"{query}\". Try a shorter word, or contact support below.", { query })}</EmptyFrame> : (
            <>
              {here.length ? (
                <>
                  <h3>{tr("On this screen")}</h3>
                  <ul className="m2-hlist" aria-label={tr("Help for this screen")}>{here.map(line)}</ul>
                </>
              ) : null}
              <h3>{here.length ? tr("Everything else") : tr("All of help")}</h3>
              <ul className="m2-hlist" aria-label={tr("All help")}>{rest.map(line)}</ul>
            </>
          )}
          <h3>{tr("What's new")}</h3>
          {releases.slice(0, 2).map((r) => (
            <div key={r.version} className="m2-hbody">
              <p className="m2-hs2">{`${r.version}, ${formatDate(r.date)}`}</p>
              <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 13 }}>
                {r.items.slice(0, 4).map((i) => (
                  <li key={i.title}>
                    <strong>{i.title}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <h3>{tr("Keyboard")}</h3>
          <button type="button" className="m2-btn" onClick={() => window.dispatchEvent(new Event("m2:shortcuts"))}>
            {tr("Keyboard shortcuts")}
          </button>
          <h3>{tr("Contact support")}</h3>
          <p className="m2-hs2" style={{ marginTop: 0 }}>{tr("Include this block in your request. It holds no record values and no secrets.")}</p>
          <p className="m2-secret" data-testid="diagnostics-ref">{diagnosticsRef(diag)}</p>
          <pre className="m2-code" tabIndex={0} aria-label={tr("Diagnostics")}>{diagnosticsText(diag)}</pre>
          {serverText ? (
            <>
              <p className="m2-hs2">{tr("The server's summary is attached below.")}</p>
              <pre className="m2-code" tabIndex={0} aria-label={tr("Server summary")} data-testid="diagnostics-summary">{serverText}</pre>
            </>
          ) : server.isError ? (
            <p className="m2-hs2">{tr("The server's summary could not be read; the block above is enough to start.")}</p>
          ) : null}
          <Actions>
            <button type="button" className="m2-btn" onClick={() => void copyText(`${diagnosticsRef(diag)}\n${diagnosticsText(diag)}${serverText ? tr("\n\nServer summary\n{serverText}", { serverText }) : ""}`).then((ok) => setCopied(ok))}>
              {copied ? tr("Copied") : tr("Copy the diagnostics")}
            </button>
          </Actions>
        </>
      )}
    </InspectorFrame>
  );
}

