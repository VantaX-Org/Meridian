import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { ToastHost } from "@/ui/kit";
import { getCompliance, getThemeSettings } from "@/lib/api/v2/enterprise";
import { getAutomation } from "@/lib/api/v2/step9";
import { resetEnterpriseFixture } from "@/lib/api/v2/fixtures/enterprise";
import { resetStep9Fixture } from "@/lib/api/v2/fixtures/step9";
import { useCompliance, useThemeSettings } from "@/lib/v2/enterprise-queries";
import { AlertSettings } from "./AlertSettings";
import { ComplianceEditor } from "./ComplianceEditor";
import { ThemeEditor } from "./ThemeEditor";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/admin?fixture=1"); resetEnterpriseFixture(); resetStep9Fixture(); });
afterEach(() => undo());

function Theme() { const q = useThemeSettings(); return q.data ? <ThemeEditor key={String(q.data.updated_at)} theme={q.data} /> : null; }
function Compliance() { const q = useCompliance(); return q.data ? <ComplianceEditor key={q.data.retention.families.map((f) => f.days).join()} families={q.data.retention.families} /> : null; }

describe("settings writes", () => {
  it("saves the product name", async () => {
    renderWithQuery(<ToastHost><Theme /></ToastHost>);
    fireEvent.change(await screen.findByLabelText(/^Product name/), { target: { value: "Acme Data" } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await waitFor(async () => expect((await getThemeSettings()).product_name_override).toBe("Acme Data"));
  });

  it("asks before keeping data for a shorter time, then saves", async () => {
    renderWithQuery(<ToastHost><Compliance /></ToastHost>);
    const before = (await getCompliance()).retention.families.find((f) => f.family === "audit_log");
    const box = await screen.findByLabelText(new RegExp("^" + before!.label));
    fireEvent.change(box, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));
    expect(await screen.findByText("Keep data for a shorter time?")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Save retention" }).at(-1)!);
    await waitFor(async () => expect((await getCompliance()).retention.families.find((f) => f.family === "audit_log")?.days).toBe(100));
  });

  it("saves automation and sends a chat test", async () => {
    renderWithQuery(<ToastHost><AlertSettings /></ToastHost>);
    fireEvent.change(await screen.findByLabelText(/^Records a fix must repeat/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }));
    await waitFor(async () => expect((await getAutomation()).rule_mining.min_records).toBe(40));
    fireEvent.click(screen.getByRole("button", { name: "Send a test message" }));
    expect(await screen.findByText(/Delivered/)).toBeTruthy();
  });
});
