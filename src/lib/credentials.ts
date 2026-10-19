import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/security/password";
import type { LoginInput } from "@/lib/validation/auth";

export async function authenticateCredentials(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordHash = user?.passwordHash ?? "$2a$12$invalidsaltinvalidsaltinvalidsalt.";
  const valid = await verifyPassword(input.password, passwordHash);

  if (!user || !valid || user.status === "BANNED" || user.status === "SUSPENDED") {
    return null;
  }
  return user;
}
