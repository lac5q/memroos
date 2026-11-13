// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
import { CONNECTOR_CYCLE_LIMIT, runConnectorCycle, startConnectorJob } from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);
const mockFetchCreds = vi.mocked(fetchNangoCredentials);
const mockCallTool = vi.mocked(callTool);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch33", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    delete process.env.NANGO_SECRET_KEY;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("skips remaining connections when cycle limit reached (248)", async () => {
    const connA = `conn-a-b33-${randomUUID().slice(0, 8)}`;
    const connB = `conn-b-b33-${randomUUID().slice(0, 8)}`;
    mockListConnections.mockResolvedValue([
      { connectionId: connA, providerKey: "linear", providerConfigKey: "linear-mcp" },
      { connectionId: connB, providerKey: "linear", providerConfigKey: "linear-mcp" },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetchCreds.mockResolvedValue({ accessToken: "token-b33" } as Awaited<ReturnType<typeof fetchNangoCredentials>>);

    const mkIssues = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}-${i}`,
        updatedAt: `2026-11-10T00:00:${String(i).padStart(2, "0")}.000Z`,
        title: `${prefix} ${i}`,
        description: "d",
      }));

    mockCallTool.mockResolvedValueOnce({
      payload: { issues: mkIssues("first", CONNECTOR_CYCLE_LIMIT), hasNextPage: false },
    });

    const out = await runConnectorCycle(db);
    expect(out.written).toBe(CONNECTOR_CYCLE_LIMIT);
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  it("interval callback swallows unhandled sync errors (329)", async () => {
    process.env.NANGO_SECRET_KEY = "nango-b33";
    mockListConnections.mockRejectedValue(new Error(`sync-b33-${randomUUID().slice(0, 8)}`));
    let captured: (() => void) | undefined;
    const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation((fn) => {
      captured = fn as () => void;
      return { unref: vi.fn() } as never;
    });
    const { startConnectorJob } = await import("../sync-job");
    startConnectorJob();
    await expect(Promise.resolve(captured?.())).resolves.toBeUndefined();
    intervalSpy.mockRestore();
  });
});
