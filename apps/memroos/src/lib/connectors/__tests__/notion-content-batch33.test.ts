// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { extractNotionTitle, notionBlocksToText } from "../notion-content";

describe("notion-content batch33", () => {
  it("extractNotionTitle reads type:title property values (66)", () => {
    const title = `Batch33 Title ${randomUUID().slice(0, 6)}`;
    const record = {
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: title }],
        },
      },
    };
    expect(extractNotionTitle(record)).toBe(title);
  });

  it("notionBlocksToText stops at maxChars mid accumulation (98)", () => {
    const long = "x".repeat(40);
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      type: "paragraph",
      paragraph: { rich_text: [{ plain_text: `${long}-${i}` }] },
    }));
    const text = notionBlocksToText(blocks, 120);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(text.split("\n").length).toBeGreaterThan(0);
  });
});
