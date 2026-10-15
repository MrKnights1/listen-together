import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LOGIN_FAILURE_REASONS } from "@/modules/identity/http/handlers/discordCallbackHandler.ts";
import { LoginPage } from "@/modules/identity/ui/LoginPage.tsx";

const markup = (error: string | null = null) => renderToStaticMarkup(<LoginPage error={error} />);

describe("LoginPage", () => {
  test("offers the Discord sign-in as a real link, so it works before scripts finish", () => {
    expect(markup()).toContain('href="/api/auth/discord/start"');
  });

  test("names the room beside its mark", () => {
    const html = markup();

    expect(html).toContain('class="login__mark"');
    expect(html).toContain("<h1");
    expect(html).toContain("Listening room");
  });

  test("says nothing about failure when there was none", () => {
    expect(markup()).not.toContain('role="alert"');
  });

  test("explains being turned away, and what to do about it", () => {
    expect(markup("not_allowed")).toContain("not on this room&#x27;s guest list yet");
    expect(markup("not_allowed")).toContain("The admins have been asked to let you in");
    expect(markup("removed")).toContain("no longer on this room&#x27;s guest list");
  });

  test("never shows a raw reason code for any reason the server can send", () => {
    for (const reason of LOGIN_FAILURE_REASONS) {
      const html = markup(reason);
      expect(html).toContain('role="alert"');
      expect(html).not.toContain(reason);
    }
  });

  test("falls back to the generic line for an unrecognised reason", () => {
    expect(markup("something_new")).toContain("Discord sign-in didn");
    expect(markup("something_new")).not.toContain("something_new");
  });
});
