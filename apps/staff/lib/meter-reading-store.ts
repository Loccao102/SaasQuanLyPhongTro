import type {
  ServerReading,
  StaffMeteringChecklistResponse,
  MeterType
} from "./staff-metering-api";

export type LocalReadingStatus =
  | "DRAFT"
  | "PENDING_SYNC"
  | "SYNCING"
  | "SYNCED"
  | "CONFLICT"
  | "FAILED";

export type LocalMeterReading = {
  id: string;
  actorUserId: string;
  organizationId: string;
  readingDate: string;
  propertyId: string;
  roomId: string;
  roomCode: string;
  meterId: string;
  meterType: MeterType;
  readingValue: string;
  status: LocalReadingStatus;
  attemptCount: number;
  updatedAt: string;
  lastError: string | null;
  conflictCode: string | null;
  serverReading: ServerReading | null;
};

type CachedChecklist = {
  key: string;
  userId: string;
  organizationId: string;
  readingDate: string;
  savedAt: string;
  data: StaffMeteringChecklistResponse;
};

const DB_NAME = "habi-staff-metering";
const DB_VERSION = 2;
const READING_STORE = "readings";
const CHECKLIST_STORE = "checklists";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(READING_STORE)) {
        db.createObjectStore(READING_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CHECKLIST_STORE)) {
        db.createObjectStore(CHECKLIST_STORE, { keyPath: "key" });
      }
    };
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

export async function putLocalReading(
  reading: LocalMeterReading
) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      READING_STORE,
      "readwrite"
    );
    transaction.objectStore(READING_STORE).put(reading);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function listLocalReadings(
  userId: string,
  organizationId: string,
  readingDate: string
): Promise<LocalMeterReading[]> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      READING_STORE,
      "readonly"
    );
    const rows = await requestResult(
      transaction.objectStore(READING_STORE).getAll()
    );
    await transactionDone(transaction);

    return (rows as Array<LocalMeterReading & {
      actorUserId?: string;
    }>)
      .filter(
        (row) =>
          row.actorUserId === userId &&
          row.organizationId === organizationId &&
          row.readingDate === readingDate
      )
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)) as LocalMeterReading[];
  } finally {
    db.close();
  }
}

export async function recoverInterruptedSync(
  userId: string,
  organizationId: string,
  readingDate: string
) {
  const rows = await listLocalReadings(
    userId,
    organizationId,
    readingDate
  );
  const stuck = rows.filter(
    (row) => row.status === "SYNCING"
  );

  await Promise.all(
    stuck.map((row) =>
      putLocalReading({
        ...row,
        status: "PENDING_SYNC",
        lastError:
          "Phiên đồng bộ trước bị gián đoạn; sẽ thử lại.",
        updatedAt: new Date().toISOString()
      })
    )
  );
}

export async function cacheChecklist(
  data: StaffMeteringChecklistResponse,
  userId: string
) {
  const row: CachedChecklist = {
    key:
      userId +
      ":" +
      data.organization.id +
      ":" +
      data.readingDate,
    userId,
    organizationId: data.organization.id,
    readingDate: data.readingDate,
    savedAt: new Date().toISOString(),
    data
  };

  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      CHECKLIST_STORE,
      "readwrite"
    );
    transaction.objectStore(CHECKLIST_STORE).put(row);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function getCachedChecklist(
  userId: string,
  organizationId: string,
  readingDate: string
): Promise<StaffMeteringChecklistResponse | null> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      CHECKLIST_STORE,
      "readonly"
    );
    const row = await requestResult(
      transaction
        .objectStore(CHECKLIST_STORE)
        .get(
          userId +
            ":" +
            organizationId +
            ":" +
            readingDate
        )
    );
    await transactionDone(transaction);
    return (row as CachedChecklist | undefined)?.data ?? null;
  } finally {
    db.close();
  }
}

export async function findAnyCachedChecklist(
  userId: string,
  readingDate: string
): Promise<StaffMeteringChecklistResponse | null> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(
      CHECKLIST_STORE,
      "readonly"
    );
    const rows = await requestResult(
      transaction.objectStore(CHECKLIST_STORE).getAll()
    );
    await transactionDone(transaction);

    const match = (rows as Array<
      CachedChecklist & { userId?: string }
    >)
      .filter(
        (row) =>
          row.userId === userId &&
          row.readingDate === readingDate
      )
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];

    return match?.data ?? null;
  } finally {
    db.close();
  }
}
