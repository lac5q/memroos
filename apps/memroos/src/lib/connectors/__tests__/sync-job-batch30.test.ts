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
import { callTool, initialize } from "../mcp-client";
import { runConnectorCycle, startConnectorJob } from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);
const mockFetchCreds = vi.mocked(fetchNangoCredentials);
const mockCallTool = vi.mocked(callTool);
const mockInitialize = vi.mocked(initialize);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch30 — outcomes, manifest skip, mcp init", () => {
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

  it("counts duplicate and empty writes separately (187–188)", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-linear-dup-b30",
        providerKey: "linear",
        providerConfigKey: "linear-mcp",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetchCreds.mockResolvedValue({ accessToken: "linear-token" } as Awaited<
      ReturnType<typeof fetchNangoCredentials>
    >);
    const issue = {
      id: "issue-b30-dup",
      updatedAt: "2026-11-07T00:00:00.000Z",
      title: "Duplicate issue batch30",
      description: "Safe connector content batch30",
    };
    mockCallTool.mockResolvedValue({
      payload: { issues: [issue, { ...issue, id: "issue-b30-empty", title: "", description: "" }], hasNextPage: false },
    });

    const first = await runConnectorCycle(db);
    expect(first.written).toBe(1);
    expect(first.skipped).toBeGreaterThanOrEqual(1);

    mockCallTool.mockResolvedValueOnce({
      payload: { issues: [issue], hasNextPage: false },
    });
    const second = await runConnectorCycle(db);
    expect(second.duplicates).toBeGreaterThanOrEqual(1);
  });

  it("skips connections without sync manifests (248)", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-unknown-b30",
        providerKey: "unknown-provider-b30",
        providerConfigKey: "unknown-config",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);

    const result = await runConnectorCycle(db);
    expect(result.written).toBe(0);
    expect(mockFetchCreds).not.toHaveBeenCalled();
  });

  it("initializes MCP transport before syncing tools (276)", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-linear-init-b30",
        providerKey: "linear",
        providerConfigKey: "linear-mcp",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetchCreds.mockResolvedValue({ accessToken: "linear-token" } as Awaited<
      ReturnType<typeof fetchNangoCredentials>
    >);
    mockCallTool.mockResolvedValue({
      payload: { issues: [], hasNextPage: false },
    });

    await runConnectorCycle(db);
    expect(mockInitialize).toHaveBeenCalledWith("https://mcp.linear.app/mcp", "linear-token");
  });

  it("startConnectorJob registers the interval runner when NANGO_SECRET_KEY is set (327–328)", async () => {
    vi.resetModules();
    process.env.NANGO_SECRET_KEY = "test-nango-key-batch30";
    mockListConnections.mockResolvedValue([]);
    let captured: (() => void) | undefined;
    const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation((fn) => {
      captured = fn as () => void;
      return { unref: vi.fn() } as never;
    });
    const { startConnectorJob: startFresh } = await import("../sync-job");
    startFresh();
    expect(intervalSpy).toHaveBeenCalled();
    await captured?.();
    intervalSpy.mockRestore();
    vi.resetModules();
    await import("../sync-job");
  });
});
