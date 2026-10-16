import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog.tsx";

const noop = () => undefined;

function render(): string {
  return renderToStaticMarkup(
    <ConfirmDialog
      title="Clear the queue?"
      message="This removes all 3 songs."
      confirmLabel="Clear queue"
      cancelLabel="Keep songs"
      onConfirm={noop}
      onCancel={noop}
    />,
  );
}

describe("ConfirmDialog", () => {
  test("asks its question in the browser's own dialog, named by its title", () => {
    const html = render();
    const labelledBy = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];

    expect(labelledBy).toBeDefined();
    expect(html).toContain(`<h2 id="${labelledBy}" class="dialog__title">Clear the queue?</h2>`);
    expect(html).toContain("This removes all 3 songs.");
  });

  test("offers to keep things first, and marks the answer that cannot be undone", () => {
    const html = render();

    expect(html.indexOf("Keep songs")).toBeLessThan(html.indexOf("Clear queue"));
    expect(html).toContain(
      '<button type="button" class="button button--danger">Clear queue</button>',
    );
  });

  /** Shown with `showModal()` once mounted; rendered open, it would sit in the page, not over it. */
  test("is not rendered open", () => {
    expect(render()).not.toMatch(/<dialog[^>]* open/);
  });
});
