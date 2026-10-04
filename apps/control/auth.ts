import crypto from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { query } from "@/lib/db";
import { hashIdentifier, verifyPassword } from "@/lib/security";

const credentialSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200)
});

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  secret:
    process.env.AUTH_SECRET ??
    crypto.createHash("sha256").update("ipresenterplux-auth-v1|" + (process.env.DATABASE_URL ?? "local")).digest("base64url"),
  session: {
    strategy: "jwt",
    maxAge: 12 * 60 * 60
  },
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = credentialSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();
        const emailHash = hashIdentifier(email);
        const forwarded = request.headers.get("x-forwarded-for");
        const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
        const ipHash = hashIdentifier(ip);

        const recentFailures = await query<{ failures: number }>(
          `select count(*)::int as failures
           from auth_login_attempts
           where email_hash=$1
             and success=false
             and created_at > now() - interval '15 minutes'`,
          [emailHash]
        );

        if ((recentFailures.rows[0]?.failures ?? 0) >= 10) {
          return null;
        }

        const users = await query<{
          id: string;
          email: string;
          display_name: string;
          password_hash: string | null;
          status: string;
          force_password_change: boolean;
        }>(
          `select id,email,display_name,password_hash,status,force_password_change
           from users
           where lower(email)=lower($1)
           limit 1`,
          [email]
        );

        const user = users.rows[0];
        const valid =
          Boolean(user) &&
          user.status === "active" &&
          (await verifyPassword(parsed.data.password, user.password_hash));

        await query(
          "insert into auth_login_attempts(email_hash,ip_hash,success) values ($1,$2,$3)",
          [emailHash, ipHash, valid]
        );

        if (!valid || !user) return null;

        await query("update users set last_login_at=now(), updated_at=now() where id=$1", [user.id]);

        return {
          id: user.id,
          email: user.email,
          name: user.display_name,
          forcePasswordChange: user.force_password_change
        };
      }
    })
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.forcePasswordChange =
          "forcePasswordChange" in user ? Boolean(user.forcePasswordChange) : false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.forcePasswordChange = Boolean(token.forcePasswordChange);
      }
      return session;
    }
  }
});
