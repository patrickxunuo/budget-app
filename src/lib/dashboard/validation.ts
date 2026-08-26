import { z } from "zod";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date.");
const uuid = z.string().uuid();
const dashboardQueryFields = {
  scope: z.enum(["family", "personal"]),
  period: z.enum(["day", "week", "month", "custom"]),
  reference: date,
  from: date.optional(),
  to: date.optional(),
  accountId: uuid.optional(),
  categoryId: uuid.optional(),
  status: z.enum(["all", "pending", "posted"]).default("all"),
  inclusion: z
    .enum(["default", "included", "excluded", "transfers", "all"])
    .default("default"),
  search: z
    .string()
    .trim()
    .max(100)
    .transform((v) => v || undefined)
    .optional(),
};
const validateRange = (
  v: { period: string; from?: string; to?: string },
  c: z.RefinementCtx,
) => {
  if (v.period === "custom" && !v.from)
    c.addIssue({
      code: "custom",
      path: ["from"],
      message: "Required for a custom period.",
    });
  if (v.period === "custom" && !v.to)
    c.addIssue({
      code: "custom",
      path: ["to"],
      message: "Required for a custom period.",
    });
  if (v.from && v.to && v.from > v.to)
    c.addIssue({
      code: "custom",
      path: ["to"],
      message: "End date must not be before start date.",
    });
};

export const dashboardExportQuerySchema = z
  .object(dashboardQueryFields)
  .strict()
  .superRefine(validateRange);

export const dashboardQuerySchema = z
  .object({
    ...dashboardQueryFields,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict()
  .superRefine(validateRange);
