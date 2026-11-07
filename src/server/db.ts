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

class Database {
  private data: DatabaseSchema;

  constructor() {
    this.ensureDirectory();
    this.data = this.loadData();
  }

  private ensureDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadData(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed: DatabaseSchema = JSON.parse(fileContent);

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

        if (!Array.isArray(parsed.outcomes)) {
          parsed.outcomes = INITIAL_OUTCOMES;
        }
        if (!Array.isArray(parsed.outputs)) {
          parsed.outputs = INITIAL_OUTPUTS;
        }
        if (!Array.isArray(parsed.activities)) {
          parsed.activities = INITIAL_ACTIVITIES;
        }
        if (!Array.isArray(parsed.subActivities)) {
          parsed.subActivities = INITIAL_SUB_ACTIVITIES;
        }
        if (!Array.isArray(parsed.tors)) {
          parsed.tors = INITIAL_TORS;
        }
        if (!Array.isArray(parsed.approvalRecords)) {
          parsed.approvalRecords = INITIAL_APPROVAL_RECORDS;
        }
        if (!Array.isArray(parsed.auditLogs)) {
          parsed.auditLogs = INITIAL_AUDIT_LOGS;
        }
        if (!Array.isArray(parsed.cashAdvances)) {
          parsed.cashAdvances = INITIAL_CASH_ADVANCES;
        }

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

        if (!Array.isArray(parsed.meetingMinutes)) {
          parsed.meetingMinutes = INITIAL_MEETING_MINUTES;
        }
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
        if (
          !parsed.activityMonitoringRecords ||
          typeof parsed.activityMonitoringRecords !== 'object'
        ) {
          parsed.activityMonitoringRecords = { ...INITIAL_ACTIVITY_MONITORING_RECORDS };
        }
        if (!parsed.monitoringReports || typeof parsed.monitoringReports !== 'object') {
          parsed.monitoringReports = { ...INITIAL_MONITORING_REPORTS };
        }
        if (!Array.isArray(parsed.participantDatabase)) {
          parsed.participantDatabase = [];
        }

        this.saveData(parsed);
        return parsed;
      }
    } catch (err) {
      console.error('Error reading db.json, falling back to seed data:', err);
    }

    const initial: DatabaseSchema = {
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
    this.saveData(initial);
    return initial;
  }

  private saveData(data: DatabaseSchema) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error writing db.json:', err);
    }
  }

  public getData(): DatabaseSchema {
    return this.data;
  }

  public update(updater: (data: DatabaseSchema) => void): DatabaseSchema {
    updater(this.data);
    this.saveData(this.data);
    return this.data;
  }

  public resetToSeed(): DatabaseSchema {
    this.data = {
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
    this.saveData(this.data);
    return this.data;
  }
}

export const db = new Database();
