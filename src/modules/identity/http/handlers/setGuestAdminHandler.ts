import { contained } from "@/shared/http/contained.ts";
import { badRequest, conflict, notFound, unsupportedMediaType } from "@/shared/http/httpErrors.ts";
import type { SetGuestAdmin } from "@/modules/identity/application/SetGuestAdmin.ts";
import { toGuestListView } from "../adminViews.ts";
import { requireAdmin, type DiscordIdRequest } from "../requireAdmin.ts";
import type { GuestListDependencies } from "./guestListHandler.ts";

export interface SetGuestAdminDependencies extends GuestListDependencies {
  setGuestAdmin: SetGuestAdmin;
}

/** `PATCH /api/admin/guests/:discordId` `{ isAdmin }` — makes a guest an admin, or a guest again. */
export function setGuestAdminHandler(deps: SetGuestAdminDependencies) {
  return contained("Changing a guest's role", async function PATCH(request: DiscordIdRequest) {
    const admin = await requireAdmin(request, deps, { changes: true });
    if ("response" in admin) return admin.response;

    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
      return unsupportedMediaType("Send the change as JSON.");
    }
    const body = (await request.json().catch(() => null)) as { isAdmin?: unknown } | null;
    if (typeof body?.isAdmin !== "boolean") return badRequest("Expected isAdmin, true or false.");

    switch (await deps.setGuestAdmin.execute(request.params.discordId, body.isAdmin)) {
      case "updated":
        return Response.json(toGuestListView(await deps.getGuestList.execute()));
      case "not_found":
        return notFound("They are not on the guest list.");
      case "is_host":
        return conflict("Hosts are set on the server and are always admins.");
    }
  });
}
