import { z } from "zod";

export const shopProductSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(2000),
  priceRand: z.coerce.number().min(0).max(100_000_000),
  categoryId: z.string().cuid().optional().or(z.literal("")),
  stockQuantity: z.coerce.number().int().min(0).max(100_000).optional(),
  isFeatured: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  imageUrls: z.array(z.string().startsWith("/uploads/")).max(10).default([]),
});

export const shopProductUpdateSchema = shopProductSchema.partial();
