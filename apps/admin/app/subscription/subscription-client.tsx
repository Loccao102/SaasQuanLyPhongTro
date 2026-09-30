"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircleOutlined,
  CopyOutlined,
  CreditCardOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import {
  MoneyDisplay,
  PageHeader,
  ProgressBar,
  StatusBadge,
  formatDateVi
} from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminSubscriptionApi,
  type SubscriptionInvoiceItem,
  type TenantSubscriptionOverview,
  type TenantSubscriptionPlanView,
  type UpgradeResponse
} from "../../lib/admin-subscription-api";

function statusTone(status: string) {
  switch (status) {
    case "ACTIVE":
    case "PAID":
      return "success" as const;
    case "TRIALING":
    case "OPEN":
    case "PARTIALLY_PAID":
    case "GRACE_PERIOD":
      return "warning" as const;
    case "PAST_DUE":
    case "SUSPENDED":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "TRIALING":
      return "ĐANG DÙNG THỬ";
    case "ACTIVE":
      return "ĐANG HOẠT ĐỘNG";
    case "PAST_DUE":
      return "QUÁ HẠN";
    case "GRACE_PERIOD":
      return "ÂN HẠN THANH TOÁN";
    case "SUSPENDED":
      return "TẠM KHÓA";
    case "CANCELLED":
      return "ĐÃ HỦY";
    case "PAID":
      return "ĐÃ THANH TOÁN";
    case "OPEN":
      return "CHỜ THANH TOÁN";
    case "VOID":
      return "ĐÃ HỦY";
    default:
      return status;
  }
}

export function SubscriptionClient() {
  const [data, setData] = useState<TenantSubscriptionOverview | null>(null);
  const [invoices, setInvoices] = useState<SubscriptionInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"MONTHLY" | "YEARLY">("MONTHLY");

  // Payment Modal State
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [currentPayment, setCurrentPayment] = useState<UpgradeResponse | TenantSubscriptionOverview["pendingInvoice"] | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, invoicesRes] = await Promise.all([
        adminSubscriptionApi.getOverview(),
        adminSubscriptionApi.listInvoices().catch(() => ({ invoices: [] }))
      ]);
      setData(overviewRes);
      setInvoices(invoicesRes.invoices);
      if (overviewRes.pendingInvoice) {
        setCurrentPayment(overviewRes.pendingInvoice);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải thông tin gói dịch vụ.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSelectPlan(plan: TenantSubscriptionPlanView) {
    setUpgrading(true);
    setError(null);
    try {
      const res = await adminSubscriptionApi.upgrade({
        targetPlanCode: plan.code,
        billingInterval
      });
      setCurrentPayment(res);
      setPaymentSuccess(false);
      setQrModalOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không thể tạo yêu cầu nâng cấp gói.");
    } finally {
      setUpgrading(false);
    }
  }

  async function handleCheckPayment() {
    if (!currentPayment) return;
    const invId = "invoiceId" in currentPayment ? currentPayment.invoiceId : currentPayment.id;
    setCheckingPayment(true);
    try {
      const res = await adminSubscriptionApi.checkInvoiceStatus(invId);
      if (res.paid) {
        setPaymentSuccess(true);
        await loadData();
      } else {
        alert("Hệ thống chưa nhận được thông tin chuyển khoản từ ngân hàng. Vui lòng thử lại sau vài giây.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Chưa thể kiểm tra trạng thái thanh toán.");
    } finally {
      setCheckingPayment(false);
    }
  }

  function copyToClipboard(text: string, fieldName: string) {
    void navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  }

  return (
    <AdminShell title="Gói dịch vụ SaaS" activeNav="Gói dịch vụ">
      <PageHeader
        eyebrow="SAAS SUBSCRIPTION & BILLING"
        title="Gói dịch vụ & Nâng cấp"
        description="Theo dõi gói cước đang sử dụng, hạn mức số phòng, nhân viên quản lý và thanh toán nâng cấp tự động qua mã VietQR."
        action={
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <ReloadOutlined aria-hidden="true" /> {loading ? "Đang tải…" : "Làm mới"}
          </button>
        }
      />

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Lỗi tải dữ liệu:</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void loadData()}>
            Thử lại
          </button>
        </div>
      ) : loading || !data ? (
        <div className="admin-state">Đang tải thông tin gói cước…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* PENDING PAYMENT ALERT BANNER */}
          {data.pendingInvoice ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "16px",
                padding: "16px 20px",
                borderRadius: "8px",
                backgroundColor: "#fffbeb",
                border: "1px solid #fde68a",
                color: "#92400e"
              }}
            >
              <div>
                <strong style={{ fontSize: "15px", display: "block", marginBottom: "4px" }}>
                  <QrcodeOutlined style={{ marginRight: 6 }} /> Bạn có 1 đơn hàng nâng cấp gói chưa thanh toán
                </strong>
                <span style={{ fontSize: "14px" }}>
                  Mã thanh toán: <strong>{data.pendingInvoice.paymentReference}</strong> — Số tiền:{" "}
                  <strong>{data.pendingInvoice.amountVnd.toLocaleString("vi-VN")} đ</strong>
                </span>
              </div>
              <button
                type="button"
                className="primary-button"
                style={{ backgroundColor: "#d97706", borderColor: "#d97706" }}
                onClick={() => {
                  setCurrentPayment(data.pendingInvoice);
                  setPaymentSuccess(false);
                  setQrModalOpen(true);
                }}
              >
                <QrcodeOutlined aria-hidden="true" /> Mở mã VietQR thanh toán
              </button>
            </div>
          ) : null}

          {/* SECTION 1: CURRENT SUBSCRIPTION SUMMARY */}
          <section className="panel">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
                marginBottom: "20px",
                borderBottom: "1px solid var(--color-border)",
                paddingBottom: "16px"
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                  <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
                    Gói hiện tại: {data.subscription.planName} ({data.subscription.planCode})
                  </h2>
                  <StatusBadge tone={statusTone(data.subscription.status)}>
                    {statusLabel(data.subscription.status)}
                  </StatusBadge>
                </div>
                <p style={{ margin: 0, fontSize: "14px", color: "var(--color-text-secondary, #64748b)" }}>
                  Chu kỳ thanh toán: <strong>{data.subscription.billingInterval === "YEARLY" ? "Theo năm" : "Theo tháng"}</strong>
                  {data.subscription.currentPeriodEnd ? (
                    <> · Hết hạn vào ngày: <strong>{formatDateVi(data.subscription.currentPeriodEnd)}</strong></>
                  ) : data.subscription.trialEndsAt ? (
                    <> · Hết hạn dùng thử: <strong>{formatDateVi(data.subscription.trialEndsAt)}</strong></>
                  ) : null}
                  {data.subscription.daysRemaining > 0 ? (
                    <span style={{ marginLeft: 8, color: "#0284c7", fontWeight: 600 }}>
                      (Còn {data.subscription.daysRemaining} ngày)
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            {/* QUOTA PROGRESS METRICS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px" }}>
              <div
                style={{
                  padding: "16px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-bg-secondary, #f8fafc)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>Số phòng trọ</span>
                  <strong style={{ fontSize: "15px" }}>
                    {data.subscription.roomUsage.current} / {data.subscription.roomUsage.limit} phòng
                  </strong>
                </div>
                <ProgressBar
                  value={data.subscription.roomUsage.current}
                  max={data.subscription.roomUsage.limit}
                  label="Số phòng trọ"
                />
                <small style={{ display: "block", marginTop: "6px", color: "var(--color-text-secondary, #64748b)" }}>
                  Đã sử dụng {data.subscription.roomUsage.percentage}% hạn mức gói
                </small>
              </div>

              <div
                style={{
                  padding: "16px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-bg-secondary, #f8fafc)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>Nhân viên quản lý</span>
                  <strong style={{ fontSize: "15px" }}>
                    {data.subscription.staffUsage.current} / {data.subscription.staffUsage.limit} nhân sự
                  </strong>
                </div>
                <ProgressBar
                  value={data.subscription.staffUsage.current}
                  max={data.subscription.staffUsage.limit}
                  label="Nhân viên quản lý"
                />
                <small style={{ display: "block", marginTop: "6px", color: "var(--color-text-secondary, #64748b)" }}>
                  Đã sử dụng {data.subscription.staffUsage.percentage}% hạn mức gói
                </small>
              </div>

              <div
                style={{
                  padding: "16px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-bg-secondary, #f8fafc)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>Tự động hóa Zalo/SMS</span>
                  <strong style={{ fontSize: "15px" }}>
                    {data.subscription.automationUsage.current.toLocaleString("vi-VN")} / {data.subscription.automationUsage.limit.toLocaleString("vi-VN")} lượt
                  </strong>
                </div>
                <ProgressBar
                  value={data.subscription.automationUsage.current}
                  max={data.subscription.automationUsage.limit}
                  label="Tự động hóa Zalo/SMS"
                />
                <small style={{ display: "block", marginTop: "6px", color: "var(--color-text-secondary, #64748b)" }}>
                  Lượt gửi thông báo tự động trong tháng
                </small>
              </div>
            </div>
          </section>

          {/* SECTION 2: PRICING COMPARISON TABLE */}
          <section className="panel">
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <h2 style={{ fontSize: "24px", fontWeight: 800, marginBottom: "8px" }}>
                Bảng so sánh các gói cước SaaS
              </h2>
              <p style={{ color: "var(--color-text-secondary, #64748b)", fontSize: "15px", marginBottom: "20px" }}>
                Lựa chọn gói phù hợp với quy mô cơ sở của bạn. Nâng cấp bất cứ lúc nào, gạch nợ tự động 100%.
              </p>

              {/* INTERVAL TOGGLE */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  backgroundColor: "var(--color-bg-secondary, #f1f5f9)",
                  padding: "4px",
                  borderRadius: "30px"
                }}
              >
                <button
                  type="button"
                  onClick={() => setBillingInterval("MONTHLY")}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "24px",
                    border: "none",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: "pointer",
                    backgroundColor: billingInterval === "MONTHLY" ? "#ffffff" : "transparent",
                    color: billingInterval === "MONTHLY" ? "var(--color-primary, #0284c7)" : "var(--color-text-secondary, #64748b)",
                    boxShadow: billingInterval === "MONTHLY" ? "0 2px 4px rgba(0,0,0,0.08)" : "none"
                  }}
                >
                  Thanh toán theo Tháng
                </button>
                <button
                  type="button"
                  onClick={() => setBillingInterval("YEARLY")}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "24px",
                    border: "none",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: "pointer",
                    backgroundColor: billingInterval === "YEARLY" ? "#ffffff" : "transparent",
                    color: billingInterval === "YEARLY" ? "var(--color-primary, #0284c7)" : "var(--color-text-secondary, #64748b)",
                    boxShadow: billingInterval === "YEARLY" ? "0 2px 4px rgba(0,0,0,0.08)" : "none"
                  }}
                >
                  Thanh toán theo Năm <span style={{ color: "#16a34a", fontSize: "12px", marginLeft: 4 }}>(Tiết kiệm ~20%)</span>
                </button>
              </div>
            </div>

            {/* PRICING CARDS GRID */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "20px" }}>
              {data.plans.map((p) => {
                const isCurrent = p.code === data.subscription.planCode;
                const price = billingInterval === "YEARLY" ? p.yearlyPriceVnd : p.monthlyPriceVnd;
                const isFeatured = p.code === "GROWTH";

                return (
                  <div
                    key={p.code}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      padding: "24px",
                      borderRadius: "12px",
                      border: isFeatured
                        ? "2px solid var(--color-primary, #0284c7)"
                        : "1px solid var(--color-border)",
                      backgroundColor: "#ffffff",
                      boxShadow: isFeatured ? "0 10px 25px -5px rgba(2, 132, 199, 0.15)" : "none",
                      position: "relative"
                    }}
                  >
                    {isFeatured ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "-12px",
                          left: "50%",
                          transform: "translateX(-50%)",
                          backgroundColor: "var(--color-primary, #0284c7)",
                          color: "#ffffff",
                          padding: "2px 12px",
                          borderRadius: "12px",
                          fontSize: "11px",
                          fontWeight: 700,
                          textTransform: "uppercase"
                        }}
                      >
                        Phổ biến nhất
                      </div>
                    ) : null}

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>{p.name}</h3>
                        {isCurrent ? (
                          <span
                            style={{
                              backgroundColor: "#e0f2fe",
                              color: "#0369a1",
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: "6px"
                            }}
                          >
                            ĐANG DÙNG
                          </span>
                        ) : null}
                      </div>

                      <div style={{ margin: "16px 0", borderBottom: "1px solid var(--color-border)", paddingBottom: "16px" }}>
                        <span style={{ fontSize: "28px", fontWeight: 800, color: "var(--color-primary, #0284c7)" }}>
                          {price.toLocaleString("vi-VN")} đ
                        </span>
                        <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #64748b)", marginLeft: 6 }}>
                          / {billingInterval === "YEARLY" ? "năm" : "tháng"}
                        </span>
                      </div>

                      {/* FEATURE LIST */}
                      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px 0", display: "flex", flexDirection: "column", gap: "10px" }}>
                        {p.features.map((feat, idx) => (
                          <li key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px" }}>
                            <CheckCircleOutlined style={{ color: "#16a34a", marginTop: "2px", flexShrink: 0 }} />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      className={isFeatured ? "primary-button" : "secondary-button"}
                      style={{ width: "100%", justifyContent: "center" }}
                      disabled={isCurrent || upgrading}
                      onClick={() => void handleSelectPlan(p)}
                    >
                      {isCurrent ? "Gói đang sử dụng" : `Nâng cấp ${p.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SECTION 3: INVOICE HISTORY */}
          <section className="panel">
            <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>
              Lịch sử hóa đơn gói SaaS
            </h3>
            {invoices.length === 0 ? (
              <div className="admin-state">Chưa có hóa đơn dịch vụ nào phát sinh.</div>
            ) : (
              <div className="lease-table" role="table" aria-label="Lịch sử hóa đơn SaaS">
                <div className="lease-table__row lease-table__head" role="row">
                  <span role="columnheader">Mã thanh toán</span>
                  <span role="columnheader">Gói cước</span>
                  <span role="columnheader">Chu kỳ</span>
                  <span role="columnheader">Số tiền</span>
                  <span role="columnheader">Kỳ sử dụng</span>
                  <span role="columnheader">Ngày thanh toán</span>
                  <span role="columnheader">Trạng thái</span>
                </div>
                {invoices.map((inv) => (
                  <div className="lease-table__row" role="row" key={inv.id}>
                    <span role="cell">
                      <strong>{inv.paymentReference}</strong>
                    </span>
                    <span role="cell">
                      <strong>{inv.planName}</strong>
                    </span>
                    <span role="cell">
                      {inv.billingInterval === "YEARLY" ? "Theo năm" : "Theo tháng"}
                    </span>
                    <strong role="cell" style={{ color: "var(--color-primary, #0284c7)" }}>
                      <MoneyDisplay amountVnd={inv.amountVnd} />
                    </strong>
                    <span role="cell">
                      <small>
                        {formatDateVi(inv.periodStart)} — {formatDateVi(inv.periodEnd)}
                      </small>
                    </span>
                    <span role="cell">
                      {inv.paidAt ? formatDateVi(inv.paidAt) : "—"}
                    </span>
                    <span role="cell">
                      <StatusBadge tone={statusTone(inv.status)}>
                        {statusLabel(inv.status)}
                      </StatusBadge>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* VIETQR PAYMENT MODAL */}
      {qrModalOpen && currentPayment ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "16px"
          }}
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: "520px",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#ffffff",
              borderRadius: "12px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              padding: "24px"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                borderBottom: "1px solid var(--color-border)",
                paddingBottom: "12px"
              }}
            >
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <CreditCardOutlined style={{ color: "var(--color-primary, #0284c7)" }} /> Thanh toán nâng cấp gói
              </h3>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setQrModalOpen(false)}
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            {paymentSuccess ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <CheckCircleOutlined style={{ fontSize: "56px", color: "#16a34a", marginBottom: "16px" }} />
                <h4 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
                  Thanh toán thành công!
                </h4>
                <p style={{ color: "var(--color-text-secondary, #64748b)", fontSize: "14px", marginBottom: "20px" }}>
                  Hệ thống đã tự động kích hoạt gói cước cho cơ sở của bạn.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  style={{ width: "100%" }}
                  onClick={() => setQrModalOpen(false)}
                >
                  Xác nhận & Bắt đầu sử dụng
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: "14px", color: "var(--color-text-secondary, #64748b)", marginBottom: "16px", textAlign: "center" }}>
                  Mở ứng dụng ngân hàng bất kỳ để quét mã QR chuyển khoản chính xác nội dung:
                </p>

                {/* VIETQR IMAGE */}
                <div style={{ textAlign: "center", marginBottom: "20px" }}>
                  <img
                    src={currentPayment.vietQrUrl}
                    alt="VietQR Chuyển Khoản"
                    style={{
                      maxWidth: "280px",
                      width: "100%",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
                    }}
                  />
                </div>

                {/* BANK TRANSFER DETAILS BOX */}
                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "20px",
                    fontSize: "13px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#64748b" }}>Ngân hàng:</span>
                    <strong>{currentPayment.bankInfo.bankName}</strong>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#64748b" }}>Số tài khoản:</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ fontSize: "14px", color: "#0284c7" }}>
                        {currentPayment.bankInfo.accountNo}
                      </strong>
                      <button
                        type="button"
                        style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b" }}
                        onClick={() => copyToClipboard(currentPayment.bankInfo.accountNo, "acc")}
                        title="Sao chép số tài khoản"
                      >
                        <CopyOutlined /> {copiedField === "acc" ? "Đã chép!" : ""}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#64748b" }}>Tên chủ tài khoản:</span>
                    <strong>{currentPayment.bankInfo.accountName}</strong>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#64748b" }}>Số tiền:</span>
                    <strong style={{ fontSize: "15px", color: "#16a34a" }}>
                      {currentPayment.amountVnd.toLocaleString("vi-VN")} đ
                    </strong>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#64748b" }}>Nội dung chuyển tiền:</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ fontSize: "15px", color: "#d97706", letterSpacing: "1px" }}>
                        {currentPayment.paymentReference}
                      </strong>
                      <button
                        type="button"
                        style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b" }}
                        onClick={() => copyToClipboard(currentPayment.paymentReference, "ref")}
                        title="Sao chép nội dung"
                      >
                        <CopyOutlined /> {copiedField === "ref" ? "Đã chép!" : ""}
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: "6px",
                    padding: "10px 12px",
                    fontSize: "12px",
                    color: "#1e40af",
                    marginBottom: "20px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8
                  }}
                >
                  <SafetyCertificateOutlined style={{ fontSize: "16px", marginTop: "2px", flexShrink: 0 }} />
                  <span>
                    Hệ thống sẽ <strong>tự động đối soát và kích hoạt gói cước ngay lập tức</strong> trong vòng 10–30 giây sau khi chuyển khoản thành công.
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setQrModalOpen(false)}
                  >
                    Đóng
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleCheckPayment()}
                    disabled={checkingPayment}
                  >
                    <ReloadOutlined aria-hidden="true" />
                    {checkingPayment ? "Đang kiểm tra…" : "Tôi đã chuyển khoản"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
