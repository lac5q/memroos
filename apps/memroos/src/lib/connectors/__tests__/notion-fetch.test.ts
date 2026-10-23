// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchNotionPageText,
  MAX_BLOCK_REQUESTS_PER_PAGE,
  NOTION_VERSION,
} from "../notion-fetch";

vi.mock("../mcp-client", () => ({
  callRest: vi.fn(),
}));

vi.mock("../notion-content", () => ({
  notionBlocksToText: vi.fn((blocks: unknown[]) =>
    Array.isArray(blocks) ? blocks.map(String).join(" ") : "",
  ),
}));

import { callRest } from "../mcp-client";

const mockCallRest = vi.mocked(callRest);

describe("fetchNotionPageText", () => {
  beforeEach(() => {
    mockCallRest.mockReset();
  });

  it("flattens block pages and respects Notion-Version header", async () => {
    mockCallRest.mockResolvedValue({
      payload: {
        results: [{ id: "b1", type: "paragraph" }],
        has_more: false,
        next_cursor: null,
      },
    });

    const text = await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret",
      pageId: "page-abc",
    });

    expect(text.length).toBeGreaterThan(0);
    expect(mockCallRest).toHaveBeenCalledWith(
      "https://api.notion.com",
      "secret",
      expect.objectContaining({
        method: "GET",
        path: "/v1/blocks/page-abc/children",
        headers: { "Notion-Version": NOTION_VERSION },
      }),
      undefined,
    );
  });

  it("returns empty string on fetch failure", async () => {
    mockCallRest.mockRejectedValue(new Error("network down"));
    const text = await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret",
      pageId: "missing",
    });
    expect(text).toBe("");
  });

  it("stops after MAX_BLOCK_REQUESTS_PER_PAGE", async () => {
    mockCallRest.mockImplementation(async () => ({
      payload: {
        results: [{ id: "block", has_children: true }],
        has_more: true,
        next_cursor: "cursor-2",
      },
    }));

    await fetchNotionPageText({
      endpoint: "https://api.notion.com",
      accessToken: "secret",
      pageId: "heavy-page",
    });

    expect(mockCallRest.mock.calls.length).toBeLessThanOrEqual(MAX_BLOCK_REQUESTS_PER_PAGE);
  });
});
