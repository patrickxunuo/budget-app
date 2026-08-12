import { z } from "zod";
const month = z
  .string()
  .regex(
    /^\d{4}-(?:0[1-9]|1[0-2])-01$/,
    "Use the first day of a month (YYYY-MM-01).",
  )
  .refine(
    (value) =>
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    "Choose a real calendar month.",
  );
const scope = z.enum(["family", "personal"]);
const amountCents = z
  .number()
  .int()
  .safe()
  .positive("Enter a positive CAD amount in cents.");
export const budgetMonthQuerySchema = z.object({ scope, month }).strict();
export const budgetHistoryQuerySchema = z.object({ month }).strict();
export const budgetIdSchema = z.string().uuid("Choose a valid budget target.");
export const createBudgetSchema = z
  .object({
    scope,
    categoryId: z.string().uuid("Choose a valid category."),
    amountCents,
    effectiveMonth: month,
  })
  .strict();
export const updateBudgetSchema = z.union([
  z
    .object({
      amountCents,
      effectiveMonth: month,
      archived: z.never().optional(),
    })
    .strict(),
  z
    .object({
      archived: z.literal(true),
      effectiveMonth: month,
      amountCents: z.never().optional(),
    })
    .strict(),
]);
