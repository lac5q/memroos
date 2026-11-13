// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clusterKeyForMemory,
  redactSecrets,
  runWikiDigest,
  shouldSkipMemory,
} from "@/lib/wiki-digest";

describe("wiki-digest batch36 — skip arms and cluster slug", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it.skip("default log one-argument branch (401) — bundled log() calls always pass extra payloads", () => {});

  it("shouldSkipMemory rejects empty trimmed content (136)", () => {
    expect(shouldSkipMemory({ id: "empty-b36", content: "   \n" }).reason).toBe("empty");
  });

  it("shouldSkipMemory flags personal legal scrap patterns (143-147)", () => {
    const verdict = shouldSkipMemory({
      id: "legal-b36",
      content: "Notes on attorney-client privilege for batch36 wiki digest planning",
    });
    expect(verdict.skip).toBe(true);
    expect(verdict.reason).toBe("personal_legal_scrap");
  });

  it("shouldSkipMemory flags sk- secret tokens (152-154)", () => {
    const verdict = shouldSkipMemory({
      id: "sk-b36",
      content: `Use key sk-${"a".repeat(12)} for batch36 digest test fixture only`,
    });
    expect(verdict.skip).toBe(true);
    expect(verdict.reason).toBe("secret_pattern");
  });

  it("clusterKeyForMemory uses slug when heading is long enough (175)", () => {
    const key = clusterKeyForMemory({
      id: `id-b36-${randomUUID().slice(0, 6)}`,
      content: "Operational deployment checklist for MemRoOS routing gates batch36 wiki",
    });
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key).not.toMatch(/^memory-/);
  });

  it("redactSecrets leaves benign text intact when no secret pattern matches", () => {
    const plain = "batch36 wiki digest has no api secrets in this sentence";
    expect(redactSecrets(plain)).toBe(plain);
  });

  it("runWikiDigest increments skipped when memories are all sensitive", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b36-${randomUUID()}-`));
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: `mem-b36-${randomUUID().slice(0, 6)}`,
          content: "restricted",
          sensitivity: "restricted",
          createdAt: "2026-11-13T12:00:00.000Z",
        },
      ],
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.written).toBe(0);
  });
});
