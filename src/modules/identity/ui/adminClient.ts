/** Mirrors the API's `GuestListView`. */
export interface GuestList {
  hosts: { discordId: string; name: string; avatarUrl: string }[];
  guests: {
    discordId: string;
    name: string;
    avatarUrl: string;
    label: string | null;
    isAdmin: boolean;
    addedAt: string;
    hasSignedIn: boolean;
  }[];
  requests: {
    discordId: string;
    name: string;
    avatarUrl: string;
    username: string;
    requestedAt: string;
  }[];
}

/**
 * Every admin call answers with the guest list as it now stands, or with a
 * sentence to show. A refusal is an answer, not a thrown error, so the page
 * never loses what it was showing.
 */
export type AdminResult = { ok: true; list: GuestList } | { ok: false; message: string };

async function send(path: string, init: RequestInit = {}): Promise<AdminResult> {
  try {
    const response = await fetch(path, init);
    if (response.ok) return { ok: true, list: (await response.json()) as GuestList };
    const problem = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    return {
      ok: false,
      message:
        typeof problem?.detail === "string" ? problem.detail : "That didn't work. Try again.",
    };
  } catch {
    return { ok: false, message: "The room isn't answering. Try again in a moment." };
  }
}

export function loadGuestList(): Promise<AdminResult> {
  return send("/api/admin/guests");
}

/** Approving a request and adding by id are the same call. */
export function addGuest(discordId: string, label: string | null): Promise<AdminResult> {
  return send("/api/admin/guests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ discordId, label }),
  });
}

export function setGuestAdmin(discordId: string, isAdmin: boolean): Promise<AdminResult> {
  return send(`/api/admin/guests/${encodeURIComponent(discordId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isAdmin }),
  });
}

export function removeGuest(discordId: string): Promise<AdminResult> {
  return send(`/api/admin/guests/${encodeURIComponent(discordId)}`, { method: "DELETE" });
}

export function declineRequest(discordId: string): Promise<AdminResult> {
  return send(`/api/admin/requests/${encodeURIComponent(discordId)}`, { method: "DELETE" });
}
