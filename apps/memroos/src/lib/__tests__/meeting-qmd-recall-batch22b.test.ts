// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { loadEnabledMeetingCollections, searchMeetingCollections } from "@/lib/meeting-qmd-recall";

describe("meeting-qmd-recall batch22b — HOME expansion and default collections", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
    delete process.env.HOME;
  });

  it("loadEnabledMeetingCollections expands bare tilde paths", async () => {
    const relDir = path.join(".memroos-test-meeting-b22b", crypto.randomUUID());
    const absDir = path.join(os.homedir(), relDir);
    fs.mkdirSync(absDir, { recursive: true });
    tmpDir = absDir;
    fs.writeFileSync(
      path.join(absDir, "meeting-sources.json"),
      JSON.stringify({ sources: [{ enabled: true, qmdCollections: ["meet-b22b-tilde"] }] }),
      "utf8",
    );
    const cols = await loadEnabledMeetingCollections(`~/${path.join(relDir, "meeting-sources.json")}`);
    expect(cols).toContain("meet-b22b-tilde");
  });

  it("searchMeetingCollections loads default collections when none are passed", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-qmd-b22b-${crypto.randomUUID()}-`));
    process.env.HOME = home;
    const configDir = path.join(home, ".memroos");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "meeting-sources.json"),
      JSON.stringify({ sources: [{ enabled: true, qmdCollections: ["meet-default-b22b"] }] }),
      "utf8",
    );
    const execMock = async () => ({
      stdout: JSON.stringify([{ id: "hit-1", title: "Standup", content: "notes", collection: "meet-default-b22b" }]),
      stderr: "",
    });
    const res = await searchMeetingCollections("standup", 3, undefined, execMock);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.hits.length).toBeGreaterThan(0);
      expect(res.collections).toContain("meet-default-b22b");
    }
  });

  it("searchMeetingCollections caps per-collection limit between 2 and 8", async () => {
    const calls: string[] = [];
    const execMock = async (_bin: string, args: string[]) => {
      calls.push(args.join(" "));
      return { stdout: "[]", stderr: "" };
    };
    await searchMeetingCollections("demo", 100, ["col-a"], execMock);
    expect(calls[0]).toMatch(/-n 8/);
    await searchMeetingCollections("demo", 1, ["col-b"], execMock);
    expect(calls[1]).toMatch(/-n 2/);
  });
});
