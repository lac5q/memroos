// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchNotionPageText } from "../notion-fetch";

vi.mock("../mcp-client", () => ({
  callRest: vi.fn(),
}));

vi.mock("../notion-content", () => ({
  notionBlocksToText: vi.fn((blocks: unknown[]) =>
    Array.isArray(blocks) ? "x".repeat(blocks.length * 40) : "",
  ),
}));

import { callRest } from "../mcp-client";

const mockCallRest = vi.mocked(callRest);

describe("notion-fetch batch20", () => {
  beforeEach(() => {
    mockCallRest.mockReset();
  });

  it("recurses into child blocks and paginates with start_cursor", async () => {
    mockCallRest
      .mockResolvedValueOnce({
        payload: {
          results: [{ id: "parent-block", has_children: true }],
          has_more: false,
          next_cursor: null,
        },
      })
      .mockResolvedValueOnce({
        payload: {
          results: [{ id: "child-block", has_children: false }],
          has_more: false,
          next_cursor: null,
        },
      });

    const text = await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret",
      pageId: "page-nested",
    });

    expect(text.length).toBeGreaterThan(0);
    expect(mockCallRest.mock.calls.length).toBe(2);
    expect(mockCallRest.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ path: "/v1/blocks/parent-block/children" }),
    );
  });

  it("paginates block children when has_more is true", async () => {
    mockCallRest
      .mockResolvedValueOnce({
        payload: {
          results: [{ id: "block-a", has_children: false }],
          has_more: true,
          next_cursor: "cursor-page-2",
        },
      })
      .mockResolvedValueOnce({
        payload: {
          results: [{ id: "block-b", has_children: false }],
          has_more: false,
          next_cursor: null,
        },
      });

    await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret",
      pageId: "paginated-page",
    });

    expect(mockCallRest.mock.calls.length).toBe(2);
    expect(mockCallRest.mock.calls[1]?.[2]?.body).toEqual(
      expect.objectContaining({ start_cursor: "cursor-page-2" }),
    );
  });
});
