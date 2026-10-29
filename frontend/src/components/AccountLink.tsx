"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

/** "Log in" for visitors, "My profile" once logged in. */
export function AccountLink({
  logIn,
  myProfile,
  className,
}: {
  logIn: string;
  myProfile: string;
  className: string;
}) {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    api("/me")
      .then(() => setLoggedIn(true))
      .catch(() => setLoggedIn(false));
  }, []);

  return (
    <Link href={loggedIn ? "/profile" : "/login"} className={className}>
      {loggedIn ? myProfile : logIn}
    </Link>
  );
}
