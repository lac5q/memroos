// @vitest-environment node
import { describe, expect, it } from "vitest";

import { classifyText, detectFixedSensitiveLabels } from "../cascade";

describe("classification cascade batch17 — nested provider labels and HR domain", () => {
  it("detectFixedSensitiveLabels collects nested gmail label arrays", () => {
    const fixed = detectFixedSensitiveLabels({
      content: "routine",
      sourceType: "message",
      metadata: {
        metadata: {
          gmail_labels: ["Finance / Payroll"],
        },
      },
    });
    expect(fixed.kinds).toContain("finance");
    expect(fixed.matchedTokens.length).toBeGreaterThan(0);
  });

  it("detectFixedSensitiveLabels ignores empty tokens after normalization", () => {
    const fixed = detectFixedSensitiveLabels({
      content: "routine",
      sourceType: "message",
      metadata: { labels: ["   ", "___"] },
    });
    expect(fixed.kinds).toEqual([]);
  });

  it("classifyText detects HR domain keywords", () => {
    const result = classifyText({
      content: "Candidate salary review for termination benefits package.",
      sourceType: "message",
      metadata: {},
    });
    expect(result.label.domain).toBe("hr");
  });

  it("classifyText maps confidential fixed labels to client domain when baseline is engineering", () => {
    const result = classifyText({
      content: "Engineering deployment checklist.",
      sourceType: "message",
      metadata: { confidential_label: "Highly Confidential" },
    });
    expect(result.label.domain).toBe("client");
  });
});
