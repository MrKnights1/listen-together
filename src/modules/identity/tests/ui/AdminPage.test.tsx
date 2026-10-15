import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AddGuestForm,
  AdminList,
  AdminPage,
  GuestRows,
  RequestList,
} from "@/modules/identity/ui/AdminPage.tsx";
import type { GuestList } from "@/modules/identity/ui/adminClient.ts";

const noop = () => undefined;
const AVATAR = "https://cdn.discordapp.com/embed/avatars/1.png";
const ME = { id: "user-ada", name: "Ada", avatarUrl: AVATAR, isAdmin: true };

const BOB_REQUEST: GuestList["requests"][number] = {
  discordId: "123456789012345678",
  name: "Bob",
  avatarUrl: AVATAR,
  username: "bob",
  requestedAt: "2026-10-15T10:00:00.000Z",
};

const CY_GUEST: GuestList["guests"][number] = {
  discordId: "333333333333333333",
  name: "Cy",
  avatarUrl: AVATAR,
  label: "Cy",
  isAdmin: false,
  addedAt: "2026-10-15T10:00:00.000Z",
  hasSignedIn: false,
};

describe("AdminPage", () => {
  test("turns away somebody who is not a host, without showing the guest list", () => {
    const html = renderToStaticMarkup(<AdminPage me={{ ...ME, isAdmin: false }} />);

    expect(html).toContain("Only admins can manage guests.");
    expect(html).not.toContain("Waiting to join");
  });

  test("shows a host the page, with a way back to the room", () => {
    const html = renderToStaticMarkup(<AdminPage me={ME} />);

    expect(html).toContain("Who may join");
    expect(html).toContain('href="/"');
    expect(html).toContain("Loading the guest list");
  });
});

describe("RequestList", () => {
  test("names each person waiting, and labels both buttons with their name", () => {
    const html = renderToStaticMarkup(
      <RequestList requests={[BOB_REQUEST]} onApprove={noop} onDecline={noop} />,
    );

    expect(html).toContain("Bob");
    expect(html).toContain("@bob");
    expect(html).toContain('aria-label="Approve Bob"');
    expect(html).toContain('aria-label="Decline Bob"');
    expect(html).toContain('dateTime="2026-10-15T10:00:00.000Z"');
  });

  test("explains how people come to wait, when nobody is", () => {
    expect(
      renderToStaticMarkup(<RequestList requests={[]} onApprove={noop} onDecline={noop} />),
    ).toContain("When a friend signs in with Discord");
  });
});

describe("GuestRows", () => {
  test("lists a guest with a named Remove button, and says when they have not signed in yet", () => {
    const html = renderToStaticMarkup(
      <GuestRows guests={[CY_GUEST]} onMakeAdmin={noop} onRemove={noop} />,
    );

    expect(html).toContain("Cy");
    expect(html).toContain('aria-label="Remove Cy"');
    expect(html).toContain('aria-label="Make Cy an admin"');
    expect(html).toContain("not signed in yet");
  });

  test("shows the host's name for a guest beside their Discord name when they differ", () => {
    const html = renderToStaticMarkup(
      <GuestRows
        guests={[{ ...CY_GUEST, name: "cyberia", label: "Cy from work", hasSignedIn: true }]}
        onMakeAdmin={noop}
        onRemove={noop}
      />,
    );

    expect(html).toContain("cyberia");
    expect(html).toContain("Cy from work");
    expect(html).not.toContain("not signed in yet");
  });

  test("invites adding somebody when there are no guests", () => {
    expect(
      renderToStaticMarkup(<GuestRows guests={[]} onMakeAdmin={noop} onRemove={noop} />),
    ).toContain("No guests yet");
  });
});

describe("AddGuestForm", () => {
  test("labels both boxes, explains where an id comes from, and announces its result", () => {
    const html = renderToStaticMarkup(<AddGuestForm onAdd={async () => null} />);

    expect(html).toContain('for="guest-id"');
    expect(html).toContain('for="guest-label"');
    expect(html).toContain('aria-describedby="guest-id-hint"');
    expect(html).toContain("Copy User ID");
    expect(html).toContain('role="status"');
  });
});

describe("AdminList", () => {
  test("lists the hosts with no buttons: they are set on the server", () => {
    const html = renderToStaticMarkup(
      <AdminList
        hosts={[{ discordId: "80351110224678912", name: "Ada", avatarUrl: AVATAR }]}
        admins={[]}
        onRemoveAdmin={noop}
      />,
    );

    expect(html).toContain("Ada");
    expect(html).toContain("set on the server");
    expect(html).not.toContain("<button");
  });

  test("lets a guest made admin be made a plain guest again, naming them on the button", () => {
    const html = renderToStaticMarkup(
      <AdminList hosts={[]} admins={[{ ...CY_GUEST, isAdmin: true }]} onRemoveAdmin={noop} />,
    );

    expect(html).toContain('aria-label="Remove admin rights from Cy"');
  });
});
