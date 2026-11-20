import NextAuth, { Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { authenticateCredentials } from "@/lib/credentials";
import { loginSchema } from "@/lib/validation/auth";

const nextAuth = NextAuth({
  trustHost:
    process.env.AUTH_TRUST_HOST === "true" ||
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV !== "production",
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await authenticateCredentials(parsed.data);
        if (!user) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          image: user.avatarUrl,
          username: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: stamp the claims from the freshly-authenticated user. `authorize`
      // has already rejected BANNED/SUSPENDED accounts, so no DB re-check is needed here.
      if (user) {
        token.id = user.id as string;
        token.username = (user as { username?: string }).username;
        token.role = (user as { role?: string }).role ?? "USER";
        return token;
      }

      // Every subsequent request re-reads the account status so an administrative hold or
      // a deletion takes effect immediately across all ~40 auth()-guarded routes, not just
      // at next login. We return a tombstoned token rather than `null`: in the NextAuth v5
      // beta, returning `null` leaves a null token on the session cookie that persists and
      // makes `session.user` read as empty even after a later successful re-login. A
      // tombstoned token still flows through `session` below, where the `session.user.id`
      // guard leaves the user unauthenticated. PUBLIC browsing never calls `auth()`, so
      // anonymous visitors are unaffected.
      if (token.id) {
        const account = await prisma.user.findUnique({ where: { id: token.id as string }, select: { status: true } });
        if (!account || account.status !== "ACTIVE") return { ...token, id: undefined };
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        if (session.user) {
          session.user.id = token.id as string;
          session.user.username = token.username as string;
          session.user.role = token.role as string;
        }
        } else {
          // Tombstoned token: ensure the session user is completely removed
          // so /api/auth/session reflects the unauthenticated state.
          delete (session as Partial<Session>).user;
        }
        return session;
    },
  },
});

const { handlers, signIn, signOut, auth: nextAuthAuth } = nextAuth;

export { handlers, signIn, signOut };

// The JWT callback checks account status on each session read and removes the id for
// held or deleted accounts. Keep callers from treating that tombstoned session as signed in.
export async function auth() {
  const session = await nextAuthAuth();
  return session?.user?.id ? session : undefined;
}
