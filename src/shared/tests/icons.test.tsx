import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark } from "@/shared/ui/BrandMark.tsx";
import { Icon, ICON_NAMES } from "@/shared/ui/Icon.tsx";

describe("Icon", () => {
  test("has icons to draw", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(0);
  });

  test("draws every icon as decoration, hidden from assistive technology", () => {
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(<Icon name={name} />);

      expect(html).toStartWith('<svg class="icon"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toMatch(/<(path|rect|circle)/);
    }
  });

  test("keeps its own class beside any it is given", () => {
    expect(renderToStaticMarkup(<Icon name="spinner" className="banner__spinner" />)).toContain(
      'class="icon banner__spinner"',
    );
  });

  test("fills the star of a starred song, so a star shows without words", () => {
    expect(renderToStaticMarkup(<Icon name="star-filled" />)).toContain('fill="currentColor"');
    expect(renderToStaticMarkup(<Icon name="star" />)).not.toContain('fill="currentColor"');
  });

  test("tells repeat-one apart from repeat, so the mode shows without words", () => {
    expect(renderToStaticMarkup(<Icon name="repeat-one" />)).not.toBe(
      renderToStaticMarkup(<Icon name="repeat" />),
    );
  });
});

describe("BrandMark", () => {
  test("is decoration: the room's name is always written beside it", () => {
    const html = renderToStaticMarkup(<BrandMark className="brand__mark" />);

    expect(html).toContain('class="brand__mark"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<circle/g)).toHaveLength(2);
  });
});
