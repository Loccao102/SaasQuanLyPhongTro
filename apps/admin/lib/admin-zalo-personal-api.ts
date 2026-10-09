import { adminApiRequest } from "./admin-api-client";

export type ZaloPersonalStatus = {
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED";
  connectedAt: string | null;
  login: {
    id: string;
    status: "PENDING" | "RUNNING" | "CONNECTED" | "FAILED" | "EXPIRED" | "CANCELLED";
    qrImage: string | null;
    expiresAt: string;
    errorMessage: string | null;
  } | null;
};

const base = "/admin/zalo-personal";
export const adminZaloPersonalApi = {
  status: () => adminApiRequest<ZaloPersonalStatus>(base),
  connect: () => adminApiRequest<{ requestId: string; expiresAt: string }>(
    base + "/connect", { method: "POST" }
  ),
  disconnect: () => adminApiRequest<{ status: string }>(
    base + "/disconnect", { method: "POST" }
  )
};
