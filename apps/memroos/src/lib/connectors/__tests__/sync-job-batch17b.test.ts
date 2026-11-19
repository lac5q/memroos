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

import { listNangoConnections } from "@/lib/tool-auth/nango-client";
import { CONNECTOR_PAGE_SIZE, runConnectorCycle } from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch17b — empty cycle and constants", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("runConnectorCycle completes with zero writes when no connections exist", async () => {
    mockListConnections.mockResolvedValueOnce([]);
    const result = await runConnectorCycle(db, { tenantId: "default-tenant" });
    expect(result.written).toBe(0);
    expect(result.degraded).toBe(false);
    expect(result.degradedProviders).toEqual([]);
  });

  it("exports connector paging constant", () => {
    expect(CONNECTOR_PAGE_SIZE).toBe(100);
  });
});
