// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { MAX_BLOCK_REQUESTS_PER_PAGE, fetchNotionPageText } from "../notion-fetch";

vi.mock("../mcp-client", () => ({
  callRest: vi.fn(),
}));

vi.mock("../notion-content", () => ({
  notionBlocksToText: vi.fn(() => "batch35 text"),
}));

import { callRest } from "../mcp-client";

const mockCallRest = vi.mocked(callRest);

describe("notion-fetch batch35", () => {
  beforeEach(async () => {
    mockCallRest.mockReset();
    const { notionBlocksToText } = await import("../notion-content");
    vi.mocked(notionBlocksToText).mockReturnValue("batch35 text");
  });

  it("stops when char budget exhausted mid-walk (61)", async () => {
    const pageId = `page-b35-chars-${randomUUID().slice(0, 8)}`;
    const { notionBlocksToText } = await import("../notion-content");
    vi.mocked(notionBlocksToText).mockReturnValue("x".repeat(12_500));
    mockCallRest.mockResolvedValue({
      payload: { results: [{ id: "blk-b35", has_children: false }], has_more: true, next_cursor: "c1" },
    });
    const text = await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "token-b35",
      pageId,
    });
    expect(text.length).toBeLessThanOrEqual(12_500);
    expect(mockCallRest.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("passes start_cursor on paginated block fetches (55)", async () => {
    const pageId = `page-b35-cursor-${randomUUID().slice(0, 8)}`;
    let calls = 0;
    mockCallRest.mockImplementation(async (_ep, _tok, req) => {
      calls += 1;
      if (calls === 2) {
        expect(req.body).toMatchObject({ start_cursor: "cursor-b35-1" });
      }
      return {
        payload: {
          results: [{ id: `blk-b35-${calls}`, has_children: false }],
          has_more: calls === 1,
          next_cursor: calls === 1 ? "cursor-b35-1" : null,
        },
      };
    });
    await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "token-b35",
      pageId,
    });
    expect(calls).toBe(2);
  });

  it("swallows child recursion failures and keeps siblings (93)", async () => {
    const pageId = `page-b35-child-${randomUUID().slice(0, 8)}`;
    mockCallRest.mockImplementationOnce(async () => ({
      payload: {
        results: [
          { id: "fail-child-b35", has_children: true },
          { id: "ok-child-b35", has_children: false },
        ],
        has_more: false,
        next_cursor: null,
      },
    }));
    mockCallRest.mockImplementation(async (_ep, _tok, req) => {
      const blockId = String(req.path).split("/").pop() ?? "";
      if (blockId.startsWith("fail-child-b35")) {
        throw new Error("child fetch failed b35");
      }
      return {
        payload: {
          results: [{ id: blockId, has_children: false }],
          has_more: false,
          next_cursor: null,
        },
      };
    });
    const text = await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "token-b35",
      pageId,
    });
    expect(text).toContain("batch35");
  });

  it("respects MAX_BLOCK_REQUESTS_PER_PAGE across pagination (61 budget)", async () => {
    let calls = 0;
    mockCallRest.mockImplementation(async () => {
      calls += 1;
      return {
        payload: {
          results: [{ id: `b35-${calls}`, has_children: false }],
          has_more: true,
          next_cursor: `cur-${calls}`,
        },
      };
    });
    await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "token-b35",
      pageId: `page-b35-budget-${randomUUID().slice(0, 8)}`,
    });
    expect(calls).toBeLessThanOrEqual(MAX_BLOCK_REQUESTS_PER_PAGE);
  });
});
