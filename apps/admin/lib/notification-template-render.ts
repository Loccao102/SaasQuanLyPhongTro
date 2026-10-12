/** Templates are drafts. Never queue unresolved variables to Zalo. */
export const variableLabels: Record<string, string> = {
  ky_thanh_toan: "Kỳ thanh toán",
  han_thanh_toan: "Hạn thanh toán",
  so_tien: "Số tiền (đã đối chiếu)",
  ngay_ghi_so: "Ngày ghi chỉ số",
  ngay_bao_tri: "Ngày bảo trì",
  noi_dung: "Nội dung thông báo",
  ten_khach: "Tên người nhận (nhập thủ công)",
  so_phong: "Phòng",
  ten_co_so: "Cơ sở"
};

const fieldPattern = /{{\s*([^{}]+?)\s*}}/g;

export function templateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(fieldPattern)].map((match) => match[1]!.trim()))];
}

export function renderNotificationTemplate(
  body: string,
  values: Readonly<Record<string, string>>
): { body: string; missing: string[]; invalid: string[] } {
  const invalid = templateVariables(body)
    .filter((variable) => !(variable in variableLabels));
  const missing = templateVariables(body)
    .filter((variable) => variable in variableLabels && !values[variable]?.trim());
  const rendered = body.replace(fieldPattern, (whole, variable: string) =>
    values[variable.trim()]?.trim() || whole
  ).trim();
  if (/{{|}}/.test(rendered)) {
    for (const variable of templateVariables(rendered)) {
      if (!missing.includes(variable) && !invalid.includes(variable)) missing.push(variable);
    }
    if (!templateVariables(rendered).length) invalid.push("cú pháp dấu ngoặc {{ }}");
  }
  return { body: rendered, missing, invalid };
}
