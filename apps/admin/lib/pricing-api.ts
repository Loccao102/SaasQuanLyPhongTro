import { adminApiRequest } from "./admin-api-client";

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


async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  return adminApiRequest<T>("/admin/pricing" + path, init);
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
