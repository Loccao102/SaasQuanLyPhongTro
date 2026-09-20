import { ProgressBar, StatusBadge } from "@propops/ui";

export default function StaffHomePage() {
  return (
    <main className="staff-page">
      <div className="staff-phone">
        <header className="staff-header">
          <div><span className="staff-kicker">THỨ HAI · 21/09</span><h1>Chào Minh</h1></div>
          <StatusBadge tone="success">ĐÃ ĐỒNG BỘ</StatusBadge>
        </header>

        <section className="staff-section">
          <h2>Công việc hôm nay</h2>
          <article className="assignment-card">
            <div className="assignment-card__header">
              <div><span className="staff-kicker">PHƯỜNG THANH XUÂN</span><h3>Nguyễn Trãi 1</h3></div>
              <strong>24 phòng</strong>
            </div>
            <ProgressBar value={18} max={24} label="18 / 24 phòng đã chốt" />
            <button className="primary-action">Tiếp tục chốt số</button>
          </article>
        </section>

        <section className="staff-section">
          <div className="staff-section__title"><h2>Phòng tiếp theo</h2><span>19 / 24</span></div>
          <article className="meter-card">
            <div className="room-title">
              <div><span className="staff-kicker">TẦNG 2</span><h3>P203</h3></div>
              <StatusBadge tone="neutral">CHƯA CHỐT</StatusBadge>
            </div>
            <label className="meter-field">
              <span><strong>Điện mới</strong><small>Chỉ số cũ: 1.250 kWh</small></span>
              <input inputMode="numeric" aria-label="Điện mới phòng P203" placeholder="Nhập chỉ số" />
            </label>
            <label className="meter-field">
              <span><strong>Nước mới</strong><small>Chỉ số cũ: 203 m³</small></span>
              <input inputMode="numeric" aria-label="Nước mới phòng P203" placeholder="Nhập chỉ số" />
            </label>
            <button className="primary-action">Lưu & phòng tiếp theo →</button>
          </article>
        </section>

        <aside className="sync-note">
          <span aria-hidden="true">●</span>
          <div><strong>Offline-first đã được dành chỗ trong UX.</strong><p>IndexedDB, queue đồng bộ và conflict handling sẽ được nối ở Metering slice; bản này chưa giả lập lưu offline.</p></div>
        </aside>
      </div>
    </main>
  );
}
