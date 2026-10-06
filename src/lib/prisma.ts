import { PrismaClient } from "@prisma/client";
import { DEFAULT_CONTACT_RULES, sanitizePublicText, type ContactRules } from "@/lib/contact-guard";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const base = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

async function loadContactRules(): Promise<ContactRules> {
  const row = await base.siteSetting.findUnique({ where: { key: "contact-rules" } }).catch(() => null);
  const value = (row?.value ?? {}) as Partial<ContactRules>;
  return {
    enabled: value.enabled ?? DEFAULT_CONTACT_RULES.enabled,
    minDigits: typeof value.minDigits === "number" && value.minDigits >= 6 ? value.minDigits : DEFAULT_CONTACT_RULES.minDigits,
    extraPatterns: Array.isArray(value.extraPatterns) ? value.extraPatterns.filter((p): p is string => typeof p === "string").slice(0, 50) : [],
  };
}

const PUBLIC_TEXT_FIELDS = ["title", "name", "description"] as const;
const OWNER_FIELDS = ["sellerId", "providerId", "ownerId"] as const;

// Every write path to public marketplace content goes through here, so editing a listing later cannot bypass the guard.
async function sanitizeData(model: string, data: unknown) {
  if (!data || typeof data !== "object") return;
  const record = data as Record<string, unknown>;
  const rules = await loadContactRules();
  const kinds = new Set<string>();
  for (const field of PUBLIC_TEXT_FIELDS) {
    const value = record[field];
    const text = typeof value === "string" ? value : value && typeof value === "object" && "set" in value ? (value as { set: unknown }).set : undefined;
    if (typeof text !== "string") continue;
    const result = sanitizePublicText(text, rules);
    if (!result.changed) continue;
    record[field] = result.text;
    result.kinds.forEach((kind) => kinds.add(kind));
  }
  const ownerId = OWNER_FIELDS.map((field) => record[field]).find((value) => typeof value === "string") as string | undefined;
  if (kinds.size && ownerId) {
    await base.contactViolation.create({ data: { userId: ownerId, surface: model, kinds: [...kinds] } }).catch(() => null);
  }
}

const guarded = base.$extends({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        if (["Listing", "ServiceListing", "PropertyListing", "Shop", "ShopProduct"].includes(model)) await sanitizeData(model, args.data);
        return query(args);
      },
      async update({ model, args, query }) {
        if (["Listing", "ServiceListing", "PropertyListing", "Shop", "ShopProduct"].includes(model)) await sanitizeData(model, args.data);
        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;

export const prisma = globalForPrisma.prisma ?? guarded;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
