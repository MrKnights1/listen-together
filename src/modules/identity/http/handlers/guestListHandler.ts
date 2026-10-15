import { contained } from "@/shared/http/contained.ts";
import type { GetGuestList } from "@/modules/identity/application/GetGuestList.ts";
import { toGuestListView } from "../adminViews.ts";
import { requireAdmin, type AdminGate } from "../requireAdmin.ts";

export interface GuestListDependencies extends AdminGate {
  getGuestList: GetGuestList;
}

/** `GET /api/admin/guests` — the hosts, the guests, and who is waiting to join. */
export function guestListHandler(deps: GuestListDependencies) {
  return contained("Reading the guest list", async function GET(request: Request) {
    const admin = await requireAdmin(request, deps, { changes: false });
    if ("response" in admin) return admin.response;
    return Response.json(toGuestListView(await deps.getGuestList.execute()));
  });
}
