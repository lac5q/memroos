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
import { CONNECTOR_CYCLE_LIMIT, runConnectorCycle } from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch16b", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("returns degraded when top-level listNangoConnections fails", async () => {
    mockListConnections.mockRejectedValueOnce(new Error("nango_down"));
    const result = await runConnectorCycle(db);
    expect(result.degraded).toBe(true);
    expect(result.written).toBe(0);
  });

  it("exports connector cycle limit constant", () => {
    expect(CONNECTOR_CYCLE_LIMIT).toBe(200);
  });
});
