import { OrganizationDirectoryClient } from "./organization-directory-client";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function OrganizationsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  return (
    <OrganizationDirectoryClient
      initialFilters={{
        query: one(params.q),
        plan: one(params.plan),
        status: one(params.status),
        organizationStatus: one(params.organizationStatus),
        delinquent: one(params.delinquent),
        overLimit: one(params.overLimit)
      }}
    />
  );
}
