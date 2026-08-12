import { z } from "zod";

const scopeSchema = z.enum(["family", "personal"]);
const kindSchema = z.enum(["income", "spending", "refund"]);
const uuidSchema = z.string().uuid("Choose a valid category.");
export const manualEntryIdSchema = z
  .string()
  .uuid("Choose a valid manual entry.");
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
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
  }, "Choose a real calendar date.");

const amountSchema = z
  .string()
  .trim()
  .regex(
    /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,
    "Use a CAD amount with at most 2 decimal places.",
  );
const descriptionSchema = z
  .string()
  .trim()
  .min(1, "Description is required.")
  .max(160, "Description must be 160 characters or fewer.");
const notesSchema = z
  .union([
    z.string().trim().max(1000, "Notes must be 1000 characters or fewer."),
    z.null(),
  ])
  .optional()
  .transform((value) => (value === "" ? null : value));

const editableShape = {
  kind: kindSchema,
  amount: amountSchema,
  entryDate: calendarDateSchema,
  description: descriptionSchema,
  categoryId: uuidSchema,
  notes: notesSchema,
};

function signedAmount(
  value: { kind?: "income" | "spending" | "refund"; amount?: string },
  ctx: z.RefinementCtx,
) {
  if (!value.kind || value.amount === undefined || !/^-?\d/.test(value.amount))
    return;
  const amount = Number(value.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Amount cannot be zero.",
    });
  } else if (value.kind === "spending" && amount >= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Spending must use a negative amount.",
    });
  } else if (value.kind !== "spending" && amount <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Income and refunds must use a positive amount.",
    });
  }
}

export const manualEntryInputSchema = z
  .object({ scope: scopeSchema, ...editableShape })
  .strict()
  .superRefine(signedAmount);
export const manualEntryUpdateSchema = z
  .object({
    kind: kindSchema.optional(),
    amount: amountSchema.optional(),
    entryDate: calendarDateSchema.optional(),
    description: descriptionSchema.optional(),
    categoryId: uuidSchema.optional(),
    notes: notesSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one editable field.",
  })
  .superRefine(signedAmount);

export const manualEntryListQuerySchema = z
  .object({
    scope: scopeSchema.optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    categoryId: uuidSchema.optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to)
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "End date cannot be before start date.",
      });
  });

export const manualEntryDeleteSchema = z
  .object({ confirmed: z.boolean() })
  .strict();
