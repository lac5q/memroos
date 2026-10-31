// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { writeSyncState } from "../store";

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
import { CONNECTOR_CYCLE_LIMIT, CONNECTOR_PAGE_SIZE, runConnectorCycle, startConnectorJob } from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);
const mockFetchCreds = vi.mocked(fetchNangoCredentials);
const mockCallTool = vi.mocked(callTool);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch19 — cursor args, budget truncation, interval errors", () => {
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

  it("passes stored page cursor to linear list_issues", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-linear-cursor",
        providerKey: "linear",
        providerConfigKey: "linear-mcp",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetchCreds.mockResolvedValue({ accessToken: "linear-token" } as Awaited<
      ReturnType<typeof fetchNangoCredentials>
    >);
    writeSyncState(db, {
      connectionId: "conn-linear-cursor",
      providerKey: "linear",
      tool: "list_issues",
      cursorValue: "2026-07-01T00:00:00.000Z",
      pageCursor: "cursor-abc",
      status: "backfilling",
      rowsWritten: 0,
    });
    mockCallTool.mockResolvedValueOnce({
      payload: { issues: [], hasNextPage: false },
    });

    await runConnectorCycle(db);
    expect(mockCallTool).toHaveBeenCalledWith(
      "https://mcp.linear.app/mcp",
      "linear-token",
      "list_issues",
      expect.objectContaining({ cursor: "cursor-abc" }),
    );
  });

  it("stops mid-page when per-cycle budget is exhausted", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-linear-budget",
        providerKey: "linear",
        providerConfigKey: "linear-mcp",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetchCreds.mockResolvedValue({ accessToken: "linear-token" } as Awaited<
      ReturnType<typeof fetchNangoCredentials>
    >);

    const mkIssues = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}-${i}`,
        updatedAt: `2026-07-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        title: `${prefix} ${i}`,
        description: "d",
      }));

    mockCallTool
      .mockResolvedValueOnce({ payload: { issues: mkIssues("issue", 70), hasNextPage: false } })
      .mockResolvedValueOnce({ payload: { documents: mkIssues("doc", 70), hasNextPage: false } })
      .mockResolvedValueOnce({ payload: { projects: mkIssues("proj", CONNECTOR_PAGE_SIZE), hasNextPage: false } });

    const first = await runConnectorCycle(db, { tenantId: "default-tenant" });
    expect(first.written).toBe(CONNECTOR_CYCLE_LIMIT);

    const state = db
      .prepare(`SELECT page_cursor, last_status FROM connector_sync_state WHERE connection_id = ? AND tool = ?`)
      .get("conn-linear-budget", "list_projects") as { page_cursor: string | null; last_status: string };
    expect(state.last_status).toBe("backfilling");
  });

  it("startConnectorJob schedules interval when NANGO_SECRET_KEY is set", async () => {
    vi.resetModules();
    process.env.NANGO_SECRET_KEY = "test-nango-key";
    const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation((fn) => {
      return { unref: vi.fn() } as never;
    });
    const { startConnectorJob: startFresh } = await import("../sync-job");
    startFresh();
    expect(intervalSpy).toHaveBeenCalled();
    intervalSpy.mockRestore();
  });
});
