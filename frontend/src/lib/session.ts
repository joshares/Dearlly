import { cookies } from "next/headers";

import { LOGIN_HINT } from "@/lib/api";

/**
 * Read on the server before a page is drawn, so logged-in people never see a flash of
 * "Log in". It's only a hint for the look of the page: every action is still checked by the API.
 */
export async function seemsLoggedIn(): Promise<boolean> {
  return (await cookies()).get(LOGIN_HINT)?.value === "1";
}
