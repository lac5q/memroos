// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    timingSafeEqual: () => {
      throw new TypeError("batch36 timingSafeEqual");
    },
  };
});

import { normalizeRegistryEntry, parseSkillMd, verifySkillSignature } from "../registry";

const SIGNING_KEY_PATH = path.join(process.cwd(), "skill-signing-key.json");

afterEach(() => {
  if (fs.existsSync(SIGNING_KEY_PATH)) {
    fs.unlinkSync(SIGNING_KEY_PATH);
  }
  vi.restoreAllMocks();
});

const COMPLETE_SKILL = (name: string): string => `---
name: ${name}
description: batch36 complete
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

describe("registry batch36", () => {
  it("verifySkillSignature catch returns false when timingSafeEqual throws (338)", () => {
    const hash = "c".repeat(64);
    const signature = createHmac("sha256", "batch36-key").update(hash, "utf8").digest("hex");
    expect(verifySkillSignature(hash, signature, "batch36-key")).toBe(false);
  });

  it("normalizeRegistryEntry maps complete enabled imports to quarantined (380)", () => {
    const name = `complete-b36-${randomUUID().slice(0, 8)}`;
    const entry = normalizeRegistryEntry(parseSkillMd(COMPLETE_SKILL(name)), "claude", "importer-b36");
    expect(entry.dispatch_status).toBe("quarantined");
    expect(entry.completeness_pct).toBe(100);
  });
});
