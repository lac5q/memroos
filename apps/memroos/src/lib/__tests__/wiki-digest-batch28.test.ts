// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clusterKeyForMemory,
  readWikiDigestWatermark,
  redactSecrets,
  runWikiDigest,
  shouldSkipMemory,
  writeWikiDigestWatermark,
} from "@/lib/wiki-digest";

describe("wiki-digest batch28 — skip gates, watermark fallback, fetch failure, redaction", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("shouldSkipMemory rejects empty, high sensitivity, legal scrap, and secret patterns", () => {
    expect(shouldSkipMemory({ id: "e1", content: "   " }).reason).toBe("empty");
    expect(shouldSkipMemory({ id: "e2", content: "note", sensitivity: "RESTRICTED" }).reason).toBe(
      "high_sensitivity",
    );
    expect(
      shouldSkipMemory({ id: "e3", content: "This mentions attorney-client privilege in notes" }).reason,
    ).toBe("personal_legal_scrap");
    expect(shouldSkipMemory({ id: "e4", content: "api_key: super-secret-value-here" }).reason).toBe(
      "secret_pattern",
    );
    expect(shouldSkipMemory({ id: "e5", content: "ok operational note batch28" }).skip).toBe(false);
  });

  it("readWikiDigestWatermark returns empty watermark when file is missing or invalid JSON", () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b28-wm-"));
    vaults.push(kb);
    const now = new Date("2026-07-24T10:00:00.000Z");
    expect(readWikiDigestWatermark(kb, now).pagesWritten).toBe(0);

    fs.mkdirSync(path.join(kb, "llm-wiki", ".memroos"), { recursive: true });
    fs.writeFileSync(path.join(kb, "llm-wiki", ".memroos", "wiki-digest-watermark.json"), "{broken", "utf8");
    expect(readWikiDigestWatermark(kb, now).lastCreatedAt).toBeNull();
  });

  it("writeWikiDigestWatermark persists pagesWritten and read round-trips", () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b28-roundtrip-"));
    vaults.push(kb);
    const wm = {
      lastCreatedAt: "2026-07-24T11:00:00.000Z",
      lastId: "mem-b28",
      updatedAt: "2026-07-24T12:00:00.000Z",
      pagesWritten: 3,
    };
    writeWikiDigestWatermark(kb, wm);
    expect(readWikiDigestWatermark(kb).pagesWritten).toBe(3);
  });

  it("clusterKeyForMemory uses slug when heading is long enough", () => {
    const key = clusterKeyForMemory({
      id: randomId(),
      content: "Batch28 digest uses a long enough heading for slug path",
    });
    expect(key.startsWith("memory-")).toBe(false);
    expect(key.length).toBeGreaterThanOrEqual(8);
  });

  it("runWikiDigest fails closed when fetch fails and episodic fallback is disabled", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b28-fail-"));
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      allowEpisodicFallback: false,
      fetchMemories: async () => {
        throw new Error("mem0_fetch_failed:503");
      },
      now: new Date("2026-07-24T13:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.status).toBe("failed");
    expect(summary.reason).toMatch(/mem0_fetch_failed/);
  });

  it("redactSecrets masks bearer tokens and api keys", () => {
    const raw = "Contact support; bearer abc.def.ghi and api_key: leaked";
    const redacted = redactSecrets(raw);
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).toContain("[REDACTED]");
  });
});

function randomId(): string {
  return `mem-${Math.random().toString(16).slice(2, 10)}`;
}
