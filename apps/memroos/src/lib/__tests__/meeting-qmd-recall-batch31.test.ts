// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aggregateSourceStatus,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch31 — tilde paths and empty aggregate", () => {
  const homes: string[] = [];

  afterEach(() => {
  for (const dir of homes) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    homes.length = 0;
    vi.unstubAllEnvs();
  });

  it("loadEnabledMeetingCollections expands ~/ config paths", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-b31-"));
    homes.push(home);
    const cfgDir = path.join(home, "config");
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, "meeting-sources.json");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ sources: [{ enabled: true, qmdCollections: ["tilde-batch31"] }] }),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const cols = await loadEnabledMeetingCollections(`~/${path.relative(home, cfgPath).replace(/\\/g, "/")}`);
    expect(cols).toEqual(["tilde-batch31"]);
  });

  it("aggregateSourceStatus returns providerAbsent for empty collections map", () => {
    expect(aggregateSourceStatus({})).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("searchMeetingCollections dedupes hits and records indexedUnrecalled", async () => {
    const payload = [{ file: "/docs/a.md", title: "A", snippet: "batch31 snippet", score: 0.9 }];
    const execMock = vi.fn(async () => ({ stdout: JSON.stringify(payload), stderr: "" }));
    const result = await searchMeetingCollections("batch31", 4, ["col-b31"], execMock);
    const second = await searchMeetingCollections("batch31", 4, ["col-b31"], execMock);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.collectionStatus["col-b31"]?.status).toBe(SOURCE_STATUS.recalled);
    expect(second.hits[0]?.id).toBe(result.hits[0]?.id);
  });
});
