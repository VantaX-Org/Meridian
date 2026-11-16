import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { OPS_SECTIONS } from "./ops";
import { Reports } from "./Reports";
import { Me } from "./Me";
import { Inbox } from "./Inbox";
import { ADMIN_SHEETS } from "./sheets";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/admin?fixture=1");
});
afterEach(() => undo());

const wrap = (ui: ReactElement) => (
  <AletheiaProvider>
    <ToastHost>{ui}</ToastHost>
  </AletheiaProvider>
);

describe("admin ops sections", () => {
  it("exports all thirteen slugs", () => {
    expect(Object.keys(OPS_SECTIONS).sort()).toEqual(
      ["access", "audit", "billing", "contact-verify", "data", "engine", "enterprise", "external-db", "mappings", "schedules", "subject-requests", "system", "triage"],
    );
  });

  for (const [slug, Section] of Object.entries(OPS_SECTIONS)) {
    it(`${slug} renders a heading in fixture mode`, async () => {
      renderWithQuery(wrap(<Section />));
      expect((await screen.findAllByRole("heading")).length).toBeGreaterThan(0);
      expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
    });
  }
});

describe("admin screens", () => {
  it("Reports shows catalogue rows", async () => {
    renderWithQuery(wrap(<Reports />));
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("Me shows preferences", async () => {
    renderWithQuery(wrap(<Me />));
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("Inbox shows notification rows", async () => {
    renderWithQuery(wrap(<Inbox />));
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
  });

  it("registers six sheets and never exposes triggerUpdate", () => {
    expect(Object.keys(ADMIN_SHEETS).sort()).toEqual(["help", "licence", "notify", "preferences", "report", "update"]);
    const dirs = [__dirname, join(__dirname, "ops"), join(__dirname, "sheets")];
    for (const d of dirs) for (const f of readdirSync(d).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."))) {
      expect(readFileSync(join(d, f), "utf8"), f).not.toContain("triggerUpdate");
    }
  });

  for (const key of ["licence", "notify", "update", "report", "preferences", "help"] as const) {
    it(`sheet ${key} renders`, async () => {
      const def = ADMIN_SHEETS[key];
      const { container } = renderWithQuery(wrap(<>{def.render(undefined as never)}</>));
      await waitFor(() => expect(container.textContent?.length ?? 0).toBeGreaterThan(0));
      expect(def.label).toBeTruthy();
    });
  }
});
