import { contained } from "@/shared/http/contained.ts";
import {
  badRequest,
  conflict,
  unprocessable,
  unsupportedMediaType,
} from "@/shared/http/httpErrors.ts";
import type { AddGuest } from "@/modules/identity/application/AddGuest.ts";
import { GUEST_LABEL_MAX_LENGTH } from "@/modules/identity/domain/Guest.ts";
import { toGuestListView } from "../adminViews.ts";
import { requireAdmin } from "../requireAdmin.ts";
import type { GuestListDependencies } from "./guestListHandler.ts";

export interface AddGuestDependencies extends GuestListDependencies {
  addGuest: AddGuest;
}

function readBody(body: unknown): { discordId: string; label: string | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const { discordId, label } = body as Record<string, unknown>;
  if (typeof discordId !== "string") return null;
  if (label !== undefined && label !== null && typeof label !== "string") return null;
  return { discordId, label: label ?? null };
}

/**
 * `POST /api/admin/guests` — lets somebody in, whether approving their request
 * or typing their id. Answers with the guest list as it now stands.
 */
export function addGuestHandler(deps: AddGuestDependencies) {
  return contained("Adding a guest", async function POST(request: Request) {
    const admin = await requireAdmin(request, deps, { changes: true });
    if ("response" in admin) return admin.response;

    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
      return unsupportedMediaType("Send the guest as JSON.");
    }
    const body = readBody(await request.json().catch(() => null));
    if (body === null) return badRequest("Expected a discordId, and optionally a label.");

    const outcome = await deps.addGuest.execute(admin.user.discordId, body.discordId, body.label);
    switch (outcome) {
      case "added":
        return Response.json(toGuestListView(await deps.getGuestList.execute()), { status: 201 });
      case "invalid_id":
        return unprocessable("A Discord user ID is a number 17 to 20 digits long.");
      case "invalid_label":
        return unprocessable(`A name can be at most ${GUEST_LABEL_MAX_LENGTH} characters.`);
      case "already_host":
        return conflict("That is a host: hosts are always let in.");
      case "already_guest":
        return conflict("They are already on the guest list.");
    }
  });
}
