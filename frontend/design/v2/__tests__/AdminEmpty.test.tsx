import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import * as dbApi from "@/lib/api/v2/external-db";
import * as matchApi from "@/lib/api/v2/match-rules";
import * as step10Api from "@/lib/api/v2/step10";
import * as step9Api from "@/lib/api/v2/step9";
import * as jobsApi from "@/lib/api/v2/runs";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { ApiKeysSection } from "../admin/apikeys";
import { ExternalDbSection } from "../admin/externaldb";
import { MatchRulesSection } from "../admin/matchrules";
import { AlertsSection } from "../admin/notify";
import { DigestsSection } from "../admin/step10";
import { SystemSection } from "../admin/system";
import { RolesSection } from "../admin/roles";
import { UsersSection } from "../admin/users";
import { WebhooksSection } from "../admin/webhooks";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  undo = stubLayout();
  setUrl("/admin");
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("Admin: empty lists say what to do first", () => {
  it("users: an empty tenant offers the first invitation", async () => {
    const real = await adminApi.listUsers();
    vi.spyOn(adminApi, "listUsers").mockResolvedValue({ ...real, users: [] } as typeof real);
    renderWithQuery(<UsersSection />);
    expect(await screen.findByText(/No users yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Invite a user" }).length).toBeGreaterThan(0);
  });

  it("roles: no roles and no open requests are each explained", async () => {
    vi.spyOn(adminApi, "listRoles").mockResolvedValue([]);
    vi.spyOn(adminApi, "listAccessRequests").mockResolvedValue([]);
    renderWithQuery(<RolesSection />);
    expect(await screen.findByText(/No roles yet/)).toBeInTheDocument();
    expect(await screen.findByText(/No open requests/)).toBeInTheDocument();
  });

  it("API keys: no keys says what a key is for", async () => {
    vi.spyOn(adminApi, "listApiKeys").mockResolvedValue([]);
    renderWithQuery(<ApiKeysSection />);
    expect(await screen.findByText(/No API keys yet/)).toBeInTheDocument();
  });

  it("webhooks: no webhook offers the first one", async () => {
    vi.spyOn(step9Api, "listWebhooks").mockResolvedValue({ webhooks: [] } as never);
    renderWithQuery(<WebhooksSection />);
    expect(await screen.findByText(/No webhook yet/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add a webhook" }).length).toBeGreaterThan(0);
  });

  it("database sources: no connection says what to add", async () => {
    vi.spyOn(dbApi, "listDbConnections").mockResolvedValue({ connections: [] } as never);
    renderWithQuery(<ExternalDbSection />);
    expect(await screen.findByText(/No connection yet/)).toBeInTheDocument();
  });

  it("alerts: no channel says what a channel carries", async () => {
    vi.spyOn(adminApi, "listChannels").mockResolvedValue([]);
    renderWithQuery(<AlertsSection />);
    expect(await screen.findByText(/No alert channels/)).toBeInTheDocument();
  });

  it("match rules: no rule offers the first one", async () => {
    vi.spyOn(matchApi, "listMatchRules").mockResolvedValue({ rules: [] } as never);
    renderWithQuery(<MatchRulesSection />);
    expect(await screen.findByText(/No match rule yet/)).toBeInTheDocument();
  });
});

describe("Admin: jobs and digests", () => {
  it("system: no job says what will appear here", async () => {
    vi.spyOn(jobsApi, "getJobsList").mockResolvedValue([] as never);
    renderWithQuery(<SystemSection />);
    expect(await screen.findByText(/No job has run yet/)).toBeInTheDocument();
  });

  it("system: a failed read offers a retry", async () => {
    vi.spyOn(jobsApi, "getJobsList").mockRejectedValue(new Error("Network Error"));
    renderWithQuery(<SystemSection />);
    expect(await screen.findByText("The jobs could not be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("digests: no digest offers the first one", async () => {
    vi.spyOn(step10Api, "listDigests").mockResolvedValue({ digests: [] } as never);
    renderWithQuery(<DigestsSection />);
    expect(await screen.findByText(/No digest yet/)).toBeInTheDocument();
  });

  it("digests: a failed read offers a retry", async () => {
    vi.spyOn(step10Api, "listDigests").mockRejectedValue(new Error("Network Error"));
    renderWithQuery(<DigestsSection />);
    expect(await screen.findByText(/The digests could not be read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Admin: a failed read says what failed and offers a retry", () => {
  const offline = () => new Error("Network Error");

  it("webhooks", async () => {
    vi.spyOn(step9Api, "listWebhooks").mockRejectedValue(offline());
    renderWithQuery(<WebhooksSection />);
    expect(await screen.findByText(/The webhooks could not be read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("database sources", async () => {
    vi.spyOn(dbApi, "listDbConnections").mockRejectedValue(offline());
    renderWithQuery(<ExternalDbSection />);
    expect(await screen.findByText(/The connections could not be read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("alerts", async () => {
    vi.spyOn(adminApi, "listChannels").mockRejectedValue(offline());
    renderWithQuery(<AlertsSection />);
    expect(await screen.findByText(/The channels could not be read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("match rules", async () => {
    vi.spyOn(matchApi, "listMatchRules").mockRejectedValue(offline());
    renderWithQuery(<MatchRulesSection />);
    expect(await screen.findByText(/The match rules could not/)).toBeInTheDocument();
  });
});
