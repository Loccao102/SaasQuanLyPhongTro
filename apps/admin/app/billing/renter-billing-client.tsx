"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MoneyDisplay, StatusBadge } from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminAssetPropertySummary
} from "../../lib/admin-assets-api";
import {
  renterBillingApi,
  type RenterBillingCycle
} from "../../lib/renter-billing-api";

function statusTone(status: RenterBillingCycle["status"]) {
  if (status === "FINALIZED") return "success" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "warning" as const;
}

export function RenterBillingClient() {
  const [cycles, setCycles] = useState<RenterBillingCycle[]>([]);
  const [properties, setProperties] = useState<AdminAssetPropertySummary[]>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billing, assets] = await Promise.all([
        renterBillingApi.list(),
        adminAssetsApi.overview()
      ]);
      setCycles(billing.cycles);
      setProperties(assets.properties);
      setOrganizationName(billing.organization.name);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải kỳ hóa đơn."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    setActionMessage(null);
    try {
      await renterBillingApi.createCycle({
        id: crypto.randomUUID(),
        propertyId: String(form.get("propertyId") ?? ""),
        code: String(form.get("code") ?? ""),
        periodStart: String(form.get("periodStart") ?? ""),
        periodEnd: String(form.get("periodEnd") ?? ""),
        dueDate: String(form.get("dueDate") ?? "")
      });
      event.currentTarget.reset();
      setActionMessage("Đã tạo kỳ hóa đơn OPEN.");
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể tạo kỳ hóa đơn."
      );
    } finally {
      setSaving(false);
    }
  }

  async function generate(cycleId: string) {
    setSaving(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = await renterBillingApi.generateRentDrafts(cycleId);
      const changed = result.created + result.refreshed;
      setActionMessage(
        result.requiresReview
          ? "Đã tính lại " +
              changed +
              " hóa đơn; " +
              result.reviewRequiredInvoiceCount +
              " hóa đơn thiếu biểu giá/chỉ số và " +
              result.partialLeaseCount +
              " hợp đồng giữa kỳ cần review."
          : "Đã tính đủ dữ liệu cho " + changed + " hóa đơn nháp."
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể sinh rent draft."
      );
    } finally {
      setSaving(false);
    }
  }

  async function finalize(cycleId: string) {
    setSaving(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = await renterBillingApi.finalizeCycle(cycleId);
      setActionMessage(
        "Đã issue " +
          result.invoiceCount +
          " hóa đơn · " +
          new Intl.NumberFormat("vi-VN").format(result.totalVnd) +
          " VND."
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể finalize kỳ hóa đơn."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title="Hóa đơn tiền thuê"
      eyebrow="RENTER BILLING · LIVE DATA"
      activeNav="Hóa đơn"
    >
      <section className="asset-context">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2>{organizationName || "Renter billing"}</h2>
          <p>
            Billing thuê phòng tách biệt hoàn toàn với SaaS subscription billing.
          </p>
        </div>
        <StatusBadge tone="info">INTEGER VND</StatusBadge>
      </section>

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Billing chưa hoàn tất thao tác.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {actionMessage ? (
        <div className="admin-state admin-state--success">
          <strong>Đã cập nhật.</strong>
          <span>{actionMessage}</span>
        </div>
      ) : null}

      <section className="panel">
        <div className="asset-section-heading">
          <div>
            <span className="eyebrow">BILLING.MANAGE</span>
            <h2>Tạo kỳ hóa đơn</h2>
          </div>
        </div>
        <form className="asset-form" onSubmit={(event) => void createCycle(event)}>
          <label>
            <span>Cơ sở</span>
            <select name="propertyId" required defaultValue="">
              <option value="" disabled>Chọn cơ sở</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.code} · {property.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Mã kỳ</span>
            <input name="code" required placeholder="T10-2026-TX01" />
          </label>
          <label>
            <span>Từ ngày</span>
            <input name="periodStart" type="date" required />
          </label>
          <label>
            <span>Đến ngày</span>
            <input name="periodEnd" type="date" required />
          </label>
          <label>
            <span>Hạn thanh toán</span>
            <input name="dueDate" type="date" required />
          </label>
          <div className="button-row">
            <button className="primary-button" type="submit" disabled={saving}>
              + Tạo kỳ
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="asset-section-heading">
          <div>
            <span className="eyebrow">BILLING CYCLES</span>
            <h2>Các kỳ hóa đơn</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="admin-state">Đang tải kỳ hóa đơn…</div>
        ) : cycles.length === 0 ? (
          <div className="admin-state">
            <strong>Chưa có kỳ hóa đơn.</strong>
            <span>Tạo kỳ đầu tiên theo từng cơ sở để bắt đầu.</span>
          </div>
        ) : (
          <div className="billing-cycle-list">
            {cycles.map((cycle) => (
              <article className="billing-cycle-card" key={cycle.id}>
                <div className="billing-cycle-card__heading">
                  <div>
                    <span className="eyebrow">{cycle.property.code}</span>
                    <h3>{cycle.code}</h3>
                    <p>
                      {cycle.periodStart} → {cycle.periodEnd} · hạn {cycle.dueDate}
                    </p>
                  </div>
                  <StatusBadge tone={statusTone(cycle.status)}>
                    {cycle.status}
                  </StatusBadge>
                </div>
                <div className="billing-cycle-card__stats">
                  <div><span>Invoice</span><strong>{cycle.invoiceCount}</strong></div>
                  <div><span>Draft</span><strong>{cycle.draftCount}</strong></div>
                  <div><span>Issued</span><strong>{cycle.issuedCount}</strong></div>
                  <div>
                    <span>Tổng</span>
                    <strong><MoneyDisplay amountVnd={cycle.totalVnd} /></strong>
                  </div>
                </div>
                <div className="button-row">
                  <a
                    className="secondary-link-button"
                    href={"/billing/cycles/" + cycle.id}
                  >
                    Chi tiết
                  </a>
                  {cycle.status === "OPEN" ? (
                    <>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={saving}
                        onClick={() => void generate(cycle.id)}
                      >
                        Tính hóa đơn nháp
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={saving || cycle.draftCount === 0}
                        onClick={() => void finalize(cycle.id)}
                      >
                        Finalize & issue
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="inline-note">
        Hóa đơn nháp snapshot tiền phòng, điện, nước và phí dịch vụ theo biểu giá
        đang hiệu lực. Thiếu biểu giá/chỉ số hoặc có hợp đồng vào/ra giữa kỳ sẽ
        được đánh dấu review và bị chặn phát hành.
      </p>
    </AdminShell>
  );
}
