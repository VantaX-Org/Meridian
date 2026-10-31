"use client";

import { useState } from "react";
import { usePreferences } from "@/hooks/use-preferences";
import { fixtureParam } from "@/lib/api/v2/fixture";
import { setPreferences } from "@/lib/preferences";
import { useOpenItem, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { productName, useTenantTheme } from "@/lib/v2/theme";
import { V2Link } from "../parts";

/** The id the welcome is kept under in the person's preferences (tours_done) once dismissed. */
export const WELCOME_ID = "welcome-v2";

const FIRST_LINE: Partial<Record<V2Persona, () => string>> = {
  steward: () => t("Your work starts on Work: the records to fix, the ones that hold the most back first."),
  basis: () => t("This page opens with the connections, the extractions, the failed jobs and the schedules."),
  owner: () => t("Your objects are on the map; the approvals waiting for you are on Work."),
};

/**
 * The welcome on a person's first visit: what the three places of the interface are, the two keys worth knowing, and
 * where the help is. Shown until "Got it", which is kept with the person's preferences so it never returns, on any
 * browser. In fixture mode it shows only with ?welcome=1, so demonstrations and tests open on the page itself.
 */
export function Welcome() {
  const { prefs } = usePreferences();
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const theme = useTenantTheme();
  const [hidden, setHidden] = useState(false);
  const done = prefs.tours_done?.includes(WELCOME_ID) ?? false;
  if (hidden || done || (session.fixture && fixtureParam("welcome") !== "1") || session.shared) return null;
  const dismiss = () => {
    setHidden(true);
    setPreferences({ tours_done: [...(prefs.tours_done ?? []), WELCOME_ID] });
  };
  const first = FIRST_LINE[session.persona]?.() ?? t("The landscape opens with the one sentence that says what holds the programme back, and your next step.");
  return (
    <section className="m2-welcome" aria-labelledby="m2-welcome-h" data-testid="welcome">
      <div className="m2-welcome-h">
        <div>
          <h2 id="m2-welcome-h">{session.name ? t("Welcome to {product}, {name}", { product: productName(theme), name: session.name }) : t("Welcome to {product}", { product: productName(theme) })}</h2>
          <p>{first}</p>
        </div>
      </div>
      <ul className="m2-welcome-parts">
        <li>
          <strong>{t("The map")}</strong>
          <span>{t("On the left: every system and object with its score. Choose a place to open it.")}</span>
        </li>
        <li>
          <strong>{t("The canvas")}</strong>
          <span>{t("In the middle: the place you chose, with its one next step.")}</span>
        </li>
        <li>
          <strong>{t("The inspector")}</strong>
          <span>{t("On the right: whatever you select, always in the same order. Esc closes it.")}</span>
        </li>
      </ul>
      <div className="m2-welcome-a">
        <button type="button" className="m2-btn m2-strong" onClick={dismiss}>
          {t("Got it")}
        </button>
        <V2Link href={hrefFor({ kind: "help", id: "" })} className="m2-btn m2-ghost">
          {t("Open the help")}
        </V2Link>
        <span className="m2-meta">{t("Press / for the command line and ? for every shortcut.")}</span>
      </div>
    </section>
  );
}
