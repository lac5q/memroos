// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { normalizeRegistryEntry, parseSkillMd, verifySkillSignature } from "../registry";

const COMPLETE_SKILL = (name: string): string => `---
name: ${name}
description: batch32 complete
owner: ops
source_harness: claude
risk_tier: low
dispatch_status: enabled
version: 1.0.0
---

## Preconditions
none

## Allowed Tools
read_file

## Verification Checks
verify

## Rollback
revert

## Evidence Examples
verify
`;

describe("registry batch32 — signature guard and quarantine import gate", () => {
  it("verifySkillSignature returns false when timingSafeEqual inputs differ in encoding (line 338)", () => {
    const hash = "a".repeat(64);
    const signature = createHmac("sha256", "batch32-key").update(hash, "utf8").digest("hex");
    const malformed = Buffer.from(signature, "hex").toString("latin1");
    expect(verifySkillSignature(hash, malformed, "batch32-key")).toBe(false);
  });

  it("normalizeRegistryEntry maps complete enabled imports to quarantined dispatch (line 380)", () => {
    const name = `quar-b32-${randomUUID().slice(0, 8)}`;
    const entry = normalizeRegistryEntry(parseSkillMd(COMPLETE_SKILL(name)), "claude", "importer-b32");
    expect(entry.dispatch_status).toBe("quarantined");
    expect(entry.completeness_pct).toBe(100);
  });
});
