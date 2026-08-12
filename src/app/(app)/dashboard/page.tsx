import type { Metadata } from "next";
import { FinancialDashboard } from "@/components/dashboard/financial-dashboard";
import { getDashboardApiContext, readDashboard } from "@/lib/dashboard/service";
import { formatLocalDate } from "@/lib/transactions/accounting";
export const metadata: Metadata = {
  title: "Financial field report",
  description: "Private Family and Personal cash-flow reporting.",
};
export default async function DashboardPage() {
  const context = await getDashboardApiContext();
  const reference = formatLocalDate(new Date(), "America/Toronto");
  const initialModel = await readDashboard(context, {
    scope: "family",
    period: "month",
    reference,
    status: "all",
    inclusion: "default",
    limit: 50,
  });
  return <FinancialDashboard initialModel={initialModel} />;
}
