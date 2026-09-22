"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricCard, StatusBadge } from "@propops/ui";
import {
  cmsBillingDetailApi,
  type CmsInvoiceDetail
} from "../../../../lib/cms-billing-detail-api";

function money(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function date(value: string | null): string {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

function statusTone(status: string) {
  if (["PAID", "ALLOCATED", "SUCCEEDED"].includes(status)) {
    return "success" as const;
  }
  if (
    ["OPEN", "PARTIALLY_PAID", "REVIEW_REQUIRED", "UNALLOCATED"].includes(
      status
    )
  ) {
    return "warning" as const;
  }
  if (["VOID", "FAILED", "REFUNDED", "OVERDUE"].includes(status)) {
    return "danger" as const;
  }
  return "neutral" as const;
}

export function InvoiceDetailClient({ invoiceId }: { invoiceId: string }) {
  const [detail, setDetail] = useState<CmsInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await cmsBillingDetailApi.getInvoice(invoiceId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải SaaS invoice."
      );
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="directory-shell">
      <header className="directory-header">
        <div>
          <a className="directory-back" href="/">
            ← SaaS Billing / Control Plane
          </a>
          <span className="cms-eyebrow">CMS · SAAS INVOICE DETAIL</span>
          <h1>{detail?.invoice.paymentReference ?? "Invoice"}</h1>
          <p>
            Financial snapshot và allocation history chỉ đọc. Không sửa/xóa
            ledger từ màn hình này.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="cms-state cms-state--error">
          <strong>Không thể tải invoice.</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : loading || !detail ? (
        <div className="cms-state">Đang tải SaaS invoice…</div>
      ) : (
        <>
          <section className="cms-metrics">
            <MetricCard
              label="Invoice amount"
              value={money(detail.invoice.amountVnd)}
              detail={detail.invoice.billingInterval}
              tone="info"
            />
            <MetricCard
              label="Paid"
              value={money(detail.invoice.paidAmountVnd)}
              detail={String(detail.allocations.length) + " allocation"}
              tone="success"
            />
            <MetricCard
              label="Remaining"
              value={money(detail.invoice.remainingAmountVnd)}
              detail={detail.invoice.isOverdue ? "Đã quá hạn" : "Outstanding"}
              tone={detail.invoice.isOverdue ? "danger" : "warning"}
            />
            <MetricCard
              label="Status"
              value={detail.invoice.isOverdue ? "OVERDUE" : detail.invoice.status}
              detail={"Due " + date(detail.invoice.dueAt)}
              tone={
                detail.invoice.isOverdue
                  ? "danger"
                  : statusTone(detail.invoice.status)
              }
            />
          </section>

          <section className="organization-detail-grid">
            <article className="cms-panel">
              <div className="organization-detail-heading">
                <div>
                  <span className="cms-eyebrow">INVOICE SNAPSHOT</span>
                  <h2>{detail.invoice.paymentReference}</h2>
                </div>
                <StatusBadge
                  tone={
                    detail.invoice.isOverdue
                      ? "danger"
                      : statusTone(detail.invoice.status)
                  }
                >
                  {detail.invoice.isOverdue ? "OVERDUE" : detail.invoice.status}
                </StatusBadge>
              </div>
              <dl className="organization-detail-list">
                <div><dt>Invoice ID</dt><dd>{detail.invoice.id}</dd></div>
                <div><dt>Plan</dt><dd>{detail.invoice.planCode}</dd></div>
                <div><dt>Subscription</dt><dd>{detail.invoice.subscriptionId}</dd></div>
                <div><dt>Billing interval</dt><dd>{detail.invoice.billingInterval}</dd></div>
                <div><dt>Period start</dt><dd>{date(detail.invoice.periodStart)}</dd></div>
                <div><dt>Period end</dt><dd>{date(detail.invoice.periodEnd)}</dd></div>
                <div><dt>Issued</dt><dd>{date(detail.invoice.issuedAt)}</dd></div>
                <div><dt>Due</dt><dd>{date(detail.invoice.dueAt)}</dd></div>
                <div><dt>Paid at</dt><dd>{date(detail.invoice.paidAt)}</dd></div>
                <div><dt>Last updated</dt><dd>{date(detail.invoice.updatedAt)}</dd></div>
              </dl>
            </article>

            <article className="cms-panel">
              <div className="organization-detail-heading">
                <div>
                  <span className="cms-eyebrow">ORGANIZATION</span>
                  <h2>{detail.organization.name}</h2>
                </div>
                <a
                  className="secondary-button directory-link-button"
                  href={"/organizations/" + detail.organization.id}
                >
                  Mở organization
                </a>
              </div>
              <dl className="organization-detail-list">
                <div><dt>Organization ID</dt><dd>{detail.organization.id}</dd></div>
                <div><dt>Slug</dt><dd>{detail.organization.slug}</dd></div>
                <div><dt>Payment reference</dt><dd>{detail.invoice.paymentReference}</dd></div>
                <div><dt>Plan version ID</dt><dd>{detail.invoice.planVersionId}</dd></div>
              </dl>
            </article>
          </section>

          <section className="cms-panel">
            <div className="organization-detail-heading">
              <div>
                <span className="cms-eyebrow">APPEND-ONLY HISTORY</span>
                <h2>Payment allocations</h2>
              </div>
              <span className="cms-note">
                {detail.allocations.length} allocation
              </span>
            </div>

            {detail.allocations.length === 0 ? (
              <div className="empty-state">
                Invoice chưa có payment allocation.
              </div>
            ) : (
              <div className="cms-table-wrap">
                <table className="cms-table invoice-allocation-table">
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th>Allocated</th>
                      <th>Source</th>
                      <th>Actor</th>
                      <th>Reason / time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.allocations.map(({ allocation, payment }) => (
                      <tr key={allocation.id}>
                        <td>
                          <strong>{payment.id}</strong>
                          <small>
                            {payment.providerTransactionId ??
                              "No provider transaction ID"}
                          </small>
                          <StatusBadge tone={statusTone(payment.reconciliationStatus)}>
                            {payment.reconciliationStatus}
                          </StatusBadge>
                        </td>
                        <td>
                          <strong>{money(allocation.amountVnd)}</strong>
                          <small>of {money(payment.amountVnd)}</small>
                        </td>
                        <td>
                          <strong>{payment.source}</strong>
                          <small>{payment.provider ?? "—"}</small>
                        </td>
                        <td>
                          <strong>
                            {allocation.allocatedByName ??
                              (allocation.allocatedByUserId
                                ? allocation.allocatedByUserId
                                : "System / auto-match")}
                          </strong>
                        </td>
                        <td>
                          <strong>{allocation.reason}</strong>
                          <small>{date(allocation.createdAt)}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cms-panel">
            <div className="organization-detail-heading">
              <div>
                <span className="cms-eyebrow">AUDIT</span>
                <h2>Invoice-related platform events</h2>
              </div>
              <span className="cms-note">
                {detail.auditEvents === null
                  ? "Role không có platform.audit.read"
                  : String(detail.auditEvents.length) + " event"}
              </span>
            </div>

            {detail.auditEvents === null ? (
              <div className="empty-state">
                Audit history không khả dụng với role hiện tại.
              </div>
            ) : detail.auditEvents.length === 0 ? (
              <div className="empty-state">
                Chưa có platform audit event liên quan invoice này.
              </div>
            ) : (
              <div className="audit-list">
                {detail.auditEvents.map((event) => (
                  <article className="audit-item" key={event.id}>
                    <div>
                      <strong>{event.action}</strong>
                      <span className="cms-note">{date(event.at)}</span>
                    </div>
                    <p>{event.reason}</p>
                    <small>
                      {event.actor} · {event.targetType} · {event.target}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
