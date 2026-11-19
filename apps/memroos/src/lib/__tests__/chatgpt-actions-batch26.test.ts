// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory",
  MEM0_URL: "http://mem0.test",
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(async () => []),
  queryGraphMemory: vi.fn(async () => ({ results: [] })),
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({ recordMemoryWrite: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/response-cache", () => ({ responseCache: { invalidateTag: vi.fn() } }));
vi.mock("@/lib/memory/policy-gate", () => ({
  filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
}));

import { authorizeChatGptAction } from "@/lib/chatgpt-actions";

describe("chatgpt-actions batch26 — localhost authorization", () => {
  beforeEach(() => {
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("authorizeChatGptAction allows localhost loopback without API key", () => {
    const res = authorizeChatGptAction(new Request("http://localhost:3000/api/chatgpt/actions/search"));
    expect(res).toBeNull();
  });
});
