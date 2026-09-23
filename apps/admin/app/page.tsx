import {
  MetricCard,
  ProgressBar,
  SectionHeader,
  StatusBadge
} from "@propops/ui";
import Link from "next/link";
import { AdminShell } from "../components/admin-shell";
import {
  AdminApiError,
  adminApi,
  type AdminDashboard
} from "../lib/admin-api";

function numberPreset(
  dashboard: AdminDashboard,
  name: string,
  fallback: Intl.NumberFormatOptions
): Intl.NumberFormatOptions {
  const raw = dashboard.display.presets[name];
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    return fallback;
  }

  const candidate = raw as Record<string, unknown>;
  const options: Intl.NumberFormatOptions = { ...fallback };
  if (
    candidate.notation === "standard" ||
    candidate.notation === "scientific" ||
    candidate.notation === "engineering" ||
    candidate.notation === "compact"
  ) {
    options.notation = candidate.notation;
  }
  if (
    typeof candidate.minimumFractionDigits === "number" &&
    Number.isInteger(candidate.minimumFractionDigits) &&
    candidate.minimumFractionDigits >= 0 &&
    candidate.minimumFractionDigits <= 20
  ) {
    options.minimumFractionDigits =
      candidate.minimumFractionDigits;
  }
  if (
    typeof candidate.maximumFractionDigits === "number" &&
    Number.isInteger(candidate.maximumFractionDigits) &&
    candidate.maximumFractionDigits >= 0 &&
    candidate.maximumFractionDigits <= 20
  ) {
    options.maximumFractionDigits =
      candidate.maximumFractionDigits;
  }
  return options;
}

function formatters(dashboard: AdminDashboard) {
  const locale = dashboard.display.locale;
  const number = (value: number) =>
    new Intl.NumberFormat(
      locale,
      numberPreset(dashboard, "integer", {
        maximumFractionDigits: 0
      })
    ).format(value);
  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      ...numberPreset(dashboard, "money", {
        maximumFractionDigits: 0
      }),
      style: "currency",
      currency: dashboard.display.currencyCode
    }).format(value);
  const percent = (value: number) =>
    new Intl.NumberFormat(
      locale,
      numberPreset(dashboard, "percent", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1
      })
    ).format(value) + "%";
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: dashboard.display.timezone
    }).format(new Date(value + "T00:00:00"));

  return { number, money, percent, date };
}

function subscriptionTone(status: string) {
  if (status === "ACTIVE" || status === "TRIALING") return "success" as const;
  if (status === "PAST_DUE" || status === "GRACE_PERIOD") {
    return "warning" as const;
  }
  if (status === "SUSPENDED" || status === "CANCELLED") {
    return "danger" as const;
  }
  return "neutral" as const;
}

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401 || error.status === 403) {
      return (
        error.message +
        " Kiểm tra tenant membership và workspace hiện tại."
      );
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "Không thể tải dashboard Habi Admin.";
}

export default async function AdminDashboardPage() {
  let dashboard: AdminDashboard;
  try {
    dashboard = await adminApi.dashboard();
  } catch (error) {
    return (
      <AdminShell title="Tổng quan vận hành" activeNav="Tổng quan">
        <section className="panel admin-error-state">
          <StatusBadge tone="danger">KHÔNG TẢI ĐƯỢC DỮ LIỆU</StatusBadge>
          <h2>Dashboard chưa sẵn sàng</h2>
          <p>{errorMessage(error)}</p>
          <p>
            Local dev cần cấu hình ADMIN_DEV_USER_ID và
            ADMIN_DEV_ORGANIZATION_ID trên API/Admin server.
          </p>
        </section>
      </AdminShell>
    );
  }

  const fmt = formatters(dashboard);
  const metrics = dashboard.metrics;
  const scopeLabel =
    dashboard.workspace.scopeMode === "ORGANIZATION"
      ? "Toàn tổ chức"
      : dashboard.workspace.authorizedPropertyCount + " cơ sở được cấp";

  return (
    <AdminShell
      title="Tổng quan vận hành"
      eyebrow="HABI ADMIN · LIVE DATA"
      activeNav="Tổng quan"
      workspaceName={dashboard.workspace.name}
      workspaceRole={dashboard.workspace.role}
      workspaceScope={scopeLabel}
      userName={dashboard.workspace.userDisplayName}
    >
      <section className="admin-dashboard-hero">
        <div>
          <span className="eyebrow">POSTGRESQL · SOURCE OF TRUTH</span>
          <h2>{dashboard.branding.tagline}</h2>
          <p>
            {dashboard.workspace.name} · {scopeLabel} ·{" "}
            {dashboard.display.timezone}
          </p>
        </div>
        <div className="admin-dashboard-hero__status">
          <StatusBadge
            tone={
              dashboard.workspace.status === "ACTIVE"
                ? "success"
                : "warning"
            }
          >
            ORG {dashboard.workspace.status}
          </StatusBadge>
          {dashboard.subscription ? (
            <StatusBadge
              tone={subscriptionTone(dashboard.subscription.status)}
            >
              {dashboard.subscription.planCode} ·{" "}
              {dashboard.subscription.status}
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral">NO SUBSCRIPTION VIEW</StatusBadge>
          )}
        </div>
      </section>

      <section className="metrics-grid" aria-label="Chỉ số tổng quan">
        <MetricCard
          label="Cơ sở đang hoạt động"
          value={fmt.number(metrics.activeProperties)}
          detail={scopeLabel}
          tone="info"
        />
        <MetricCard
          label="Phòng đang hoạt động"
          value={fmt.number(metrics.activeRooms)}
          detail={
            dashboard.subscription
              ? fmt.number(metrics.activeRooms) +
                " / " +
                fmt.number(dashboard.subscription.roomLimit) +
                " room limit"
              : "Theo phạm vi được cấp"
          }
          tone="info"
        />
        <MetricCard
          label="Tỷ lệ lấp đầy"
          value={fmt.percent(metrics.occupancyRatePercent)}
          detail={
            fmt.number(metrics.occupiedRooms) +
            " / " +
            fmt.number(metrics.activeRooms) +
            " phòng có hợp đồng"
          }
          tone="success"
        />
        <MetricCard
          label="Cư dân hiện tại"
          value={fmt.number(metrics.activeResidents)}
          detail="Resident đang nằm trong lease hiện hành"
          tone="info"
        />
        <MetricCard
          label="Hợp đồng active"
          value={fmt.number(metrics.activeLeases)}
          detail={
            fmt.number(metrics.terminationScheduledLeases) +
            " đang chờ chấm dứt"
          }
          tone="neutral"
        />
        <MetricCard
          label={"HĐ hết hạn ≤ " + dashboard.windows.leaseExpiryDays + " ngày"}
          value={fmt.number(metrics.expiringLeases)}
          detail={fmt.number(metrics.draftLeases) + " hợp đồng draft"}
          tone={metrics.expiringLeases > 0 ? "warning" : "success"}
        />
        <MetricCard
          label="Giá thuê cam kết / tháng"
          value={fmt.money(metrics.contractedMonthlyRentVnd)}
          detail="Tổng base_rent_vnd của lease hiện hành"
          tone="success"
        />
        <MetricCard
          label="Cọc yêu cầu hiện hành"
          value={fmt.money(metrics.requiredDepositVnd)}
          detail="Theo deposit_required_vnd trong hợp đồng"
          tone="neutral"
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--cycle">
          <SectionHeader
            title="Occupancy & hợp đồng"
            action={
              <StatusBadge
                tone={
                  metrics.vacantRooms > 0 ? "warning" : "success"
                }
              >
                {fmt.number(metrics.vacantRooms)} PHÒNG TRỐNG
              </StatusBadge>
            }
          />
          <ProgressBar
            value={metrics.occupiedRooms}
            max={Math.max(metrics.activeRooms, 1)}
            label={
              fmt.number(metrics.occupiedRooms) +
              " / " +
              fmt.number(metrics.activeRooms) +
              " phòng có lease hiện hành"
            }
          />
          <div className="cycle-stats">
            <div>
              <span>Phòng trống</span>
              <strong>{fmt.number(metrics.vacantRooms)}</strong>
            </div>
            <div>
              <span>Lease draft</span>
              <strong>{fmt.number(metrics.draftLeases)}</strong>
            </div>
            <div>
              <span>Chờ chấm dứt</span>
              <strong>
                {fmt.number(metrics.terminationScheduledLeases)}
              </strong>
            </div>
          </div>
          <Link className="secondary-link-button" href="/leases">
            Quản lý hợp đồng
          </Link>
        </article>

        <article className="panel">
          <SectionHeader
            title="Hợp đồng sắp hết hạn"
            action={
              <Link className="text-link" href="/leases">
                Xem tất cả
              </Link>
            }
          />
          {dashboard.expiringLeases.length === 0 ? (
            <div className="admin-empty-state">
              Không có hợp đồng hết hạn trong{" "}
              {dashboard.windows.leaseExpiryDays} ngày tới.
            </div>
          ) : (
            <div className="attention-list">
              {dashboard.expiringLeases.slice(0, 6).map((lease) => (
                <Link
                  href={"/leases/" + lease.id}
                  className="attention-item attention-item--lease"
                  key={lease.id}
                >
                  <StatusBadge
                    tone={lease.daysRemaining <= 7 ? "danger" : "warning"}
                  >
                    {lease.daysRemaining} NGÀY
                  </StatusBadge>
                  <span>
                    <strong>
                      {lease.primaryResidentName ?? "Chưa gán người thuê"}
                    </strong>
                    <small>
                      {lease.propertyName} · {lease.roomCode} ·{" "}
                      {lease.leaseCode}
                    </small>
                  </span>
                  <span>{fmt.date(lease.plannedEndDate)}</span>
                </Link>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="panel">
        <SectionHeader
          title="Theo cơ sở"
          action={
            <span className="scope-label">
              Top {dashboard.windows.topItemsLimit} theo số phòng active
            </span>
          }
        />
        {dashboard.topProperties.length === 0 ? (
          <div className="admin-empty-state">
            Chưa có cơ sở/phòng trong phạm vi hiện tại.
          </div>
        ) : (
          <div className="area-table" role="table" aria-label="Tình trạng vận hành theo cơ sở">
            <div className="area-table__row area-table__head admin-property-row" role="row">
              <span role="columnheader">Cơ sở</span>
              <span role="columnheader">Phòng</span>
              <span role="columnheader">Có HĐ</span>
              <span role="columnheader">Trống</span>
              <span role="columnheader">Lấp đầy</span>
              <span role="columnheader">Rent cam kết</span>
            </div>
            {dashboard.topProperties.map((property) => (
              <div
                className="area-table__row admin-property-row"
                role="row"
                key={property.id}
              >
                <span role="cell">
                  <strong>{property.name}</strong>
                  <small>
                    {property.code}
                    {property.addressText
                      ? " · " + property.addressText
                      : ""}
                  </small>
                </span>
                <span role="cell">
                  {fmt.number(property.activeRooms)}
                </span>
                <span role="cell">
                  {fmt.number(property.occupiedRooms)}
                </span>
                <span role="cell">
                  {fmt.number(property.vacantRooms)}
                </span>
                <span role="cell">
                  {fmt.percent(property.occupancyRatePercent)}
                </span>
                <span role="cell">
                  {fmt.money(property.contractedMonthlyRentVnd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="prototype-note">
        Dashboard này chỉ dùng dữ liệu domain đã có trong PostgreSQL.
        “Đã thu / công nợ tiền trọ” chưa hiển thị cho tới khi renter
        invoice/payment domain được triển khai; không dùng số demo để lấp chỗ trống.
      </p>
    </AdminShell>
  );
}
