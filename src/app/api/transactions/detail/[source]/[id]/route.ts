import { NextResponse } from "next/server";
import {
  getTransactionDetailApiContext,
  readTransactionDetail,
  toTransactionDetailApiErrorResponse,
  type TransactionDetailSource,
} from "@/lib/transactions/transaction-detail";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSource(value: string): value is TransactionDetailSource {
  return value === "plaid" || value === "manual";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ source: string; id: string }> },
) {
  const { source, id } = await params;
  if (!isSource(source) || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const context = await getTransactionDetailApiContext();
    const transaction = await readTransactionDetail(context, source, id);
    return NextResponse.json({ transaction });
  } catch (error) {
    return toTransactionDetailApiErrorResponse(error);
  }
}
