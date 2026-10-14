import { ConflictException } from "@nestjs/common";

export interface ItemizedInvoiceLine {
  type: string;
  description: string;
  quantity: string;
  unitPriceVnd: number;
  amountVnd: number;
  snapshot: unknown;
}

export interface ItemizedInvoice {
  roomCode: string;
  invoiceNumber: string;
  totalVnd: number;
  paidVnd: number;
  remainingVnd: number;
  dueDate: string;
  publicUrl: string;
  lines: readonly ItemizedInvoiceLine[];
}

const money = new Intl.NumberFormat("vi-VN");
const quantityFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });

function readingDetails(line: ItemizedInvoiceLine): string {
  if (line.type !== "ELECTRICITY" && line.type !== "WATER") return "";
  const snapshot = line.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "";

  const meter = (snapshot as Record<string, unknown>).meter;
  if (!meter || typeof meter !== "object" || Array.isArray(meter)) return "";
  const previous = (meter as Record<string, unknown>).previous;
  const current = (meter as Record<string, unknown>).current;
  if (!previous || !current || typeof previous !== "object" || typeof current !== "object") return "";

  const prior = (previous as Record<string, unknown>).value;
  const next = (current as Record<string, unknown>).value;
  if (![prior, next].every(value =>
    (typeof value === "string" || typeof value === "number") &&
    /^\\d+(?:\\.\\d{1,3})?$/.test(String(value))
  )) return "";

  const unit = line.type === "ELECTRICITY" ? "kWh" : "m³";
  const used = Number(line.quantity);
  return " · chỉ số " + quantityFormat.format(Number(prior)) + " → " +
    quantityFormat.format(Number(next)) + " (" +
    quantityFormat.format(used) + " " + unit + ")";
}

/**
 * Use finalized invoice amounts, never recompute charges from editable client data.
 * The public invoice URL displays a live VietQR with remaining balance and payment memo.
 * The Playwright sender currently supports text only; do not claim it attaches an image.
 */
export function formatItemizedInvoiceZaloMessage(
  cycleCode: string,
  displayName: string | null,
  invoices: readonly ItemizedInvoice[]
): string {
  const blocks = invoices.flatMap((invoice) => {
    if (!Number.isSafeInteger(invoice.totalVnd) ||
        !Number.isSafeInteger(invoice.paidVnd) ||
        !Number.isSafeInteger(invoice.remainingVnd) ||
        invoice.remainingVnd < 0) {
      throw new ConflictException("Invalid issued invoice balance.");
    }

    if (invoice.lines.length) {
      const sum = invoice.lines.reduce((total, line) => {
        if (!Number.isSafeInteger(line.amountVnd)) {
          throw new ConflictException("Invalid issued invoice line amount.");
        }
        return total + line.amountVnd;
      }, 0);
      if (sum !== invoice.totalVnd) {
        throw new ConflictException("Issued invoice line items do not match the total.");
      }
    }

    const details = invoice.lines.map((line) =>
      "  • " + line.description + readingDetails(line) +
      ": " + money.format(line.amountVnd) + "đ"
    );
    return [
      "Phòng " + invoice.roomCode + ": " +
        money.format(invoice.remainingVnd) + "đ · hạn " + invoice.dueDate,
      ...details,
      "  Tổng hóa đơn: " + money.format(invoice.totalVnd) + "đ",
      "  Đã thanh toán: " + money.format(invoice.paidVnd) + "đ",
      "  Còn phải thanh toán: " + money.format(invoice.remainingVnd) + "đ",
      "  Xem hóa đơn và quét mã QR VietQR: " + invoice.publicUrl
    ];
  });
  const message = [
    displayName ? "Xin chào " + displayName + "," : "Xin chào,",
    "Habi gửi bảng kê tiền phòng kỳ " + cycleCode + ":",
    ...blocks,
    "Vui lòng kiểm tra các khoản thu trước khi thanh toán. Mã QR và số tiền còn lại được cập nhật trên trang hóa đơn."
  ].join("\n");
  if (message.length > 4000) {
    throw new ConflictException("Personalized invoice notification exceeds 4000 characters.");
  }
  return message;
}
