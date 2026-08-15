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
      className="px-5 py-9 sm:px-8 lg:px-12 lg:py-14"
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-9 grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-end">
          <div>
            <p className="font-utility text-brand text-xs font-semibold tracking-[.15em] uppercase">
              Classification / household index
            </p>
            <h1 className="font-display mt-3 text-5xl leading-[.94] font-semibold tracking-[-.055em] sm:text-6xl">
              Give every dollar a place.
            </h1>
          </div>
          <p className="border-line text-muted border-l pl-5 text-sm leading-6">
            Family labels keep the shared ledger legible. Personal labels remain
            yours alone—even from the family owner.
          </p>
        </header>
        <CategoryWorkbench
          initialCategories={data.categories}
          initialRules={data.rules}
        />
      </div>
    </main>
  );
}
