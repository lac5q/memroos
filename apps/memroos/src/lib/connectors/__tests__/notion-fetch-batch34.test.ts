// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { MAX_BLOCK_REQUESTS_PER_PAGE, fetchNotionPageText } from "../notion-fetch";

vi.mock("../mcp-client", () => ({
  callRest: vi.fn(),
}));

vi.mock("../notion-content", () => ({
  notionBlocksToText: vi.fn(() => "batch34 text"),
}));

import { callRest } from "../mcp-client";

const mockCallRest = vi.mocked(callRest);

describe("notion-fetch batch34", () => {
  beforeEach(() => {
    mockCallRest.mockReset();
  });

  it("stops recursion when request budget is exhausted (55, 61)", async () => {
    const pageId = `page-b34-budget-${randomUUID().slice(0, 8)}`;
    let calls = 0;
    mockCallRest.mockImplementation(async () => {
      calls += 1;
      return {
        payload: {
          results: [{ id: `blk-b34-${calls}`, has_children: true }],
          has_more: true,
          next_cursor: `cursor-b34-${calls}`,
        },
      };
    });
    await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "secret-b34",
      pageId,
    });
    expect(calls).toBeLessThanOrEqual(MAX_BLOCK_REQUESTS_PER_PAGE);
  });

  it("ignores child fetch errors and continues siblings (93)", async () => {
    const pageId = `page-b34-sibling-${randomUUID().slice(0, 8)}`;
    mockCallRest.mockImplementation(async (_ep, _tok, req) => {
      const blockId = String(req.path).split("/").pop() ?? "";
      if (blockId.startsWith("child-error-b34")) {
        throw new Error("child fetch failed b34");
      }
      return {
        payload: {
          results: [{ id: blockId, has_children: false }],
          has_more: false,
          next_cursor: null,
        },
      };
    });
    mockCallRest.mockImplementationOnce(async () => ({
      payload: {
        results: [
          { id: "child-error-b34", has_children: true },
          { id: "child-ok-b34", has_children: false },
        ],
        has_more: false,
        next_cursor: null,
      },
    }));
    const text = await fetchNotionPageText({
      endpoint: "http://localhost",
      accessToken: "secret-b34",
      pageId,
    });
    expect(text).toContain("batch34");
  });
});
