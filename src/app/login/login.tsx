import { createRoot } from "react-dom/client";
import { LoginPage } from "@/modules/identity/ui/index.ts";

const container = document.getElementById("root");
if (container === null) throw new Error("The login page is missing its #root element.");

const error = new URLSearchParams(window.location.search).get("error");

createRoot(container).render(<LoginPage error={error} />);
