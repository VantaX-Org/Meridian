// The run progress banner follows the run's server-sent events and refetches its status when the server speaks.
import { act, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunProgressBanner } from "../run-progress-banner";
import * as events from "@/lib/api/run-events";

let params: { versionId?: string } = { versionId: "v1" };
vi.mock("next/navigation", () => ({ useParams: () => params }));

function mount(props: Partial<React.ComponentProps<typeof RunProgressBanner>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <RunProgressBanner percent={40} label="Analysis running" step="Checks" {...props} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

beforeEach(() => {
  vi.restoreAllMocks();
  params = { versionId: "v1" };
});

describe("RunProgressBanner", () => {
  it("shows the progress it is given", () => {
    vi.spyOn(events, "streamRunEvents").mockReturnValue(() => {});
    mount();
    expect(screen.getByRole("progressbar", { name: "Analysis running progress" })).toHaveAttribute("aria-valuenow", "40");
  });

  it("follows the run named by the page and refetches the status on each progress event", async () => {
    let send: (e: events.RunEvent) => void = () => {};
    const stop = vi.fn();
    const stream = vi.spyOn(events, "streamRunEvents").mockImplementation((_id, onEvent) => { send = onEvent; return stop; });
    const { invalidate } = mount();
    expect(stream).toHaveBeenCalledWith("v1", expect.any(Function), expect.any(Function));
    act(() => send({ event: "progress", data: { percent: 55 } }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["run", "v1", "status"] }));
  });

  it("refetches the whole run when it completes", async () => {
    let send: (e: events.RunEvent) => void = () => {};
    vi.spyOn(events, "streamRunEvents").mockImplementation((_id, onEvent) => { send = onEvent; return () => {}; });
    const { invalidate } = mount();
    act(() => send({ event: "complete", data: {} }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["run", "v1"] }));
  });

  it("closes the stream when it goes away", () => {
    const stop = vi.fn();
    vi.spyOn(events, "streamRunEvents").mockReturnValue(stop);
    render(<QueryClientProvider client={new QueryClient()}><RunProgressBanner percent={1} label="Analysis running" /></QueryClientProvider>).unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("opens no stream on a page that names no run, and takes an explicit run over the page's", () => {
    const stream = vi.spyOn(events, "streamRunEvents").mockReturnValue(() => {});
    params = {};
    mount();
    expect(stream).not.toHaveBeenCalled();
    mount({ versionId: "v9" });
    expect(stream).toHaveBeenCalledWith("v9", expect.any(Function), expect.any(Function));
  });
});
