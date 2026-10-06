import { z } from "zod";

export const serviceUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(10).max(5000).optional(),
  pricingType: z.enum(["FIXED", "HOURLY", "DAILY", "QUOTE"]).optional(),
  priceRand: z.coerce.number().min(0).optional(),
  serviceArea: z.string().trim().min(2).max(160).optional(),
  location: z.string().trim().min(2).max(120).optional(),
});
