import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { resetSurvivorship } from "@/lib/api/v2/fixtures/survivorship";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaSurvivorship } from "../screens/AletheiaSurvivorship";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/aletheia-survivorship");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("verified survivorship", () => {
  it("shows counts per object and each pick with its checks, codes beside text", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    expect(await screen.findByTestId("surv-domain-material_master")).toBeInTheDocument();
    const ok = await screen.findByTestId("surv-pick-MAT-000101-MARA.MTART");
    expect(within(ok).getByText("Material type")).toBeInTheDocument();
    expect(within(ok).getByText("The source's value is not blank")).toBeInTheDocument();
    const bad = await screen.findByTestId("surv-pick-MAT-000102-MARA.MATKL");
    expect(within(bad).getByText("Not proved, the pick did not win")).toBeInTheDocument();
  });
});

const PICK = "surv-pick-MAT-000101-MARA.MTART";
const asSteward = () => { const u = "/aletheia-survivorship?fixture=1&persona=owner"; window.history.pushState({}, "", u); setUrl(u); };

describe("steward decision on a verified pick", () => {
  beforeEach(() => { resetSurvivorship(); asSteward(); });

  it("accepts the pick and shows who kept it", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const pick = await screen.findByTestId(PICK);
    fireEvent.click(within(pick).getByRole("button", { name: "Accept the pick" }));
    expect(await screen.findByText("Accepted by a steward")).toBeInTheDocument();
    expect(within(screen.getByTestId("surv-rates")).getByText(/Accepted/)).toBeInTheDocument();
  });

  it("offers only the other candidates as source and shape, then overrides with a coded reason", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const pick = await screen.findByTestId(PICK);
    fireEvent.click(within(pick).getByRole("button", { name: "Override" }));
    expect(within(pick).queryByRole("radio", { name: /SYS_A/ })).toBeNull();
    expect(within(pick).getByRole("radio", { name: /SYS_B/ })).toBeInTheDocument();
    expect(within(pick).getByText("Shape AAAA, 4 characters")).toBeInTheDocument();
    const go = within(pick).getByRole("button", { name: "Override with this source" });
    expect(go).toBeDisabled();
    fireEvent.click(within(pick).getByRole("radio", { name: /SYS_B/ }));
    fireEvent.change(within(pick).getByLabelText("Reason for the override"), { target: { value: "stale_value" } });
    fireEvent.click(go);
    const state = await screen.findByTestId("surv-state-MAT-000101-MARA.MTART");
    expect(state).toHaveTextContent("Overridden to SYS_B");
    expect(state).toHaveTextContent("The picked value is out of date");
  });

  it("a viewer sees the picks but no actions", async () => {
    window.history.pushState({}, "", "/aletheia-survivorship?fixture=1&persona=owner&role=viewer");
    setUrl("/aletheia-survivorship?fixture=1&persona=owner&role=viewer");
    renderWithQuery(<AletheiaSurvivorship />);
    const pick = await screen.findByTestId(PICK);
    expect(within(pick).queryByRole("button", { name: "Accept the pick" })).toBeNull();
    expect(within(pick).queryByRole("button", { name: "Override" })).toBeNull();
  });
});

describe("approval queue", () => {
  const Q = "surv-queue-MAT-000103-MARA.MEINS";
  beforeEach(() => { resetSurvivorship(); asSteward(); });

  it("lists proposed picks with field, shapes the model saw, checks and confidence, and the counts", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const row = await screen.findByTestId(Q);
    expect(within(row).getByText("Base unit of measure")).toBeInTheDocument();
    expect(within(row).getByText("Shape AA, 2 characters")).toBeInTheDocument();
    expect(within(row).getByText("The source's value is not blank")).toBeInTheDocument();
    expect(within(row).getByText(/Confidence 74/)).toBeInTheDocument();
    expect(screen.queryByTestId("surv-queue-MAT-000101-MARA.MTART")).toBeNull();
    expect(screen.getByTestId("surv-count-proposed")).toHaveTextContent("2");
    expect(screen.getByTestId("surv-count-approved")).toHaveTextContent("51");
    expect(screen.getByTestId("surv-count-rejected")).toHaveTextContent("4");
  });

  it("approves a pick and moves the counts", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const row = await screen.findByTestId(Q);
    fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
    expect(await screen.findByTestId("surv-state-MAT-000103-MARA.MEINS")).toHaveTextContent("Accepted by a steward");
    expect(screen.queryByTestId(Q)).toBeNull();
    expect(screen.getByTestId("surv-count-approved")).toHaveTextContent("52");
    expect(screen.getByTestId("surv-count-proposed")).toHaveTextContent("1");
  });

  it("rejects only with a reason", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const row = await screen.findByTestId(Q);
    fireEvent.click(within(row).getByRole("button", { name: "Reject" }));
    const go = within(row).getByRole("button", { name: "Reject this pick" });
    expect(go).toBeDisabled();
    fireEvent.change(within(row).getByLabelText("Reason for the rejection"), { target: { value: "wrong unit" } });
    fireEvent.click(go);
    expect(await screen.findByTestId("surv-state-MAT-000103-MARA.MEINS")).toHaveTextContent("Rejected by a steward: wrong unit");
    expect(screen.getByTestId("surv-count-rejected")).toHaveTextContent("5");
  });

  it("approves the selected picks in bulk", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const row = await screen.findByTestId(Q);
    const bulk = screen.getByRole("button", { name: /Approve selected/ });
    expect(bulk).toBeDisabled();
    fireEvent.click(within(row).getByRole("checkbox"));
    fireEvent.click(await screen.findByRole("button", { name: "Approve selected (1)" }));
    expect(await screen.findByTestId("surv-state-MAT-000103-MARA.MEINS")).toHaveTextContent("Accepted by a steward");
    expect(screen.getByTestId("surv-count-proposed")).toHaveTextContent("1");
  });

  it("a viewer can read the queue but not decide", async () => {
    const u = "/aletheia-survivorship?fixture=1&persona=owner&role=viewer";
    window.history.pushState({}, "", u);
    setUrl(u);
    renderWithQuery(<AletheiaSurvivorship />);
    const row = await screen.findByTestId("survivorship-queue");
    expect(within(row).getByTestId("surv-queue-reason")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(row).queryByRole("button", { name: /Approve selected/ })).toBeNull();
  });
});

describe("accuracy panel", () => {
  beforeEach(() => { resetSurvivorship(); asSteward(); });

  it("shows the rates, the weekly trend and a bar per field with its text", async () => {
    renderWithQuery(<AletheiaSurvivorship />);
    const panel = await screen.findByTestId("survivorship-accuracy");
    expect(within(panel).getByTestId("surv-rates")).toHaveTextContent("Accepted 83.8%, overridden 16.2%, waiting 1");
    expect(within(panel).getByTestId("surv-trend")).toBeInTheDocument();
    const fields = within(panel).getByTestId("surv-by-field");
    expect(within(fields).getByTitle("Material type (MARA.MTART)")).toBeInTheDocument();
    expect(within(fields).getByText("Material type")).toBeInTheDocument();
  });
});
