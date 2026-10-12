import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/security/password";
import { registerErrorMessage, registerSchema } from "@/lib/validation/auth";
import { hashEmailSecure, hashEmailLegacy } from "@/lib/account-security";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again in a minute." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: registerErrorMessage(parsed.error) },
      { status: 400 }
    );
  }

  const { displayName, username, email, password } = parsed.data;

  try {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      const field = existing.email === email ? "email" : "username";
      return NextResponse.json(
        { error: `That ${field} is already in use.` },
        { status: 409 }
      );
    }

    // Repeat-offender check: check for HMAC match or legacy SHA-256 match.
    const secret = process.env.AUTH_SECRET || process.env.DELETED_ACCOUNT_HASH_SECRET;
    if (!secret) {
      console.error("[register] Hashing secret not configured. New accounts will be flagged for review by default.");
    }

    const hmac = secret ? hashEmailSecure(email, secret) : null;
    const legacy = hashEmailLegacy(email);

    let flaggedForReview = false;

    if (!secret) {
      // Safety fallback: If we can't run repeat-offender detection, the account must be reviewed.
      flaggedForReview = true;
    } else if (hmac) {
      const record = await prisma.deletedAccountRecord.findUnique({ where: { emailHash: hmac } });
      if (record) flaggedForReview = true;
    }

    if (!flaggedForReview) {
      const legacyRecord = await prisma.deletedAccountRecord.findUnique({ where: { emailHash: legacy } });
      if (legacyRecord) {
        flaggedForReview = true;
        // Migration: Convert legacy hash to HMAC.
        if (hmac) {
          await prisma.deletedAccountRecord.update({
            where: { id: legacyRecord.id },
            data: { emailHash: hmac },
          });
        }
      }
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        displayName,
        username,
        email,
        passwordHash,
        flaggedForReview,
      },
      select: { id: true, email: true, username: true },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = error.meta?.target;
      const targetName = Array.isArray(target)
        ? target.join(" ")
        : typeof target === "string"
          ? target
          : "";
      const field = /email/i.test(targetName)
        ? "email"
        : /username/i.test(targetName)
          ? "username"
          : "details";
      return NextResponse.json(
        {
          error:
            field === "details"
              ? "Those registration details are already in use."
              : `That ${field} is already in use.`,
        },
        { status: 409 }
      );
    }

    console.error("[register] account creation failed", error);
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again." },
      { status: 500 }
    );
  }
}
