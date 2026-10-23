import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import Loading from "../loading";

describe("Loading", () => {
  it("renders skeleton pulse placeholders", () => {
    const { container } = render(<Loading />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});
