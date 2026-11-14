// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { extractNotionTitle, notionBlocksToText, richTextToPlain } from "../notion-content";

describe("notion-content batch35", () => {
  it("extractNotionTitle skips non-record property values (66)", () => {
    const title = `title-b35-${randomUUID().slice(0, 8)}`;
    const record = {
      properties: {
        junk: "not-an-object",
        Name: {
          type: "title",
          title: [{ plain_text: title }],
        },
      },
    };
    expect(extractNotionTitle(record)).toBe(title);
  });

  it("notionBlocksToText skips blocks with missing typed body (98)", () => {
    const blocks = [
      { type: "paragraph" },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "visible-b35" }] } },
    ];
    expect(notionBlocksToText(blocks)).toBe("visible-b35");
  });

  it("richTextToPlain reads nested text.content spans", () => {
    const text = richTextToPlain([{ text: { content: `nested-b35-${randomUUID().slice(0, 6)}` } }]);
    expect(text).toMatch(/nested-b35/);
  });

  it("notionBlocksToText honors maxChars without mid-line truncation (98)", () => {
    const blocks = [
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "a".repeat(80) }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "b".repeat(80) }] } },
    ];
    const out = notionBlocksToText(blocks, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).not.toMatch(/b{10}/);
  });
});
