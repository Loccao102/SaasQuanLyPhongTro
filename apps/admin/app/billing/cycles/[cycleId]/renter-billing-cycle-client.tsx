"use client";

import { useCallback, useEffect, useState } from "react";
import { MoneyDisplay, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../../../components/admin-shell";
import {
  renterBillingApi,
  type RenterBillingDetailResponse
} from "../../../../lib/renter-billing-api";

export function RenterBillingCycleClient({ cycleId }: { cycleId: string }) {
  const [data, setData] = useState<RenterBillingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await renterBillingApi.detail(cycleId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải chi tiết kỳ hóa đơn."
      );
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminShell
      title={data?.cycle.code ?? "Chi tiết kỳ hóa đơn"}
      eyebrow="RENTER BILLING · CYCLE DETAIL"
      activeNav="Hóa đơn"
    >
      <a className="back-link" href="/billing">← Các kỳ hóa đơn</a>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Không thể tải kỳ hóa đơn.</strong>
          <span>{error}</span>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải invoice snapshots…</div>
      ) : (
        <>
          <section className="asset-context">
            <div>
              <span className="eyebrow">{data.cycle.property.code}</span>
              <h2>{data.cycle.code}</h2>
              <p>
                {data.cycle.periodStart} → {data.cycle.periodEnd} · hạn{" "}
                {data.cycle.dueDate}
              </p>
            </div>
            <StatusBadge
              tone={data.cycle.status === "FINALIZED" ? "success" : "warning"}
            >
              {data.cycle.status}
            </StatusBadge>
          </section>

          {data.invoices.length === 0 ? (
            <div className="admin-state">
              <strong>Chưa có invoice draft.</strong>
              <span>Quay lại danh sách và chạy “Sinh rent draft”.</span>
            </div>
          ) : (
            <div className="renter-invoice-stack">
              {data.invoices.map((invoice) => (
                <section className="panel renter-invoice-card" key={invoice.id}>
                  <div className="asset-section-heading">
                    <div>
                      <span className="eyebrow">
                        PHÒNG {invoice.room.code} · {invoice.lease.code}
                      </span>
                      <h2>{invoice.number}</h2>
                      <p className="panel-meta">
                        {invoice.primaryResidentName}
                      </p>
                    </div>
                    <StatusBadge
                      tone={invoice.status === "ISSUED" ? "success" : "neutral"}
                    >
                      {invoice.status}
                    </StatusBadge>
                  </div>

                  <div className="billing-cycle-card__stats">
                    <div>
                      <span>Subtotal</span>
                      <strong><MoneyDisplay amountVnd={invoice.subtotalVnd} /></strong>
                    </div>
                    <div>
                      <span>Adjustment</span>
                      <strong><MoneyDisplay amountVnd={invoice.adjustmentVnd} /></strong>
                    </div>
                    <div>
                      <span>Nợ trước</span>
                      <strong><MoneyDisplay amountVnd={invoice.previousBalanceVnd} /></strong>
                    </div>
                    <div>
                      <span>Tổng</span>
                      <strong><MoneyDisplay amountVnd={invoice.totalVnd} /></strong>
                    </div>
                  </div>

                  <div className="renter-invoice-lines">
                    {invoice.lines.map((line) => (
                      <div className="renter-invoice-line" key={line.id}>
                        <div>
                          <strong>{line.description}</strong>
                          <span>
                            {line.type} · {line.quantity} ×{" "}
                            {new Intl.NumberFormat("vi-VN").format(line.unitPriceVnd)}
                          </span>
                        </div>
                        <MoneyDisplay amountVnd={line.amountVnd} />
                      </div>
                    ))}
                  </div>

                  {invoice.issuedAt ? (
                    <p className="inline-note">
                      Issued: {new Date(invoice.issuedAt).toLocaleString("vi-VN")}.
                      Snapshot tài chính không được sửa trực tiếp sau thời điểm này.
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
