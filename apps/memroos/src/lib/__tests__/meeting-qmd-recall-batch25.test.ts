// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  aggregateSourceStatus,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch25 — home paths, hit shapes, dedupe", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
  });

  it("loadEnabledMeetingCollections expands bare ~ and $HOME config paths", async () => {
    const relDir = path.join(".memroos-test-meeting-b25", crypto.randomUUID());
    const absDir = path.join(os.homedir(), relDir);
    fs.mkdirSync(absDir, { recursive: true });
    tmpDir = absDir;
    const configPath = path.join(absDir, "meeting-sources.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        sources: [
          {
            enabled: true,
            qmdCollections: ["meet-recordings-b25-a", "meet-recordings-b25-b"],
          },
          { enabled: false, qmdCollections: ["disabled-col"] },
        ],
      }),
      "utf8",
    );
    const fromTilde = await loadEnabledMeetingCollections(`~/${path.join(relDir, "meeting-sources.json")}`);
    expect(fromTilde).toEqual(["meet-recordings-b25-a", "meet-recordings-b25-b"]);

    const homeExpanded = configPath.replace(os.homedir(), "$HOME");
    const fromHome = await loadEnabledMeetingCollections(homeExpanded);
    expect(fromHome).toContain("meet-recordings-b25-a");
  });

  it("searchMeetingCollections normalizes scalar hits and dedupes duplicate ids", async () => {
    const sharedPath = "/meetings/shared-note.md";
    const execMock = async (_file: string, args: string[]) => {
      const collection = args[args.indexOf("-c") + 1];
      if (collection === "meet-recordings-b25-dedupe") {
        return {
          stdout: JSON.stringify([
            { file: sharedPath, title: "First", snippet: "alpha", score: 9, indexed_at: "2026-07-01T00:00:00Z" },
            { file: sharedPath, title: "Duplicate", snippet: "beta", score: 8 },
          ]),
          stderr: "",
        };
      }
      if (collection === "meet-recordings-b25-scalar") {
        return {
          stdout: JSON.stringify({ file: "scalar.md", text: "plain scalar hit", title: "Scalar doc" }),
          stderr: "",
        };
      }
      return { stdout: JSON.stringify({ file: "solo.md", name: "Solo doc" }), stderr: "" };
    };

    const dedupe = await searchMeetingCollections(
      "shared",
      6,
      ["meet-recordings-b25-dedupe", "meet-recordings-b25-scalar"],
      execMock,
    );
    expect(dedupe.hits.filter((h) => h.path === sharedPath)).toHaveLength(1);
    expect(dedupe.collectionStatus["meet-recordings-b25-dedupe"]?.lastIndexAt).toBe(
      "2026-07-01T00:00:00Z",
    );

    const scalar = await searchMeetingCollections("x", 4, ["meet-recordings-b25-scalar"], execMock);
    expect(scalar.hits[0]?.content).toContain("plain scalar");
    expect(scalar.hits[0]?.title).toBe("Scalar doc");
  });

  it("aggregateSourceStatus returns providerAbsent when statuses are unknown", () => {
    expect(
      aggregateSourceStatus({
        broken: {
          collection: "broken",
          status: "not-a-real-status" as typeof SOURCE_STATUS.recalled,
          count: 0,
          lastIndexAt: null,
        },
      }),
    ).toBe(SOURCE_STATUS.providerAbsent);
  });
});
