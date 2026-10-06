import { z } from "zod";

export const propertyUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(10).max(5000).optional(),
  listingType: z.enum(["FOR_SALE", "FOR_RENT"]).optional(),
  propertyType: z.enum(["HOUSE", "APARTMENT", "ROOM", "LAND", "COMMERCIAL", "OFFICE", "SHOP_PREMISES", "INDUSTRIAL", "OTHER"]).optional(),
  priceRand: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(100).nullable().optional(),
  bathrooms: z.coerce.number().int().min(0).max(100).nullable().optional(),
  parkingSpaces: z.coerce.number().int().min(0).max(100).nullable().optional(),
  floorAreaSqm: z.coerce.number().min(0).nullable().optional(),
  landSizeSqm: z.coerce.number().min(0).nullable().optional(),
  location: z.string().trim().min(2).max(160).optional(),
});
