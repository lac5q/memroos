// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildOkfBundle, buildOkfConceptFromMemory } from "../okf";

describe("okf batch33", () => {
  it("serializeYamlValue stringifies numeric frontmatter (208)", () => {
    const concept = buildOkfConceptFromMemory(
      {
        id: `mem-b33-${randomUUID().slice(0, 8)}`,
        content: "batch33 numeric frontmatter",
        agent: "agent-b33",
        date: "2026-11-10T00:00:00.000Z",
        type: "reference",
        source: "test",
      },
      { tags: ["batch33"] },
    );
    concept.content = concept.content.replace("---\n", "---\npriority: 3\n");
    const bundle = buildOkfBundle({
      name: "Batch33 Numeric",
      concepts: [concept],
      timestamp: "2026-11-10T00:00:00.000Z",
    });
    expect(bundle[concept.path]).toMatch(/priority: 3/);
  });

  it("firstSentence falls back when body is empty (222)", () => {
    const concept = buildOkfConceptFromMemory({
      id: `mem-empty-b33-${randomUUID().slice(0, 8)}`,
      content: "   ",
      agent: "agent-b33",
      date: "2026-11-10T00:00:00.000Z",
      type: "reference",
      source: "test",
    });
    expect(concept.frontmatter.description).toBe("MemRoOS memory entry.");
  });
});
