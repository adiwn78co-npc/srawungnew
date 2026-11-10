import fs from 'fs';
import path from 'path';
import type {
  User,
  Program,
  Outcome,
  Output,
  Activity,
  SubActivity,
  Tor,
  TorApprovalRecord,
  AuditLog,
  CashAdvanceRecord,
  MeetingMinutesRecord,
  ActivityDocumentationRecord,
  OutputRaciRecord,
  ActivityMonitoringRecord,
  MonitoringReportItem,
  ApprovalHubItem,
  ApprovalCategoryWorkflowConfig,
  ApprovalNotificationItem,
  MasterParticipantRecord,
  AttendanceSystemBundle,
} from '../types/index.ts';
import {
  getMysqlPool,
  isCloudRunEnvironment,
  isMysqlConfigured,
  loadDatabaseFromMysql,
  resetMysqlPool,
  saveDatabaseToMysql,
  upsertMysqlKvEntries,
  upsertMysqlUserRow,
  deleteMysqlUserRow,
} from './mysqlPool.ts';
import {
  SEED_PROGRAMS,
  SEED_OUTCOMES,
  SEED_OUTPUTS,
  SEED_ACTIVITIES,
  SEED_SUB_ACTIVITIES,
  SEED_TORS,
  SEED_APPROVAL_RECORDS,
  SEED_CASH_ADVANCES,
  SEED_MEETING_MINUTES,
  SEED_ACTIVITY_DOCUMENTATIONS,
  SEED_ACTIVITY_DOCUMENTATION_LIST,
  SEED_OUTPUT_RACI_RECORDS,
  SEED_ACTIVITY_MONITORING_RECORDS,
  SEED_MONITORING_REPORTS,
  SEED_PARTICIPANT_DATABASE,
  SEED_PROGRAM_BUDGETS,
} from './integratedSeedData.ts';

export interface DatabaseSchema {
  users: User[];
  currentUserId: string;
  programs: Program[];
  outcomes: Outcome[];
  outputs: Output[];
  activities: Activity[];
  subActivities: SubActivity[];
  tors: Tor[];
  approvalRecords: TorApprovalRecord[];
  auditLogs: AuditLog[];
  cashAdvances?: CashAdvanceRecord[];
  cashAdvanceSummaries?: Record<string, any>;
  cashAdvanceAuditLogs?: Record<string, any[]>;
  meetingMinutes?: MeetingMinutesRecord[];
  activityDocumentations?: Record<string, ActivityDocumentationRecord>;
  activityDocumentationList?: ActivityDocumentationRecord[];
  outputRaciRecords?: Record<string, OutputRaciRecord>;
  activityMonitoringRecords?: Record<string, ActivityMonitoringRecord>;
  monitoringReports?: Record<string, MonitoringReportItem>;
  approvalHubItems?: Record<string, ApprovalHubItem>;
  approvalWorkflowConfigs?: Record<string, ApprovalCategoryWorkflowConfig>;
  approvalNotifications?: ApprovalNotificationItem[];
  programBudgets?: Record<string, any>;
  participantDatabase?: MasterParticipantRecord[];
  attendanceSystem?: AttendanceSystemBundle;
  organizationSettings?: Record<string, any>;
  cleanResetPrj3581V1?: boolean;
  cleanResetPrj3581V2?: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.resolve(DATA_DIR, 'db.json');
const DB_BACKUP_FILE = path.resolve(DATA_DIR, 'db.backup.json');

const INITIAL_PROGRAMS: Program[] = SEED_PROGRAMS;

const INITIAL_USERS: User[] = [
  {
    id: 'user-admin',
    name: 'Bambang Sudiro',
    email: 'admin@ngo-harmoni.org',
    role: 'admin',
    roleTitle: 'System Administrator',
    department: 'Teknologi & Tata Kelola Sistem',
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: false,
      canApproveTor: false,
      canManageUsers: true,
      canViewAllTors: true,
    },
    createdAt: '2026-01-10T08:00:00Z',
  },
  {
    id: 'user-director',
    name: 'Dr. Hendra Wijaya',
    email: 'director@ngo-harmoni.org',
    role: 'director',
    roleTitle: 'Executive Director',
    department: 'Direktorat Eksekutif',
    isActive: true,
    permissions: {
      canManagePrograms: true,
      canCreateTor: true,
      canApproveTor: true,
      canManageUsers: false,
      canViewAllTors: true,
    },
    createdAt: '2026-01-10T08:00:00Z',
  },
  {
    id: 'user-finance',
    name: 'Ratna Kusuma, S.E.',
    email: 'finance@ngo-harmoni.org',
    role: 'finance',
    roleTitle: 'Finance & HR Manager',
    department: 'Keuangan, HR & Kepatuhan',
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: true,
      canManageUsers: true,
      canViewAllTors: true,
    },
    createdAt: '2026-01-12T08:00:00Z',
  },
  {
    id: 'user-pm',
    name: 'Dimas Pratama, M.Sc.',
    email: 'pm@ngo-harmoni.org',
    role: 'program_manager',
    roleTitle: 'Program Manager',
    department: 'Divisi Manajemen Program',
    isActive: true,
    permissions: {
      canManagePrograms: true,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: true,
    },
    createdAt: '2026-01-15T08:00:00Z',
  },
  {
    id: 'user-meal',
    name: 'Maya Safitri, S.Sos.',
    email: 'meal@ngo-harmoni.org',
    role: 'meal',
    roleTitle: 'MEAL Coordinator',
    department: 'Monitoring, Evaluation, Accountability & Learning',
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: true,
    },
    createdAt: '2026-01-18T08:00:00Z',
  },
  {
    id: 'user-staff-1',
    name: 'Budi Santoso',
    email: 'budi.santoso@ngo-harmoni.org',
    role: 'staff',
    roleTitle: 'Senior Field Officer',
    department: 'Operasional Lapangan',
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: false,
    },
    createdAt: '2026-02-01T08:00:00Z',
  },
  {
    id: 'user-staff-2',
    name: 'Siti Rahmawati',
    email: 'siti.rahmawati@ngo-harmoni.org',
    role: 'staff',
    roleTitle: 'Community Facilitator',
    department: 'Pemberdayaan Masyarakat',
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: false,
    },
    createdAt: '2026-02-05T08:00:00Z',
  },
];

const INITIAL_OUTCOMES: Outcome[] = SEED_OUTCOMES;
const INITIAL_OUTPUTS: Output[] = SEED_OUTPUTS;
const INITIAL_ACTIVITIES: Activity[] = SEED_ACTIVITIES;
const INITIAL_SUB_ACTIVITIES: SubActivity[] = SEED_SUB_ACTIVITIES;
const INITIAL_TORS: Tor[] = SEED_TORS;
const INITIAL_APPROVAL_RECORDS: TorApprovalRecord[] = SEED_APPROVAL_RECORDS;
const INITIAL_AUDIT_LOGS: AuditLog[] = [];
export const INITIAL_CASH_ADVANCES: CashAdvanceRecord[] = SEED_CASH_ADVANCES;
const INITIAL_ACTIVITY_DOCUMENTATIONS: Record<string, ActivityDocumentationRecord> = SEED_ACTIVITY_DOCUMENTATIONS;
const INITIAL_ACTIVITY_DOCUMENTATION_LIST: ActivityDocumentationRecord[] = SEED_ACTIVITY_DOCUMENTATION_LIST;
const INITIAL_MEETING_MINUTES: MeetingMinutesRecord[] = SEED_MEETING_MINUTES;
const INITIAL_OUTPUT_RACI_RECORDS: Record<string, OutputRaciRecord> = SEED_OUTPUT_RACI_RECORDS;
const INITIAL_ACTIVITY_MONITORING_RECORDS: Record<string, ActivityMonitoringRecord> = SEED_ACTIVITY_MONITORING_RECORDS;
const INITIAL_MONITORING_REPORTS: Record<string, MonitoringReportItem> = SEED_MONITORING_REPORTS;
const INITIAL_PARTICIPANT_DATABASE: MasterParticipantRecord[] = SEED_PARTICIPANT_DATABASE;
const INITIAL_PROGRAM_BUDGETS: Record<string, any> = SEED_PROGRAM_BUDGETS;

function cloneInitialUsers(): User[] {
  return INITIAL_USERS.map((u) => ({
    ...u,
    permissions: { ...u.permissions },
  }));
}

function createDefaultSeed(): DatabaseSchema {
  return {
    users: cloneInitialUsers(),
    currentUserId: 'user-director',
    programs: [...INITIAL_PROGRAMS],
    outcomes: [...INITIAL_OUTCOMES],
    outputs: [...INITIAL_OUTPUTS],
    activities: [...INITIAL_ACTIVITIES],
    subActivities: [...INITIAL_SUB_ACTIVITIES],
    tors: [...INITIAL_TORS],
    approvalRecords: [...INITIAL_APPROVAL_RECORDS],
    auditLogs: [...INITIAL_AUDIT_LOGS],
    cashAdvances: [...INITIAL_CASH_ADVANCES],
    cashAdvanceSummaries: {},
    cashAdvanceAuditLogs: {},
    meetingMinutes: [...INITIAL_MEETING_MINUTES],
    activityDocumentations: { ...INITIAL_ACTIVITY_DOCUMENTATIONS },
    activityDocumentationList: [...INITIAL_ACTIVITY_DOCUMENTATION_LIST],
    outputRaciRecords: { ...INITIAL_OUTPUT_RACI_RECORDS },
    activityMonitoringRecords: { ...INITIAL_ACTIVITY_MONITORING_RECORDS },
    monitoringReports: { ...INITIAL_MONITORING_REPORTS },
    approvalHubItems: {},
    approvalNotifications: [],
    programBudgets: { ...INITIAL_PROGRAM_BUDGETS },
    participantDatabase: [...INITIAL_PARTICIPANT_DATABASE],
    cleanResetPrj3581V1: true,
    cleanResetPrj3581V2: true,
  };
}

function normalizeSchema(parsed: DatabaseSchema): DatabaseSchema {
  // Migrasi skema bersifat murni additive & non-destructive:
  // Ketiadaan flag migrasi tidak pernah menghapus atau menimpa data operasional yang sudah ada.
  if (parsed.cleanResetPrj3581V1 === undefined) {
    parsed.cleanResetPrj3581V1 = true;
  }
  if (parsed.cleanResetPrj3581V2 === undefined) {
    parsed.cleanResetPrj3581V2 = true;
  }

  if (!parsed.currentUserId) {
    parsed.currentUserId = 'user-director';
  }

  if (!Array.isArray(parsed.programs)) {
    parsed.programs = [];
  }

  const defaultPermsByRole: Record<User['role'], User['permissions']> = {
    admin: { canManagePrograms: false, canCreateTor: false, canApproveTor: false, canManageUsers: true, canViewAllTors: true },
    director: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    hr: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
    finance: { canManagePrograms: false, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    program_manager: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    meal: { canManagePrograms: true, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
    staff: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: false },
  };

  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    parsed.users = cloneInitialUsers();
  } else {
    parsed.users = parsed.users.map((u) => {
      const basePerms = defaultPermsByRole[u.role] || defaultPermsByRole.staff;
      const rawPerms = (u.permissions && typeof u.permissions === 'object' ? u.permissions : {}) as Partial<User['permissions']>;
      return {
        ...u,
        permissions: {
          canManagePrograms: rawPerms.canManagePrograms ?? basePerms.canManagePrograms,
          canCreateTor: rawPerms.canCreateTor ?? basePerms.canCreateTor,
          canApproveTor:
            u.role === 'admin' ? false : rawPerms.canApproveTor ?? basePerms.canApproveTor,
          canManageUsers:
            u.role === 'admin' ? true : rawPerms.canManageUsers ?? basePerms.canManageUsers,
          canViewAllTors: rawPerms.canViewAllTors ?? basePerms.canViewAllTors,
        },
      };
    });

    const hasAdmin = parsed.users.some(
      (u) => u.role === 'admin' || u.permissions?.canManageUsers
    );
    if (!hasAdmin) {
      const defaultAdmin = INITIAL_USERS.find((u) => u.role === 'admin');
      if (defaultAdmin) {
        parsed.users.push({
          ...defaultAdmin,
          permissions: { ...defaultAdmin.permissions },
          isActive: true,
          accountStatus: 'Aktif',
        });
      }
    }
  }

  if (!Array.isArray(parsed.outcomes)) {
    parsed.outcomes = [];
  }
  if (!Array.isArray(parsed.outputs)) {
    parsed.outputs = [];
  }
  if (!Array.isArray(parsed.activities)) {
    parsed.activities = [];
  }
  if (!Array.isArray(parsed.subActivities)) {
    parsed.subActivities = [];
  }
  if (!Array.isArray(parsed.tors)) {
    parsed.tors = [];
  }
  if (!Array.isArray(parsed.approvalRecords)) {
    parsed.approvalRecords = [];
  }
  if (!Array.isArray(parsed.auditLogs)) {
    parsed.auditLogs = [];
  }
  if (!Array.isArray(parsed.cashAdvances)) {
    parsed.cashAdvances = [];
  }
  if (!parsed.cashAdvanceSummaries || typeof parsed.cashAdvanceSummaries !== 'object') {
    parsed.cashAdvanceSummaries = {};
  }
  if (!parsed.cashAdvanceAuditLogs || typeof parsed.cashAdvanceAuditLogs !== 'object') {
    parsed.cashAdvanceAuditLogs = {};
  }

  if (Array.isArray(parsed.tors) && Array.isArray(parsed.cashAdvances)) {
    parsed.tors = parsed.tors.map((t) => {
      const approvedCas = parsed.cashAdvances!.filter(
        (ca) => ca.torId === t.id && (ca.status === 'Disetujui' || ca.status === 'Dicairkan')
      );
      const verifiedCas = approvedCas.filter(
        (ca) => ca.isReported && ca.reportApprovalStatus === 'Telah Disetujui'
      );
      const computedRequested = approvedCas.reduce(
        (sum, ca) => sum + (Number(ca.totalAmount) || 0),
        0
      );
      const computedActualSpent = verifiedCas.reduce(
        (sum, ca) => sum + (Number(ca.realizedAmount ?? ca.totalAmount) || 0),
        0
      );
      return {
        ...t,
        budgetRequested:
          approvedCas.length > 0 ? computedRequested : (t.budgetRequested ?? 0),
        budgetApproved: t.budgetApproved ?? t.budgetRequested ?? 0,
        budgetActualSpent:
          verifiedCas.length > 0 ? computedActualSpent : (t.budgetActualSpent ?? 0),
      };
    });
  }

  if (!Array.isArray(parsed.meetingMinutes)) {
    parsed.meetingMinutes = [];
  }
  if (!parsed.activityDocumentations || typeof parsed.activityDocumentations !== 'object') {
    parsed.activityDocumentations = {};
  }
  if (!Array.isArray(parsed.activityDocumentationList)) {
    parsed.activityDocumentationList = [];
  }

  if (Array.isArray(parsed.tors)) {
    parsed.tors = parsed.tors.map((t) => ({
      ...t,
      documentation:
        parsed.activityDocumentationList?.find((d) => d.torId === t.id) ||
        parsed.activityDocumentations?.[t.id] ||
        t.documentation,
    }));
  }

  if (!parsed.outputRaciRecords || typeof parsed.outputRaciRecords !== 'object') {
    parsed.outputRaciRecords = {};
  }
  if (!parsed.activityMonitoringRecords || typeof parsed.activityMonitoringRecords !== 'object') {
    parsed.activityMonitoringRecords = {};
  }
  if (!parsed.monitoringReports || typeof parsed.monitoringReports !== 'object') {
    parsed.monitoringReports = {};
  }
  if (!parsed.approvalHubItems || typeof parsed.approvalHubItems !== 'object') {
    parsed.approvalHubItems = {};
  }
  if (!Array.isArray(parsed.approvalNotifications)) {
    parsed.approvalNotifications = [];
  }
  if (!Array.isArray(parsed.participantDatabase)) {
    parsed.participantDatabase = [];
  }
  if (!parsed.programBudgets || typeof parsed.programBudgets !== 'object') {
    parsed.programBudgets = {};
  }

  return parsed;
}

function sanitizeDbError(err: unknown): string {
  const raw =
    err instanceof Error
      ? `${err.name}${('code' in err && (err as any).code) ? ` [${(err as any).code}]` : ''}: ${err.message}`
      : String(err || 'Unknown error');
  return raw
    .replace(/mysql2?:\/\/[^\s@]+@/gi, 'mysql://***@')
    .replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, '$1***');
}

class Database {
  private data: DatabaseSchema;
  private mysqlWriteChain: Promise<void> = Promise.resolve();
  private initPromise: Promise<void> | null = null;
  private mysqlStatus: 'unconfigured' | 'ready' | 'failed' = 'unconfigured';

  constructor() {
    this.ensureDirectory();
    // Jika MySQL dikonfigurasi, jangan pernah memuat db.json atau db.backup.json ke memori operasional.
    this.data = isMysqlConfigured()
      ? normalizeSchema(createDefaultSeed())
      : this.loadInitialLocalDevData();
    this.initPromise = this.initializeMysqlStorage();
  }

  /**
   * Menunggu hingga proses inisialisasi database selesai sepenuhnya.
   * Jika percobaan sebelumnya gagal (status 'failed'), memanggil ready() akan mencoba menginisialisasi ulang secara aman.
   */
  public async ready(): Promise<void> {
    if (
      !this.initPromise ||
      (isMysqlConfigured() && this.mysqlStatus === 'failed' && !this.isInitializing)
    ) {
      this.initPromise = this.initializeMysqlStorage();
    }
    await this.initPromise;
  }

  private isInitializing = false;
  private lastFailedMysqlAttemptAt = 0;
  private failedMysqlCycles = 0;

  public isMysqlReady(): boolean {
    return this.mysqlStatus === 'ready';
  }

  /**
   * Jika MySQL dikonfigurasi namun sempat gagal saat startup (misal MySQL server baru aktif),
   * coba hubungkan ulang secara berkala dengan exponential backoff agar aplikasi otomatis kembali ke MySQL
   * tanpa membebani latensi API.
   */
  public async retryMysqlIfNeeded(): Promise<boolean> {
    if (!isMysqlConfigured() || this.isMysqlReady() || this.isInitializing) {
      return false;
    }
    const now = Date.now();
    const backoffMs = Math.min(300_000, 30_000 * Math.pow(2, Math.max(0, this.failedMysqlCycles - 1)));
    if (now - this.lastFailedMysqlAttemptAt < backoffMs) {
      return false;
    }
    this.initPromise = this.initializeMysqlStorage(1);
    await this.initPromise;
    return this.isMysqlReady();
  }

  /**
   * Bernilai true apabila database siap melayani aplikasi:
   * - MySQL tidak dikonfigurasi (mode lokal), ATAU
   * - MySQL berhasil dimuat ('ready'), ATAU
   * - Mode fallback lokal aktif ketika MySQL tidak terjangkau di environment preview (kecuali MYSQL_STRICT_REQUIRED=true).
   */
  public isOperational(): boolean {
    if (!isMysqlConfigured() || this.mysqlStatus === 'ready') {
      return true;
    }
    if (process.env.MYSQL_STRICT_REQUIRED === 'true') {
      return false;
    }
    return this.mysqlStatus === 'failed';
  }

  /**
   * Menunggu seluruh antrean penulisan asynchronous ke MySQL selesai.
   */
  public async flushWrites(): Promise<void> {
    await this.mysqlWriteChain;
  }

  /**
   * Menjamin perubahan akun / password pengguna langsung tersimpan atomik ke tabel users MySQL
   * sebelum server mengembalikan respons sukses ke klien.
   */
  public async syncUserImmediately(user: User): Promise<void> {
    if (isMysqlConfigured() && this.mysqlStatus === 'ready') {
      try {
        const pool = await getMysqlPool();
        if (pool) {
          await upsertMysqlUserRow(pool, user);
        }
      } catch (err) {
        console.warn(`[DB] Direct user sync warning: ${sanitizeDbError(err)}`);
      }
    }
    await this.flushWrites();
  }

  public async removeUserImmediately(userId: string): Promise<void> {
    if (isMysqlConfigured() && this.mysqlStatus === 'ready') {
      try {
        const pool = await getMysqlPool();
        if (pool) {
          await deleteMysqlUserRow(pool, userId);
        }
      } catch (err) {
        console.warn(`[DB] Direct user delete warning: ${sanitizeDbError(err)}`);
      }
    }
    await this.flushWrites();
  }

  private ensureDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private persistLocalJsonOnly(snapshot: DatabaseSchema) {
    try {
      const jsonText = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(DB_FILE, jsonText, 'utf-8');
    } catch {
      // abaikan jika filesystem bersifat read-only pada environment produksi
    }
  }

  private persistExplicitBackup(snapshot: DatabaseSchema) {
    try {
      const jsonText = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(DB_BACKUP_FILE, jsonText, 'utf-8');
    } catch {
      // abaikan jika filesystem bersifat read-only
    }
  }

  /**
   * Hanya digunakan untuk mode fallback development lokal ketika MySQL TIDAK dikonfigurasi
   * atau ketika host MySQL produksi tidak dapat dijangkau dari container preview.
   * Catatan penting: db.backup.json tidak pernah dibaca secara otomatis, dan data ini TIDAK PERNAH ditulis ke MySQL.
   */
  private loadInitialLocalDevData(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        const rawParsed: DatabaseSchema = JSON.parse(fileContent);
        const normalized = normalizeSchema(rawParsed);
        this.persistLocalJsonOnly(normalized);
        return normalized;
      }
    } catch (err) {
      console.warn('[DB] Failed to read local development data/db.json, using default seed:', sanitizeDbError(err));
    }

    const fresh = normalizeSchema(createDefaultSeed());
    this.persistLocalJsonOnly(fresh);
    return fresh;
  }

  private async initializeMysqlStorage(maxAttempts = 3): Promise<void> {
    if (!isMysqlConfigured()) {
      this.mysqlStatus = 'unconfigured';
      return;
    }

    this.isInitializing = true;
    let lastError: unknown = null;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const pool = await getMysqlPool();
          if (!pool) {
            throw new Error('MySQL connection pool is unavailable.');
          }

          // Verifikasi koneksi aktif ke server MySQL sebelum menyatakan terhubung
          await pool.query('SELECT 1');
          console.log('[DB] MySQL connected successfully.');

          const existingFromMysql = await loadDatabaseFromMysql(pool);
          if (existingFromMysql) {
            const missingFlags: Record<string, boolean> = {};
            if (existingFromMysql.cleanResetPrj3581V1 === undefined) {
              missingFlags.cleanResetPrj3581V1 = true;
            }
            if (existingFromMysql.cleanResetPrj3581V2 === undefined) {
              missingFlags.cleanResetPrj3581V2 = true;
            }

            this.data = normalizeSchema(existingFromMysql);
            this.mysqlStatus = 'ready';
            this.failedMysqlCycles = 0;

            if (Object.keys(missingFlags).length > 0) {
              await upsertMysqlKvEntries(pool, missingFlags);
            }

            console.log('[DB] Existing application data loaded from MySQL.');
            return;
          }

          // Kondisi: MySQL berhasil terhubung DAN database benar-benar baru / kosong
          console.log('[DB] Database is empty. Initial seed is being created.');
          const initialSeed = normalizeSchema(createDefaultSeed());
          await saveDatabaseToMysql(pool, initialSeed);
          this.data = initialSeed;
          this.mysqlStatus = 'ready';
          this.failedMysqlCycles = 0;
          console.log('[DB] Initial seed saved successfully to MySQL.');
          return;
        } catch (err) {
          lastError = err;
          await resetMysqlPool();
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }

      this.lastFailedMysqlAttemptAt = Date.now();
      this.failedMysqlCycles += 1;
      const wasAlreadyFailed = this.mysqlStatus === 'failed';
      this.mysqlStatus = 'failed';
      if (!wasAlreadyFailed && process.env.MYSQL_STRICT_REQUIRED !== 'true') {
        this.data = this.loadInitialLocalDevData();
      }
      if (isCloudRunEnvironment() && process.env.MYSQL_STRICT_REQUIRED !== 'true') {
        if (!wasAlreadyFailed) {
          console.log(
            `[DB] MySQL unreachable from Cloud Run preview; using local preview storage (${sanitizeDbError(lastError)}).`
          );
        }
      } else {
        console.warn(`[DB] MySQL connection or initialization failed: ${sanitizeDbError(lastError)}`);
      }
    } finally {
      this.isInitializing = false;
    }
  }

  private persistToMysql(snapshot: DatabaseSchema) {
    if (!isMysqlConfigured()) {
      this.persistLocalJsonOnly(snapshot);
      return;
    }

    // Proteksi mutlak: jika pembacaan awal MySQL belum berhasil ('ready'),
    // JANGAN PERNAH menulis atau menimpa tabel MySQL dengan state memori/lokal.
    if (this.mysqlStatus !== 'ready') {
      if (process.env.MYSQL_STRICT_REQUIRED !== 'true') {
        this.persistLocalJsonOnly(snapshot);
      }
      return;
    }

    const clonedSnapshot: DatabaseSchema = JSON.parse(JSON.stringify(snapshot));

    this.mysqlWriteChain = this.mysqlWriteChain
      .then(async () => {
        const pool = await getMysqlPool();
        if (!pool) return;
        await saveDatabaseToMysql(pool, clonedSnapshot);
      })
      .catch((err) => {
        console.warn(`[DB] MySQL connection or initialization failed: ${sanitizeDbError(err)}`);
      });
  }

  public getData(): DatabaseSchema {
    return this.data;
  }

  public update(updater: (data: DatabaseSchema) => void): DatabaseSchema {
    updater(this.data);
    this.persistToMysql(this.data);
    return this.data;
  }

  public resetToSeed(): DatabaseSchema {
    this.data = normalizeSchema(createDefaultSeed());
    this.persistExplicitBackup(this.data);
    this.persistToMysql(this.data);
    return this.data;
  }
}

export const db = new Database();
