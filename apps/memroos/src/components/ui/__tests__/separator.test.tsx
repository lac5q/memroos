import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { Separator } from "../separator";

describe("Separator", () => {
  it("renders horizontal separator slot", () => {
    const { container } = render(<Separator className="my-2" />);
    expect(container.querySelector('[data-slot="separator"]')).toBeTruthy();
  });

  it("renders vertical orientation", () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect(container.querySelector('[data-slot="separator"]')).toBeTruthy();
  });
});
