import { z } from "zod";

export const createShopSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(5000),
  address: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  website: z.string().trim().url().optional().or(z.literal("")),
  logoUrl: z.string().startsWith("/uploads/").optional().or(z.literal("")),
  coverUrl: z.string().startsWith("/uploads/").optional().or(z.literal("")),
});

export const shopUpdateSchema = createShopSchema.partial();
