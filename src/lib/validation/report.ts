import { z } from "zod";

export const reportSchema = z.object({
  targetType: z.enum(["LISTING", "SHOP", "SERVICE", "PROPERTY", "USER"]),
  targetId: z.string().cuid(),
  reason: z.string().trim().min(3).max(120),
  details: z.string().trim().max(2000).optional(),
});

export const reportUpdateSchema = z.object({
  status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"]),
});
