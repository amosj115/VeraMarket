import { z } from "zod";

export const createPropertySchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  listingType: z.enum(["FOR_SALE", "FOR_RENT"]),
  propertyType: z.enum(["HOUSE", "APARTMENT", "ROOM", "LAND", "COMMERCIAL", "OFFICE", "SHOP_PREMISES", "INDUSTRIAL", "OTHER"]),
  priceRand: z.coerce.number().min(0),
  bedrooms: z.coerce.number().int().min(0).max(100).optional(),
  bathrooms: z.coerce.number().int().min(0).max(100).optional(),
  parkingSpaces: z.coerce.number().int().min(0).max(100).optional(),
  floorAreaSqm: z.coerce.number().min(0).optional(),
  landSizeSqm: z.coerce.number().min(0).optional(),
  location: z.string().trim().min(2).max(160),
});
