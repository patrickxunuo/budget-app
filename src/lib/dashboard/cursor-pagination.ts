import { z } from "zod";
import type { DashboardTransaction } from "./types";

const cursorDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });

const dashboardCursorPayloadSchema = z
  .object({
    version: z.literal(1),
    date: cursorDate,
    source: z.enum(["manual", "plaid"]),
    id: z.string().min(1).max(256),
  })
  .strict();

export type DashboardCursorPayload = z.infer<
  typeof dashboardCursorPayloadSchema
>;

type DashboardCursorBoundary = Pick<
  DashboardTransaction,
  "date" | "source" | "id"
>;

export class DashboardCursorError extends Error {
  constructor() {
    super("Invalid dashboard cursor.");
    this.name = "DashboardCursorError";
  }
}

function toPayload(boundary: DashboardCursorBoundary): DashboardCursorPayload {
  return dashboardCursorPayloadSchema.parse({
    version: 1,
    date: boundary.date,
    source: boundary.source,
    id: boundary.id,
  });
}

export function encodeDashboardCursor(
  boundary: DashboardCursorBoundary,
): string {
  return Buffer.from(JSON.stringify(toPayload(boundary)), "utf8").toString(
    "base64url",
  );
}

export function decodeDashboardCursor(cursor: string): DashboardCursorPayload {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new DashboardCursorError();
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor)
      throw new DashboardCursorError();
    return dashboardCursorPayloadSchema.parse(
      JSON.parse(decoded.toString("utf8")),
    );
  } catch {
    throw new DashboardCursorError();
  }
}

/**
 * Stable ledger ordering: newest date first, then source and id ascending.
 * A positive result means `left` appears after `right` in the feed.
 */
export function compareDashboardTransactions(
  left: DashboardCursorBoundary,
  right: DashboardCursorBoundary,
): number {
  return (
    right.date.localeCompare(left.date) ||
    left.source.localeCompare(right.source) ||
    left.id.localeCompare(right.id)
  );
}
