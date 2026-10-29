import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetAdminFixture } from "@/lib/api/v2/fixtures/admin";
import { resetRolesFixture } from "@/lib/api/v2/fixtures/roles";
import { setShareMode, setViewAs } from "@/lib/v2/view-as";
import { Inspector } from "../../Inspector";
import { ToastProvider } from "../../Toast";
import { RoleBanners } from "../../shell/RoleBanners";
import { setUrl } from "../nav-store";

/**
 * The role walks (step 6c): each test file signs in as one role in fixture mode (`?role=<key>` gives the session that
 * role's permissions from the fixture copy of api/services/rbac.py) and walks that role's jobs from
 * docs/roles-and-features.md, asserting each verb is reachable and, where the role lacks it, gated.
 */
export function visit(path: string, role: string, extra = ""): void {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${path}${sep}fixture=1&role=${role}${extra}`;
  window.history.pushState({}, "", url);
  setUrl(url);
}

export function reset(): void {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetAdminFixture();
  resetRolesFixture();
  setViewAs(null);
  setShareMode(null);
}

/** The canvas under test with the shell pieces the role verbs touch: banners, inspector and toasts. */
export function mount(ui?: ReactElement) {
  return renderWithQuery(
    <ToastProvider>
      <RoleBanners />
      {ui ?? null}
      <Inspector />
    </ToastProvider>,
  );
}

export const norm = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();
