export type CmsGlobalSearchItem = {
  kind:
    | "ORGANIZATION"
    | "PROVIDER_PAYMENT"
    | "SAAS_INVOICE"
    | "NOTIFICATION_JOB";
  id: string;
  title: string;
  reference: string;
  status: string;
  organization: {
    id: string;
    name: string;
  } | null;
  metadata: Readonly<Record<string, string | number | null>>;
};

export type CmsGlobalSearchResult = {
  query: string;
  scopes: {
    organizations: boolean;
    billing: boolean;
    jobs: boolean;
  };
  items: CmsGlobalSearchItem[];
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(apiBase + "/cms/search" + path, {
    credentials: "include"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "CMS API request failed with status " + String(response.status)
    );
  }

  return response.json() as Promise<T>;
}

export const cmsGlobalSearchApi = {
  search: (query: string, limit = 8) => {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit)
    });
    return request<CmsGlobalSearchResult>("?" + params.toString());
  }
};
