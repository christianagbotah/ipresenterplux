import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    forcePasswordChange?: boolean;
  }

  interface Session {
    user: {
      id: string;
      forcePasswordChange: boolean;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    forcePasswordChange?: boolean;
  }
}
