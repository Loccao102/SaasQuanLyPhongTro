import { adminApiRequest } from "./admin-api-client";

export interface TenantSubscriptionPlanView {
  code: string;
  name: string;
  monthlyPriceVnd: number;
  yearlyPriceVnd: number;
  roomLimit: number;
  staffLimit: number;
  automationQuota: number;
  features: string[];
}

export interface PlatformBankInfo {
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
}

export interface TenantSubscriptionOverview {
  subscription: {
    id: string;
    planCode: string;
    planName: string;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELLED";
    billingInterval: "MONTHLY" | "YEARLY";
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    daysRemaining: number;
    roomUsage: {
      current: number;
      limit: number;
      percentage: number;
    };
    staffUsage: {
      current: number;
      limit: number;
      percentage: number;
    };
    automationUsage: {
      current: number;
      limit: number;
      percentage: number;
    };
  };
  plans: TenantSubscriptionPlanView[];
  pendingInvoice: {
    id: string;
    amountVnd: number;
    paymentReference: string;
    status: string;
    dueAt: string;
    vietQrUrl: string;
    bankInfo: PlatformBankInfo;
  } | null;
}

export interface UpgradeResponse {
  invoiceId: string;
  planName: string;
  planCode: string;
  billingInterval: "MONTHLY" | "YEARLY";
  amountVnd: number;
  paymentReference: string;
  dueAt: string;
  status: string;
  vietQrUrl: string;
  bankInfo: PlatformBankInfo;
}

export interface SubscriptionInvoiceItem {
  id: string;
  planName: string;
  planCode: string;
  billingInterval: "MONTHLY" | "YEARLY";
  amountVnd: number;
  paymentReference: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
}

export const adminSubscriptionApi = {
  getOverview() {
    return adminApiRequest<TenantSubscriptionOverview>("/admin/subscription");
  },
  upgrade(input: { targetPlanCode: string; billingInterval: "MONTHLY" | "YEARLY" }) {
    return adminApiRequest<UpgradeResponse>("/admin/subscription/upgrade", {
      method: "POST",
      body: input
    });
  },
  listInvoices() {
    return adminApiRequest<{ invoices: SubscriptionInvoiceItem[] }>("/admin/subscription/invoices");
  },
  checkInvoiceStatus(invoiceId: string) {
    return adminApiRequest<{ paid: boolean; status: string; paidAt: string | null }>(
      `/admin/subscription/invoices/${encodeURIComponent(invoiceId)}/status`
    );
  }
};
