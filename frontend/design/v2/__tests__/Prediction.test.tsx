import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s10 from "@/lib/api/v2/step10";
import { bandWords, queueWords, spanWords } from "@/lib/v2/step10";
import { Inspector } from "../Inspector";
import { AdminCanvas } from "../admin/Admin";
import { resetKeptOutcomes } from "../inspector/shared";
import { RunsCanvas } from "../screens/Runs";
import { FixtureJobLine } from "../shell/JobLine";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const ECC = "a1b2c3d4-0001-4000-8000-000000000001";

let undo: () => void = () => undefined;
const visit = (url: string) => {
  window.history.pushState({}, "", url);
  setUrl(url);
};
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetKeptOutcomes();
  undo = stubLayout(1400, 600);
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("run prediction", () => {
  it("says spans, bands and queue places in words", () => {
    expect(spanWords(42)).toBe("42 s");
    expect(spanWords(605)).toBe("10 min");
    expect(spanWords(3900)).toBe("1 h 05 min");
    expect(bandWords({ seconds: 600, seconds_low: 540, seconds_high: 720 })).toBe("9 min to 12 min");
    expect(bandWords({ seconds: null, seconds_low: null, seconds_high: null })).toBeNull();
    expect(queueWords(1)).toBe("Starts next");
    expect(queueWords(3)).toBe("Position 3 in the queue");
  });

  it("Admin runs: the extraction form shows the band, records, cost and queue before the person confirms", async () => {
    const spy = vi.spyOn(s10, "getRunPrediction");
    visit("/admin/runs?fixture=1");
    renderWithQuery(<AdminCanvas section="runs" />);
    const objects = await screen.findByRole("list", { name: "Objects to extract" });
    const ext = screen.getByRole("region", { name: "Start an extraction" });
    expect(within(ext).queryByTestId("run-prediction")).toBeNull();
    fireEvent.click((await within(objects).findAllByRole("checkbox"))[0]);
    const p = await within(ext).findByTestId("run-prediction");
    await waitFor(() => expect(within(p).getByTestId("prediction-duration")).toHaveTextContent(/\d+ min.*, high confidence/));
    expect(norm(p)).toContain("Records");
    expect(within(p).getByTestId("prediction-cost")).toHaveTextContent(/^ZAR \d/);
    expect(within(p).getByTestId("prediction-queue")).toHaveTextContent("Starts next; 0 running, 0 queued");
    expect(norm(p)).toContain("From the last 8 finished runs of 1 object.");
    expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ system_id: ECC, delta: false });
    fireEvent.click(screen.getAllByTestId("extract-delta")[0]);
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ delta: true }));
    await waitFor(() => expect(norm(within(ext).getByTestId("run-prediction"))).toContain("changes only"));
  });

  it("a dash when the cost model prices no run, and the queue when jobs are ahead", async () => {
    visit("/admin/runs?fixture=1&cost=none&queue=busy");
    renderWithQuery(<AdminCanvas section="runs" />);
    const objects = await screen.findByRole("list", { name: "Objects to extract" });
    fireEvent.click((await within(objects).findAllByRole("checkbox"))[0]);
    const p = await within(screen.getByRole("region", { name: "Start an extraction" })).findByTestId("run-prediction");
    await waitFor(() => expect(within(p).getByTestId("prediction-cost")).toHaveTextContent("—"));
    expect(within(p).getByTestId("prediction-cost").querySelector(".m2-dash")).toHaveAttribute("title", expect.stringContaining("The cost model prices no run"));
    expect(within(p).getByTestId("prediction-queue")).toHaveTextContent("Position 3 in the queue; 0 running, 2 queued");
  });

  it("the System inspector's extraction and the Runs canvas's Start a run show it too", async () => {
    visit(`/?fixture=1&open=system:${ECC}`);
    const a = renderWithQuery(<Inspector />);
    fireEvent.click(await screen.findByRole("button", { name: "Extract" }));
    const picker = await screen.findByTestId("extract-picker");
    fireEvent.click((await within(picker).findAllByRole("checkbox"))[0]);
    expect(await within(picker).findByTestId("run-prediction")).toBeInTheDocument();
    a.unmount();
    visit("/runs?fixture=1");
    renderWithQuery(<RunsCanvas />);
    fireEvent.click(await screen.findByRole("button", { name: "Start a run" }));
    const start = await screen.findByTestId("start-run");
    fireEvent.change(within(start).getByLabelText("System"), { target: { value: "a1b2c3d4-0002-4000-8000-000000000002" } });
    const p = await within(start).findByTestId("run-prediction");
    await waitFor(() => expect(norm(p)).toContain("Before you start the analysis"));
  });

  it("a queued job says its place on the job line and in its inspector", async () => {
    visit("/?fixture=1&job=queued");
    renderWithQuery(<FixtureJobLine />);
    expect(await screen.findByTestId("job-line-link")).toHaveTextContent("Analysing Material master, queued, position 2");
    visit("/?fixture=1&job=queued&open=job:an-q0000000-0000-4000-8000-0000000000q1");
    renderWithQuery(<Inspector />);
    const insp = await screen.findByTestId("inspector");
    await waitFor(() => expect(norm(insp)).toContain("QueuePosition 2 in the queue"));
  });
});
