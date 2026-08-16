import type { Metadata } from "next";
import { CategoryWorkbench } from "@/components/categories/category-workbench";
import {
  getApiContext,
  listCategoriesAndRules,
} from "@/lib/categories/service";
import { delayRouteForE2E } from "@/lib/testing/route-loading-delay";
export const metadata: Metadata = {
  title: "Categories",
  description: "Manage private and shared ledger categories.",
};
export default async function CategoriesPage() {
  await delayRouteForE2E();
  const data = await listCategoriesAndRules(await getApiContext());
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
    >
      <div className="mx-auto max-w-6xl">
        <CategoryWorkbench
          initialCategories={data.categories}
          initialRules={data.rules}
        />
      </div>
    </main>
  );
}
