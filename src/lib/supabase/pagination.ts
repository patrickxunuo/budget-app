export const SUPABASE_PAGE_SIZE = 1000;

export async function collectAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<readonly T[]>,
  pageSize = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new RangeError("pageSize must be a positive safe integer");

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.length > pageSize)
      throw new RangeError("data source returned more than the requested page");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
