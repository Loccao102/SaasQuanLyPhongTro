"use client";

import { useEffect, useMemo, useState } from "react";
import {
  adminNotificationsApi,
  type EligibleNotificationResident
} from "../../lib/admin-notifications-api";

export type SelectedTenantRecipient = {
  recipientKey: string;
  recipientDisplayName: null;
};

export function normalizeTenantPhone(value: string): string | null {
  const cleaned = value.replace(/[\s().-]/g, "");
  if (/^0[35789]\d{8}$/.test(cleaned)) return cleaned;
  if (/^\+?84[35789]\d{8}$/.test(cleaned)) return "0" + cleaned.replace(/^\+?84/, "");
  return null;
}

/**
 * Chooses individual current lease residents, deduplicated by normalized
 * Vietnamese phone. Legal resident names are for display ONLY: Zalo account
 * display names may differ, so never send them as recipientDisplayName.
 */
export function TenantNotificationRecipientsPicker({
  onChange
}: {
  onChange: (recipients: SelectedTenantRecipient[]) => void;
}) {
  const [residents, setResidents] = useState<EligibleNotificationResident[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    void adminNotificationsApi.eligibleResidents()
      .then((response) => {
        if (!active) return;
        setResidents(response.residents);
        setTruncated(response.truncated);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Không thể tải danh sách khách đang thuê.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const { unique, invalid, duplicates } = useMemo(() => {
    const phones = new Set<string>();
    const unique: Array<EligibleNotificationResident & { normalizedPhone: string }> = [];
    let invalid = 0;
    let duplicates = 0;
    for (const resident of residents) {
      const normalizedPhone = normalizeTenantPhone(resident.phone);
      if (!normalizedPhone) { invalid += 1; continue; }
      if (phones.has(normalizedPhone)) { duplicates += 1; continue; }
      phones.add(normalizedPhone);
      unique.push({ ...resident, normalizedPhone });
    }
    unique.sort((a, b) => a.propertyName.localeCompare(b.propertyName, "vi") ||
      a.roomCode.localeCompare(b.roomCode, "vi") ||
      a.fullName.localeCompare(b.fullName, "vi"));
    return { unique, invalid, duplicates };
  }, [residents]);

  const properties = useMemo(() =>
    [...new Map(residents.map(r => [r.propertyId, { id: r.propertyId, name: r.propertyName }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, "vi")), [residents]);

  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("vi");
    return unique.filter(r => (!propertyId || r.propertyId === propertyId) &&
      (!search || [r.fullName, r.normalizedPhone, r.roomCode, r.propertyName, r.leaseCode]
        .some(field => field.toLocaleLowerCase("vi").includes(search))));
  }, [unique, propertyId, query]);

  useEffect(() => {
    onChange(unique.filter(r => selectedPhones.has(r.normalizedPhone)).map(r => ({
      recipientKey: r.normalizedPhone,
      recipientDisplayName: null
    })));
  }, [unique, selectedPhones, onChange]);

  const selectVisible = () => setSelectedPhones(current => {
    const next = new Set(current);
    for (const r of visible) next.add(r.normalizedPhone);
    return next;
  });
  const clearVisible = () => setSelectedPhones(current => {
    const next = new Set(current);
    for (const r of visible) next.delete(r.normalizedPhone);
    return next;
  });

  if (loading) return <p className="admin-state">Đang lấy khách thuê từ các hợp đồng còn hiệu lực…</p>;
  if (error) return <p className="admin-state admin-state--error">{error}</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="admin-state" style={{ padding: "12px 16px", textAlign: "left" }}>
        <strong>{selectedPhones.size} số điện thoại được chọn / {unique.length} số hợp lệ</strong>
        <span style={{ display: "block", marginTop: 4 }}>
          Chỉ lấy người đang ở trong hợp đồng đang hoạt động hoặc chờ kết thúc. Các số trùng sẽ chỉ được gửi một lần.
        </span>
        {invalid || duplicates || truncated ? (
          <small style={{ display: "block", marginTop: 5, color: "#b45309" }}>
            {invalid ? `${invalid} số không hợp lệ đã bỏ qua. ` : ""}
            {duplicates ? `${duplicates} số trùng đã gộp. ` : ""}
            {truncated ? "Danh sách vượt 5.000 dòng; dữ liệu hiển thị chưa đầy đủ." : ""}
          </small>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 190px" }}>
          <span>Cơ sở</span>
          <select className="form-select" value={propertyId} onChange={e => setPropertyId(e.target.value)}>
            <option value="">Tất cả cơ sở</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ flex: "2 1 220px" }}>
          <span>Tìm khách / phòng / SĐT</span>
          <input className="form-input" type="search" value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Tên khách, số điện thoại hoặc phòng…" />
        </label>
      </div>
      <div className="button-row">
        <button type="button" className="secondary-button" onClick={selectVisible} disabled={!visible.length}>
          Chọn tất cả {visible.length} số đang lọc
        </button>
        <button type="button" className="secondary-button" onClick={clearVisible} disabled={!visible.length}>
          Bỏ chọn danh sách đang lọc
        </button>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #dbe4ef", borderRadius: 10 }}>
        {!visible.length ? <div className="admin-state">Không có khách thuê phù hợp bộ lọc.</div> :
          visible.slice(0, 300).map(r => (
            <label key={r.normalizedPhone} style={{
              display: "flex", gap: 12, alignItems: "center",
              padding: "10px 12px", borderBottom: "1px solid #edf2f7",
              cursor: "pointer", margin: 0
            }}>
              <input type="checkbox" checked={selectedPhones.has(r.normalizedPhone)}
                onChange={event => {
                  const checked = event.target.checked;
                  setSelectedPhones(current => {
                    const next = new Set(current);
                    if (checked) next.add(r.normalizedPhone); else next.delete(r.normalizedPhone);
                    return next;
                  });
                }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block" }}>{r.fullName}</strong>
                <small>{r.propertyName} · Phòng {r.roomCode}</small>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.normalizedPhone}</span>
            </label>
          ))}
        {visible.length > 300 && <p style={{ padding: 12 }}>
          Đang hiển thị 300 / {visible.length} mục. Dùng tìm kiếm để chọn lẻ, hoặc nút chọn tất cả để chọn toàn bộ mục phù hợp.
        </p>}
      </div>
      <small>Tên khách chỉ dùng để đối chiếu nội bộ. Zalo sẽ xác minh người nhận theo số điện thoại, không ép khớp tên trên hợp đồng.</small>
    </div>
  );
}
