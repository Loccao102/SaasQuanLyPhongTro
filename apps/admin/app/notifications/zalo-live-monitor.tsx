"use client";

import { useEffect, useState } from "react";
import {
  adminNotificationsApi,
  type ZaloMonitorState
} from "../../lib/admin-notifications-api";

const stageLabels: Record<string, string> = {
  INITIALIZING: "Khởi tạo phiên Zalo",
  OPENING_ZALO: "Mở giao diện Zalo Web",
  WAITING_FOR_SEARCH: "Đợi ô tìm kiếm người nhận",
  SEARCHING_PHONE: "Đang tìm tài khoản qua SĐT",
  SEARCH_INPUT_NOT_FOUND: "Không tìm thấy ô tìm kiếm",
  RECIPIENT_NOT_FOUND: "Không tìm thấy người nhận",
  RECIPIENT_AMBIGUOUS: "Nhiều kết quả, dừng để tránh gửi nhầm",
  OPENING_CHAT: "Mở khung trò chuyện",
  MESSAGE_EDITOR_NOT_FOUND: "Không tìm thấy khung soạn tin",
  PREPARING_MESSAGE: "Nhập nội dung tin nhắn",
  SENDING_MESSAGE: "Thực hiện gửi",
  VERIFYING_DELIVERY: "Kiểm tra tin nhắn sau khi gửi",
  SENT_CONFIRMED: "Đã xác nhận gửi trên Zalo Web"
};

type StageEvent = { stage: string; capturedAt: string; errorCode: string | null };

export function ZaloLiveMonitor({
  campaignId,
  jobId
}: {
  campaignId: string;
  jobId: string;
}) {
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ZaloMonitorState | null>(null);
  const [history, setHistory] = useState<StageEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const result = await adminNotificationsApi.monitor(campaignId, jobId);
        if (stopped) return;
        setState(result);
        setError(null);
        if (result.frame) {
          const frame = result.frame;
          setHistory((previous) => {
            const last = previous[previous.length - 1];
            if (last?.stage === frame.stage && last?.errorCode === frame.errorCode &&
                last.capturedAt === frame.capturedAt) return previous;
            // Keep one entry per stage transition, not one per screenshot.
            if (last?.stage === frame.stage && last?.errorCode === frame.errorCode) return previous;
            return [...previous, {
              stage: frame.stage,
              capturedAt: frame.capturedAt,
              errorCode: frame.errorCode
            }].slice(-20);
          });
        }
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : "Không tải được trạng thái theo dõi.");
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => { stopped = true; clearInterval(timer); };
  }, [campaignId, jobId]);

  useEffect(() => {
    if (!watching) return;
    // Viewers expire on the API after 15 seconds. Keep the session alive only
    // while this component is visible and monitoring is explicitly enabled.
    const heartbeat = setInterval(() => {
      void adminNotificationsApi.watchMonitor(campaignId, jobId, true).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Không duy trì được phiên quan sát.");
        setWatching(false);
      });
    }, 8000);
    return () => {
      clearInterval(heartbeat);
      void adminNotificationsApi.watchMonitor(campaignId, jobId, false).catch(() => {});
    };
  }, [watching, campaignId, jobId]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (watching) {
        setWatching(false);
        setState((current) => current ? {
          ...current, watching: false,
          frame: current.frame ? { ...current.frame, image: null } : null
        } : null);
      } else {
        await adminNotificationsApi.watchMonitor(campaignId, jobId, true);
        setWatching(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thay đổi được chế độ xem.");
    } finally {
      setBusy(false);
    }
  };

  const frame = state?.frame;
  const errorCode = state?.job.lastErrorCode ?? frame?.errorCode;
  const errorMessage = state?.job.lastErrorMessage;
  const paused = state?.provider.status === "PAUSED";

  return (
    <section className="panel" style={{ marginTop: 18 }} aria-label="Trực quan Zalo Playwright">
      <div className="asset-section-heading">
        <div>
          <span className="eyebrow">ZALO WEB / LIVE DEBUG</span>
          <h3>Theo dõi trình duyệt gửi tin</h3>
        </div>
        <button
          className={watching ? "secondary-button" : "primary-button"}
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
        >
          {busy ? "Đang xử lý..." : watching ? "Tắt xem màn hình" : "Bật xem màn hình"}
        </button>
      </div>
      <p style={{ fontSize: 13, opacity: 0.8, marginTop: 0 }}>
        Ảnh gần thời gian thực chỉ hiển thị cho quản trị viên, tự hết hạn và không lưu vào lịch sử tin nhắn.
        Chế độ này chỉ quan sát, không điều khiển hoặc tự gửi lại.
      </p>

      {paused ? (
        <div className="admin-state admin-state--error" role="alert">
          <strong>Provider Zalo đang tạm dừng</strong>
          <span>{state?.provider.reason || "Cần kiểm tra lỗi trước khi tiếp tục gửi."}</span>
        </div>
      ) : null}

      {error ? <div className="admin-state admin-state--error" role="alert">{error}</div> : null}

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 12,
        alignItems: "center", marginBottom: 12, fontSize: 13
      }}>
        <span><strong>Job:</strong> {state?.job.status ?? "Đang tải..."}</span>
        <span><strong>Quan sát:</strong> {watching ? "Đã bật" : "Đã tắt"}</span>
        {frame ? <span><strong>Bước:</strong> {stageLabels[frame.stage] ?? frame.stage}</span> : null}
        {frame ? <span><strong>Ảnh:</strong> {new Date(frame.capturedAt).toLocaleTimeString("vi-VN")}</span> : null}
      </div>

      <div style={{
        background: "#111827", borderRadius: 12, minHeight: 180,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", color: "#e5e7eb", textAlign: "center"
      }}>
        {watching && frame?.image ? (
          <img
            src={frame.image}
            alt="Ảnh màn hình Zalo Web do Playwright đang thao tác"
            style={{ display: "block", width: "100%", maxHeight: 540, objectFit: "contain" }}
          />
        ) : (
          <div style={{ padding: 24 }}>
            {watching
              ? "Đang đợi worker mở Zalo và gửi khung hình. Nếu job đã kết thúc, ảnh mới sẽ không xuất hiện."
              : "Bật xem màn hình trước khi chạy job để quan sát Playwright."}
          </div>
        )}
      </div>

      {errorCode ? (
        <div className="notification-job-error" style={{ marginTop: 12 }} role="alert">
          <strong>Lỗi: {errorCode}</strong>
          {errorMessage ? <div>{errorMessage}</div> : null}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <strong>Các bước gần đây</strong>
          <ol style={{ paddingLeft: 22, marginBottom: 0 }}>
            {history.map((event, index) => (
              <li key={event.capturedAt + ":" + index} style={{ fontSize: 13, marginTop: 6 }}>
                {new Date(event.capturedAt).toLocaleTimeString("vi-VN")}
                {" — "}
                {stageLabels[event.stage] ?? event.stage}
                {event.errorCode ? " (" + event.errorCode + ")" : ""}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
