// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { MAX_BLOCK_DEPTH, fetchNotionPageText } from "../notion-fetch";

vi.mock("../mcp-client", () => ({
  callRest: vi.fn(),
}));

vi.mock("../notion-content", () => ({
  notionBlocksToText: vi.fn(() => "batch35b"),
}));

import { callRest } from "../mcp-client";

const mockCallRest = vi.mocked(callRest);

describe("notion-fetch batch35b", () => {
  beforeEach(() => {
    mockCallRest.mockReset();
  });

  it("walk returns empty when block depth exceeds MAX_BLOCK_DEPTH (55)", async () => {
    const pageId = `page-b35b-depth-${randomUUID().slice(0, 8)}`;
    const rootId = "root-b35b";
    const deepId = "deep-b35b";
    mockCallRest.mockImplementation(async (_ep, _tok, req) => {
      const blockId = decodeURIComponent(String(req.path).split("/").pop() ?? "");
      if (blockId === pageId) {
        return {
          payload: {
            results: [{ id: rootId, has_children: true }],
            has_more: false,
            next_cursor: null,
          },
        };
      }
      if (blockId === rootId) {
        return {
          payload: {
            results: [{ id: deepId, has_children: true }],
            has_more: false,
            next_cursor: null,
          },
        };
      }
      if (blockId === deepId) {
        return {
          payload: {
            results: [{ id: "too-deep-b35b", has_children: true }],
            has_more: false,
            next_cursor: null,
          },
        };
      }
      return {
        payload: { results: [], has_more: false, next_cursor: null },
      };
    });

    const text = await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "token-b35b",
      pageId,
    });
    expect(text).toContain("batch35b");
    expect(mockCallRest.mock.calls.length).toBeLessThanOrEqual(3 + MAX_BLOCK_DEPTH);
  });

  it("passes start_cursor on the second paginated request (55 cursor branch)", async () => {
    const pageId = `page-b35b-cursor-${randomUUID().slice(0, 8)}`;
    let calls = 0;
    mockCallRest.mockImplementation(async (_ep, _tok, req) => {
      calls += 1;
      if (calls === 2) {
        expect(req.body).toMatchObject({ start_cursor: "cursor-b35b-2" });
      }
      return {
        payload: {
          results: [{ id: `blk-b35b-${calls}`, has_children: false }],
          has_more: calls === 1,
          next_cursor: calls === 1 ? "cursor-b35b-2" : null,
        },
      };
    });
    await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "token-b35b",
      pageId,
    });
    expect(calls).toBe(2);
  });
});
