import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login"
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const loggedIn = Boolean(auth?.user);
      const onLogin = nextUrl.pathname === "/login";
      const publicAudience = nextUrl.pathname === "/live" || nextUrl.pathname.startsWith("/live/");

      if (onLogin && loggedIn) {
        return Response.redirect(new URL("/", nextUrl));
      }

      if (onLogin || publicAudience) return true;
      return loggedIn;
    }
  },
  providers: []
} satisfies NextAuthConfig;
