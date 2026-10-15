import type { Prisma } from "@prisma/client";

/** Public service content also requires its provider account to remain active. */
export function publicServiceWhere(): Prisma.ServiceListingWhereInput {
  return {
    status: "ACTIVE",
    provider: { is: { status: "ACTIVE" } },
  };
}

/** Public property content also requires its owner's account to remain active. */
export function publicPropertyWhere(): Prisma.PropertyListingWhereInput {
  return {
    status: "ACTIVE",
    owner: { is: { status: "ACTIVE" } },
  };
}
