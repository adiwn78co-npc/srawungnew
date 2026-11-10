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
  cleanResetPrj3581V1?: boolean;
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
  };
}

function normalizeSchema(parsed: DatabaseSchema): DatabaseSchema {
  if (!parsed.cleanResetPrj3581V1) {
    parsed.programs = INITIAL_PROGRAMS.map((p) => ({ ...p, picId: '', picName: '' }));
    parsed.outcomes = INITIAL_OUTCOMES.map((oc) => ({ ...oc, picId: '', picName: '' }));
    parsed.outputs = INITIAL_OUTPUTS.map((op) => ({ ...op, picId: '', picName: '' }));
    parsed.activities = INITIAL_ACTIVITIES.map((act) => ({ ...act, picId: '', picName: '' }));
    parsed.subActivities = [];
    parsed.tors = [];
    parsed.approvalRecords = [];
    parsed.auditLogs = [];
    parsed.cashAdvances = [];
    parsed.cashAdvanceSummaries = {};
    parsed.cashAdvanceAuditLogs = {};
    parsed.meetingMinutes = [];
    parsed.activityDocumentations = {};
    parsed.activityDocumentationList = [];
    parsed.outputRaciRecords = {};
    parsed.activityMonitoringRecords = {};
    parsed.monitoringReports = {};
    parsed.approvalHubItems = {};
    parsed.approvalNotifications = [];
    parsed.programBudgets = {};
    parsed.participantDatabase = [];
    if (parsed.attendanceSystem && typeof parsed.attendanceSystem === 'object') {
      parsed.attendanceSystem.records = [];
      parsed.attendanceSystem.flextimeAssignments = [];
      parsed.attendanceSystem.leaveRequests = [];
      parsed.attendanceSystem.wfaRequests = [];
      parsed.attendanceSystem.holidayRequests = [];
      parsed.attendanceSystem.employeeTrainings = [];
      parsed.attendanceSystem.employeeProfileLinks = {};
      parsed.attendanceSystem.workRecapVerifications = {};
      parsed.attendanceSystem.auditTrail = [];
    }
    parsed.cleanResetPrj3581V1 = true;
  }

  if (!Array.isArray(parsed.programs) || parsed.programs.length === 0) {
    parsed.programs = [...INITIAL_PROGRAMS];
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
        budgetRequested: computedRequested,
        budgetApproved: t.budgetApproved ?? t.budgetRequested ?? 0,
        budgetActualSpent: computedActualSpent,
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

  private persistToDisk(snapshot: DatabaseSchema) {
    try {
      const jsonText = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(DB_FILE, jsonText, 'utf-8');
      fs.writeFileSync(DB_BACKUP_FILE, jsonText, 'utf-8');
    } catch {
      // abaikan jika read-only
    }
  }

  private loadInitialSeedFromBackupOrFile(): DatabaseSchema {
    try {
      const sourceFile = fs.existsSync(DB_BACKUP_FILE)
        ? DB_BACKUP_FILE
        : fs.existsSync(DB_FILE)
        ? DB_FILE
        : null;

      if (sourceFile) {
        const fileContent = fs.readFileSync(sourceFile, 'utf-8');
        const rawParsed: DatabaseSchema = JSON.parse(fileContent);
        const needsDiskSync = !rawParsed.cleanResetPrj3581V1;
        const normalized = normalizeSchema(rawParsed);
        if (needsDiskSync) {
          this.persistToDisk(normalized);
        } else if (fs.existsSync(DB_FILE) && !fs.existsSync(DB_BACKUP_FILE)) {
          try {
            fs.copyFileSync(DB_FILE, DB_BACKUP_FILE);
          } catch {
            // abaikan jika read-only
          }
        }
        return normalized;
      }
    } catch (err) {
      console.error('Error reading initial seed backup, falling back to default seed:', err);
    }

    const fresh = createDefaultSeed();
    this.persistToDisk(fresh);
    return fresh;
  }

  private async initializeMysqlStorage() {
    if (!isMysqlConfigured()) {
      return;
    }
    try {
      const pool = await getMysqlPool();
      if (!pool) return;

      const existingFromMysql = await loadDatabaseFromMysql(pool, this.data);
      if (existingFromMysql) {
        const needsReset = !existingFromMysql.cleanResetPrj3581V1;
        this.data = normalizeSchema(existingFromMysql);
        if (needsReset) {
          await saveDatabaseToMysql(pool, this.data);
        }
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

  private persistToMysql(snapshot: DatabaseSchema) {
    this.persistToDisk(snapshot);
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
