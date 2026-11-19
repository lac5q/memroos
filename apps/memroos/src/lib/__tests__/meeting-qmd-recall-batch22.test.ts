// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { loadEnabledMeetingCollections, searchMeetingCollections } from "@/lib/meeting-qmd-recall";

describe("meeting-qmd-recall batch22 — home expansion and empty query guard", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
  });

  it("loadEnabledMeetingCollections expands tilde config paths", async () => {
    const relDir = path.join(".memroos-test-meeting-b22", crypto.randomUUID());
    const absDir = path.join(os.homedir(), relDir);
    fs.mkdirSync(absDir, { recursive: true });
    tmpDir = absDir;
    const configPath = path.join(absDir, "meeting-sources.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        sources: [{ enabled: true, qmdCollections: ["meet-recordings-b22"] }],
      }),
      "utf8",
    );
    const tildePath = `~/${path.join(relDir, "meeting-sources.json")}`;
    const cols = await loadEnabledMeetingCollections(tildePath);
    expect(cols).toContain("meet-recordings-b22");
  });

  it("searchMeetingCollections rejects blank queries before invoking qmd", async () => {
    const execMock = async () => ({ stdout: "[]", stderr: "" });
    const res = await searchMeetingCollections("   ", 5, ["meet-recordings-b22"], execMock);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("query is required");
  });
});
