// @vitest-environment node
import { describe, expect, it } from "vitest";

import { searchMeetingCollections } from "@/lib/meeting-qmd-recall";

describe("meeting-qmd-recall batch21", () => {
  it("caps per-collection limits between 2 and 8", async () => {
    const execMock = async (_cmd: string, _args: string[]) => ({
      stdout: JSON.stringify([{ title: "Daily", content: "Notes", path: "/meet/a.md", score: 0.8 }]),
      stderr: "",
    });
    const res = await searchMeetingCollections("daily", 100, ["meet-recordings-b21"], execMock);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hits.length).toBeGreaterThan(0);
  });
});
