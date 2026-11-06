// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  aggregateSourceStatus,
  isSearchAggregateRecalled,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch20c", () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const file of tmpFiles) {
      fs.rmSync(file, { force: true });
    }
    tmpFiles.length = 0;
  });

  it("loadEnabledMeetingCollections reads enabled qmdCollections from config file", async () => {
    const cfg = path.join(os.tmpdir(), `meeting-src-${randomUUID()}.json`);
    fs.writeFileSync(
      cfg,
      JSON.stringify({
        sources: [
          { enabled: true, qmdCollections: ["meet-recordings-custom"] },
          { enabled: false, qmdCollections: ["ignored"] },
        ],
      }),
      "utf8",
    );
    tmpFiles.push(cfg);
    const cols = await loadEnabledMeetingCollections(cfg);
    expect(cols).toEqual(["meet-recordings-custom"]);
  });

  it("aggregateSourceStatus returns providerAbsent for empty map", () => {
    expect(aggregateSourceStatus({})).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("searchMeetingCollections rejects blank query", async () => {
    const res = await searchMeetingCollections("   ");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/required/i);
  });

  it("searchMeetingCollections parses qmd stdout via injected execFile", async () => {
    const execMock = async () => ({
      stdout: JSON.stringify([
        { title: "Standup", content: "Notes", path: "/meet/a.md", score: 0.9 },
      ]),
      stderr: "",
    });
    const res = await searchMeetingCollections("standup", 5, ["meet-recordings-test"], execMock);
    expect(res.hits.length).toBe(1);
    expect(res.hits[0]?.collection).toBe("meet-recordings-test");
    expect(isSearchAggregateRecalled(res)).toBe(true);
  });
});
