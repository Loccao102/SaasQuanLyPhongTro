"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricCard, StatusBadge } from "@propops/ui";
import {
  cmsOrganizationsApi,
  type CmsOrganizationDirectoryItem
} from "../../../lib/cms-organizations-api";

function tone(status: string) {
  if (["ACTIVE", "PAID"].includes(status)) return "success" as const;
  if (
    ["TRIALING", "PAST_DUE", "GRACE_PERIOD", "OPEN", "PARTIALLY_PAID"].includes(
      status
    )
  ) {
    return "warning" as const;
  }
  if (["SUSPENDED", "CANCELLED", "OVERDUE"].includes(status)) {
    return "danger" as const;
  }
  return "neutral" as const;
}

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

export function OrganizationDetailClient({
  organizationId
}: {
  organizationId: string;
}) {
  const [organization, setOrganization] =
    useState<CmsOrganizationDirectoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrganization(await cmsOrganizationsApi.getById(organizationId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải organization."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="directory-shell">
      <header className="directory-header">
        <div>
          <a className="directory-back" href="/organizations">
            ← Organizations
          </a>
          <span className="cms-eyebrow">CMS · ORGANIZATION DETAIL</span>
          <h1>{organization?.name ?? "Organization"}</h1>
          <p>{organization?.slug ?? organizationId}</p>
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
          <strong>Không thể tải organization.</strong>
          <span>{error}</span>
          <a className="text-button" href="/organizations">
            Quay lại danh sách
          </a>
        </div>
      ) : loading || !organization ? (
        <div className="cms-state">Đang tải organization…</div>
      ) : (
        <>
          <section className="cms-metrics">
            <MetricCard
              label="Rooms"
              value={String(organization.rooms)}
              detail={"Limit " + String(organization.roomLimit ?? "—")}
              tone={organization.overLimit ? "warning" : "info"}
            />
            <MetricCard
              label="Staff"
              value={String(organization.staff)}
              detail={"Limit " + String(organization.staffLimit ?? "—")}
              tone={
                organization.staffLimit !== null &&
                organization.staff > organization.staffLimit
                  ? "warning"
                  : "info"
              }
            />
            <MetricCard
              label="Automation"
              value={String(
                organization.automationUsed + organization.automationReserved
              )}
              detail={
                organization.automationQuota === null
                  ? "No quota"
                  : "Limit " + organization.automationQuota.toLocaleString("vi-VN")
              }
              tone={organization.overLimit ? "warning" : "info"}
            />
            <MetricCard
              label="Billing"
              value={
                organization.latestInvoice
                  ? money(organization.latestInvoice.remainingAmountVnd)
                  : "—"
              }
              detail={
                organization.latestInvoice?.isOverdue
                  ? "Overdue"
                  : "Latest outstanding"
              }
              tone={organization.delinquent ? "danger" : "success"}
            />
          </section>

          <section className="organization-detail-grid">
            <article className="cms-panel">
              <div className="organization-detail-heading">
                <div>
                  <span className="cms-eyebrow">IDENTITY & SUBSCRIPTION</span>
                  <h2>{organization.name}</h2>
                </div>
                <div className="organization-flags">
                  <StatusBadge tone={tone(organization.status)}>
                    {organization.status}
                  </StatusBadge>
                  <StatusBadge tone={tone(organization.subscriptionStatus)}>
                    {organization.subscriptionStatus}
                  </StatusBadge>
                </div>
              </div>

              <dl className="organization-detail-list">
                <div>
                  <dt>Organization ID</dt>
                  <dd>{organization.id}</dd>
                </div>
                <div>
                  <dt>Slug</dt>
                  <dd>{organization.slug}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{organization.ownerName ?? "No active owner"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{date(organization.createdAt)}</dd>
                </div>
                <div>
                  <dt>Plan</dt>
                  <dd>{organization.planCode ?? "UNASSIGNED"}</dd>
                </div>
                <div>
                  <dt>Subscription version</dt>
                  <dd>{organization.subscriptionVersion ?? "—"}</dd>
                </div>
                <div>
                  <dt>Billing interval</dt>
                  <dd>{organization.billingInterval ?? "—"}</dd>
                </div>
                <div>
                  <dt>Current period</dt>
                  <dd>
                    {date(organization.currentPeriodStart)} →{" "}
                    {date(organization.currentPeriodEnd)}
                  </dd>
                </div>
                <div>
                  <dt>Cancel at period end</dt>
                  <dd>{organization.cancelAtPeriodEnd ? "YES" : "NO"}</dd>
                </div>
              </dl>
            </article>

            <article className="cms-panel">
              <div className="organization-detail-heading">
                <div>
                  <span className="cms-eyebrow">COMMERCIAL HEALTH</span>
                  <h2>Limits & flags</h2>
                </div>
                <div className="organization-flags">
                  {organization.delinquent ? (
                    <StatusBadge tone="danger">DELINQUENT</StatusBadge>
                  ) : null}
                  {organization.overLimit ? (
                    <StatusBadge tone="warning">OVER LIMIT</StatusBadge>
                  ) : null}
                  {!organization.delinquent && !organization.overLimit ? (
                    <StatusBadge tone="success">CLEAR</StatusBadge>
                  ) : null}
                </div>
              </div>

              <dl className="organization-detail-list">
                <div>
                  <dt>Room usage</dt>
                  <dd>
                    {organization.rooms} / {organization.roomLimit ?? "—"}{" "}
                    ({organization.roomLimitSource ?? "NO LIMIT"})
                  </dd>
                </div>
                <div>
                  <dt>Staff usage</dt>
                  <dd>
                    {organization.staff} / {organization.staffLimit ?? "—"}{" "}
                    ({organization.staffLimitSource ?? "NO LIMIT"})
                  </dd>
                </div>
                <div>
                  <dt>Automation consumed</dt>
                  <dd>{organization.automationUsed.toLocaleString("vi-VN")}</dd>
                </div>
                <div>
                  <dt>Automation reserved</dt>
                  <dd>
                    {organization.automationReserved.toLocaleString("vi-VN")}
                  </dd>
                </div>
                <div>
                  <dt>Automation quota</dt>
                  <dd>
                    {organization.automationQuota?.toLocaleString("vi-VN") ?? "—"}{" "}
                    ({organization.automationQuotaSource ?? "NO LIMIT"})
                  </dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="cms-panel">
            <div className="organization-detail-heading">
              <div>
                <span className="cms-eyebrow">LATEST SAAS INVOICE</span>
                <h2>Billing snapshot</h2>
              </div>
              {organization.latestInvoice ? (
                <StatusBadge
                  tone={tone(
                    organization.latestInvoice.isOverdue
                      ? "OVERDUE"
                      : organization.latestInvoice.status
                  )}
                >
                  {organization.latestInvoice.isOverdue
                    ? "OVERDUE"
                    : organization.latestInvoice.status}
                </StatusBadge>
              ) : null}
            </div>

            {organization.latestInvoice ? (
              <dl className="organization-detail-list organization-detail-list--wide">
                <div>
                  <dt>Invoice ID</dt>
                  <dd>{organization.latestInvoice.id}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>{money(organization.latestInvoice.amountVnd)}</dd>
                </div>
                <div>
                  <dt>Paid</dt>
                  <dd>{money(organization.latestInvoice.paidAmountVnd)}</dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd>{money(organization.latestInvoice.remainingAmountVnd)}</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{date(organization.latestInvoice.dueAt)}</dd>
                </div>
                <div>
                  <dt>Period</dt>
                  <dd>
                    {date(organization.latestInvoice.periodStart)} →{" "}
                    {date(organization.latestInvoice.periodEnd)}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="empty-state">
                Organization chưa có SaaS invoice để hiển thị.
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
