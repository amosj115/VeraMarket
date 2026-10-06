import { z } from "zod";

export const boostSchema = z
  .object({
    targetType: z.enum(["LISTING", "SHOP", "SERVICE", "PROPERTY"]),
    targetId: z.string().cuid(),
    duration: z.enum(["ONE_DAY", "THREE_DAYS", "SEVEN_DAYS", "THIRTY_DAYS"]).optional(),
    packageId: z.string().cuid().optional(),
  })
  .refine((value) => value.duration || value.packageId, { message: "Choose a boost package" });