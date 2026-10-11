import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      // `id` stays non-optional: `auth()` in src/auth.ts is the single session gate and
      // returns undefined unless the account is ACTIVE with a real id, so any code that
      // has a session is guaranteed a usable id.
      id: string;
      username: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    username?: string;
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username?: string;
    role?: string;
  }
}
