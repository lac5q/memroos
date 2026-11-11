// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { MAX_BLOCK_DEPTH, MAX_BLOCK_REQUESTS_PER_PAGE, fetchNotionPageText } from "../notion-fetch";

vi.mock("../mcp-client", () => ({
  callRest: vi.fn(),
}));

vi.mock("../notion-content", () => ({
  notionBlocksToText: vi.fn(() => "block text b33"),
}));

import { callRest } from "../mcp-client";

const mockCallRest = vi.mocked(callRest);

describe("notion-fetch batch33", () => {
  beforeEach(() => {
    mockCallRest.mockReset();
  });

  it("returns early when depth exceeds MAX_BLOCK_DEPTH (55)", async () => {
    const pageId = `page-b33-deep-${randomUUID().slice(0, 8)}`;
    mockCallRest.mockImplementation(async (_ep, _token, req) => {
      const blockId = String(req.path).split("/")[3];
      return {
        payload: {
          results: [{ id: blockId, has_children: true }],
          has_more: false,
          next_cursor: null,
        },
      };
    });

    const text = await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret-b33",
      pageId,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(mockCallRest.mock.calls.length).toBeLessThanOrEqual(MAX_BLOCK_DEPTH + 2);
  });

  it("respects request budget and recurses has_children (61, 93)", async () => {
    const pageId = `page-b33-walk-${randomUUID().slice(0, 8)}`;
    let calls = 0;
    mockCallRest.mockImplementation(async () => {
      calls += 1;
      return {
        payload: {
          results: [{ id: `child-b33-${calls}`, has_children: calls < 3 }],
          has_more: calls < MAX_BLOCK_REQUESTS_PER_PAGE,
          next_cursor: calls < MAX_BLOCK_REQUESTS_PER_PAGE ? `cursor-b33-${calls}` : null,
        },
      };
    });

    await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret-b33",
      pageId,
    });
    expect(mockCallRest.mock.calls.length).toBeLessThanOrEqual(MAX_BLOCK_REQUESTS_PER_PAGE);
  });
});
