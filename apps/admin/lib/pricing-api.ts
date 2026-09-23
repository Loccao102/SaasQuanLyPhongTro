export type PricingItemType =
  | "ELECTRICITY_PER_KWH"
  | "WATER_PER_M3"
  | "INTERNET"
  | "PARKING"
  | "TRASH"
  | "CUSTOM";

export type PricingItem = {
  id: string;
  itemType: PricingItemType;
  description: string;
  unitPriceVnd: number;
  fixedQuantity: string;
  sortOrder: number;
};

export type PricingPolicy = {
  id: string;
  name: string;
  propertyId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  items: PricingItem[];
};

export type PricingListResponse = {
  propertyId: string;
  permissions: {
    manage: boolean;
  };
  policies: PricingPolicy[];
};

export type CreatePricingPolicyInput = {
  id: string;
  propertyId: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  items: Array<{
    id: string;
    itemType: PricingItemType;
    description: string;
    unitPriceVnd: number;
    fixedQuantity?: number | string;
    sortOrder: number;
  }>;
};

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const configuredOrganizationId =
  process.env.NEXT_PUBLIC_ADMIN_ORGANIZATION_ID?.trim() ?? "";

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const headers = new Headers();
  if (configuredOrganizationId) {
    headers.set("x-organization-id", configuredOrganizationId);
  }
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(apiBase + "/admin/pricing" + path, {
    credentials: "include",
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || "Pricing API request failed with status " + String(response.status)
    );
  }

  return response.json() as Promise<T>;
}

export const pricingApi = {
  listForProperty: (propertyId: string) =>
    request<PricingListResponse>(
      "/properties/" + encodeURIComponent(propertyId) + "/policies"
    ),
  createPolicy: (input: CreatePricingPolicyInput) =>
    request<PricingPolicy>("/policies", {
      method: "POST",
      body: input
    })
};
