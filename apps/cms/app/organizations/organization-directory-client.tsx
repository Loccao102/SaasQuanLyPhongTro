"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { StatusBadge } from "@propops/ui";
import {
  cmsOrganizationsApi,
  type CmsOrganizationDirectoryItem
} from "../../lib/cms-organizations-api";

type FilterState = {
  query: string;
  plan: string;
  status: string;
  organizationStatus: string;
  delinquent: string;
  overLimit: string;
};

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

function optionalBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function buildUrl(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.plan) params.set("plan", filters.plan);
  if (filters.status) params.set("status", filters.status);
  if (filters.organizationStatus) {
    params.set("organizationStatus", filters.organizationStatus);
  }
  if (filters.delinquent) params.set("delinquent", filters.delinquent);
  if (filters.overLimit) params.set("overLimit", filters.overLimit);
  return "/organizations" + (params.size ? "?" + params.toString() : "");
}

export function OrganizationDirectoryClient({
  initialFilters
}: {
  initialFilters: FilterState;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [items, setItems] = useState<CmsOrganizationDirectoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append = false, cursor?: string) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const result = await cmsOrganizationsApi.search({
          query: appliedFilters.query.trim() || undefined,
          plan: appliedFilters.plan || undefined,
          status: appliedFilters.status || undefined,
          organizationStatus: appliedFilters.organizationStatus || undefined,
          delinquent: optionalBoolean(appliedFilters.delinquent),
          overLimit: optionalBoolean(appliedFilters.overLimit),
          limit: 25,
          cursor
        });

        setItems((current) =>
          append ? [...current, ...result.items] : result.items
        );
        setNextCursor(result.nextCursor);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Không thể tải danh sách organization."
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appliedFilters]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const plans = useMemo(
    () =>
      [...new Set(items.map((item) => item.planCode).filter(Boolean))].sort() as string[],
    [items]
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = { ...filters };
    setAppliedFilters(next);
    window.history.replaceState(null, "", buildUrl(next));
  }

  function clearFilters() {
    const empty: FilterState = {
      query: "",
      plan: "",
      status: "",
      organizationStatus: "",
      delinquent: "",
      overLimit: ""
    };
    setFilters(empty);
    setAppliedFilters(empty);
    window.history.replaceState(null, "", "/organizations");
  }

  return (
    <main className="directory-shell">
      <header className="directory-header">
        <div>
          <a className="directory-back" href="/">← Control Plane</a>
          <span className="cms-eyebrow">CMS · ORGANIZATION DIRECTORY</span>
          <h1>Organizations</h1>
          <p>
            Tìm tenant theo tên, slug, owner hoặc UUID; lọc trạng thái thương mại
            và usage mà không tải toàn bộ dữ liệu vào browser.
          </p>
        </div>
        <a className="secondary-button directory-link-button" href="/">
          Tổng quan CMS
        </a>
      </header>

      <section className="cms-panel">
        <form className="organization-search-form" onSubmit={submit}>
          <label className="organization-search-form__query">
            Tìm organization
            <input
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  query: event.target.value
                }))
              }
              placeholder="Tên, slug, owner hoặc UUID"
            />
          </label>

          <label>
            Plan
            <input
              list="organization-plan-options"
              value={filters.plan}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  plan: event.target.value
                }))
              }
              placeholder="Tất cả"
            />
            <datalist id="organization-plan-options">
              {plans.map((plan) => (
                <option key={plan} value={plan} />
              ))}
            </datalist>
          </label>

          <label>
            Subscription
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value
                }))
              }
            >
              <option value="">Tất cả</option>
              <option value="UNASSIGNED">UNASSIGNED</option>
              <option value="TRIALING">TRIALING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAST_DUE">PAST_DUE</option>
              <option value="GRACE_PERIOD">GRACE_PERIOD</option>
              <option value="SUSPENDED">SUSPENDED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </label>

          <label>
            Tenant status
            <select
              value={filters.organizationStatus}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  organizationStatus: event.target.value
                }))
              }
            >
              <option value="">Tất cả</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>

          <label>
            Delinquency
            <select
              value={filters.delinquent}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  delinquent: event.target.value
                }))
              }
            >
              <option value="">Tất cả</option>
              <option value="true">Có delinquency</option>
              <option value="false">Không delinquency</option>
            </select>
          </label>

          <label>
            Limit
            <select
              value={filters.overLimit}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  overLimit: event.target.value
                }))
              }
            >
              <option value="">Tất cả</option>
              <option value="true">Over limit</option>
              <option value="false">Trong limit</option>
            </select>
          </label>

          <div className="organization-search-form__actions">
            <button className="primary-button" type="submit">
              Áp dụng
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={clearFilters}
            >
              Xóa lọc
            </button>
          </div>
        </form>

        {error ? (
          <div className="cms-state cms-state--error">
            <strong>Không thể tải organizations.</strong>
            <span>{error}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void load()}
            >
              Thử lại
            </button>
          </div>
        ) : loading ? (
          <div className="cms-state">Đang tải organizations…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            Không có organization phù hợp với bộ lọc hiện tại.
          </div>
        ) : (
          <>
            <div className="cms-table-wrap">
              <table className="cms-table organization-directory-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Plan</th>
                    <th>Subscription</th>
                    <th>Billing</th>
                    <th>Rooms</th>
                    <th>Staff</th>
                    <th>Flags</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((organization) => (
                    <tr key={organization.id}>
                      <td>
                        <strong>{organization.name}</strong>
                        <small>
                          {organization.slug} · {organization.ownerName ?? "No active owner"}
                        </small>
                      </td>
                      <td>{organization.planCode ?? "—"}</td>
                      <td>
                        <StatusBadge tone={tone(organization.subscriptionStatus)}>
                          {organization.subscriptionStatus}
                        </StatusBadge>
                        <small>{organization.status}</small>
                      </td>
                      <td>
                        {organization.latestInvoice ? (
                          <>
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
                            <small>
                              {money(organization.latestInvoice.remainingAmountVnd)} còn lại
                            </small>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {organization.rooms} / {organization.roomLimit ?? "—"}
                      </td>
                      <td>
                        {organization.staff} / {organization.staffLimit ?? "—"}
                      </td>
                      <td>
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
                      </td>
                      <td>
                        <a
                          className="text-button"
                          href={"/organizations/" + organization.id}
                        >
                          Chi tiết
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="organization-directory-footer">
              <span className="cms-note">
                Đã tải {items.length.toLocaleString("vi-VN")} organization
              </span>
              {nextCursor ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void load(true, nextCursor)}
                >
                  {loadingMore ? "Đang tải…" : "Tải thêm"}
                </button>
              ) : (
                <span className="cms-note">Đã đến cuối danh sách.</span>
              )}
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
