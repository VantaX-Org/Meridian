import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as rep from "@/lib/api/v2/reports";
import * as s9 from "@/lib/api/v2/step9";
import { Inspector } from "../Inspector";
import { certificateRights } from "../screens/step9/Certificate";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[], id: "u-me" }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, id: h.id, fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetWorkFixture();
  undo = stubLayout();
  h.allowed = "all";
  h.id = "u-me";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const open = (wave: string) => {
  setUrl(`/?fixture=1&view=waves&open=certificate:${wave}`);
  return renderWithQuery(<Inspector />);
};

describe("the readiness certificate of a wave", () => {
  it("lists the required signers, the versions and who has signed", async () => {
    open("w-2");
    const block = await screen.findByTestId("certificate-block");
    expect(block).toHaveTextContent("Required signers: R. Govender (Material master); T. Mokoena (Business partner); Demo user (Customer master).");
    const [v1] = await within(block).findAllByTestId("certificate-version");
    expect(v1).toHaveTextContent("Version 1");
    expect(v1).toHaveTextContent("Issued, waiting for signatures");
    expect(v1).toHaveTextContent("R. Govender");
    expect(v1).toHaveTextContent('signed 2 Oct 2026');
    expect(v1).toHaveTextContent("T. Mokoena");
    expect(v1).toHaveTextContent("not signed yet");
    expect(v1).toHaveTextContent(/SHA-256 [0-9a-f]{64}/);
  });

  it("lets a required signer sign once, with a statement", async () => {
    const spy = vi.spyOn(s9, "signCertificate");
    open("w-2");
    const v1 = await screen.findByTestId("certificate-version");
    fireEvent.change(within(v1).getByLabelText("Statement"), { target: { value: "Ready for mock load 1." } });
    fireEvent.click(within(v1).getByRole("button", { name: "Sign version 1" }));
    expect(await within(v1).findByText("Signed. Waiting for 1 more owner.")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("w-2", "cert-w2-1", "Ready for mock load 1.");
    await waitFor(() => expect(within(screen.getByTestId("certificate-version")).queryByRole("button", { name: "Sign version 1" })).toBeNull());
    expect(screen.getByTestId("certificate-version")).toHaveTextContent("You have signed this version.");
  });

  it("does not offer signing to someone who is not a required signer", async () => {
    h.id = "u-an";
    h.allowed = ["view", "export"];
    open("w-2");
    const v1 = await screen.findByTestId("certificate-version");
    expect(within(v1).queryByRole("button", { name: /^Sign/ })).toBeNull();
    expect(v1).toHaveTextContent("Only the owners of the wave's objects sign.");
    expect(screen.queryByTestId("issue-certificate")).toBeNull();
    expect(within(v1).getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
  });

  it("shows why the gate refuses a new version", async () => {
    open("w-2");
    fireEvent.click(await screen.findByTestId("issue-certificate"));
    const refusal = await screen.findByTestId("certificate-refusal");
    expect(refusal).toHaveTextContent("The wave is not ready to certify.");
    expect(refusal).toHaveTextContent("Material master");
    expect(within(refusal).getByRole("link", { name: "MM014" })).toBeInTheDocument();
  });

  it("issues a version when every object of the wave is clear", async () => {
    const w = await rep.createWave({ name: "Wave 9: clean", modules: [], target_date: null, stage: "plan", min_readiness: 95 });
    await rep.updateWave(w.id, { modules: ["gl_accounts", "quality_management"] });
    open(w.id);
    const block = await screen.findByTestId("certificate-block");
    expect(block).toHaveTextContent("No object of this wave has an owner");
    fireEvent.click(within(block).getByTestId("issue-certificate"));
    expect(await screen.findByText(/Version 1 issued/)).toBeInTheDocument();
    await waitFor(() => expect(within(block).getAllByTestId("certificate-version")).toHaveLength(1));
  });

  it("downloads the PDF of a version", async () => {
    const spy = vi.spyOn(s9, "downloadCertificate").mockResolvedValue("readiness_certificate_v1.pdf");
    open("w-2");
    const v1 = await screen.findByTestId("certificate-version");
    fireEvent.click(within(v1).getByRole("button", { name: "Download PDF" }));
    expect(await within(v1).findByText("Saved readiness_certificate_v1.pdf.")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("w-2", "cert-w2-1", 1);
  });
});

describe("certificate rights", () => {
  const list = { wave_id: "w", required_signers: [{ user_id: "a", name: "A", modules: ["m"] }], versions: [] };
  const v = { id: "c", version: 1, status: "issued" as const, sha256: "", report_file_id: null, issued_by: null, issued_at: "", measured_on: [], signatures: [] };
  it("follow the backend: owners sign, owners or leads issue, export downloads", () => {
    const lead = (a: string) => ["approve", "view_audit", "export"].includes(a);
    expect(certificateRights(list, "b", lead, true).issue).toBe(true);
    expect(certificateRights(list, "b", lead, true).sign(v)).toBe(false);
    expect(certificateRights(list, "a", () => false, true).sign(v)).toBe(true);
    expect(certificateRights(list, "a", () => false, false).sign(v)).toBe(false);
    expect(certificateRights({ ...list, required_signers: [] }, "b", lead, true).sign(v)).toBe(true);
    expect(certificateRights(list, "a", () => false, true).download).toBe(false);
  });
});
