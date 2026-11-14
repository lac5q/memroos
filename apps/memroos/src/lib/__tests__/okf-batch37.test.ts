// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildOkfBundle, buildOkfConceptFromMemory } from "@/lib/okf";
import type { MemoryEntry } from "@/types";

describe("okf batch37 — serializeYamlValue non-string scalar (208)", () => {
  it("serializes numeric frontmatter via String(value)", () => {
    const memory: MemoryEntry = {
      id: `mem-okf-b37`,
      content: "Numeric frontmatter batch37.",
      type: "fact",
      agent: "test",
      date: "2026-11-14T00:00:00.000Z",
      source: "unit-test",
    };
    const concept = buildOkfConceptFromMemory(memory);
    concept.content = concept.content.replace("---\n", "---\npriority: 37\n");
    const bundle = buildOkfBundle({ name: "okf-b37", concepts: [concept] });
    expect(bundle[concept.path]).toMatch(/priority: 37/);
  });
});