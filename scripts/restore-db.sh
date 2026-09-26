#!/usr/bin/env bash
# ==============================================================================
# HABI Prop-Ops PostgreSQL Disaster Recovery & Restore Script
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-propops}"
POSTGRES_DB="${POSTGRES_DB:-propops}"

RESTORE_FILE="${1:-}"

if [ -z "$RESTORE_FILE" ]; then
  echo "Cách sử dụng: ./scripts/restore-db.sh <đường_dẫn_tệp_sao_lưu.sql.gz>"
  echo ""
  echo "Các tệp sao lưu khả dụng trong [${BACKUP_DIR}]:"
  if [ -d "${BACKUP_DIR}" ]; then
    ls -lh "${BACKUP_DIR}"/*.sql.gz 2>/dev/null || echo "Chưa có bản sao lưu nào."
  else
    echo "Thư mục ${BACKUP_DIR} chưa tồn tại."
  fi
  exit 1
fi

if [ ! -f "$RESTORE_FILE" ]; then
  echo "LỖI: Tệp $RESTORE_FILE không tồn tại."
  exit 1
fi

echo "================================================================================"
echo "CẢNH BÁO NGUY HIỂM: BẠN ĐANG CHUẨN BỊ PHỤC HỒI CƠ SỞ DỮ LIỆU!"
echo "Database mục tiêu: ${POSTGRES_DB}"
echo "Tệp nguồn:         ${RESTORE_FILE}"
echo "Hành động này sẽ ghi đè toàn bộ dữ liệu hiện tại."
echo "================================================================================"
read -p "Nhập 'XACNHAN' để tiếp tục phục hồi: " CONFIRM

if [ "$CONFIRM" != "XACNHAN" ]; then
  echo "Đã huỷ thao tác phục hồi."
  exit 0
fi

echo "Đang tạo bản sao lưu an toàn ngay trước khi restore..."
PRE_BACKUP="./backups/safety_before_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
docker compose -f "${COMPOSE_FILE}" exec -T "${POSTGRES_SERVICE}" \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner \
  | gzip -9 > "${PRE_BACKUP}" || true
echo "Bản snapshot an toàn đã lưu tại: ${PRE_BACKUP}"

echo "Đang phục hồi dữ liệu từ ${RESTORE_FILE}..."
gunzip -c "${RESTORE_FILE}" | docker compose -f "${COMPOSE_FILE}" exec -T "${POSTGRES_SERVICE}" \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

echo "✓ Phục hồi cơ sở dữ liệu THÀNH CÔNG!"
