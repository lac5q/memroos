// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { normalizeRegistryEntry, parseSkillMd } from "../registry";

const PARTIAL_SKILL = (name: string): string => `---
name: ${name}
description: batch33 partial
owner: ops
source_harness: claude
risk_tier: low
version: 0.1.0
---

## Body
incomplete
`;

describe("registry batch33 — import normalization edges", () => {
  it("normalizeRegistryEntry keeps incomplete imports disabled with low completeness", () => {
    const name = `partial-b33-${randomUUID().slice(0, 8)}`;
    const entry = normalizeRegistryEntry(parseSkillMd(PARTIAL_SKILL(name)), "claude", "importer-b33");
    expect(entry.dispatch_status).toBe("incomplete");
    expect(entry.completeness_pct).toBeLessThan(100);
    expect(entry.content_hash).toBe(createHash("sha256").update(entry.raw_body, "utf8").digest("hex"));
  });
});
