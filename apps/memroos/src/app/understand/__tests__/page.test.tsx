import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import UnderstandPage from "../page";

describe("UnderstandPage", () => {
  it("embeds static graph without token", async () => {
    const ui = await UnderstandPage({ searchParams: Promise.resolve({}) });
    render(ui);
    const frame = screen.getByTitle("MemRoOS Understand graph");
    expect(frame).toHaveAttribute("src", "/understand-static/index.html");
  });

  it("passes encoded token to iframe src", async () => {
    const ui = await UnderstandPage({
      searchParams: Promise.resolve({ token: "abc/def" }),
    });
    render(ui);
    expect(screen.getByTitle("MemRoOS Understand graph")).toHaveAttribute(
      "src",
      "/understand-static/index.html?token=abc%2Fdef",
    );
  });
});
