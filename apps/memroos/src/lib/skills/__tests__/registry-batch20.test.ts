// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  normalizeRegistryEntry,
  parseSkillMd,
  signRegistryEntry,
  trustLevelRank,
  verifySkillSignature,
} from "../registry";

describe("registry batch20 — parser and signing edges", () => {
  it("parseSkillMd ignores frontmatter lines without a colon", () => {
    const parsed = parseSkillMd(`---
name: batch20-skill
owner: ops
no-colon-line-here
source_harness: claude
risk_tier: low
dispatch_status: enabled
---
# Body
`);
    expect(parsed.name).toBe("batch20-skill");
  });

  it("trustLevelRank returns zero for unknown levels", () => {
    expect(trustLevelRank("not-a-level" as never)).toBe(0);
  });

  it("verifySkillSignature returns false on length mismatch without throwing", () => {
    const hash = "a".repeat(64);
    expect(verifySkillSignature(hash, "short", "signing-key")).toBe(false);
  });

  it("normalizeRegistryEntry maps complete enabled frontmatter to quarantined dispatch", () => {
    const parsed = parseSkillMd(`
---
name: complete-skill
description: desc
owner: ops
source_harness: claude
risk_tier: low
dispatch_status: enabled
version: 1.0.0
---

## Preconditions
- none

## Allowed Tools
- read_file

## Verification Checks
- Output format is JSON

## Rollback
- Revert snapshot

## Evidence Examples
- Example one
`);
    const entry = normalizeRegistryEntry(parsed, "claude", "importer-b20");
    expect(entry.dispatch_status).toBe("quarantined");
  });

  it("signRegistryEntry leaves entry unchanged without content_hash", () => {
    const parsed = parseSkillMd("---\nname: x\nowner: o\nsource_harness: c\nrisk_tier: low\n---\n");
    const entry = normalizeRegistryEntry(parsed, "claude", "importer");
    const unsigned = { ...entry, content_hash: null };
    expect(signRegistryEntry(unsigned, "key")).toBe(unsigned);
  });
});
