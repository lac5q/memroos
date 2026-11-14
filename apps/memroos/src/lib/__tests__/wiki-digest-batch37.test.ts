// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clusterKeyForMemory,
  readWikiDigestWatermark,
  shouldSkipMemory,
  watermarkPath,
} from "@/lib/wiki-digest";

describe("wiki-digest batch37 — skip arms, watermark, cluster hash", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it.skip("default log one-argument branch (401) — bundled log() calls always pass extra payloads", () => {});

  it("shouldSkipMemory flags medical record phrasing (143-147)", () => {
    const verdict = shouldSkipMemory({
      id: `med-b37-${randomUUID().slice(0, 6)}`,
      content: "Patient medical record notes for batch37 wiki digest fixture",
    });
    expect(verdict.skip).toBe(true);
    expect(verdict.reason).toBe("personal_legal_scrap");
  });

  it("readWikiDigestWatermark returns empty watermark on corrupt file (120-122)", () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b37-${randomUUID()}-`));
    vaults.push(kb);
    fs.mkdirSync(path.dirname(watermarkPath(kb)), { recursive: true });
    fs.writeFileSync(watermarkPath(kb), "not-json-b37", "utf8");
    const wm = readWikiDigestWatermark(kb, new Date("2026-11-14T12:00:00.000Z"));
    expect(wm.lastCreatedAt).toBeNull();
    expect(wm.pagesWritten).toBe(0);
  });

  it("clusterKeyForMemory hashes when slug shorter than 8 chars (175-177)", () => {
    const key = clusterKeyForMemory({ id: "", content: "ab" });
    expect(key.startsWith("memory-")).toBe(true);
    expect(key.length).toBeGreaterThan(8);
  });
});