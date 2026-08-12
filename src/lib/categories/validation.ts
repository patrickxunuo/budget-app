import { z } from "zod";
export const scopeSchema = z.enum(["family", "personal"]);
export const uuidSchema = z.string().uuid();
export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((v) => v.toUpperCase());
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((v) => v.replace(/\s+/g, " "));
export const createCategorySchema = z
  .object({ name, color: colorSchema, scope: scopeSchema })
  .strict();
export const updateCategorySchema = z
  .object({
    name: name.optional(),
    color: colorSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  });
export const transactionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    scope: scopeSchema.optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    categoryId: uuidSchema.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ["to"],
    message: "End date must not be before start date.",
  });
export const manualCategorySchema = z
  .object({ categoryId: uuidSchema })
  .strict();
export const previewRuleSchema = z
  .object({
    transactionId: uuidSchema,
    categoryId: uuidSchema,
    scope: scopeSchema,
  })
  .strict();
export const createRuleSchema = previewRuleSchema
  .extend({ applyExisting: z.boolean() })
  .strict();
export const updateRuleSchema = z
  .object({
    categoryId: uuidSchema.optional(),
    enabled: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export { name as categoryNameSchema };
