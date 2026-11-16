"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { useAuroraPrefs } from "@/hooks/use-theme";
import { usePreferences } from "@/hooks/use-preferences";
import type { NotificationDelivery } from "@/lib/api/notifications";
import { getOidcPublicConfig } from "@/lib/api/sso";
import { errorSentence } from "@/lib/api/v2/client";
import { fixtureActive, useFixture } from "@/lib/api/v2/fixture";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { localeOptions, setPreferences, timezoneOptions, type DensityTier, type DigestFrequency, type PreferencesPatch, type Theme } from "@/lib/preferences";
import { personaDensity } from "@/lib/v2/density";
import { PERSONA_LABEL, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { t, LANGUAGES, langOf, type Lang } from "@/lib/v2/i18n";
import { setKeyHints, setPersonaOverride, useKeyHints, usePersonaOverride } from "@/lib/v2/prefs";
import { f1, int } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import { Button, ErrorState, SegmentedControl, Skeleton } from "../../kit";
import { MIN_PASSWORD_LENGTH } from "../AuthGuard";
import { Actions, InspectorFrame, type BodyProps } from "./frame";
import { Result, SubscriptionsBlock, useOutcome, WatchListBlock, type Outcome } from "./panels-kit";

const AUTO = "";

/** The density choice: the role's, or one of the two modes (lib/v2/density.ts). */
type DensityChoice = "role" | "compact" | "comfortable";

/** `?open=preferences`: how Meridian looks and reads for this person, and where it tells them things. */
export function PreferencesBody({ onClose }: BodyProps) {
  const fixture = useFixture();
  const { theme, setTheme } = useAuroraPrefs();
  const { prefs } = usePreferences();
  const density = prefs.density;
  const persona = usePersonaOverride();
  const hints = useKeyHints();
  const session = useV2Session();
  // Saved at once, locally and (live) by the sync mounted in the shell. In fixture mode the change goes to /me/preferences.
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
    <InspectorFrame title={t("Preferences")} status={session.name || undefined} onClose={onClose}>
      <section className="nx-ib-sec">
        <h3>{t("Display")}</h3>
        <div className="nx-pn-form">
          <div className="nx-pn-fld">
            <span>{t("Theme")}</span>
            <SegmentedControl<Theme>
              label={t("Theme")}
              value={theme}
              items={[
                { value: "light", label: t("Light") },
                { value: "dark", label: t("Dark") },
              ]}
              onChange={(v) => {
                setTheme(v);
                if (fixture) void api.patchMyPreferences({ theme: v });
              }}
            />
          </div>
          <div className="nx-pn-fld">
            <span>{t("Row density")}</span>
            <SegmentedControl<DensityChoice>
              label={t("Row density")}
              value={density === "compact" || density === "comfortable" ? density : "role"}
              items={[
                { value: "role", label: t("My role's ({density})", { density: personaDensity(session.persona) === "compact" ? t("Compact") : t("Comfortable") }) },
                { value: "compact", label: t("Compact") },
                { value: "comfortable", label: t("Comfortable") },
              ]}
              onChange={(d) => {
                const next: DensityTier | null = d === "role" ? null : d;
                save({ density: next });
              }}
            />
            <p className="nx-pn-meta" data-testid="density-note">
              {t("Compact fits more rows: 28 pixels, 13 pixel text. Comfortable reads more easily: 36 pixels, 14 pixel text. Every list and ledger follows it.")}
            </p>
          </div>
        </div>
      </section>
      <section className="nx-ib-sec">
        <h3>{t("Language and region")}</h3>
        <div className="nx-pn-form">
          <label className="nx-pn-fld">
            <span>{t("Language")}</span>
            <select value={lang} onChange={(e) => chooseLang(e.target.value as Lang)} data-testid="language-picker">
              {LANGUAGES.map((l) => (
                <option key={l.lang} value={l.lang} lang={l.tag}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="nx-pn-fld">
            <span>{t("Number and date format")}</span>
            <select value={prefs.locale ?? AUTO} onChange={(e) => save({ locale: e.target.value || null })}>
              <option value={AUTO}>{t("Browser default")}</option>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="nx-pn-fld">
            <span>{t("Time zone")}</span>
            <select value={prefs.timezone ?? AUTO} onChange={(e) => save({ timezone: e.target.value || null })}>
              <option value={AUTO}>{t("UTC (default)")}</option>
              {zones
                .filter((z) => z !== "UTC")
                .map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <p className="nx-pn-meta" data-testid="format-sample">
          {t("Dates read {sample}, scores {value}, counts {value2}.", { sample: formatDate(sample, "datetime"), value: f1(71.8), value2: int(1234567) })}
        </p>
      </section>
      <section className="nx-ib-sec">
        <h3>{t("Start screen")}</h3>
        <label className="nx-pn-fld nx-pn-form">
          <span>{t("Open Meridian as")}</span>
          <select value={persona ?? AUTO} onChange={(e) => setPersonaOverride((e.target.value || null) as V2Persona | null)}>
            <option value={AUTO}>{t("My role's default ({PERSONA_LABEL})", { PERSONA_LABEL: session.label })}</option>
            {(Object.keys(PERSONA_LABEL) as V2Persona[]).map((p) => (
              <option key={p} value={p}>
                {PERSONA_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <p className="nx-pn-meta">{t("It changes the next step on the landscape and the work it shows first. Your access does not change.")}</p>
      </section>
      <section className="nx-ib-sec">
        <h3>{t("Keyboard")}</h3>
        <label className="nx-pn-opt">
          <input type="checkbox" checked={hints} onChange={(e) => setKeyHints(e.target.checked)} />
          <span>{t("Show keyboard hints beside menu entries and places")}</span>
        </label>
      </section>
      <section className="nx-ib-sec">
        <h3>{t("Notifications")}</h3>
        <div className="nx-pn-form">
          <label className="nx-pn-fld">
            <span>{t("Digest of your open work")}</span>
            <select value={digest} onChange={(e) => save({ notifications: { digest: e.target.value as DigestFrequency } })}>
              <option value="off">{t("Off")}</option>
              <option value="daily">{t("Daily")}</option>
              <option value="weekly">{t("Weekly")}</option>
            </select>
          </label>
          <label className="nx-pn-opt">
            <input type="checkbox" checked={critical} onChange={(e) => save({ notifications: { immediate_critical: e.target.checked } })} />
            <span>{t("Tell me at once about critical findings")}</span>
          </label>
          <label className="nx-pn-opt">
            <input type="checkbox" checked={email} onChange={(e) => save({ notifications: { channels: { email: e.target.checked } } })} />
            <span>{t("Also email me")}</span>
          </label>
        </div>
        <p className="nx-pn-meta">
          <V2Link href="/work?open=triage">{t("Inbox and triage settings")}</V2Link>
          {t(" decide what reaches your inbox and who covers it.")}
        </p>
      </section>
      <section className="nx-ib-sec">
        <h3>{t("Password")}</h3>
        <ChangePasswordBlock />
      </section>
      <DeliveryLog />
      <SubscriptionsBlock />
      <WatchListBlock />
      <Actions>
        <Button variant="secondary" size={32} onClick={onClose}>
          {t("Done")}
        </Button>
      </Actions>
    </InspectorFrame>
  );
}

const CHANNEL_TEXT: Record<NotificationDelivery["channel"], () => string> = { email: () => t("Email"), in_app: () => t("In Meridian") };
const KIND_TEXT: Record<NotificationDelivery["kind"], () => string> = { critical: () => t("Critical finding"), digest: () => t("Digest"), test: () => t("Test message") };
const STATUS_TEXT: Record<NotificationDelivery["status"], () => string> = {
  sent: () => t("Sent"),
  failed: () => t("Failed"),
  no_backend: () => t("No mail server set up"),
  skipped: () => t("Skipped"),
};

/** The person's own test message and the last 20 things Meridian sent them, with why any failed. */
function DeliveryLog() {
  const fixture = useFixture();
  const qc = useQueryClient();
  const key = ["v2", "admin", fixture, "me", "deliveries"];
  const log = useQuery({ queryKey: key, queryFn: () => api.getMyDeliveries(20) });
  const [note, setNote] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: api.sendTestNotification,
    onSuccess: (r) => {
      setNote(
        r.email === "sent" || r.email === "sent_unrecorded"
          ? t("Sent. Check your inbox and the bell.")
          : r.email === "no_backend"
            ? t("Sent to the bell. No mail server is set up, so no email went out.")
            : t("Sent to the bell. The email failed; the log below says why."),
      );
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setNote(isAxiosError(err) && err.response?.status === 429 ? t("Three test messages an hour is the limit. Try again later.") : errorSentence(err, t("The test message could not be sent."))),
  });
  const items = log.data?.items ?? [];
  return (
    <section className="nx-ib-sec" aria-label={t("Delivery log")} data-testid="delivery-log">
      <h3>{t("Delivery log")}</h3>
      <span>
        <Button variant="secondary" size={32} loading={test.isPending} onClick={() => test.mutate()}>
          {t("Send me a test message")}
        </Button>
      </span>
      {note ? (
        <p className="nx-pn-meta" role="status">
          {note}
        </p>
      ) : null}
      {log.isLoading ? (
        <Skeleton lines={2} label={t("Delivery log")} />
      ) : log.isError ? (
        <ErrorState sentence={t("The delivery log could not be read.")} error={log.error} onRetry={() => void log.refetch()} />
      ) : !items.length ? (
        <p className="nx-pn-meta">{t("Nothing has been sent to you yet.")}</p>
      ) : (
        <div className="nx-pn-scroll" tabIndex={0} role="region" aria-label={t("Delivery log, scrollable")}>
          <table className="nx-pn-table">
            <thead>
              <tr>
                <th scope="col">{t("When")}</th>
                <th scope="col">{t("Channel")}</th>
                <th scope="col">{t("Kind")}</th>
                <th scope="col">{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td>{formatDate(d.created_at, "datetime")}</td>
                  <td>{CHANNEL_TEXT[d.channel]?.() ?? d.channel}</td>
                  <td>{KIND_TEXT[d.kind]?.() ?? d.kind}</td>
                  <td>
                    {STATUS_TEXT[d.status]?.() ?? d.status}
                    {d.error ? <div className="nx-pn-meta">{d.error}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** True when the tenant enforces single sign-on (public config, so any signed-in user can read it). Same key as v2. */
function useSsoEnforced(): boolean {
  const q = useQuery({
    queryKey: ["oidc-public", fixtureActive()],
    queryFn: () => (fixtureActive() ? Promise.resolve({ enabled: false, display_name: null, enforce: false }) : getOidcPublicConfig()),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return Boolean(q.data?.enabled && q.data.enforce);
}

/** The sentence for a refused password request, by status; the API's own sentence when it gave one. */
function passwordFailure(e: unknown): Outcome {
  const status = isAxiosError(e) ? e.response?.status : undefined;
  if (status === 429) return { tone: "fail", title: t("Too many password changes"), detail: t("Wait a minute, then try again.") };
  if (status === 403) return { tone: "fail", title: t("Not allowed"), detail: errorSentence(e, t("Setting a password needs the manage users permission.")) };
  if (status === 422) return { tone: "fail", title: t("That password cannot be used"), detail: errorSentence(e, t("Choose a stronger password.")) };
  return { tone: "fail", title: t("The password was not changed"), detail: errorSentence(e, t("Try again.")) };
}

/**
 * Change your own password with the current one, through the signed-in user's own auth context (POST of the
 * user's own change, not a connect). The values live in component state only, are cleared on success and are never logged.
 */
function ChangePasswordBlock() {
  const { changePassword } = useAuth();
  const { isAdmin } = useRole();
  const sso = useSsoEnforced();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { outcome, pending, run } = useOutcome();
  if (sso && !isAdmin) return <p className="nx-pn-meta">{t("Managed by your identity provider. Change your password there.")}</p>;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const p =
      pw.length < MIN_PASSWORD_LENGTH
        ? t("Use at least {min} characters", { min: MIN_PASSWORD_LENGTH })
        : pw !== confirm
          ? t("The new password and its confirmation do not match.")
          : pw === current
            ? t("The new password must differ from the current one.")
            : null;
    if (p) return setProblem(p);
    void run("change", async () => {
      try {
        await changePassword(current, pw);
        setCurrent("");
        setPw("");
        setConfirm("");
        return { tone: "ok", title: t("Password changed"), detail: t("Your other sessions are signed out.") };
      } catch (err) {
        return passwordFailure(err);
      }
    });
  };
  return (
    <form className="nx-pn-form" onSubmit={submit} noValidate data-testid="change-password">
      <label className="nx-pn-fld">
        <span>{t("Current password")}</span>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </label>
      <label className="nx-pn-fld">
        <span>{t("New password")}</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="nx-pn-fld">
        <span>{t("Confirm new password")}</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {problem ? (
        <p className="nx-pn-err" role="alert">
          {problem}
        </p>
      ) : null}
      <Result outcome={outcome} />
      <span>
        <Button type="submit" variant="secondary" size={32} loading={pending !== null} loadingLabel={t("Saving…")} disabled={!current || !pw}>
          {t("Change password")}
        </Button>
      </span>
    </form>
  );
}
