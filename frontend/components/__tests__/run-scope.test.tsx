// The header names the run a page's numbers belong to, offers its lineage where an older run matters, and
// "Back to latest" (clearing ?run=) only while the page is pinned to an older run.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Version } from "@/types/api";
import { hrefWithRun } from "@/lib/run-scope";
import { RunScope } from "../run-scope";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

const run = (id: string, day: string): Version => ({
  id, label: id, status: "complete", run_at: `2026-10-${day}T05:00:00Z`, dqs_summary: null, metadata: { modules: ["material_master"] },
});
const NEW = run("material_master_25k", "16");
const OLD = run("material_master_10k", "10");
const search = new URLSearchParams("run=material_master_10k&tab=rules");
const hrefFor = (id: string | null) => hrefWithRun("/objects/material_master", search, id);

describe("RunScope", () => {
  it("says which run the numbers belong to", () => {
    render(<RunScope scope={{ run: NEW, choices: [NEW], latestId: NEW.id, pinned: false }} hrefFor={hrefFor} />);
    expect(screen.getByTestId("run-scope")).toHaveTextContent("As of Material master, 16 Oct, 05:00");
    expect(screen.queryByRole("link", { name: "Back to latest" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders nothing until the run is known", () => {
    const { container } = render(<RunScope scope={{ run: undefined, choices: [], latestId: undefined, pinned: false }} hrefFor={hrefFor} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Back to latest, which clears ?run= and keeps the rest of the URL", () => {
    render(<RunScope scope={{ run: OLD, choices: [NEW, OLD], latestId: NEW.id, pinned: true }} hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: "Back to latest" })).toHaveAttribute("href", "/objects/material_master?tab=rules");
  });

  it("switches to another run of the lineage through ?run=, and to the latest by clearing it", async () => {
    render(<RunScope scope={{ run: OLD, choices: [NEW, OLD], latestId: NEW.id, pinned: true }} hrefFor={hrefFor} picker />);
    const picker = screen.getByRole("combobox", { name: "Showing run" });
    expect(picker).toHaveTextContent("Material master, 10 Oct, 05:00");
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "Material master, 16 Oct, 05:00" }));
    expect(replace).toHaveBeenCalledWith("/objects/material_master?tab=rules", { scroll: false });
  });

  it("shows no picker when the lineage holds one run", () => {
    render(<RunScope scope={{ run: NEW, choices: [NEW], latestId: NEW.id, pinned: false }} hrefFor={hrefFor} picker />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
