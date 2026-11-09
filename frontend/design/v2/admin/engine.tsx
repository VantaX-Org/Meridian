"use client";

import { formatDate } from "@/lib/format";
import { useEngineStatus } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import type { EngineStatus } from "@/lib/api/v2/aletheia-engine";
import { AdminPage, Block, Kv, Loaded, Note, StatusWord } from "./kit";

/** The engine reports times as epoch seconds or ISO text. */
const when = (v: string | number | null | undefined) => (v == null || v === "" ? t("Never") : formatDate(typeof v === "number" ? new Date(v * 1000).toISOString() : v, "datetime"));

/** What stops the engine, in the order it is checked, or null when it runs licensed. */
function problem(s: EngineStatus): { tone: "warn" | "bad"; text: string } | null {
  if (!s.configured) return { tone: "warn", text: t("No engine address is set, so Meridian runs without its engine. Every other screen works as before.") };
  if (!s.live) return { tone: "bad", text: t("The engine does not answer. Meridian keeps working; the engine panels show nothing until it is back.") };
  if (!s.token_set) return { tone: "warn", text: t("The engine runs but no access token is set, so Meridian cannot send it run trends to learn from.") };
  if (s.licence && !s.licence.licensed) return { tone: "warn", text: t("The engine runs unlicensed: no licence key is set on this host. It still learns, but nothing is enforced or attested until a licence key is set.") };
  if (s.licence && !s.licence.valid) return { tone: "bad", text: t("The engine licence is not valid ({reason}). Meridian stops sending it work until a valid licence key is set.", { reason: s.licence.reason ?? t("no reason given") }) };
  return null;
}

/** Admin > Aletheia engine: this deployment's own engine instance, never shared with another product. */
export function EngineSection() {
  const q = useEngineStatus();
  return (
    <AdminPage title={t("Aletheia engine")} lead={t("This deployment runs its own analysis engine. It receives only run-level scores and counts, never extracted records or field values.")}>
      <Loaded q={q} what={t("The engine status")} rows={6}>
        {(s) => {
          const p = problem(s);
          const l = s.licence;
          const verdict = !s.live ? <StatusWord tone="neutral">{t("Not known")}</StatusWord>
            : !l ? <StatusWord tone="at-risk">{t("Not read")}</StatusWord>
            : !l.licensed ? <StatusWord tone="at-risk">{t("Unlicensed")}</StatusWord>
            : l.valid ? <StatusWord tone="go">{t("Valid")}</StatusWord>
            : <StatusWord tone="no-go">{t("Not valid")}</StatusWord>;
          const counters = Object.entries(s.usage?.counters ?? {});
          return (
            <>
              {p ? <Note tone={p.tone}>{p.text}</Note> : null}
              <Block title={t("Status")}>
                <Kv
                  rows={[
                    [t("Engine"), !s.configured ? <StatusWord tone="neutral">{t("Not configured")}</StatusWord> : s.live ? <StatusWord tone="go">{t("Running")}</StatusWord> : <StatusWord tone="no-go">{t("Not answering")}</StatusWord>],
                    [t("Version"), s.version ?? t("Not known")],
                    [t("Engine tenant"), s.tenant],
                    [t("Access token"), s.token_set ? t("Set") : t("Not set")],
                  ]}
                />
              </Block>
              <Block title={t("Licence")}>
                <Kv
                  rows={[
                    [t("Verdict"), verdict],
                    [t("Reason"), l?.reason ? labelText(l.reason) : t("None")],
                    [t("Deployment"), l?.deployment ?? t("Not known")],
                    [t("Valid until"), l?.expires ? formatDate(l.expires) : t("Not set")],
                    [t("Engine tenants allowed"), l?.max_tenants != null ? int(l.max_tenants) : t("Not set")],
                  ]}
                />
              </Block>
              <Block title={t("Usage")}>
                <Kv
                  rows={[
                    [t("Calls recorded"), s.usage?.events != null ? int(s.usage.events) : t("None")],
                    [t("First call"), when(s.usage?.first_seen)],
                    [t("Last call"), when(s.usage?.last_seen)],
                    ...counters.map(([name, n]) => [labelText(name), int(n)] as [string, string]),
                  ]}
                />
              </Block>
            </>
          );
        }}
      </Loaded>
    </AdminPage>
  );
}
