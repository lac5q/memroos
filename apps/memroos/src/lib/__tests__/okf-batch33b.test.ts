// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildOkfBundle, buildOkfConceptFromMemory } from "../okf";

describe("okf batch33b", () => {
  it("serializeYamlValue stringifies numbers in frontmatter (208)", () => {
    const concept = buildOkfConceptFromMemory({
      id: `mem-b33b-${randomUUID().slice(0, 8)}`,
      content: "priority field",
      agent: "agent-b33b",
      date: "2026-11-10T00:00:00.000Z",
      type: "reference",
      source: "test",
    });
    concept.content = concept.content.replace("---\n", "---\npriority: 7\n");
    const bundle = buildOkfBundle({
      name: "Batch33b Numeric",
      concepts: [concept],
      timestamp: "2026-11-10T00:00:00.000Z",
    });
    expect(bundle[concept.path]).toMatch(/priority: 7/);
  });
});
