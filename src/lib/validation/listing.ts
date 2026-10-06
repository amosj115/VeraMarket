import { z } from "zod";

export const listingConditions = [
  "NEW",
  "LIKE_NEW",
  "GOOD",
  "FAIR",
  "FOR_PARTS",
] as const;

export const createListingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  priceRand: z.coerce.number().min(0).max(100_000_000),
  categoryId: z.string().cuid(),
  condition: z.enum(listingConditions),
  location: z.string().trim().min(2).max(120),
  imageUrls: z.array(z.string()).min(1, "Add at least one photo").max(10),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
