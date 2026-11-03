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
import { CONNECTOR_PAGE_SIZE, runConnectorCycle } from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);
const mockFetchCreds = vi.mocked(fetchNangoCredentials);
const mockCallTool = vi.mocked(callTool);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch18b", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("marks degraded when a single tool sync throws", async () => {
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
    mockCallTool.mockRejectedValueOnce(new Error("list_issues offline"));

    const result = await runConnectorCycle(db);
    expect(result.degraded).toBe(true);
    expect(result.degradedProviders.some((p) => p.includes("linear"))).toBe(true);
  });

  it("records per-tool failures in degradedProviders without aborting the provider", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-linear-tools",
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
          issues: [{ id: "issue-1", updatedAt: "2026-07-01T00:00:00.000Z", title: "One", description: "d" }],
          hasNextPage: false,
        },
      })
      .mockRejectedValueOnce(new Error("list_projects offline"));

    const result = await runConnectorCycle(db);
    expect(result.written).toBeGreaterThanOrEqual(1);
    expect(result.degraded).toBe(true);
    expect(result.degradedProviders.some((p) => p.includes("list_projects"))).toBe(true);
  });
});
