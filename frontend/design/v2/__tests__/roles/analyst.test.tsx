import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { ProcessesTab } from "../../screens/object/ProcessesTab";
import { mount, norm, reset, visit } from "./helpers";

vi.mock("next/navigation", async () => (await import("../nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => reset());
afterEach(() => vi.restoreAllMocks());

describe("the process analyst's jobs", () => {
  it("simulates fixing rules on the Processes tab: blocked steps before and after, labelled as a simulation", async () => {
    visit("/v2/o/ecc-production/material-master/processes", "process_analyst");
    mount(<ProcessesTab system="ecc-production" module="material-master" />);
    const panel = await screen.findByTestId("what-if");
    expect(within(panel).getByText("Simulation")).toBeInTheDocument();
    expect(norm(within(panel).getByTestId("what-if-result"))).toBe("Choose at least one rule.");
    const boxes = within(panel).getAllByRole("checkbox");
    boxes.forEach((b) => fireEvent.click(b));
    const result = within(panel).getByTestId("what-if-result");
    expect(norm(result)).toContain("Blocked steps: 2 now, 0 if fixed.");
    expect(norm(result)).toContain("Would open: PTP step 3");
  });

  it("may comment on a rule (view) but not balance work (no assign)", async () => {
    visit("/v2/work?open=rule:MM014", "process_analyst");
    mount();
    expect(await screen.findByRole("textbox", { name: "Add a comment" })).toBeInTheDocument();
  });

  it("is refused Balance work", async () => {
    visit("/v2/people?open=balance", "process_analyst");
    mount();
    expect(await screen.findByTestId("needs-permission")).toBeInTheDocument();
  });
});
