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
} from './mysqlPool.ts';

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
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.resolve(DATA_DIR, 'db.json');
const DB_BACKUP_FILE = path.resolve(DATA_DIR, 'db.backup.json');

const INITIAL_PROGRAMS: Program[] = [];

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

const INITIAL_OUTCOMES: Outcome[] = [];
const INITIAL_OUTPUTS: Output[] = [];
const INITIAL_ACTIVITIES: Activity[] = [];
const INITIAL_SUB_ACTIVITIES: SubActivity[] = [];
const INITIAL_TORS: Tor[] = [];
const INITIAL_APPROVAL_RECORDS: TorApprovalRecord[] = [];
const INITIAL_AUDIT_LOGS: AuditLog[] = [];
export const INITIAL_CASH_ADVANCES: CashAdvanceRecord[] = [];
const INITIAL_ACTIVITY_DOCUMENTATIONS: Record<string, ActivityDocumentationRecord> = {};
const INITIAL_ACTIVITY_DOCUMENTATION_LIST: ActivityDocumentationRecord[] = [];
const INITIAL_MEETING_MINUTES: MeetingMinutesRecord[] = [];
const INITIAL_OUTPUT_RACI_RECORDS: Record<string, OutputRaciRecord> = {};
const INITIAL_ACTIVITY_MONITORING_RECORDS: Record<string, ActivityMonitoringRecord> = {};
const INITIAL_MONITORING_REPORTS: Record<string, MonitoringReportItem> = {};

function createDefaultSeed(): DatabaseSchema {
  return {
    users: INITIAL_USERS,
    currentUserId: 'user-director',
    programs: INITIAL_PROGRAMS,
    outcomes: INITIAL_OUTCOMES,
    outputs: INITIAL_OUTPUTS,
    activities: INITIAL_ACTIVITIES,
    subActivities: INITIAL_SUB_ACTIVITIES,
    tors: INITIAL_TORS,
    approvalRecords: INITIAL_APPROVAL_RECORDS,
    auditLogs: INITIAL_AUDIT_LOGS,
    cashAdvances: INITIAL_CASH_ADVANCES,
    cashAdvanceSummaries: {},
    cashAdvanceAuditLogs: {},
    meetingMinutes: INITIAL_MEETING_MINUTES,
    activityDocumentations: INITIAL_ACTIVITY_DOCUMENTATIONS,
    activityDocumentationList: INITIAL_ACTIVITY_DOCUMENTATION_LIST,
    outputRaciRecords: { ...INITIAL_OUTPUT_RACI_RECORDS },
    activityMonitoringRecords: { ...INITIAL_ACTIVITY_MONITORING_RECORDS },
    monitoringReports: { ...INITIAL_MONITORING_REPORTS },
    approvalHubItems: {},
    approvalNotifications: [],
    programBudgets: {},
    participantDatabase: [],
  };
}

function normalizeSchema(parsed: DatabaseSchema): DatabaseSchema {
  if (!Array.isArray(parsed.programs)) {
    parsed.programs = INITIAL_PROGRAMS;
  }

  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    parsed.users = [...INITIAL_USERS];
  } else {
    parsed.users = parsed.users
      .filter((u) => u.id !== 'user-hr' && u.role !== 'hr')
      .map((u) =>
        u.id === 'user-finance' || u.role === 'finance'
          ? {
              ...u,
              roleTitle: 'Finance & HR Manager',
              department: 'Keuangan, HR & Kepatuhan',
            }
          : u
      );
    const hasAdmin = parsed.users.some(
      (u) => u.role === 'admin' || u.permissions?.canManageUsers
    );
    if (!hasAdmin) {
      const defaultAdmin = INITIAL_USERS.find((u) => u.role === 'admin');
      if (defaultAdmin) {
        parsed.users.push({ ...defaultAdmin, isActive: true, accountStatus: 'Aktif' });
      }
    }
    if (parsed.currentUserId === 'user-hr') {
      parsed.currentUserId = 'user-finance';
    }
  }

  if (!Array.isArray(parsed.outcomes)) parsed.outcomes = INITIAL_OUTCOMES;
  if (!Array.isArray(parsed.outputs)) parsed.outputs = INITIAL_OUTPUTS;
  if (!Array.isArray(parsed.activities)) parsed.activities = INITIAL_ACTIVITIES;
  if (!Array.isArray(parsed.subActivities)) parsed.subActivities = INITIAL_SUB_ACTIVITIES;
  if (!Array.isArray(parsed.tors)) parsed.tors = INITIAL_TORS;
  if (!Array.isArray(parsed.approvalRecords)) parsed.approvalRecords = INITIAL_APPROVAL_RECORDS;
  if (!Array.isArray(parsed.auditLogs)) parsed.auditLogs = INITIAL_AUDIT_LOGS;
  if (!Array.isArray(parsed.cashAdvances)) parsed.cashAdvances = INITIAL_CASH_ADVANCES;

  if (Array.isArray(parsed.tors) && Array.isArray(parsed.cashAdvances)) {
    parsed.tors = parsed.tors.map((t) => {
      const torCas = parsed.cashAdvances!.filter(
        (ca) => ca.torId === t.id && ca.status !== 'Ditolak' && ca.status !== 'Draft'
      );
      const verifiedCas = torCas.filter(
        (ca) => ca.isReported && ca.reportApprovalStatus === 'Telah Disetujui'
      );
      const computedRequested =
        torCas.length > 0
          ? torCas.reduce((sum, ca) => sum + (Number(ca.totalAmount) || 0), 0)
          : t.budgetRequested ?? null;
      const computedActualSpent = verifiedCas.reduce(
        (sum, ca) => sum + (Number(ca.realizedAmount ?? ca.totalAmount) || 0),
        0
      );
      return {
        ...t,
        budgetRequested: computedRequested,
        budgetActualSpent: computedActualSpent,
      };
    });
  }

  if (!Array.isArray(parsed.meetingMinutes)) parsed.meetingMinutes = INITIAL_MEETING_MINUTES;
  if (!parsed.activityDocumentations || typeof parsed.activityDocumentations !== 'object') {
    parsed.activityDocumentations = INITIAL_ACTIVITY_DOCUMENTATIONS;
  }
  if (!Array.isArray(parsed.activityDocumentationList)) {
    parsed.activityDocumentationList = [...INITIAL_ACTIVITY_DOCUMENTATION_LIST];
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
    parsed.outputRaciRecords = { ...INITIAL_OUTPUT_RACI_RECORDS };
  }
  if (!parsed.activityMonitoringRecords || typeof parsed.activityMonitoringRecords !== 'object') {
    parsed.activityMonitoringRecords = { ...INITIAL_ACTIVITY_MONITORING_RECORDS };
  }
  if (!parsed.monitoringReports || typeof parsed.monitoringReports !== 'object') {
    parsed.monitoringReports = { ...INITIAL_MONITORING_REPORTS };
  }
  if (!Array.isArray(parsed.participantDatabase)) {
    parsed.participantDatabase = [];
  }

  return parsed;
}

class Database {
  private data: DatabaseSchema;
  private mysqlWriteChain: Promise<void> = Promise.resolve();

  constructor() {
    this.ensureDirectory();
    this.data = this.loadInitialSeedFromBackupOrFile();
    this.initializeMysqlStorage();
  }

  private ensureDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Membaca seed awal dari backup JSON (hanya sebagai sumber migrasi awal sebelum MySQL aktif).
   * Penulisan ke db.json dihentikan agar seluruh penyimpanan berjalan melalui MySQL.
   */
  private loadInitialSeedFromBackupOrFile(): DatabaseSchema {
    try {
      const sourceFile = fs.existsSync(DB_BACKUP_FILE)
        ? DB_BACKUP_FILE
        : fs.existsSync(DB_FILE)
        ? DB_FILE
        : null;

      if (sourceFile) {
        const fileContent = fs.readFileSync(sourceFile, 'utf-8');
        const parsed: DatabaseSchema = JSON.parse(fileContent);
        // Buat salinan backup satu kali dari db.json ke db.backup.json bila belum ada
        if (fs.existsSync(DB_FILE) && !fs.existsSync(DB_BACKUP_FILE)) {
          try {
            fs.copyFileSync(DB_FILE, DB_BACKUP_FILE);
          } catch {
            // abaikan jika read-only
          }
        }
        return normalizeSchema(parsed);
      }
    } catch (err) {
      console.error('Error reading initial seed backup, falling back to default seed:', err);
    }

    return createDefaultSeed();
  }

  /**
   * Inisialisasi koneksi MySQL (SELECT dari tabel MySQL, atau migrasi otomatis dari seed jika tabel MySQL kosong)
   */
  private async initializeMysqlStorage() {
    if (!isMysqlConfigured()) {
      return;
    }
    try {
      const pool = await getMysqlPool();
      if (!pool) return;

      const existingFromMysql = await loadDatabaseFromMysql(pool, this.data);
      if (existingFromMysql) {
        this.data = normalizeSchema(existingFromMysql);
        console.log('[MySQL] Berhasil memuat seluruh data dari tabel-tabel MySQL.');
      } else {
        console.log('[MySQL] Tabel MySQL masih kosong — menjalankan migrasi otomatis dari backup db.json...');
        await saveDatabaseToMysql(pool, this.data);
        console.log('[MySQL] Migrasi otomatis dari db.json ke MySQL selesai.');
      }
    } catch (err: any) {
      console.error('[MySQL] Gagal menghubungkan atau memuat data dari MySQL:', err?.message || err);
    }
  }

  /**
   * Menyimpan perubahan ke MySQL menggunakan query INSERT / UPDATE / DELETE.
   * Penulisan ke file db.json telah dihentikan.
   */
  private persistToMysql(snapshot: DatabaseSchema) {
    if (!isMysqlConfigured()) {
      return;
    }
    this.mysqlWriteChain = this.mysqlWriteChain
      .then(async () => {
        const pool = await getMysqlPool();
        if (!pool) return;
        await saveDatabaseToMysql(pool, snapshot);
      })
      .catch((err) => {
        console.error('[MySQL] Gagal menyimpan perubahan ke MySQL:', err?.message || err);
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
    this.data = createDefaultSeed();
    this.persistToMysql(this.data);
    return this.data;
  }
}

export const db = new Database();
