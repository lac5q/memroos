// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoConnections: vi.fn(),
  fetchNangoCredentials: vi.fn(),
}));

vi.mock("../mcp-client", () => ({
  callTool: vi.fn(),
  callRest: vi.fn(),
  initialize: vi.fn(),
}));

import { fetchNangoCredentials, listNangoConnections } from "@/lib/tool-auth/nango-client";
import { callTool } from "../mcp-client";
import { runConnectorCycle, startConnectorJob } from "../sync-job";

const mockList = vi.mocked(listNangoConnections);
const mockFetch = vi.mocked(fetchNangoCredentials);
const mockCallTool = vi.mocked(callTool);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch19b — degraded boundaries", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    delete process.env.NANGO_SECRET_KEY;
    vi.restoreAllMocks();
  });

  it("returns degraded when listNangoConnections throws at cycle start", async () => {
    mockList.mockRejectedValueOnce(new Error("nango unavailable"));
    const result = await runConnectorCycle(db);
    expect(result.degraded).toBe(true);
    expect(result.written).toBe(0);
  });

  it("skips connections without access tokens and continues", async () => {
    mockList.mockResolvedValueOnce([
      { connectionId: "conn-no-token", providerKey: "linear", providerConfigKey: "linear-mcp" },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetch.mockResolvedValueOnce(null as never);
    const result = await runConnectorCycle(db);
    expect(result.written).toBe(0);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("records per-tool failures in degradedProviders without aborting the cycle", async () => {
    mockList.mockResolvedValueOnce([
      { connectionId: "conn-linear-fail", providerKey: "linear", providerConfigKey: "linear-mcp" },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetch.mockResolvedValueOnce({ accessToken: "token" } as Awaited<ReturnType<typeof fetchNangoCredentials>>);
    mockCallTool.mockRejectedValueOnce(new Error("tool blew up"));
    const result = await runConnectorCycle(db);
    expect(result.degraded).toBe(true);
    expect(result.degradedProviders.some((p) => p.includes("linear"))).toBe(true);
  });

  it("startConnectorJob is a no-op when NANGO_SECRET_KEY is unset", async () => {
    vi.resetModules();
    delete process.env.NANGO_SECRET_KEY;
    const intervalSpy = vi.spyOn(global, "setInterval");
    const { startConnectorJob: startFresh } = await import("../sync-job");
    startFresh();
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });
});
