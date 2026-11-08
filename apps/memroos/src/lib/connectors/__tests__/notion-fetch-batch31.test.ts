// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import {
  MAX_BLOCK_DEPTH,
  MAX_BLOCK_REQUESTS_PER_PAGE,
  MAX_PAGE_TEXT_CHARS,
  fetchNotionPageText,
} from "../notion-fetch";

vi.mock("../mcp-client", () => ({
  callRest: vi.fn(),
}));

vi.mock("../notion-content", () => ({
  notionBlocksToText: vi.fn(() => "x".repeat(500)),
}));

import { callRest } from "../mcp-client";

const mockCallRest = vi.mocked(callRest);

describe("notion-fetch batch31", () => {
  beforeEach(() => {
    mockCallRest.mockReset();
  });

  it("stops walk when depth exceeds MAX_BLOCK_DEPTH (line 55)", async () => {
    const deepId = `page-b31-deep-${randomUUID().slice(0, 8)}`;
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
      accessToken: "secret-b31",
      pageId: deepId,
    });

    expect(text.length).toBeGreaterThan(0);
    expect(mockCallRest.mock.calls.length).toBeLessThanOrEqual(MAX_BLOCK_DEPTH + 2);
  });

  it("respects MAX_BLOCK_REQUESTS_PER_PAGE and MAX_PAGE_TEXT_CHARS (lines 60–61, 93)", async () => {
    const pageId = `page-b31-cap-${randomUUID().slice(0, 8)}`;
    let calls = 0;
    mockCallRest.mockImplementation(async () => {
      calls += 1;
      return {
        payload: {
          results: [{ id: `child-${calls}`, has_children: true }],
          has_more: calls < MAX_BLOCK_REQUESTS_PER_PAGE + 2,
          next_cursor: calls < MAX_BLOCK_REQUESTS_PER_PAGE + 2 ? `cursor-${calls}` : null,
        },
      };
    });

    const text = await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret-b31",
      pageId,
    });

    expect(mockCallRest.mock.calls.length).toBeLessThanOrEqual(MAX_BLOCK_REQUESTS_PER_PAGE);
    expect(text.length).toBeLessThanOrEqual(MAX_PAGE_TEXT_CHARS + 500);
  });
});
