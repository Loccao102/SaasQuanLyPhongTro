#!/usr/bin/env bash
# ==============================================================================
# HABI Prop-Ops Automated PostgreSQL Backup Script
# Retention Policy: Keeps daily backups for RETENTION_DAYS (default 30 days)
# ==============================================================================

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-propops}"
POSTGRES_DB="${POSTGRES_DB:-propops}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILENAME="habi_db_${POSTGRES_DB}_${TIMESTAMP}.sql.gz"
BACKUP_FILEPATH="${BACKUP_DIR}/${BACKUP_FILENAME}"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

log() {
  local msg="[$(date +"%Y-%m-%d %H:%M:%S")] $1"
  echo "$msg"
  echo "$msg" >> "${LOG_FILE}"
}

log "=== Bắt đầu sao lưu cơ sở dữ liệu [${POSTGRES_DB}] ==="

# Execute pg_dump inside postgres container and compress with gzip
if docker compose -f "${COMPOSE_FILE}" exec -T "${POSTGRES_SERVICE}" \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --clean --if-exists \
  | gzip -9 > "${BACKUP_FILEPATH}"; then

  # Verify backup file size is greater than 1KB
  FILE_SIZE=$(wc -c < "${BACKUP_FILEPATH}" | tr -d ' ')
  if [ "$FILE_SIZE" -lt 1024 ]; then
    log "LỖI: Tệp sao lưu quá nhỏ (${FILE_SIZE} bytes). Kiểm tra lại kết nối cơ sở dữ liệu!"
    rm -f "${BACKUP_FILEPATH}"
    exit 1
  fi

  log "Sao lưu THÀNH CÔNG: ${BACKUP_FILENAME} (${FILE_SIZE} bytes)"
else
  log "LỖI: Quá trình pg_dump thất bại!"
  rm -f "${BACKUP_FILEPATH}"
  exit 1
fi

# Cleanup old backups exceeding retention policy
log "Áp dụng chính sách lưu trữ: Giữ lại ${RETENTION_DAYS} ngày gần nhất..."
DELETED_COUNT=0
while IFS= read -r old_file; do
  if [ -n "$old_file" ]; then
    rm -f "$old_file"
    log "Đã xoá tệp sao lưu cũ: $(basename "$old_file")"
    DELETED_COUNT=$((DELETED_COUNT + 1))
  fi
done < <(find "${BACKUP_DIR}" -type f -name "habi_db_*.sql.gz" -mtime +"${RETENTION_DAYS}")

log "Đã dọn dẹp ${DELETED_COUNT} tệp sao lưu cũ quá ${RETENTION_DAYS} ngày."
log "=== Hoàn tất quy trình sao lưu ==="
