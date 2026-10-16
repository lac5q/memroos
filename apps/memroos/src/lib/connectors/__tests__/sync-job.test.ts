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

vi.mock("../notion-fetch", () => ({
  fetchNotionPageText: vi.fn(async () => "body text"),
}));

import {
  fetchNangoCredentials,
  listNangoConnections,
} from "@/lib/tool-auth/nango-client";
import { callTool, initialize } from "../mcp-client";
import {
  CONNECTOR_CYCLE_LIMIT,
  CONNECTOR_INTERVAL_MS,
  CONNECTOR_PAGE_SIZE,
  runConnectorCycle,
  startConnectorJob,
} from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);
const mockFetchCreds = vi.mocked(fetchNangoCredentials);
const mockCallTool = vi.mocked(callTool);
const mockInitialize = vi.mocked(initialize);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job", () => {
  let db: Database.Database;
  const originalNangoKey = process.env.NANGO_SECRET_KEY;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    if (originalNangoKey === undefined) {
      delete process.env.NANGO_SECRET_KEY;
    } else {
      process.env.NANGO_SECRET_KEY = originalNangoKey;
    }
  });

  it("exports bounded cycle constants", () => {
    expect(CONNECTOR_PAGE_SIZE).toBe(100);
    expect(CONNECTOR_CYCLE_LIMIT).toBe(200);
    expect(CONNECTOR_INTERVAL_MS).toBe(900_000);
  });

  it("returns zero work when no connections", async () => {
    mockListConnections.mockResolvedValue([]);
    const result = await runConnectorCycle(db);
    expect(result).toEqual({
      written: 0,
      duplicates: 0,
      skipped: 0,
      degraded: false,
      degradedProviders: [],
    });
  });

  it("syncs linear issues via MCP and marks degraded on tool failure", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-linear",
        providerKey: "linear",
        providerConfigKey: "linear-mcp",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);

    mockFetchCreds.mockResolvedValue({ accessToken: "linear-token" } as Awaited<
      ReturnType<typeof fetchNangoCredentials>
    >);

    mockCallTool
      .mockResolvedValueOnce({
        payload: {
          issues: [
            {
              id: "issue-1",
              updatedAt: "2026-07-01T00:00:00.000Z",
              title: "Fix bug",
              description: "details",
            },
          ],
          hasNextPage: false,
        },
      })
      .mockRejectedValueOnce(new Error("documents offline"))
      .mockResolvedValueOnce({
        payload: { projects: [], hasNextPage: false },
      });

    const ok = await runConnectorCycle(db);
    expect(ok.written).toBeGreaterThanOrEqual(1);
    expect(mockInitialize).toHaveBeenCalled();
    expect(ok.degraded).toBe(true);
    expect(ok.degradedProviders.some((p) => p.includes("list_documents"))).toBe(true);
  });

  it("startConnectorJob is a no-op without NANGO_SECRET_KEY", () => {
    delete process.env.NANGO_SECRET_KEY;
    const intervalSpy = vi.spyOn(global, "setInterval");
    startConnectorJob();
    startConnectorJob();
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });

  it("marks cycle degraded when listing connections fails", async () => {
    mockListConnections.mockRejectedValue(new Error("nango offline"));
    const result = await runConnectorCycle(db);
    expect(result.degraded).toBe(true);
    expect(result.written).toBe(0);
  });

  it("skips connections without access tokens", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-empty",
        providerKey: "linear",
        providerConfigKey: "linear-mcp",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetchCreds.mockResolvedValue({ accessToken: "" } as Awaited<
      ReturnType<typeof fetchNangoCredentials>
    >);

    const result = await runConnectorCycle(db);
    expect(result.written).toBe(0);
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("startConnectorJob schedules when NANGO_SECRET_KEY is set", async () => {
    vi.resetModules();
    process.env.NANGO_SECRET_KEY = "test-nango-key";
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);
    const { startConnectorJob: startFresh } = await import("../sync-job");
    startFresh();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), CONNECTOR_INTERVAL_MS);
    intervalSpy.mockRestore();
    delete process.env.NANGO_SECRET_KEY;
  });
});
