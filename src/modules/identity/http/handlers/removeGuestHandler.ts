import { contained } from "@/shared/http/contained.ts";
import { conflict, notFound } from "@/shared/http/httpErrors.ts";
import type { RemoveGuest } from "@/modules/identity/application/RemoveGuest.ts";
import { toGuestListView } from "../adminViews.ts";
import { requireAdmin, type DiscordIdRequest } from "../requireAdmin.ts";
import type { GuestListDependencies } from "./guestListHandler.ts";

export interface RemoveGuestDependencies extends GuestListDependencies {
  removeGuest: RemoveGuest;
}

/** `DELETE /api/admin/guests/:discordId` — takes a guest off the list and ends what they have open. */
export function removeGuestHandler(deps: RemoveGuestDependencies) {
  return contained("Removing a guest", async function DELETE(request: DiscordIdRequest) {
    const admin = await requireAdmin(request, deps, { changes: true });
    if ("response" in admin) return admin.response;

    switch (await deps.removeGuest.execute(request.params.discordId)) {
      case "removed":
        return Response.json(toGuestListView(await deps.getGuestList.execute()));
      case "not_found":
        return notFound("They are not on the guest list.");
      case "is_host":
        return conflict("Hosts are set on the server and cannot be removed here.");
    }
  });
}
