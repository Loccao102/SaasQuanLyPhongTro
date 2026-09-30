"use client";
import {
  DateInput } from "@propops/ui/date-input";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent
} from "react";
import { ArrowLeftOutlined } from "@ant-design/icons";
import {
  MoneyDisplay,
  PageHeader,
  SectionHeader,
  StatusBadge,
  formatDateVi
} from "@propops/ui";
import { AdminShell } from "../../../components/admin-shell";
import {
  adminAssetsApi,
  type AdminAssetPropertySummary
} from "../../../lib/admin-assets-api";
import {
  pricingApi,
  type CreatePricingPolicyInput,
  type PricingItem,
  type PricingItemType,
  type PricingListResponse
} from "../../../lib/pricing-api";

const itemLabels: Record<PricingItemType, string> = {
  ELECTRICITY_PER_KWH: "Điện (đồng hồ kWh)",
  ELECTRICITY_PER_PERSON: "Điện (theo đầu người)",
  ELECTRICITY_PER_ROOM: "Điện (khoán theo phòng)",
  WATER_PER_M3: "Nước (đồng hồ m³)",
  WATER_PER_PERSON: "Nước (theo đầu người)",
  WATER_PER_ROOM: "Nước (khoán theo phòng)",
  VEHICLE_PARKING: "Gửi xe (theo số xe)",
  SERVICE_PER_PERSON: "Dịch vụ (theo đầu người)",
  INTERNET: "Internet",
  PARKING: "Gửi xe (khoán phòng)",
  TRASH: "Rác / vệ sinh",
  ELEVATOR: "Thang máy",
  CUSTOM: "Phí khác"
};

function itemUnit(itemType: PricingItemType) {
  switch (itemType) {
    case "ELECTRICITY_PER_KWH":
      return "/ kWh";
    case "WATER_PER_M3":
      return "/ m³";
    case "ELECTRICITY_PER_PERSON":
    case "WATER_PER_PERSON":
    case "SERVICE_PER_PERSON":
      return "/ người / tháng";
    case "VEHICLE_PARKING":
      return "/ xe / tháng";
    case "ELECTRICITY_PER_ROOM":
    case "WATER_PER_ROOM":
    case "INTERNET":
    case "PARKING":
    case "TRASH":
    case "ELEVATOR":
      return "/ phòng / tháng";
    default:
      return "/ đơn vị";
  }
}

function readOptionalMoney(form: FormData, field: string): number | null {
  const raw = String(form.get(field) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Mức giá phải là số nguyên VND không âm.");
  }
  return value;
}

function policyRange(effectiveFrom: string, effectiveTo: string | null) {
  return effectiveTo
    ? formatDateVi(effectiveFrom) + " – " + formatDateVi(effectiveTo)
    : formatDateVi(effectiveFrom) + " – không thời hạn";
}

function PolicyItems({ items }: { items: PricingItem[] }) {
  if (items.length === 0) {
    return (
      <div className="admin-state">
        <span>Không có phí điện, nước hoặc dịch vụ bổ sung trong policy này.</span>
      </div>
    );
  }

  return (
    <div className="renter-invoice-lines">
      {items.map((item) => (
        <div className="renter-invoice-line" key={item.id}>
          <div>
            <strong>{item.description}</strong>
            <span>
              {itemLabels[item.itemType]} · số lượng mặc định {item.fixedQuantity}
            </span>
          </div>
          <strong>
            <MoneyDisplay amountVnd={item.unitPriceVnd} /> {itemUnit(item.itemType)}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function PricingSetupClient() {
  const [properties, setProperties] = useState<AdminAssetPropertySummary[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [pricing, setPricing] = useState<PricingListResponse | null>(null);
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<CreatePricingPolicyInput | null>(null);
  const [electricityMode, setElectricityMode] = useState<
    "ELECTRICITY_PER_KWH" | "ELECTRICITY_PER_PERSON" | "ELECTRICITY_PER_ROOM"
  >("ELECTRICITY_PER_KWH");
  const [waterMode, setWaterMode] = useState<
    "WATER_PER_M3" | "WATER_PER_PERSON" | "WATER_PER_ROOM"
  >("WATER_PER_M3");
  const [parkingMode, setParkingMode] = useState<
    "VEHICLE_PARKING" | "PARKING" | "NONE"
  >("VEHICLE_PARKING");

  const loadPricing = useCallback(async (propertyId: string) => {
    if (!propertyId) {
      setPricing(null);
      return;
    }
    setLoadingPricing(true);
    setPricing(null);
    setError(null);
    try {
      setPricing(await pricingApi.listForProperty(propertyId));
    } catch (loadError) {
      setPricing(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không thể tải biểu giá."
      );
    } finally {
      setLoadingPricing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadProperties() {
      setLoadingProperties(true);
      setError(null);
      try {
        const assets = await adminAssetsApi.overview();
        if (!active) return;
        setProperties(assets.properties);
        const firstPropertyId = assets.properties[0]?.id ?? "";
        setSelectedPropertyId(firstPropertyId);
        if (firstPropertyId) {
          await loadPricing(firstPropertyId);
        }
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Không thể tải danh sách cơ sở."
        );
      } finally {
        if (active) setLoadingProperties(false);
      }
    }

    void loadProperties();
    return () => {
      active = false;
    };
  }, [loadPricing]);

  async function selectProperty(propertyId: string) {
    setSelectedPropertyId(propertyId);
    setPending(null);
    setSuccess(null);
    await loadPricing(propertyId);
  }

  function preparePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      const form = new FormData(event.currentTarget);
      const items: CreatePricingPolicyInput["items"] = [];

      const addItem = (
        field: string,
        itemType: PricingItemType,
        description: string,
        sortOrder: number
      ) => {
        const unitPriceVnd = readOptionalMoney(form, field);
        if (unitPriceVnd === null) return;
        const isDynamic =
          itemType === "ELECTRICITY_PER_KWH" ||
          itemType === "ELECTRICITY_PER_PERSON" ||
          itemType === "ELECTRICITY_PER_ROOM" ||
          itemType === "WATER_PER_M3" ||
          itemType === "WATER_PER_PERSON" ||
          itemType === "WATER_PER_ROOM" ||
          itemType === "VEHICLE_PARKING" ||
          itemType === "SERVICE_PER_PERSON";
        items.push({
          id: crypto.randomUUID(),
          itemType,
          description,
          unitPriceVnd,
          fixedQuantity: isDynamic ? undefined : 1,
          sortOrder
        });
      };

      if (electricityMode === "ELECTRICITY_PER_PERSON") {
        addItem("electricityPriceVnd", "ELECTRICITY_PER_PERSON", "Tiền điện (theo người)", 20);
      } else if (electricityMode === "ELECTRICITY_PER_ROOM") {
        addItem("electricityPriceVnd", "ELECTRICITY_PER_ROOM", "Tiền điện (khoán phòng)", 20);
      } else {
        addItem("electricityPriceVnd", "ELECTRICITY_PER_KWH", "Tiền điện", 20);
      }

      if (waterMode === "WATER_PER_PERSON") {
        addItem("waterPriceVnd", "WATER_PER_PERSON", "Tiền nước (theo người)", 30);
      } else if (waterMode === "WATER_PER_ROOM") {
        addItem("waterPriceVnd", "WATER_PER_ROOM", "Tiền nước (khoán phòng)", 30);
      } else {
        addItem("waterPriceVnd", "WATER_PER_M3", "Tiền nước", 30);
      }

      if (parkingMode === "VEHICLE_PARKING") {
        addItem("parkingPriceVnd", "VEHICLE_PARKING", "Phí gửi xe máy", 40);
      } else if (parkingMode === "PARKING") {
        addItem("parkingPriceVnd", "PARKING", "Phí gửi xe (khoán phòng)", 40);
      }

      addItem(
        "servicePerPersonPriceVnd",
        "SERVICE_PER_PERSON",
        "Phí dịch vụ chung (theo người)",
        50
      );
      addItem("elevatorPriceVnd", "ELEVATOR", "Phí thang máy", 55);
      addItem("internetPriceVnd", "INTERNET", "Internet", 60);
      addItem("trashPriceVnd", "TRASH", "Rác / vệ sinh", 70);

      const effectiveFrom = String(form.get("effectiveFrom") ?? "");
      const effectiveTo = String(form.get("effectiveTo") ?? "") || null;
      if (effectiveTo && effectiveTo < effectiveFrom) {
        throw new Error("Ngày kết thúc hiệu lực không thể trước ngày bắt đầu.");
      }

      setPending({
        id: crypto.randomUUID(),
        propertyId: selectedPropertyId,
        name: String(form.get("name") ?? "").trim(),
        effectiveFrom,
        effectiveTo,
        items
      });
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "Không thể chuẩn bị biểu giá."
      );
    }
  }

  async function confirmCreate() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await pricingApi.createPolicy(pending);
      setSuccess(
        "Đã tạo biểu giá " +
          pending.name +
          ". Hóa đơn nháp trong khoảng hiệu lực sẽ snapshot mức giá này."
      );
      setPending(null);
      await loadPricing(pending.propertyId);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Không thể tạo biểu giá."
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedProperty = properties.find(
    (property) => property.id === selectedPropertyId
  );

  return (
    <AdminShell
      title="Cấu hình biểu giá"
      eyebrow="RENTER BILLING · PRICING"
      activeNav="Hóa đơn"
    >
      <PageHeader
        eyebrow="BILLING.MANAGE"
        title="Biểu giá theo cơ sở"
        description="Policy mới chỉ áp dụng cho kỳ nằm trọn trong khoảng hiệu lực. Hóa đơn đã phát hành giữ nguyên snapshot lịch sử."
        action={
          <a className="secondary-link-button" href="/billing">
            <ArrowLeftOutlined aria-hidden="true" /> Kỳ hóa đơn
          </a>
        }
      />

      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Thao tác biểu giá chưa hoàn tất.</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="admin-state admin-state--success">
          <strong>Đã cập nhật biểu giá.</strong>
          <span>{success}</span>
        </div>
      ) : null}

      <section className="panel">
        <SectionHeader title="Chọn cơ sở" />
        {loadingProperties ? (
          <div className="admin-state">Đang tải cơ sở…</div>
        ) : properties.length === 0 ? (
          <div className="admin-state">
            <strong>Chưa có cơ sở trong scope hiện tại.</strong>
            <span>Tạo cơ sở hoặc kiểm tra lại membership scope trước.</span>
          </div>
        ) : (
          <div className="asset-form">
            <label>
              <span>Cơ sở áp dụng</span>
              <select
                value={selectedPropertyId}
                onChange={(event) => void selectProperty(event.target.value)}
              >
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.code} · {property.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>

      {selectedPropertyId && pricing?.permissions.manage ? (
        <section className="panel">
          <SectionHeader title="Tạo biểu giá mới" />
          <p className="inline-note">
            Tạo policy mới thay vì sửa policy lịch sử. Khoảng hiệu lực không được
            chồng lấn với policy đã có của {selectedProperty?.name ?? "cơ sở"}.
          </p>
          <form className="asset-form" onSubmit={preparePolicy}>
            <label>
              <span>Tên biểu giá</span>
              <input
                name="name"
                required
                placeholder="Biểu giá 2026 · Cơ sở Hà Đông"
              />
            </label>
            <label>
              <span>Hiệu lực từ</span>
              <DateInput name="effectiveFrom"  required />
            </label>
            <label>
              <span>Hiệu lực đến</span>
              <DateInput name="effectiveTo"  required />
              <small>
                Admin baseline dùng khoảng hữu hạn để policy kế tiếp không bị
                chồng lấn.
              </small>
            </label>
            <div style={{ display: "grid", gap: "0.5rem", padding: "0.75rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))", borderRadius: "8px", border: "1px solid var(--border-color, #e5e7eb)" }}>
              <label>
                <span style={{ fontWeight: 600 }}>Phương thức tính tiền điện</span>
                <select
                  value={electricityMode}
                  onChange={(e) =>
                    setElectricityMode(e.target.value as typeof electricityMode)
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.625rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #d1d5db)",
                    background: "var(--bg-surface, #fff)",
                    fontSize: "0.875rem"
                  }}
                >
                  <option value="ELECTRICITY_PER_KWH">Theo đồng hồ điện (VND/kWh)</option>
                  <option value="ELECTRICITY_PER_PERSON">Theo số người ở (VND/người/tháng)</option>
                  <option value="ELECTRICITY_PER_ROOM">Khoán cố định phòng (VND/phòng/tháng)</option>
                </select>
              </label>
              <label>
                <span>
                  {electricityMode === "ELECTRICITY_PER_KWH"
                    ? "Đơn giá điện · VND/kWh"
                    : electricityMode === "ELECTRICITY_PER_PERSON"
                    ? "Đơn giá điện · VND/người/tháng"
                    : "Đơn giá điện · VND/phòng/tháng"}
                </span>
                <input
                  name="electricityPriceVnd"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder={
                    electricityMode === "ELECTRICITY_PER_KWH"
                      ? "3500"
                      : electricityMode === "ELECTRICITY_PER_PERSON"
                      ? "100000"
                      : "300000"
                  }
                />
              </label>
            </div>

            <div style={{ display: "grid", gap: "0.5rem", padding: "0.75rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))", borderRadius: "8px", border: "1px solid var(--border-color, #e5e7eb)" }}>
              <label>
                <span style={{ fontWeight: 600 }}>Phương thức tính tiền nước</span>
                <select
                  value={waterMode}
                  onChange={(e) =>
                    setWaterMode(e.target.value as typeof waterMode)
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.625rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #d1d5db)",
                    background: "var(--bg-surface, #fff)",
                    fontSize: "0.875rem"
                  }}
                >
                  <option value="WATER_PER_M3">Theo đồng hồ nước (VND/m³)</option>
                  <option value="WATER_PER_PERSON">Theo số người ở (VND/người/tháng)</option>
                  <option value="WATER_PER_ROOM">Khoán cố định phòng (VND/phòng/tháng)</option>
                </select>
              </label>
              <label>
                <span>
                  {waterMode === "WATER_PER_M3"
                    ? "Đơn giá nước · VND/m³"
                    : waterMode === "WATER_PER_PERSON"
                    ? "Đơn giá nước · VND/người/tháng"
                    : "Đơn giá nước · VND/phòng/tháng"}
                </span>
                <input
                  name="waterPriceVnd"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder={waterMode === "WATER_PER_M3" ? "15000" : "100000"}
                />
              </label>
            </div>

            <div style={{ display: "grid", gap: "0.5rem", padding: "0.75rem", background: "var(--bg-subtle, rgba(0,0,0,0.02))", borderRadius: "8px", border: "1px solid var(--border-color, #e5e7eb)" }}>
              <label>
                <span style={{ fontWeight: 600 }}>Phương thức tính phí gửi xe</span>
                <select
                  value={parkingMode}
                  onChange={(e) =>
                    setParkingMode(e.target.value as typeof parkingMode)
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.625rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #d1d5db)",
                    background: "var(--bg-surface, #fff)",
                    fontSize: "0.875rem"
                  }}
                >
                  <option value="VEHICLE_PARKING">Theo số lượng xe máy đăng ký (VND/xe/tháng)</option>
                  <option value="PARKING">Khoán cố định phòng (VND/phòng/tháng)</option>
                  <option value="NONE">Không thu phí gửi xe</option>
                </select>
              </label>
              {parkingMode !== "NONE" && (
                <label>
                  <span>
                    {parkingMode === "VEHICLE_PARKING"
                      ? "Phí gửi xe · VND/xe/tháng"
                      : "Phí gửi xe · VND/phòng/tháng"}
                  </span>
                  <input
                    name="parkingPriceVnd"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="100000"
                  />
                </label>
              )}
            </div>

            <label>
              <span>Phí dịch vụ theo đầu người · VND/người/tháng (vệ sinh...)</span>
              <input
                name="servicePerPersonPriceVnd"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="50000"
              />
            </label>
            <label>
              <span>Phí thang máy · VND/phòng/tháng</span>
              <input
                name="elevatorPriceVnd"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="50000"
              />
            </label>
            <label>
              <span>Internet · VND/tháng</span>
              <input
                name="internetPriceVnd"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="100000"
              />
            </label>
            <label>
              <span>Rác / vệ sinh · VND/tháng</span>
              <input
                name="trashPriceVnd"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="50000"
              />
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit" disabled={saving}>
                Xem lại biểu giá
              </button>
            </div>
          </form>
        </section>
      ) : selectedPropertyId && pricing && !pricing.permissions.manage ? (
        <div className="admin-state">
          <strong>Chỉ đọc biểu giá.</strong>
          <span>
            Membership hiện tại không có billing.manage trên cơ sở này.
          </span>
        </div>
      ) : null}

      {pending ? (
        <section className="panel">
          <SectionHeader
            title="Xác nhận biểu giá"
            action={<StatusBadge tone="warning">FINANCIAL CHANGE</StatusBadge>}
          />
          <dl className="detail-list">
            <div>
              <dt>Cơ sở</dt>
              <dd>{selectedProperty?.name ?? pending.propertyId}</dd>
            </div>
            <div>
              <dt>Tên policy</dt>
              <dd>{pending.name}</dd>
            </div>
            <div>
              <dt>Khoảng hiệu lực</dt>
              <dd>{policyRange(pending.effectiveFrom, pending.effectiveTo)}</dd>
            </div>
          </dl>

          {pending.items.length === 0 ? (
            <div className="admin-state">
              <strong>Policy không có phí bổ sung.</strong>
              <span>
                Trong khoảng này hệ thống chỉ snapshot tiền phòng từ hợp đồng.
              </span>
            </div>
          ) : (
            <div className="renter-invoice-lines">
              {pending.items.map((item) => (
                <div className="renter-invoice-line" key={item.id}>
                  <div>
                    <strong>{item.description}</strong>
                    <span>{itemLabels[item.itemType]}</span>
                  </div>
                  <strong>
                    <MoneyDisplay amountVnd={item.unitPriceVnd} />{" "}
                    {itemUnit(item.itemType)}
                  </strong>
                </div>
              ))}
            </div>
          )}

          <p className="inline-note">
            Sau khi tạo, policy này được xem là cấu hình lịch sử chỉ đọc. Khi tính
            hóa đơn nháp, mô tả, số lượng, đơn giá và meter readings sẽ được
            snapshot vào invoice lines; hóa đơn đã ISSUED không bị thay đổi.
          </p>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => setPending(null)}
            >
              Quay lại chỉnh
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={saving}
              onClick={() => void confirmCreate()}
            >
              {saving ? "Đang tạo…" : "Xác nhận tạo biểu giá"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <SectionHeader
          title="Lịch sử biểu giá"
          action={
            pricing ? (
              <StatusBadge tone="neutral">
                {pricing.policies.length} POLICY
              </StatusBadge>
            ) : null
          }
        />

        {loadingPricing ? (
          <div className="admin-state">Đang tải biểu giá…</div>
        ) : !selectedPropertyId ? (
          <div className="admin-state">Chọn cơ sở để xem biểu giá.</div>
        ) : !pricing || pricing.policies.length === 0 ? (
          <div className="admin-state">
            <strong>Chưa có biểu giá.</strong>
            <span>
              Hóa đơn có utility/service sẽ REVIEW_REQUIRED cho tới khi có policy
              bao phủ toàn bộ kỳ.
            </span>
          </div>
        ) : (
          <div className="billing-cycle-list">
            {pricing.policies.map((policy) => (
              <article className="billing-cycle-card" key={policy.id}>
                <div className="billing-cycle-card__heading">
                  <div>
                    <span className="eyebrow">IMMUTABLE SNAPSHOT SOURCE</span>
                    <h3>{policy.name}</h3>
                    <p>
                      {policyRange(policy.effectiveFrom, policy.effectiveTo)}
                    </p>
                  </div>
                  <StatusBadge tone="neutral">READ ONLY</StatusBadge>
                </div>
                <PolicyItems items={policy.items} />
              </article>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
