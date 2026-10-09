import type { NextAuthConfig } from "next-auth";

function publicOrigin(nextUrl: URL) {
  const configured = process.env.IPRESENTERPLUX_PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.origin;
    } catch {
      // Invalid deployment configuration falls back to the request origin for local development.
    }
  }
  return nextUrl.origin;
}

export function buildLoginRedirect(nextUrl: URL) {
  const loginUrl = new URL("/login", publicOrigin(nextUrl));
  loginUrl.searchParams.set("callbackUrl", `${nextUrl.pathname}${nextUrl.search}` || "/");
  return loginUrl;
}

function buildHomeRedirect(nextUrl: URL) {
  return new URL("/", publicOrigin(nextUrl));
}

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
        return Response.redirect(buildHomeRedirect(nextUrl));
      }

      if (onLogin || publicAudience) return true;
      if (!loggedIn) return Response.redirect(buildLoginRedirect(nextUrl));
      return true;
    }
  },
  providers: []
} satisfies NextAuthConfig;
