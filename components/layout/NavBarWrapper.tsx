import { getSessionUser } from "@/lib/auth";
import NavBar from "./NavBar";

export default async function NavBarWrapper() {
  const user = await getSessionUser();
  return <NavBar isEditor={!!user} />;
}
