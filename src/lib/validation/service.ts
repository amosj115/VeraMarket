import { z } from "zod";

export const createServiceSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  categoryId: z.string().cuid(),
  pricingType: z.enum(["FIXED", "HOURLY", "DAILY", "QUOTE"]),
  priceRand: z.coerce.number().min(0).optional(),
  serviceArea: z.string().trim().min(2).max(160),
  location: z.string().trim().min(2).max(120),
});
