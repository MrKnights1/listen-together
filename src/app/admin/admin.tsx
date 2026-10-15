import { createRoot } from "react-dom/client";
import { AdminPage, loadSession } from "@/modules/identity/ui/index.ts";

const container = document.getElementById("root");
if (container === null) throw new Error("The admin page is missing its #root element.");

const session = await loadSession();

if (session.status === "signed-out") window.location.replace("/login");
else if (session.status === "not-allowed") window.location.replace("/login?error=removed");
else if (session.status === "unreachable") {
  createRoot(container).render(
    <p className="notice" role="alert">
      The room isn&apos;t answering. Reload the page in a moment.
    </p>,
  );
} else {
  createRoot(container).render(<AdminPage me={session.user} />);
}
