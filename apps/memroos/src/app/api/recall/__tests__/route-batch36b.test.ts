// @vitest-environment node
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockEmbedText = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const mockAuthorize = vi.fn(() => true);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock("@/lib/embeddings/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embeddings/provider")>();
  return {
    ...actual,
    embedText: (...args: unknown[]) => mockEmbedText(...args),
  };
});

const LOOPBACK = "http://localhost";

function asReq(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

function insertMessage(agentId: string, content: string) {
  testDb
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?, 'alpha', ?, 'user', ?, '2026-01-01T00:00:00Z', 'public_approved', 'indexable')`,
    )
    .run(`sess-b36b-${randomUUID().slice(0, 6)}`, agentId, content);
}

beforeEach(() => {
  testDb.exec("DELETE FROM messages");
  mockEmbedText.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], degraded: false });
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/recall batch36b", () => {
  it("filters hybrid results to agent_id when query param set (207)", async () => {
    insertMessage("agent-target-b36b", "keyword b36b target only");
    insertMessage("agent-other-b36b", "keyword b36b other noise");
    const { GET } = await import("../route");
    const body = await (
      await GET(
        asReq(
          `${LOOPBACK}/api/recall?q=keyword+b36b&mode=hybrid&agent_id=agent-target-b36b`,
        ),
      )
    ).json();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r: { agent_id: string }) => r.agent_id === "agent-target-b36b")).toBe(true);
  });
});
