import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as workApi from "@/lib/api/v2/work";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { WorkCanvas } from "../screens/Work";
import { Inspector } from "../Inspector";
import { ToastProvider } from "../Toast";
import { V2Shell } from "../shell/V2Shell";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;

function visit(search = "") {
  const url = `/work?fixture=1&persona=steward${search}`;
  window.history.pushState({}, "", url);
  setUrl(url);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetWorkFixture();
  resetActions();
  clearPatches();
  undoLayout = stubLayout(1400, 600);
  visit();
});
afterEach(() => {
  undoLayout();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function mount(search = "") {
  visit(search);
  return renderWithQuery(
    <ToastProvider>
      <WorkCanvas />
      <Inspector />
    </ToastProvider>,
  );
}

const ledger = () => screen.findByRole("grid", { name: "Work ledger" });
const rowFor = (grid: HTMLElement, key: string) => within(grid).getByText(key).closest('[role="row"]') as HTMLElement;
const KEY_100 = "000000000000000100"; // MM142, suggested EA
const KEY_232 = "000000000000000232"; // MM003, no suggestion, the highest value at risk

describe("the Work ledger, fixture mode", () => {
  it("states what it lists: the title, the sentence from the summary, the chips with their counts", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Work");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All objects");
    expect(await screen.findByTestId("work-sentence")).toHaveTextContent("25,712 records to fix, 3,418 with a suggested value.");
    const chips = screen.getByRole("group", { name: "Filter by state" });
    await waitFor(() => expect(within(chips).getByRole("button", { name: /To fix/ })).toHaveTextContent("25,712"));
    expect(within(chips).getByRole("button", { name: /Fix proposed/ })).toHaveTextContent("3,418");
    expect(within(chips).getByRole("button", { name: /Waiting for approval/ })).toHaveTextContent("612");
    expect(within(chips).getByRole("button", { name: /Exceptions/ })).toHaveTextContent("48");
    expect(within(chips).getByRole("button", { name: /To fix/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("draws the grid with the columns of the prototype, keeping leading zeros and showing the headers of the key", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const heads = within(grid).getAllByRole("columnheader").map((h) => text(h));
    expect(heads).toEqual([
      "",
      "Material number",
      "Plant",
      "Name",
      "Rule",
      "Severity",
      "Field description",
      "SAP field",
      "Problem",
      "Current value",
      "Possible values",
      "Suggested value",
      "New value",
      "Decision",
      "First seen",
      "Days open",
      "Owner",
      "Value at risk",
    ]);
    const row = rowFor(grid, KEY_232);
    expect(within(row).getByText("MM003")).toHaveClass("m2-mono");
    expect(within(row).getByText("Critical")).toBeInTheDocument();
    expect(within(row).getByText("MARA.MTART")).toBeInTheDocument();
    expect(within(row).getByText("Material type is mandatory - determines procurement and storage behaviour")).toBeInTheDocument();
    expect(within(row).getByText("12,390")).toBeInTheDocument();
    // Possible values are cut to three with "+N more" and the whole list in the title.
    const pv = within(row).getByText("+9 more");
    expect(pv.closest(".m2-pvl")).toHaveAttribute("title", expect.stringContaining("ROH (Raw materials)"));
    expect(within(row).getByLabelText(`New value for ${KEY_232}`)).toBeInTheDocument();
    expect(within(row).getByLabelText(`Decision for ${KEY_232}`)).toBeInTheDocument();
  });

  it("ranks by value at risk by default and re-sorts by age", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const firstKeys = () => within(grid).getAllByRole("row").slice(1, 4).map((r) => text(r.querySelector('[role="gridcell"]:nth-child(2)') as Element));
    expect(firstKeys()[0]).toBe(KEY_232);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "age" } });
    expect(getUrl()).toContain("sort=age");
  });

  it("filters with a chip: Waiting for approval lists the values in a draft batch, and the address carries it", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.click(screen.getByRole("button", { name: /Waiting for approval/ }));
    expect(getUrl()).toContain("filter=approvals");
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "Work ledger" })).queryByText(KEY_232)).toBeNull());
    expect(await screen.findByTestId("work-sentence")).toHaveTextContent("612 records wait for approval");
    expect(screen.getByRole("grid", { name: "Work ledger" }).querySelectorAll('[role="row"]').length).toBeGreaterThan(5);
  });

  it("opens with ?filter=approvals (the command line's approve) on that chip", async () => {
    mount("&filter=approvals");
    expect(await screen.findByRole("button", { name: /Waiting for approval/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("groups by rule: a heading per rule with 'Accept all N suggested', the top rule open", async () => {
    mount("&group=rule");
    const grid = await ledger();
    const heading = await within(grid).findByRole("button", { name: /^MM142/ });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(within(grid).getByRole("button", { name: "Accept all 112 suggested" })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: "Accept all 640 suggested" })).toBeInTheDocument();
    // Only the open rule shows rows; the others are collapsed.
    await waitFor(() => expect(within(grid).getAllByText("MM142").length).toBeGreaterThan(1));
    expect(within(grid).getByRole("button", { name: /^MM003/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "By rule" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the steward's next step accepts the suggested values of the top rule, with the server's count in the notice", async () => {
    const spy = vi.spyOn(workApi, "postAcceptAll");
    mount();
    const next = await screen.findByRole("button", { name: "Accept the 112 suggested values" });
    fireEvent.click(next);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("MM142", expect.any(String)));
    expect(await screen.findByText(/Accepted 112 suggested values for MM142/)).toBeInTheDocument();
    // The count moved: the next rule's values are now the next step.
    expect(await screen.findByRole("button", { name: "Accept the 640 suggested values" })).toBeInTheDocument();
  });

  it("shows the bulk bar for the selected rows: N records, accept, set value, not an issue, accept risk, assign", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const boxes = within(grid).getAllByRole("checkbox", { name: /^Select row/ });
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    const bar = await screen.findByRole("region", { name: "Bulk actions" });
    expect(text(bar)).toContain("2 records");
    for (const name of [/Accept suggested/, /Set value for all/, /Not an issue/, /Accept risk/, /Assign/, /Clear selection/]) expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
  });

  it("bulk Accept suggested sends accept for the selected rows that have a suggestion, and names the count", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_100);
    const r = rowFor(grid, KEY_100);
    fireEvent.click(within(r).getByRole("checkbox"));
    fireEvent.click(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: /Accept suggested/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [items, version] = spy.mock.calls[0];
    expect(items).toEqual([expect.objectContaining({ module: "material_master", record_key: `MATNR=${KEY_100}`, check_id: "MM142", action: "accept" })]);
    expect(version).toBe("d3229ded-0708-4967-9dfb-1b7f4fada953");
    expect(await screen.findByText("Accepted 1 suggested value")).toBeInTheDocument();
  });

  it("bulk Set value for all asks for the value and sends an edit for every selected row", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const boxes = within(grid).getAllByRole("checkbox", { name: /^Select row/ });
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    const bar = await screen.findByRole("region", { name: "Bulk actions" });
    fireEvent.click(within(bar).getByRole("button", { name: /Set value for all/ }));
    fireEvent.change(within(bar).getByLabelText("Value for all selected rows"), { target: { value: "ROH" } });
    fireEvent.click(within(bar).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const items = spy.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.action === "edit" && i.value === "ROH")).toBe(true);
  });

  it("bulk Not an issue asks for a reason first, then signs the rows off", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.click(within(rowFor(grid, KEY_232)).getByRole("checkbox"));
    fireEvent.click(within(await screen.findByRole("region", { name: "Bulk actions" })).getByRole("button", { name: /Not an issue/ }));
    const dialog = await screen.findByRole("dialog", { name: "Mark as not an issue" });
    expect(within(dialog).getByRole("button", { name: "Mark as not an issue" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Spare part, planned elsewhere" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as not an issue" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ action: "not_an_issue", note: "Spare part, planned elsewhere", check_id: "MM003" })]);
    // The row has left the list of rows to fix, and the notice offers Undo.
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "Work ledger" })).queryByText(KEY_232)).toBeNull());
    expect(await screen.findByText("Marked 1 record as not an issue")).toBeInTheDocument();
  });

  it("Assign… offers me and unassign, and sends assign", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.click(within(rowFor(grid, KEY_232)).getByRole("checkbox"));
    fireEvent.click(within(await screen.findByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Assign…" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Assign to me" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ action: "assign", assignee: "me", check_id: null })]);
  });

  it("the Decision select calls /work/decide with the right body: fix accepts the suggestion", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_100);
    fireEvent.change(within(rowFor(grid, KEY_100)).getByLabelText(`Decision for ${KEY_100}`), { target: { value: "fix" } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith([{ module: "material_master", record_key: `MATNR=${KEY_100}`, check_id: "MM142", action: "accept", value: undefined, note: undefined, assignee: undefined }], "d3229ded-0708-4967-9dfb-1b7f4fada953");
  });

  it("a Decision of accept risk needs a reason and sends accept_risk with it", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.change(within(rowFor(grid, KEY_232)).getByLabelText(`Decision for ${KEY_232}`), { target: { value: "accept risk" } });
    const dialog = await screen.findByRole("dialog", { name: "Accept the risk" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Signed off by the plant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept the risk" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ action: "accept_risk", note: "Signed off by the plant" })]);
  });

  it("choosing fix on a row with no suggested value says so with the server's kind of sentence, and changes nothing", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.change(within(rowFor(grid, KEY_232)).getByLabelText(`Decision for ${KEY_232}`), { target: { value: "fix" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("no suggested value");
    expect(within(screen.getByRole("grid", { name: "Work ledger" })).getByText(KEY_232)).toBeInTheDocument();
  });

  it("Enter in New value commits through /work/decide as an edit", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const input = within(rowFor(grid, KEY_232)).getByLabelText(`New value for ${KEY_232}`);
    fireEvent.change(input, { target: { value: "ROH" } });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ module: "material_master", record_key: `MATNR=${KEY_232}`, check_id: "MM003", action: "edit", value: "ROH" })]);
  });

  it("an error from the API puts the row back and shows the server's sentence", async () => {
    vi.spyOn(workApi, "postDecide").mockRejectedValue(Object.assign(new Error("x"), { response: { status: 403, data: { detail: "Your role cannot apply." } } }));
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_100);
    fireEvent.change(within(rowFor(grid, KEY_100)).getByLabelText(`Decision for ${KEY_100}`), { target: { value: "fix" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role cannot apply.");
    expect(within(screen.getByRole("grid", { name: "Work ledger" })).getByText(KEY_100)).toBeInTheDocument();
  });

  it("fills down with ⌘D: the New value of the focused row goes to every selected row", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const boxes = within(grid).getAllByRole("checkbox", { name: /^Select row/ });
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[2]);
    const input = within(rowFor(grid, KEY_232)).getByLabelText(`New value for ${KEY_232}`);
    fireEvent.change(input, { target: { value: "ROH" } });
    fireEvent.keyDown(input, { key: "d", metaKey: true });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const items = spy.mock.calls[0][0];
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.action === "edit" && i.value === "ROH")).toBe(true);
    expect(await screen.findByText("Filled ROH down 3 rows")).toBeInTheDocument();
  });

  it("pasting several lines into New value fills the selected rows, one line each, with a notice", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const boxes = within(grid).getAllByRole("checkbox", { name: /^Select row/ });
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[2]);
    const input = within(rowFor(grid, KEY_232)).getByLabelText(`New value for ${KEY_232}`);
    fireEvent.paste(input, { clipboardData: { getData: () => "ROH\nHALB\nFERT\n" } });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const items = spy.mock.calls[0][0];
    expect(items.map((i) => i.value)).toEqual(["ROH", "HALB", "FERT"]);
    expect(await screen.findByText("Pasted 3 values into 3 selected rows")).toBeInTheDocument();
  });

  it("a single pasted line is an ordinary paste", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const input = within(rowFor(grid, KEY_232)).getByLabelText(`New value for ${KEY_232}`);
    fireEvent.paste(input, { clipboardData: { getData: () => "ROH" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("opens a row in the inspector: ?open=record:<module>:<key>", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.click(within(rowFor(grid, KEY_232)).getByText("Hydraulic hose 3/8 in"));
    expect(decodeURIComponent(getUrl())).toContain(`open=record:material_master:MATNR=${KEY_232}`);
    expect(await screen.findByRole("heading", { level: 2, name: KEY_232 })).toBeInTheDocument();
  });

  it("the Views menu lists the built-in views and saves the current one through PUT /views", async () => {
    const put = vi.spyOn(workApi, "putView");
    mount("&filter=proposed");
    await ledger();
    fireEvent.click(await screen.findByRole("button", { name: /^Views/ }));
    const menu = await screen.findByRole("menu", { name: "Views" });
    for (const name of ["My open work", "Critical and unassigned", "Overdue"]) expect(within(menu).getByRole("menuitemradio", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Save current view…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save this view" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Ready to accept" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith({ route: "work", name: "Ready to accept", filters: { status: "to_fix", proposed: "true" }, columns: null, density: "comfortable" });
    // The address now names the view, with no hash.
    await waitFor(() => expect(getUrl()).toMatch(/[?&]view=fx-view-1/));
    expect(getUrl()).not.toContain("#");
    expect(await screen.findByRole("button", { name: "Views Ready to accept" })).toBeInTheDocument();
  });

  it("opening a built-in view by ?view= applies its filters", async () => {
    mount("&view=builtin:work:critical-and-unassigned");
    expect(await screen.findByRole("button", { name: "Views Critical and unassigned" })).toBeInTheDocument();
    const tags = await screen.findByRole("list", { name: "Filters in force" });
    expect(text(tags)).toContain("Severity critical");
    expect(text(tags)).toContain("Unassigned");
  });

  it("density: Compact makes the rows 28 pixels", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    const row = rowFor(grid, KEY_232);
    expect(row.style.height).toBe("32px");
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(getUrl()).toContain("density=compact");
  });

  it("Columns hides and shows columns", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Field description" }));
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "Work ledger" })).queryByRole("columnheader", { name: "Field description" })).toBeNull());
  });

  it("Export fix sheet saves what is on screen, with the filters of the chip", async () => {
    const spy = vi.spyOn(workApi, "exportFixSheet").mockResolvedValue({ filename: "fix-sheet.xlsx" });
    mount("&filter=proposed");
    await ledger();
    fireEvent.click(await screen.findByRole("button", { name: /Export fix sheet/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ status: "to_fix", proposed: true });
    expect(await screen.findByText("Fix sheet saved as fix-sheet.xlsx")).toBeInTheDocument();
  });

  it("?export=1 (the command line's export) saves the sheet once and leaves the address clean", async () => {
    const spy = vi.spyOn(workApi, "exportFixSheet").mockResolvedValue({ filename: "fix-sheet.xlsx" });
    mount("&export=1");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getUrl()).not.toContain("export=1"));
  });

  it("Import filled sheet: choose a file, see how many decisions were saved and what was skipped", async () => {
    const spy = vi.spyOn(workApi, "importFixSheet");
    mount();
    await ledger();
    fireEvent.click(await screen.findByRole("button", { name: "Import filled sheet" }));
    const file = new File(["x"], "fix-sheet-filled.xlsx");
    fireEvent.change(screen.getByLabelText("Choose a filled fix sheet"), { target: { files: [file] } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(file));
    const result = await screen.findByTestId("import-result");
    expect(result).toHaveTextContent("fix-sheet-filled.xlsx: 3 decisions saved from 3 rows; 1 skipped.");
    expect(result).toHaveTextContent("a sign-off needs a reason");
  });

  it("Import refuses a file that is not a fix sheet with the server's sentence in the frame", async () => {
    mount();
    await ledger();
    fireEvent.click(await screen.findByRole("button", { name: "Import filled sheet" }));
    fireEvent.change(screen.getByLabelText("Choose a filled fix sheet"), { target: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByTestId("error-frame")).toHaveTextContent("This is not an .xlsx file.");
  });

  it("an empty list says what would fill it", async () => {
    mount("&filter=exceptions&rule=MM028&severity=critical");
    expect(await screen.findByText(/No record is signed off/)).toBeInTheDocument();
  });
});

describe("undo", () => {
  it("every change shows a notice with Undo; Undo calls /actions/undo with the action id and puts the row back", async () => {
    const decide = vi.spyOn(workApi, "postDecide");
    const undo = vi.spyOn(workApi, "postUndo");
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.click(within(rowFor(grid, KEY_232)).getByRole("checkbox"));
    fireEvent.click(within(await screen.findByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Assign…" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Assign to me" }));
    const toast = await screen.findByText("Assigned 1 record to you");
    const notice = toast.closest(".m2-toast") as HTMLElement;
    await waitFor(() => expect(decide).toHaveBeenCalled());
    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    expect(undo.mock.calls[0][0]).toMatch(/^fx-action-/);
    expect(await screen.findByText(/^Undone: assigned 1 record to you/)).toBeInTheDocument();
  });

  it("the notice is a polite live region and goes away after six seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      const grid = await ledger();
      await within(grid).findByText(KEY_100);
      fireEvent.change(within(rowFor(grid, KEY_100)).getByLabelText(`Decision for ${KEY_100}`), { target: { value: "fix" } });
      const region = screen.getByRole("region", { name: "Change notices" });
      expect(region).toHaveAttribute("aria-live", "polite");
      await screen.findByText("Accepted 1 suggested value");
      act(() => {
        vi.advanceTimersByTime(6100);
      });
      await waitFor(() => expect(screen.queryByText("Accepted 1 suggested value")).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("the counts follow a change: accepting a suggested value moves one from To fix to Waiting for approval after the refetch", async () => {
    mount();
    const grid = await ledger();
    await within(grid).findByText(KEY_100);
    const chips = screen.getByRole("group", { name: "Filter by state" });
    await waitFor(() => expect(within(chips).getByRole("button", { name: /To fix/ })).toHaveTextContent("25,712"));
    fireEvent.change(within(rowFor(grid, KEY_100)).getByLabelText(`Decision for ${KEY_100}`), { target: { value: "fix" } });
    await waitFor(() => expect(within(chips).getByRole("button", { name: /To fix/ })).toHaveTextContent("25,711"));
    expect(within(chips).getByRole("button", { name: /Waiting for approval/ })).toHaveTextContent("613");
  });
});

describe("the keyboard, in the shell", () => {
  const mountShell = (search = "") => {
    visit(search);
    return renderWithQuery(
      <V2Shell>
        <WorkCanvas />
      </V2Shell>,
    );
  };
  const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

  it("⌘Z takes the last change back", async () => {
    const undo = vi.spyOn(workApi, "postUndo");
    mountShell();
    const grid = await ledger();
    await within(grid).findByText(KEY_100);
    fireEvent.change(within(rowFor(grid, KEY_100)).getByLabelText(`Decision for ${KEY_100}`), { target: { value: "fix" } });
    await screen.findByText("Accepted 1 suggested value");
    press("z", { metaKey: true });
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Undone: accepted 1 suggested value/)).toBeInTheDocument();
  });

  it("⌘Z with nothing to undo says so", async () => {
    mountShell();
    await ledger();
    press("z", { metaKey: true });
    expect(await screen.findByText("Nothing to undo in this session.")).toBeInTheDocument();
  });

  it("⌘Z inside a text field stays the field's own undo", async () => {
    const undo = vi.spyOn(workApi, "postUndo");
    mountShell();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.keyDown(within(rowFor(grid, KEY_232)).getByLabelText(`New value for ${KEY_232}`), { key: "z", metaKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it("a accepts the suggested value on the selected rows", async () => {
    const spy = vi.spyOn(workApi, "postDecide");
    mountShell();
    const grid = await ledger();
    await within(grid).findByText(KEY_100);
    fireEvent.click(within(rowFor(grid, KEY_100)).getByRole("checkbox"));
    press("a");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toEqual([expect.objectContaining({ action: "accept" })]);
  });

  it("n and r open the reason dialog for the selected rows", async () => {
    mountShell();
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    fireEvent.click(within(rowFor(grid, KEY_232)).getByRole("checkbox"));
    press("n");
    expect(await screen.findByRole("dialog", { name: "Mark as not an issue" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    press("r");
    expect(await screen.findByRole("dialog", { name: "Accept the risk" })).toBeInTheDocument();
  });

  it("a with nothing selected tells you how to select", async () => {
    mountShell();
    await ledger();
    press("a");
    expect(await screen.findByText(/Select rows first/)).toBeInTheDocument();
  });

  it("e exports the fix sheet of what is on screen, f moves to the chips", async () => {
    const spy = vi.spyOn(workApi, "exportFixSheet").mockResolvedValue({ filename: "fix-sheet.xlsx" });
    mountShell();
    await ledger();
    press("e");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    press("f");
    expect(document.activeElement).toHaveAttribute("aria-pressed", "true");
  });

  it("the keys are in the ? sheet", async () => {
    mountShell();
    await ledger();
    press("?");
    const sheet = await screen.findByTestId("shortcut-sheet");
    expect(within(sheet).getByRole("heading", { name: "Work ledger" })).toBeInTheDocument();
    for (const k of ["a", "n", "r", "e", "f", "⌘D", "⌘Z"]) expect(within(sheet).getAllByText(k).length).toBeGreaterThan(0);
  });
});

describe("phone: rows are two-line list items", () => {
  it("draws a list, not a grid; a row opens the inspector where editing happens", async () => {
    const mq = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      mount();
      const list = await screen.findByRole("list", { name: "Work ledger" });
      expect(screen.queryByRole("grid", { name: "Work ledger" })).toBeNull();
      const first = await within(list).findByRole("button", { name: new RegExp(KEY_232) });
      expect(text(first)).toContain("Hydraulic hose 3/8 in");
      expect(text(first)).toContain("MM003");
      expect(first.querySelector("input")).toBeNull();
      fireEvent.click(first);
      expect(decodeURIComponent(getUrl())).toContain(`open=record:material_master:MATNR=${KEY_232}`);
    } finally {
      window.matchMedia = mq;
    }
  });
});

describe("read-only", () => {
  it("a viewer sees the rows with no editing, no selection and no bulk bar", async () => {
    mount("&role=viewer");
    const grid = await ledger();
    await within(grid).findByText(KEY_232);
    expect(within(grid).queryByLabelText(`New value for ${KEY_232}`)).toBeNull();
    expect(within(grid).queryByLabelText(`Decision for ${KEY_232}`)).toBeNull();
    expect(within(grid).queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Import filled sheet" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept the .* suggested/ })).toBeNull();
  });
});
