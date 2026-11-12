import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CalendarHeatmap } from "../calendar-heatmap";

describe("CalendarHeatmap", () => {
  it("renders 90-day activity heading", () => {
    render(<CalendarHeatmap entries={[]} />);
    expect(screen.getByText("Activity — Last 90 Days")).toBeInTheDocument();
  });

  it("renders 90 day cells with entry counts in titles", () => {
    const today = new Date().toISOString().slice(0, 10);
    const { container } = render(
      <CalendarHeatmap entries={[{ timestamp: `${today}T12:00:00.000Z` }]} />,
    );
    const cells = container.querySelectorAll("[title]");
    expect(cells.length).toBe(90);
    expect(Array.from(cells).some((el) => el.getAttribute("title")?.includes("1 entry"))).toBe(true);
  });
});
