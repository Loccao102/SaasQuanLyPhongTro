import { GlobalSearchClient } from "./global-search-client";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function GlobalSearchPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  return <GlobalSearchClient initialQuery={one(params.q)} />;
}
