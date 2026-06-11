import { getSessionUser } from "@/lib/auth";
import SessionClaimer from "./SessionClaimer";

// Renders the post-login session claimer only for signed-in users, so anonymous
// visitors never hit the authenticated claim endpoint (issue #96).
export default async function SessionSync() {
  const user = await getSessionUser();
  if (!user) return null;
  return <SessionClaimer />;
}
