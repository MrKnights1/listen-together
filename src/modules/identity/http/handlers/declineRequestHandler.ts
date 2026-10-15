import { contained } from "@/shared/http/contained.ts";
import { notFound } from "@/shared/http/httpErrors.ts";
import type { DeclineAccessRequest } from "@/modules/identity/application/DeclineAccessRequest.ts";
import { toGuestListView } from "../adminViews.ts";
import { requireAdmin, type DiscordIdRequest } from "../requireAdmin.ts";
import type { GuestListDependencies } from "./guestListHandler.ts";

export interface DeclineRequestDependencies extends GuestListDependencies {
  declineAccessRequest: DeclineAccessRequest;
}

/** `DELETE /api/admin/requests/:discordId` — turns down somebody waiting to join. */
export function declineRequestHandler(deps: DeclineRequestDependencies) {
  return contained("Declining a request", async function DELETE(request: DiscordIdRequest) {
    const admin = await requireAdmin(request, deps, { changes: true });
    if ("response" in admin) return admin.response;

    return (await deps.declineAccessRequest.execute(request.params.discordId)) === "declined"
      ? Response.json(toGuestListView(await deps.getGuestList.execute()))
      : notFound("Nobody with that id is waiting to join.");
  });
}
