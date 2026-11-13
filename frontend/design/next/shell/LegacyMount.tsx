"use client";

import { createContext, type ReactNode } from "react";
import { usePreferences } from "@/hooks/use-preferences";
import { useV2Session } from "@/lib/v2/hooks";
import { DensityContext, resolveDensity } from "@/lib/v2/density";
import { useInterfaceLang } from "@/lib/v2/i18n";
import { themeRootProps, useTenantTheme } from "@/lib/v2/theme";
import { ToastProvider } from "@/design/v2/Toast";

/** True under the next shell. V2Shell reads it and renders only its token scope there, so a route never gets two frames. */
export const InNextShell = createContext(false);

/** The v2 token scope, density and toasts: what a v2 screen needs around it to render as it does in the old interface. */
export function LegacyScope({ children }: { children: ReactNode }) {
  const { tag } = useInterfaceLang();
  const theme = useTenantTheme();
  const { prefs } = usePreferences();
  const { persona } = useV2Session();
  const density = resolveDensity(prefs.density, persona);
  return (
    <div className="m2-root m2-fonts" data-m2="" data-density={density} lang={tag || undefined} {...themeRootProps(theme)}>
      <DensityContext.Provider value={density}>
        <ToastProvider>{children}</ToastProvider>
      </DensityContext.Provider>
    </div>
  );
}

/** Mounts an existing v2 screen unchanged inside the next shell: same component, same data, same behaviour. */
export function LegacyMount({ children }: { children: ReactNode }) {
  return (
    <div className="nx-legacy">
      <LegacyScope>
        <div className="m2-sheetwrap">
          <div className="m2-cwrap">
            <div className="m2-canvas">{children}</div>
          </div>
        </div>
      </LegacyScope>
    </div>
  );
}
