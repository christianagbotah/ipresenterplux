import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login"
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = Boolean(auth?.user);
      const onLogin = nextUrl.pathname === "/login";

      if (onLogin && loggedIn) {
        return Response.redirect(new URL("/", nextUrl));
      }

      if (onLogin) return true;
      return loggedIn;
    }
  },
  providers: []
} satisfies NextAuthConfig;
