import { z } from "zod";

export const listingUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(10).max(5000).optional(),
  priceRand: z.coerce.number().min(0).max(100_000_000).optional(),
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "FOR_PARTS"]).optional(),
  location: z.string().trim().min(2).max(120).optional(),
  status: z.enum(["SOLD", "REMOVED"]).optional(),
});
