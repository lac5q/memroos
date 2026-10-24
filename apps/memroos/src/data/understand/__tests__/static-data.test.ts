// @vitest-environment node
import { describe, expect, it } from "vitest";
import config from "../config.json";
import knowledgeGraph from "../knowledge-graph.json";
import meta from "../meta.json";

describe("understand static data", () => {
  it("loads config.json", () => {
    expect(config).toBeTruthy();
    expect(typeof config).toBe("object");
  });

  it("loads knowledge-graph.json", () => {
    expect(knowledgeGraph).toBeTruthy();
    expect(typeof knowledgeGraph).toBe("object");
  });

  it("loads meta.json", () => {
    expect(meta).toBeTruthy();
    expect(typeof meta).toBe("object");
  });
});
