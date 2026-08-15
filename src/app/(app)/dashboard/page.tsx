import type { Metadata } from "next";
import { FinancialDashboard } from "@/components/dashboard/financial-dashboard";
import {
  getDashboardOverviewApiContext,
  readDashboardOverview,
} from "@/lib/dashboard/overview-service";

export const metadata: Metadata = {
  title: "Month-to-date overview",
  description: "Private Family and Personal month-to-date budget health.",
};

export default async function DashboardPage() {
  const context = await getDashboardOverviewApiContext();
  const initialModel = await readDashboardOverview(
    context,
    "family",
    new Date(),
  );
  return <FinancialDashboard initialModel={initialModel} />;
}
