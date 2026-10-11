import NextAuth, { Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/security/password";
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

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        // Always run the compare to reduce timing-based user enumeration.
        const passwordHash = user?.passwordHash ?? "$2a$12$invalidsaltinvalidsaltinvalidsalt.";
        const valid = await verifyPassword(parsed.data.password, passwordHash);

        if (!user || !valid) return null;
        if (user.status === "BANNED" || user.status === "SUSPENDED") return null;

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

// Central session gate. NextAuth's own `auth()` still returns a `user` object for a held
// or deleted account (the `jwt` callback only tombstones the token, leaving `session.user`
// intact minus its `id`), which made ~40 routes pass `undefined` into Prisma and 500. We
// return `undefined` for any account that is not ACTIVE so every `await auth()` caller
// sees a coherent "not signed in" instead of a half-built session.
export async function auth() {
  const session = await nextAuthAuth();
  if (!session?.user?.id) {
    console.log("auth wrapper: missing session user id");
    return undefined;
  }
  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!account || account.status !== "ACTIVE") {
    console.log(`auth wrapper: account ${session.user.id} not active:`, account?.status);
    return undefined;
  }
  return session;
}
