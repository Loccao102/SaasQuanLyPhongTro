import {
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";

type AuthEmailKind = "VERIFY_EMAIL" | "RESET_PASSWORD";

@Injectable()
export class AuthEmailDeliveryService {
  isAvailable(): boolean {
    if (process.env.NODE_ENV !== "production") return true;
    return Boolean(
      process.env.RESEND_API_KEY?.trim() &&
      process.env.AUTH_EMAIL_FROM?.trim() &&
      process.env.AUTH_PUBLIC_APP_URL?.trim()
    );
  }

  isSecurityAlertAvailable(): boolean {
    return Boolean(
      process.env.RESEND_API_KEY?.trim() &&
      process.env.AUTH_EMAIL_FROM?.trim()
    );
  }

  sendVerification(email: string, token: string): Promise<void> {
    return this.send({
      kind: "VERIFY_EMAIL",
      email,
      path: "/verify-email",
      token,
      subject: "Xác minh email Habi",
      intro:
        "Bạn vừa đăng ký Habi bằng email/mật khẩu. Xác minh email để hoàn tất tạo tenant."
    });
  }

  sendPasswordReset(email: string, token: string): Promise<void> {
    return this.send({
      kind: "RESET_PASSWORD",
      email,
      path: "/reset-password",
      token,
      subject: "Đặt lại mật khẩu Habi",
      intro:
        "Có yêu cầu đặt lại mật khẩu cho tài khoản Habi của bạn. Nếu không phải bạn, hãy bỏ qua email này."
    });
  }

  async sendSecurityAlert(input: {
    email: string;
    subject: string;
    message: string;
  }): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.AUTH_EMAIL_FROM?.trim();

    if (!apiKey || !from) {
      if (process.env.NODE_ENV !== "production") {
        console.info(
          "[auth-security-email] " +
            input.email +
            " " +
            input.subject +
            " " +
            input.message
        );
      }
      throw new ServiceUnavailableException(
        "Dịch vụ email cảnh báo bảo mật chưa được cấu hình."
      );
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: input.subject,
        text:
          input.message +
          "\n\nNếu đây không phải thao tác của bạn, hãy đăng nhập Habi, kiểm tra các phiên và thay đổi credential cần thiết.",
        html:
          "<p>" +
          this.escapeHtml(input.message) +
          "</p><p>Nếu đây không phải thao tác của bạn, hãy đăng nhập Habi, kiểm tra các phiên và thay đổi credential cần thiết.</p>"
      }),
      signal: AbortSignal.timeout(8_000)
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        "Không thể gửi email cảnh báo bảo mật lúc này."
      );
    }
  }

  private async send(input: {
    kind: AuthEmailKind;
    email: string;
    path: string;
    token: string;
    subject: string;
    intro: string;
  }): Promise<void> {
    const link = this.actionUrl(input.path, input.token);
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.AUTH_EMAIL_FROM?.trim();

    if (!apiKey || !from) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "Dịch vụ email xác thực chưa được cấu hình."
        );
      }

      console.info(
        `[auth-email] ${input.kind} ${input.email} ${link}`
      );
      return;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: input.subject,
        text:
          input.intro +
          "\n\nMở liên kết sau để tiếp tục:\n" +
          link +
          "\n\nLiên kết chỉ dùng được một lần và sẽ hết hạn.",
        html:
          "<p>" +
          this.escapeHtml(input.intro) +
          "</p><p><a href=\"" +
          this.escapeHtml(link) +
          "\">Tiếp tục với Habi</a></p>" +
          "<p>Liên kết chỉ dùng được một lần và sẽ hết hạn.</p>"
      }),
      signal: AbortSignal.timeout(8_000)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (process.env.NODE_ENV !== "production") {
        console.error(
          "[auth-email] Resend rejected " +
            input.kind +
            " to " +
            input.email +
            " with status " +
            String(response.status) +
            (detail ? ": " + detail : "")
        );
      }
      throw new ServiceUnavailableException(
        "Không thể gửi email xác thực lúc này. Vui lòng thử lại."
      );
    }

    if (process.env.NODE_ENV !== "production") {
      console.info(
        "[auth-email] sent " +
          input.kind +
          " to " +
          input.email +
          " via Resend"
      );
    }
  }

  private actionUrl(path: string, token: string): string {
    const configured = process.env.AUTH_PUBLIC_APP_URL?.trim();
    const base =
      configured ||
      (process.env.NODE_ENV === "production"
        ? ""
        : "http://localhost:3000");

    if (!base) {
      throw new ServiceUnavailableException(
        "AUTH_PUBLIC_APP_URL chưa được cấu hình."
      );
    }

    let url: URL;
    try {
      url = new URL(path, base.endsWith("/") ? base : base + "/");
    } catch {
      throw new ServiceUnavailableException(
        "AUTH_PUBLIC_APP_URL không hợp lệ."
      );
    }

    if (
      process.env.NODE_ENV === "production" &&
      url.protocol !== "https:"
    ) {
      throw new ServiceUnavailableException(
        "AUTH_PUBLIC_APP_URL phải dùng HTTPS ở production."
      );
    }

    url.searchParams.set("token", token);
    return url.toString();
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}
