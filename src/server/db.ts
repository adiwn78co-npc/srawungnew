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
  isMysqlConfigured,
  loadDatabaseFromMysql,
  saveDatabaseToMysql,
  upsertMysqlKvEntries,
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

function createDefaultSeed(): DatabaseSchema {
  return {
    users: INITIAL_USERS,
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
    parsed.programs = [...INITIAL_PROGRAMS];
  }

  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    parsed.users = [...INITIAL_USERS];
  } else {
    const hasAdmin = parsed.users.some(
      (u) => u.role === 'admin' || u.permissions?.canManageUsers
    );
    if (!hasAdmin) {
      const defaultAdmin = INITIAL_USERS.find((u) => u.role === 'admin');
      if (defaultAdmin) {
        parsed.users.push({ ...defaultAdmin, isActive: true, accountStatus: 'Aktif' });
      }
    }
  }

  if (!Array.isArray(parsed.outcomes)) {
    parsed.outcomes = [...INITIAL_OUTCOMES];
  }
  if (!Array.isArray(parsed.outputs)) {
    parsed.outputs = [...INITIAL_OUTPUTS];
  }
  if (!Array.isArray(parsed.activities)) {
    parsed.activities = [...INITIAL_ACTIVITIES];
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

class Database {
  private data: DatabaseSchema;
  private mysqlWriteChain: Promise<void> = Promise.resolve();
  private initPromise: Promise<void> | null = null;
  private mysqlStatus: 'unconfigured' | 'ready' | 'failed' = 'unconfigured';

  constructor() {
    this.ensureDirectory();
    this.data = this.loadInitialLocalSeed();
    this.initPromise = this.initializeMysqlStorage();
  }

  /**
   * Menunggu hingga proses inisialisasi database (khususnya pembacaan awal dari MySQL)
   * benar-benar selesai sebelum server menerima request atau memodifikasi data.
   */
  public async ready(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeMysqlStorage();
    }
    await this.initPromise;
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
   * Memuat data lokal untuk:
   * - fallback development (ketika MySQL tidak dikonfigurasi), atau
   * - seed awal satu kali apabila database MySQL benar-benar baru/kosong.
   * Catatan: db.json diprioritaskan di atas db.backup.json, dan tidak pernah menimpa MySQL yang sudah berisi data.
   */
  private loadInitialLocalSeed(): DatabaseSchema {
    try {
      const sourceFile = fs.existsSync(DB_FILE)
        ? DB_FILE
        : fs.existsSync(DB_BACKUP_FILE)
        ? DB_BACKUP_FILE
        : null;

      if (sourceFile) {
        const fileContent = fs.readFileSync(sourceFile, 'utf-8');
        const rawParsed: DatabaseSchema = JSON.parse(fileContent);
        const normalized = normalizeSchema(rawParsed);
        if (!isMysqlConfigured()) {
          this.persistLocalJsonOnly(normalized);
        }
        return normalized;
      }
    } catch (err) {
      console.error('[Database][Local] Gagal membaca file JSON lokal, menggunakan default seed:', err);
    }

    const fresh = normalizeSchema(createDefaultSeed());
    if (!isMysqlConfigured()) {
      this.persistLocalJsonOnly(fresh);
      if (!fs.existsSync(DB_BACKUP_FILE)) {
        this.persistExplicitBackup(fresh);
      }
    }
    return fresh;
  }

  private async initializeMysqlStorage(): Promise<void> {
    if (!isMysqlConfigured()) {
      this.mysqlStatus = 'unconfigured';
      console.log(
        '[Database][Local] Konfigurasi MySQL tidak ditemukan — menggunakan penyimpanan file lokal (data/db.json).'
      );
      return;
    }

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const pool = await getMysqlPool();
        if (!pool) {
          throw new Error('Pool koneksi MySQL bernilai null meskipun konfigurasi environment tersedia.');
        }

        const existingFromMysql = await loadDatabaseFromMysql(pool, this.data);
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

          if (Object.keys(missingFlags).length > 0) {
            await upsertMysqlKvEntries(pool, missingFlags);
          }

          // Sinkronkan salinan cache lokal dari MySQL (MySQL adalah sumber kebenaran utama)
          this.persistLocalJsonOnly(this.data);

          console.log(
            `[Database][MySQL] Berhasil memuat data operasional dari MySQL (users: ${
              this.data.users.length
            }, programs: ${this.data.programs.length}, tors: ${
              this.data.tors.length
            }, cashAdvances: ${(this.data.cashAdvances || []).length}, participants: ${
              (this.data.participantDatabase || []).length
            }).`
          );
          return;
        }

        // Database MySQL benar-benar baru / kosong: lakukan seed awal satu kali saja
        this.data = normalizeSchema(this.data);
        await saveDatabaseToMysql(pool, this.data);
        this.mysqlStatus = 'ready';
        this.persistLocalJsonOnly(this.data);

        console.log(
          `[Database][MySQL] Database MySQL masih kosong — seed awal berhasil diinisialisasi satu kali ke MySQL (users: ${this.data.users.length}, programs: ${this.data.programs.length}).`
        );
        return;
      } catch (err: any) {
        lastError = err;
        if (attempt < maxAttempts) {
          console.warn(
            `[Database][MySQL] Percobaan koneksi/muat ke-${attempt}/${maxAttempts} belum berhasil (${
              err?.message || err
            }). Mencoba ulang dalam 1 detik...`
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    this.mysqlStatus = 'failed';
    console.error(
      '[Database][MySQL] Gagal terhubung atau memuat data dari MySQL setelah seluruh percobaan. Penulisan otomatis ke MySQL ditangguhkan guna mencegah penimpaan data produksi:',
      lastError?.message || lastError
    );
  }

  private persistToMysql(snapshot: DatabaseSchema) {
    if (!isMysqlConfigured()) {
      this.persistLocalJsonOnly(snapshot);
      return;
    }

    if (this.mysqlStatus !== 'ready') {
      console.error(
        '[Database][MySQL] Peringatan: Perubahan dibatalkan untuk ditulis ke MySQL karena koneksi/pembacaan awal MySQL belum berstatus ready (proteksi anti-overwrite data produksi).'
      );
      return;
    }

    this.persistLocalJsonOnly(snapshot);
    const clonedSnapshot: DatabaseSchema = JSON.parse(JSON.stringify(snapshot));

    this.mysqlWriteChain = this.mysqlWriteChain
      .then(async () => {
        const pool = await getMysqlPool();
        if (!pool) return;
        await saveDatabaseToMysql(pool, clonedSnapshot);
      })
      .catch((err) => {
        console.error('[Database][MySQL] Gagal menyimpan perubahan ke MySQL:', err?.message || err);
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
