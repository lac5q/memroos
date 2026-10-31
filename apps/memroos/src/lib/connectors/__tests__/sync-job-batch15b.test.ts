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
  fetchNotionPageText: vi.fn(async () => "Enriched notion body"),
}));

import { fetchNangoCredentials, listNangoConnections } from "@/lib/tool-auth/nango-client";
import { callRest } from "../mcp-client";
import { fetchNotionPageText } from "../notion-fetch";
import { runConnectorCycle } from "../sync-job";

const mockListConnections = vi.mocked(listNangoConnections);
const mockFetchCreds = vi.mocked(fetchNangoCredentials);
const mockCallRest = vi.mocked(callRest);
const mockFetchNotion = vi.mocked(fetchNotionPageText);

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("connector sync-job batch15b", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("enriches notion pages and writes connector rows", async () => {
    mockListConnections.mockResolvedValue([
      {
        connectionId: "conn-notion-enrich",
        providerKey: "notion",
        providerConfigKey: "notion",
      },
    ] as Awaited<ReturnType<typeof listNangoConnections>>);
    mockFetchCreds.mockResolvedValue({ accessToken: "notion-token" } as Awaited<
      ReturnType<typeof fetchNangoCredentials>
    >);
    mockCallRest.mockResolvedValueOnce({
      payload: {
        results: [
          {
            id: "page-123",
            url: "https://notion.so/page-123",
            last_edited_time: "2026-07-01T00:00:00.000Z",
            properties: { title: { title: [{ plain_text: "Spec" }] } },
          },
        ],
        has_more: false,
      },
    });

    const result = await runConnectorCycle(db);
    expect(result.written).toBeGreaterThanOrEqual(1);
    expect(mockFetchNotion).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "page-123", accessToken: "notion-token" }),
    );
  });
});
