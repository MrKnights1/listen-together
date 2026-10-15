/**
 * Development only: Bun bundles these HTML imports on demand. Production never
 * loads this file — nginx serves the prebuilt pages from `dist/public`.
 */
import adminPage from "@/app/admin/admin.html";
import loginPage from "@/app/login/login.html";
import roomPage from "@/app/room/room.html";

export const pages = {
  "/": roomPage,
  "/login": loginPage,
  "/admin": adminPage,
};
