import crypto from 'crypto';
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
  checkMysqlWritePrivileges,
  deleteMysqlUserRow,
  ensureMysqlSchema,
  fetchProgramByIdFromMysql,
  fetchSystemAdminFromMysql,
  fetchUsersFromMysql,
  getMysqlPool,
  importProgramHierarchyToMysql,
  isCloudRunEnvironment,
  isMysqlConfigured,
  isMysqlLoopbackInCloudRun,
  isProductionHostingerEnvironment,
  loadDatabaseFromMysql,
  type MysqlHierarchyImportBatchParams,
  type MysqlPoolLike,
  type MysqlPrivilegeSummary,
  resetMysqlPool,
  saveDatabaseToMysql,
  saveDiffToMysql,
  upsertMysqlKvEntries,
  upsertMysqlUserRow,
  validateMysqlEnvConfiguration,
  verifyAndGetMysqlPool,
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
  organizationSettings?: Record<string, any>;
  cleanResetPrj3581V1?: boolean;
  cleanResetPrj3581V2?: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.resolve(DATA_DIR, 'db.json');
const DB_BACKUP_FILE = path.resolve(DATA_DIR, 'db.backup.json');

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
      canApproveTor: true,
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
      canManagePrograms: true,
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

const DEFAULT_INITIAL_USER_SCRYPT_HASH =
  'scrypt$ba9df605a7e35320f89561247f82a861$ad8b4942bc71ce1fa283548b3a339832946411e6ed2096f7f52d5e7fb95120b31b7196388f6c833faeca3b68e704758a0d6266eb797d4e19a9fd6b6a0cf45860';
const DEFAULT_SYSADMIN_BOOTSTRAP_SCRYPT_HASH =
  'scrypt$3a3328cdf4519f0a5c7e323a59a5ff48$bcee9184fb18bf6ab468182ed8169745a64842e69eac0bb9d4bb4fd559defe3b07f6c3a4a437c66fc6f5d8d94761f6ba9470b7c2e5cca8402338620d832093d3';

function buildPasswordHashFromSecret(secret: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedHex = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedHex}`;
}

function buildInitialPasswordHash(): string {
  const configuredPass = (process.env.DEFAULT_TESTING_PASSWORD || '').trim();
  if (configuredPass) {
    return buildPasswordHashFromSecret(configuredPass);
  }
  return DEFAULT_INITIAL_USER_SCRYPT_HASH;
}

function buildSystemAdminDefaultPasswordHash(): string {
  const configuredSysAdminPass = (
    process.env.SYSADMIN_DEFAULT_PASSWORD ||
    process.env.DEFAULT_TESTING_PASSWORD ||
    ''
  ).trim();
  if (configuredSysAdminPass) {
    return buildPasswordHashFromSecret(configuredSysAdminPass);
  }
  return DEFAULT_SYSADMIN_BOOTSTRAP_SCRYPT_HASH;
}

function cloneInitialUsers(): User[] {
  const initialHash = buildInitialPasswordHash();
  return INITIAL_USERS.map((u) => {
    const derivedUsername =
      u.username ||
      (u.email || '').split('@')[0]?.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') ||
      u.id;
    return {
      ...u,
      username: derivedUsername,
      accountStatus: u.accountStatus || (u.isActive === false ? 'Nonaktif' : 'Aktif'),
      passwordHash: u.passwordHash || initialHash,
      passwordUpdatedAt: u.passwordUpdatedAt || u.createdAt,
      mustChangePassword: true,
      permissions: { ...u.permissions },
    };
  });
}

function createDefaultSeed(): DatabaseSchema {
  return {
    users: cloneInitialUsers(),
    currentUserId: 'user-director',
    programs: [],
    outcomes: [],
    outputs: [],
    activities: [],
    subActivities: [],
    tors: [],
    approvalRecords: [],
    auditLogs: [],
    cashAdvances: [],
    cashAdvanceSummaries: {},
    cashAdvanceAuditLogs: {},
    meetingMinutes: [],
    activityDocumentations: {},
    activityDocumentationList: [],
    outputRaciRecords: {},
    activityMonitoringRecords: {},
    monitoringReports: {},
    approvalHubItems: {},
    approvalWorkflowConfigs: {},
    approvalNotifications: [],
    programBudgets: {},
    participantDatabase: [],
    cleanResetPrj3581V1: true,
    cleanResetPrj3581V2: true,
  };
}

function createEmptyDatabaseState(): DatabaseSchema {
  return {
    users: [],
    currentUserId: '',
    programs: [],
    outcomes: [],
    outputs: [],
    activities: [],
    subActivities: [],
    tors: [],
    approvalRecords: [],
    auditLogs: [],
    cashAdvances: [],
    cashAdvanceSummaries: {},
    cashAdvanceAuditLogs: {},
    meetingMinutes: [],
    activityDocumentations: {},
    activityDocumentationList: [],
    outputRaciRecords: {},
    activityMonitoringRecords: {},
    monitoringReports: {},
    approvalHubItems: {},
    approvalWorkflowConfigs: {},
    approvalNotifications: [],
    programBudgets: {},
    participantDatabase: [],
    cleanResetPrj3581V1: true,
    cleanResetPrj3581V2: true,
  };
}

function normalizeSchema(
  parsed: DatabaseSchema,
  options?: { isFromMysql?: boolean }
): DatabaseSchema {
  const isFromMysql = Boolean(options?.isFromMysql);

  // Migrasi skema bersifat murni additive & non-destructive:
  // Ketiadaan flag migrasi tidak pernah menghapus atau menimpa data operasional yang sudah ada.
  if (parsed.cleanResetPrj3581V1 === undefined) {
    parsed.cleanResetPrj3581V1 = true;
  }
  if (parsed.cleanResetPrj3581V2 === undefined) {
    parsed.cleanResetPrj3581V2 = true;
  }

  if (!Array.isArray(parsed.programs)) {
    parsed.programs = [];
  }

  const defaultPermsByRole: Record<User['role'], User['permissions']> = {
    system_admin: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: true, canViewAllTors: true },
    admin: { canManagePrograms: false, canCreateTor: false, canApproveTor: false, canManageUsers: true, canViewAllTors: true },
    director: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    hr: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
    finance: { canManagePrograms: false, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    program_manager: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    meal: { canManagePrograms: true, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
    staff: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: false },
  };

  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    // Jika dimuat dari MySQL, JANGAN menyuntikkan dummy INITIAL_USERS.
    parsed.users = isFromMysql ? [] : cloneInitialUsers();
  } else {
    parsed.users = parsed.users.map((u) => {
      if (u.role === 'system_admin') {
        return {
          ...u,
          permissions: {
            canManagePrograms: true,
            canCreateTor: true,
            canApproveTor: true,
            canManageUsers: true,
            canViewAllTors: true,
          },
        };
      }
      const basePerms = defaultPermsByRole[u.role] || defaultPermsByRole.staff;
      const rawPerms = (u.permissions && typeof u.permissions === 'object' ? u.permissions : {}) as Partial<User['permissions']>;
      const repairedManagePrograms =
        u.id === 'user-meal' && u.role === 'meal'
          ? true
          : (rawPerms.canManagePrograms ?? basePerms.canManagePrograms);
      const repairedApproveTor =
        u.role === 'admin'
          ? false
          : u.id === 'user-pm' && u.role === 'program_manager'
          ? true
          : (rawPerms.canApproveTor ?? basePerms.canApproveTor);
      return {
        ...u,
        permissions: {
          canManagePrograms: repairedManagePrograms,
          canCreateTor: rawPerms.canCreateTor ?? basePerms.canCreateTor,
          canApproveTor: repairedApproveTor,
          canManageUsers:
            u.role === 'admin' ? true : rawPerms.canManageUsers ?? basePerms.canManageUsers,
          canViewAllTors: rawPerms.canViewAllTors ?? basePerms.canViewAllTors,
        },
      };
    });

    // Hanya tambahkan default admin pada mode preview lokal (bukan pada database MySQL produksi)
    if (!isFromMysql) {
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
  }

  if (!parsed.currentUserId) {
    parsed.currentUserId = parsed.users[0]?.id || 'user-director';
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

  // Pastikan seluruh relasi hirarki (Output -> Outcome -> Program, Activity -> Output -> Outcome -> Program)
  // memiliki programId dan outcomeId lengkap agar operasi UPDATE/INSERT ke MySQL selalu memenuhi FOREIGN KEY.
  const outcomeByIdMap = new Map<string, Outcome>();
  for (const oc of parsed.outcomes) {
    if (oc && oc.id) {
      outcomeByIdMap.set(oc.id, oc);
    }
  }
  const outputByIdMap = new Map<string, Output>();
  parsed.outputs = parsed.outputs.map((op: any) => {
    const parentOc = op?.outcomeId ? outcomeByIdMap.get(op.outcomeId) : undefined;
    const enriched =
      !op?.programId && parentOc?.programId
        ? { ...op, programId: parentOc.programId }
        : op;
    if (enriched && enriched.id) {
      outputByIdMap.set(enriched.id, enriched);
    }
    return enriched;
  });
  const activityByIdMap = new Map<string, Activity>();
  parsed.activities = parsed.activities.map((ac: any) => {
    const parentOp: any = ac?.outputId ? outputByIdMap.get(ac.outputId) : undefined;
    const resolvedOutcomeId = ac?.outcomeId || parentOp?.outcomeId || '';
    const parentOc = resolvedOutcomeId ? outcomeByIdMap.get(resolvedOutcomeId) : undefined;
    const resolvedProgramId = ac?.programId || parentOp?.programId || parentOc?.programId || '';
    const enriched =
      (!ac?.outcomeId && resolvedOutcomeId) || (!ac?.programId && resolvedProgramId)
        ? {
            ...ac,
            ...(resolvedOutcomeId ? { outcomeId: resolvedOutcomeId } : {}),
            ...(resolvedProgramId ? { programId: resolvedProgramId } : {}),
          }
        : ac;
    if (enriched && enriched.id) {
      activityByIdMap.set(enriched.id, enriched);
    }
    return enriched;
  });
  parsed.subActivities = parsed.subActivities.map((sa: any) => {
    const parentAct: any = sa?.activityId ? activityByIdMap.get(sa.activityId) : undefined;
    if (!parentAct) return sa;
    const needsBackfill =
      (!sa?.outputId && parentAct.outputId) ||
      (!sa?.outcomeId && parentAct.outcomeId) ||
      (!sa?.programId && parentAct.programId);
    if (!needsBackfill) return sa;
    return {
      ...sa,
      ...(parentAct.outputId && !sa.outputId ? { outputId: parentAct.outputId } : {}),
      ...(parentAct.outcomeId && !sa.outcomeId ? { outcomeId: parentAct.outcomeId } : {}),
      ...(parentAct.programId && !sa.programId ? { programId: parentAct.programId } : {}),
    };
  });
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
    const programByIdMap = new Map<string, Program>();
    for (const pr of parsed.programs) {
      if (pr && pr.id) programByIdMap.set(pr.id, pr);
    }

    parsed.tors = parsed.tors.map((t: any) => {
      const linkedAct = t?.activityId ? activityByIdMap.get(t.activityId) : undefined;
      const resolvedOutputId = t?.outputId || linkedAct?.outputId || '';
      const linkedOutp = resolvedOutputId ? outputByIdMap.get(resolvedOutputId) : undefined;
      const resolvedOutcomeId = t?.outcomeId || linkedOutp?.outcomeId || '';
      const linkedOutc = resolvedOutcomeId ? outcomeByIdMap.get(resolvedOutcomeId) : undefined;
      const resolvedProgramId =
        t?.programId ||
        (linkedAct as any)?.programId ||
        (linkedOutp as any)?.programId ||
        linkedOutc?.programId ||
        '';
      const linkedProg = resolvedProgramId ? programByIdMap.get(resolvedProgramId) : undefined;

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
      const resolvedSubmissionStatus =
        t.submissionStatus || t.status || 'Draft';
      const resolvedActivityStatus =
        t.activityStatus ||
        (resolvedSubmissionStatus === 'Disetujui' ? 'Sedang Berjalan' : 'Belum Dimulai');

      return {
        ...t,
        title: typeof t.title === 'string' ? t.title : '',
        torNumber: typeof t.torNumber === 'string' ? t.torNumber : '',
        background: typeof t.background === 'string' ? t.background : '',
        rationale: typeof t.rationale === 'string' ? t.rationale : '',
        generalObjective: typeof t.generalObjective === 'string' ? t.generalObjective : '',
        objectives: typeof t.objectives === 'string' ? t.objectives : '',
        programId: resolvedProgramId,
        programName: t.programName || linkedProg?.name || linkedOutc?.programName || '',
        outcomeId: resolvedOutcomeId,
        outcomeName: t.outcomeName || linkedOutc?.name || '',
        outputId: resolvedOutputId,
        outputName: t.outputName || linkedOutp?.name || '',
        activityId: t.activityId || '',
        activityName: t.activityName || linkedAct?.name || t.title || '',
        picId: t.picId || t.createdById || '',
        picName: t.picName || t.createdByName || '',
        createdById: t.createdById || t.picId || '',
        createdByName: t.createdByName || t.picName || '',
        submissionStatus: resolvedSubmissionStatus,
        activityStatus: resolvedActivityStatus,
        implementingTeam: Array.isArray(t.implementingTeam) ? t.implementingTeam : [],
        specificObjectives: Array.isArray(t.specificObjectives) ? t.specificObjectives : [],
        timelineItems: Array.isArray(t.timelineItems) ? t.timelineItems : [],
        monitoringItems: Array.isArray(t.monitoringItems) ? t.monitoringItems : [],
        scopeOfActivities: Array.isArray(t.scopeOfActivities) ? t.scopeOfActivities : [],
        implementationMechanisms: Array.isArray(t.implementationMechanisms)
          ? t.implementationMechanisms
          : [],
        participantRows: Array.isArray(t.participantRows) ? t.participantRows : [],
        participantCustomColumns: Array.isArray(t.participantCustomColumns)
          ? t.participantCustomColumns
          : [],
        rolesResponsibilities: Array.isArray(t.rolesResponsibilities)
          ? t.rolesResponsibilities
          : [],
        rundown: Array.isArray(t.rundown) ? t.rundown : [],
        locations: Array.isArray(t.locations) ? t.locations : [],
        goals: Array.isArray(t.goals) ? t.goals : [],
        indicators: Array.isArray(t.indicators) ? t.indicators : [],
        mealItems: Array.isArray(t.mealItems) ? t.mealItems : [],
        challengesMitigations: Array.isArray(t.challengesMitigations)
          ? t.challengesMitigations
          : [],
        budgetAuditLogs: Array.isArray(t.budgetAuditLogs) ? t.budgetAuditLogs : [],
        budgetRequested:
          approvedCas.length > 0 ? computedRequested : (t.budgetRequested ?? 0),
        budgetApproved: t.budgetApproved ?? t.budgetRequested ?? 0,
        budgetActualSpent:
          verifiedCas.length > 0 ? computedActualSpent : (t.budgetActualSpent ?? 0),
      };
    });

    const torByIdMap = new Map<string, Tor>();
    for (const tr of parsed.tors) {
      if (tr && tr.id) torByIdMap.set(tr.id, tr);
    }

    parsed.cashAdvances = parsed.cashAdvances.map((ca: any) => {
      const parentTor = ca?.torId ? torByIdMap.get(ca.torId) : undefined;
      const resolvedAdvanceNumber =
        ca?.advanceNumber || ca?.caNumber || ca?.documentNumber || '';
      return {
        ...ca,
        advanceNumber: resolvedAdvanceNumber,
        torNumber: ca?.torNumber || parentTor?.torNumber || '',
        programId: ca?.programId || parentTor?.programId || '',
        programName: ca?.programName || parentTor?.programName || '',
        activityId: ca?.activityId || parentTor?.activityId || '',
        activityTitle: ca?.activityTitle || parentTor?.activityName || parentTor?.title || '',
        requesterId: ca?.requesterId || parentTor?.picId || '',
        requesterName: ca?.requesterName || parentTor?.picName || '',
        items: Array.isArray(ca?.items) ? ca.items : [],
      };
    });
  }

  if (Array.isArray(parsed.meetingMinutes)) {
    parsed.meetingMinutes = parsed.meetingMinutes.map((m: any) => ({
      ...m,
      participants: Array.isArray(m?.participants) ? m.participants : [],
      discussions: Array.isArray(m?.discussions) ? m.discussions : [],
      decisions: Array.isArray(m?.decisions) ? m.decisions : [],
      actionPoints: Array.isArray(m?.actionPoints) ? m.actionPoints : [],
    }));
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

function buildMysqlWriteFailureError(err: any, contextLabel: string): Error & {
  httpStatus?: number;
  userMessage?: string;
  code?: string;
  errorCategory?: string;
  failedTable?: string;
  failedStage?: string;
} {
  const sqlCode = String(err?.code || '');
  const failedTable = err?.failedTable ? String(err.failedTable) : undefined;
  const failedStage = err?.failedStage ? String(err.failedStage) : undefined;
  const safeDetail = sanitizeDbError(err);
  const tableInfo = failedTable ? ` pada tabel '${failedTable}'` : '';
  const codeInfo = sqlCode ? ` (${sqlCode})` : '';

  let httpStatus = 500;
  let userMessage = `[DATABASE WRITE ERROR] Gagal menyimpan perubahan${tableInfo} ke database MySQL produksi${codeInfo}. Perubahan dibatalkan agar tampilan tetap akurat.`;

  if (
    sqlCode === 'ER_TABLEACCESS_DENIED_ERROR' ||
    sqlCode === 'ER_DBACCESS_DENIED_ERROR' ||
    sqlCode === 'ER_SPECIFIC_ACCESS_DENIED_ERROR' ||
    /command denied to user/i.test(safeDetail)
  ) {
    httpStatus = 500;
    userMessage =
      `[DATABASE WRITE ERROR] Database MySQL menolak penyimpanan${tableInfo} karena user database belum memiliki hak akses tulis (INSERT / UPDATE / DELETE). Periksa hak akses user MySQL di panel Hostinger.`;
  } else if (
    sqlCode === 'ECONNREFUSED' ||
    sqlCode === 'PROTOCOL_CONNECTION_LOST' ||
    sqlCode === 'ETIMEDOUT' ||
    sqlCode === 'EHOSTUNREACH'
  ) {
    httpStatus = 503;
    userMessage =
      '[DATABASE WRITE ERROR] Koneksi ke server MySQL terputus saat menyimpan data. Silakan coba kembali beberapa saat lagi.';
  } else if (
    sqlCode === 'ER_NO_REFERENCED_ROW_2' ||
    sqlCode === 'ER_NO_REFERENCED_ROW' ||
    sqlCode === 'PROGRAM_NOT_FOUND_IN_MYSQL'
  ) {
    httpStatus = 400;
    userMessage =
      `[DATABASE WRITE ERROR] Relasi data induk tidak ditemukan${tableInfo}${codeInfo}. Pastikan Program, Outcome, atau Output induk sudah tersimpan di database MySQL.`;
  } else if (sqlCode === 'ER_ROW_IS_REFERENCED_2' || sqlCode === 'ER_ROW_IS_REFERENCED') {
    httpStatus = 409;
    userMessage =
      `[DATABASE WRITE ERROR] Data${tableInfo} tidak dapat dihapus atau diubah karena masih direferensikan oleh data turunan di database MySQL${codeInfo}.`;
  } else if (sqlCode === 'ER_BAD_NULL_ERROR' || sqlCode === 'ER_NO_DEFAULT_FOR_FIELD') {
    httpStatus = 400;
    userMessage =
      `[DATABASE WRITE ERROR] Kolom wajib${tableInfo} belum lengkap untuk struktur tabel MySQL${codeInfo}. Perubahan dibatalkan agar data tetap konsisten.`;
  } else if (sqlCode === 'ER_NO_SUCH_TABLE' || sqlCode === 'ER_BAD_FIELD_ERROR') {
    httpStatus = 500;
    userMessage =
      `[DATABASE WRITE ERROR] Struktur tabel atau kolom${tableInfo} di database MySQL belum sesuai${codeInfo}.`;
  } else if (sqlCode === 'ER_DUP_ENTRY') {
    httpStatus = 409;
    userMessage = `[DATABASE WRITE ERROR] Data dengan kode atau identitas tersebut sudah terdaftar${tableInfo} di database MySQL.`;
  } else if (sqlCode === 'ER_DATA_TOO_LONG' || sqlCode === 'ER_TRUNCATED_WRONG_VALUE') {
    httpStatus = 400;
    userMessage =
      `[DATABASE WRITE ERROR] Format atau panjang data tidak sesuai dengan kolom${tableInfo} di MySQL${codeInfo}. Periksa kembali isian Anda.`;
  }

  return Object.assign(new Error(`[MySQL Write Failed: ${contextLabel}] ${safeDetail}`), {
    httpStatus,
    userMessage,
    code: sqlCode || undefined,
    errorCategory: 'DATABASE_WRITE_ERROR',
    failedTable,
    failedStage,
  });
}

class Database {
  private data: DatabaseSchema;
  private lastCommittedJson = '';
  private mutationVersion = 0;
  private committedVersion = 0;
  private isCommittingWrite = false;
  private mysqlWriteChain: Promise<void> = Promise.resolve();
  private initPromise: Promise<void> | null = null;
  private mysqlStatus: 'unconfigured' | 'ready' | 'failed' = 'unconfigured';
  private lastMysqlErrorSummary = '';
  private lastUsersRefreshAt = 0;
  private lastFullMysqlSyncAt = 0;
  private privilegeSummary: MysqlPrivilegeSummary | null = null;

  constructor() {
    this.ensureDirectory();
    // Jika MySQL dikonfigurasi atau berjalan di lingkungan produksi Hostinger,
    // JANGAN PERNAH memuat data/db.json, db.backup.json, atau dummy seed ke memori.
    if (this.isStrictMysqlRequired()) {
      this.data = createEmptyDatabaseState();
    } else {
      this.data = this.loadInitialLocalDevData();
    }
    this.lastCommittedJson = JSON.stringify(this.data);
    this.initPromise = this.initializeMysqlStorage();
  }

  /**
   * Bernilai true apabila aplikasi wajib menggunakan MySQL tanpa fallback ke JSON/mock data:
   * - Kredensial MySQL (MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE) dikonfigurasi, ATAU
   * - Berjalan di environment produksi Hostinger (bukan container preview Cloud Run), ATAU
   * - MYSQL_STRICT_REQUIRED='true'.
   */
  public isStrictMysqlRequired(): boolean {
    return (
      isMysqlConfigured() ||
      isProductionHostingerEnvironment() ||
      process.env.MYSQL_STRICT_REQUIRED === 'true'
    );
  }

  /**
   * Menunggu hingga proses inisialisasi database selesai sepenuhnya.
   * Jika percobaan sebelumnya gagal (status 'failed'), memanggil ready() akan mencoba menginisialisasi ulang secara aman.
   */
  public async ready(): Promise<void> {
    if (
      !this.initPromise ||
      (this.isStrictMysqlRequired() && this.mysqlStatus === 'failed' && !this.isInitializing)
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

  public getLastErrorSummary(): string {
    return this.lastMysqlErrorSummary;
  }

  public getDiagnostics() {
    const envCheck = validateMysqlEnvConfiguration();
    const loopbackInCloudRun = isMysqlLoopbackInCloudRun();
    return {
      provider: this.isStrictMysqlRequired() ? 'mysql' : 'preview-local',
      status: this.mysqlStatus,
      operational: this.isOperational(),
      mysqlConfigured: envCheck.configured,
      loopbackInCloudRun,
      connectionHint: loopbackInCloudRun
        ? 'Cloud Run preview detected with loopback MYSQL_HOST (127.0.0.1); set MYSQL_REMOTE_HOST to connect Cloud Run directly to remote MySQL, or deploy on Hostinger where 127.0.0.1 connects to local MySQL.'
        : undefined,
      missingEnvVars: envCheck.missingVars,
      privileges: this.privilegeSummary
        ? {
            checked: this.privilegeSummary.checked,
            canSelect: this.privilegeSummary.canSelect,
            canInsert: this.privilegeSummary.canInsert,
            canUpdate: this.privilegeSummary.canUpdate,
            canDelete: this.privilegeSummary.canDelete,
          }
        : undefined,
      lastError: this.lastMysqlErrorSummary || undefined,
      counts: {
        users: (this.data.users || []).length,
        programs: (this.data.programs || []).length,
        tors: (this.data.tors || []).length,
      },
    };
  }

  /**
   * Jika MySQL dikonfigurasi namun sempat gagal saat startup (misal MySQL server baru aktif),
   * coba hubungkan ulang secara berkala dengan exponential backoff.
   */
  public async retryMysqlIfNeeded(): Promise<boolean> {
    if (!this.isStrictMysqlRequired() || this.isMysqlReady() || this.isInitializing) {
      return false;
    }
    const now = Date.now();
    const backoffMs = Math.min(60_000, 5_000 * Math.pow(2, Math.max(0, this.failedMysqlCycles - 1)));
    if (now - this.lastFailedMysqlAttemptAt < backoffMs) {
      return false;
    }
    this.initPromise = this.initializeMysqlStorage(1);
    await this.initPromise;
    return this.isMysqlReady();
  }

  /**
   * Bernilai true apabila database siap melayani aplikasi:
   * - Pada mode produksi / MySQL: HANYA bernilai true jika koneksi & pembacaan MySQL berhasil ('ready').
   *   Tidak ada fallback otomatis ke JSON atau in-memory seed apabila MySQL gagal terhubung.
   * - Pada mode preview Cloud Run (tanpa MySQL): bernilai true menggunakan penyimpanan preview.
   */
  public isOperational(): boolean {
    if (this.isStrictMysqlRequired()) {
      return this.mysqlStatus === 'ready';
    }
    return true;
  }

  private enqueueWriteTask<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mysqlWriteChain.then(task, task);
    this.mysqlWriteChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Menunggu seluruh antrean penulisan asynchronous ke MySQL selesai.
   */
  public async flushWrites(): Promise<void> {
    await this.mysqlWriteChain;
  }

  /**
   * Menyelaraskan baseline snapshot bersih setelah normalisasi memori non-mutasi (seperti saat startup / reload).
   */
  public syncCleanBaseline(): void {
    if (this.mutationVersion === this.committedVersion && !this.isCommittingWrite) {
      this.lastCommittedJson = JSON.stringify(this.data);
    }
  }

  public hasUncommittedChanges(): boolean {
    return this.mutationVersion > this.committedVersion;
  }

  public rollbackUncommittedChanges(): void {
    if (this.mutationVersion > this.committedVersion && this.lastCommittedJson) {
      try {
        this.data = JSON.parse(this.lastCommittedJson);
      } catch {
        // ignore parse fallback
      }
      this.mutationVersion = this.committedVersion;
    }
  }

  /**
   * Menyimpan seluruh perubahan yang dilakukan melalui `db.update()` ke MySQL secara sinkron & atomik.
   * Menggunakan penghitung versi monotonik (`mutationVersion` vs `committedVersion`) agar dua request
   * paralel tidak pernah saling menghapus flag dirty atau mengembalikan 200 OK sebelum versinya ter-commit di MySQL.
   */
  public async commitPendingWrites(contextLabel = 'write'): Promise<void> {
    if (!this.isStrictMysqlRequired()) {
      if (this.mutationVersion > this.committedVersion) {
        this.persistLocalJsonOnly(this.data);
        this.lastCommittedJson = JSON.stringify(this.data);
        this.committedVersion = this.mutationVersion;
      }
      return;
    }

    if (this.mysqlStatus !== 'ready') {
      this.rollbackUncommittedChanges();
      throw Object.assign(new Error('MySQL database is not ready for write operations.'), {
        httpStatus: 503,
        userMessage:
          'Database MySQL sedang tidak siap menerima penyimpanan data. Silakan muat ulang halaman dan coba kembali.',
      });
    }

    const requiredVersion = this.mutationVersion;
    if (requiredVersion <= this.committedVersion) {
      return;
    }

    await this.enqueueWriteTask(async () => {
      if (this.committedVersion >= requiredVersion && this.mutationVersion <= this.committedVersion) {
        return;
      }
      this.isCommittingWrite = true;
      try {
        const pool = await getMysqlPool();
        if (!pool) {
          throw new Error('MySQL connection pool is unavailable during commit.');
        }

        while (this.mutationVersion > this.committedVersion) {
          const targetVersion = this.mutationVersion;
          const prevData: DatabaseSchema = this.lastCommittedJson
            ? JSON.parse(this.lastCommittedJson)
            : createEmptyDatabaseState();
          const nextSnapshotJson = JSON.stringify(this.data);
          const nextData: DatabaseSchema = JSON.parse(nextSnapshotJson);

          await saveDiffToMysql(pool, prevData, nextData, contextLabel);

          this.lastCommittedJson = nextSnapshotJson;
          this.committedVersion = targetVersion;
          this.lastFullMysqlSyncAt = Date.now();
          this.lastUsersRefreshAt = Date.now();
        }
      } catch (err) {
        this.lastMysqlErrorSummary = sanitizeDbError(err);
        if (this.lastCommittedJson) {
          try {
            this.data = JSON.parse(this.lastCommittedJson);
          } catch {
            // ignore
          }
        }
        this.mutationVersion = this.committedVersion;
        throw buildMysqlWriteFailureError(err, contextLabel);
      } finally {
        this.isCommittingWrite = false;
      }
    });
  }

  /**
   * Mengeksekusi seluruh batch Import Excel Hirarki Program dalam satu transaksi atomik:
   * - Pada mode MySQL produksi: memverifikasi Program induk di MySQL, menjalankan START TRANSACTION -> outcomes -> outputs -> activities -> sub_activities -> COMMIT,
   *   lalu membaca ulang (SELECT) state terbaru dari MySQL agar data di memori & respons API 100% akurat sesuai isi tabel MySQL.
   * - Jika gagal di tahap mana pun: ROLLBACK penuh tanpa meninggalkan data parsial.
   */
  public async executeHierarchyImportTransaction(
    batchParams: MysqlHierarchyImportBatchParams
  ): Promise<DatabaseSchema> {
    const contextLabel = `POST /api/programs/${batchParams.programId}/import-hierarchy`;

    if (!this.isStrictMysqlRequired()) {
      const backupJson = JSON.stringify(this.data);
      try {
        console.log(`[IMPORT] DATABASE TRANSACTION STARTED (programId=${batchParams.programId}, mode=preview-local)`);
        const progExists = (this.data.programs || []).some((p) => p.id === batchParams.programId);
        if (!progExists) {
          throw Object.assign(
            new Error(`Parent program '${batchParams.programId}' not found.`),
            {
              code: 'PROGRAM_NOT_FOUND_IN_MYSQL',
              failedTable: 'programs',
              failedStage: 'PROGRAM VERIFICATION',
            }
          );
        }
        console.log(`[IMPORT] PROGRAM VERIFIED (programId=${batchParams.programId})`);

        const upsertById = <T extends { id: string }>(list: T[], incoming: T[]): T[] => {
          const map = new Map<string, T>();
          for (const item of list) map.set(item.id, item);
          for (const item of incoming) map.set(item.id, item);
          return Array.from(map.values());
        };

        console.log(`[IMPORT] OUTCOME INSERT STARTED (count=${batchParams.outcomesToUpsert.length})`);
        this.data.outcomes = upsertById(this.data.outcomes || [], batchParams.outcomesToUpsert);

        console.log(`[IMPORT] OUTPUT INSERT STARTED (count=${batchParams.outputsToUpsert.length})`);
        this.data.outputs = upsertById(this.data.outputs || [], batchParams.outputsToUpsert);

        console.log(`[IMPORT] ACTIVITY INSERT STARTED (count=${batchParams.activitiesToUpsert.length})`);
        this.data.activities = upsertById(this.data.activities || [], batchParams.activitiesToUpsert);

        if (batchParams.subActivitiesToUpsert.length > 0) {
          this.data.subActivities = upsertById(
            this.data.subActivities || [],
            batchParams.subActivitiesToUpsert
          );
        }
        if (batchParams.auditLog) {
          this.data.auditLogs = [...(this.data.auditLogs || []), batchParams.auditLog];
        }

        this.persistLocalJsonOnly(this.data);
        this.lastCommittedJson = JSON.stringify(this.data);
        this.committedVersion = this.mutationVersion;
        console.log(`[IMPORT] COMMIT SUCCESS (programId=${batchParams.programId}, mode=preview-local)`);
        return this.data;
      } catch (err) {
        this.data = JSON.parse(backupJson);
        this.mutationVersion = this.committedVersion;
        throw buildMysqlWriteFailureError(err, contextLabel);
      }
    }

    if (this.mysqlStatus !== 'ready') {
      throw Object.assign(new Error('MySQL database is not ready for hierarchy import.'), {
        httpStatus: 503,
        errorCategory: 'DATABASE_WRITE_ERROR',
        userMessage:
          '[DATABASE WRITE ERROR] Database MySQL sedang tidak siap menerima import hirarki. Silakan muat ulang halaman dan coba kembali.',
      });
    }

    return this.enqueueWriteTask(async () => {
      this.isCommittingWrite = true;
      try {
        const pool = await getMysqlPool();
        if (!pool) {
          throw new Error('MySQL connection pool is unavailable during hierarchy import.');
        }

        // Pastikan seluruh mutasi memori sebelumnya telah ter-commit sebelum import
        while (this.mutationVersion > this.committedVersion) {
          const targetVer = this.mutationVersion;
          const prevData: DatabaseSchema = this.lastCommittedJson
            ? JSON.parse(this.lastCommittedJson)
            : createEmptyDatabaseState();
          const snapJson = JSON.stringify(this.data);
          await saveDiffToMysql(pool, prevData, JSON.parse(snapJson), `${contextLabel}:pre-flush`);
          this.lastCommittedJson = snapJson;
          this.committedVersion = targetVer;
        }

        await importProgramHierarchyToMysql(pool, batchParams);

        // Setelah COMMIT sukses di MySQL, muat ulang data otoritatif langsung dari MySQL (SELECT)
        const freshFromMysql = await loadDatabaseFromMysql(pool);
        if (freshFromMysql) {
          this.data = normalizeSchema(freshFromMysql, { isFromMysql: true });
          this.lastCommittedJson = JSON.stringify(this.data);
          this.committedVersion = this.mutationVersion;
          this.lastFullMysqlSyncAt = Date.now();
          this.lastUsersRefreshAt = Date.now();
        }
        return this.data;
      } catch (err) {
        this.lastMysqlErrorSummary = sanitizeDbError(err);
        if (this.lastCommittedJson) {
          try {
            this.data = JSON.parse(this.lastCommittedJson);
          } catch {
            // ignore
          }
        }
        this.mutationVersion = this.committedVersion;
        throw buildMysqlWriteFailureError(err, contextLabel);
      } finally {
        this.isCommittingWrite = false;
      }
    });
  }

  /**
   * Menyegarkan data aplikasi dari MySQL apabila cache memori lebih lama dari `maxAgeMs`
   * dan tidak ada transaksi tulis yang sedang berlangsung, sehingga refresh halaman selalu
   * menampilkan data aktual yang benar-benar tersimpan di MySQL.
   */
  public async refreshFromMysqlIfStale(maxAgeMs = 1500): Promise<boolean> {
    if (
      !isMysqlConfigured() ||
      this.mysqlStatus !== 'ready' ||
      this.hasUncommittedChanges() ||
      this.isCommittingWrite
    ) {
      return false;
    }
    const now = Date.now();
    if (now - this.lastFullMysqlSyncAt < maxAgeMs) {
      return false;
    }
    const versionBeforeFetch = this.mutationVersion;
    try {
      const pool = await getMysqlPool();
      if (!pool) return false;
      const fresh = await loadDatabaseFromMysql(pool);
      if (
        fresh &&
        !this.hasUncommittedChanges() &&
        !this.isCommittingWrite &&
        this.mutationVersion === versionBeforeFetch
      ) {
        this.data = normalizeSchema(fresh, { isFromMysql: true });
        this.lastCommittedJson = JSON.stringify(this.data);
        this.lastFullMysqlSyncAt = Date.now();
        this.lastUsersRefreshAt = Date.now();
        return true;
      }
    } catch (err) {
      console.warn(`[DB] Warning refreshing state from MySQL: ${sanitizeDbError(err)}`);
    }
    return false;
  }

  /**
   * Memverifikasi dan menyinkronkan satu baris Program langsung dari tabel `programs` MySQL setelah operasi tulis.
   */
  public async verifyProgramInMysql(programId: string): Promise<Program | null> {
    if (!isMysqlConfigured() || this.mysqlStatus !== 'ready') {
      return (this.data.programs || []).find((p) => p.id === programId) || null;
    }
    const pool = await getMysqlPool();
    if (!pool) {
      return (this.data.programs || []).find((p) => p.id === programId) || null;
    }
    const hydrated = await fetchProgramByIdFromMysql(pool, programId);
    if (hydrated && hydrated.id) {
      const idx = (this.data.programs || []).findIndex((p) => p.id === programId);
      if (idx !== -1) {
        this.data.programs[idx] = hydrated;
      } else {
        this.data.programs = [hydrated, ...(this.data.programs || [])];
      }
      if (!this.hasUncommittedChanges() && !this.isCommittingWrite) {
        this.lastCommittedJson = JSON.stringify(this.data);
      }
      return hydrated;
    }
    return null;
  }

  /**
   * Membaca ulang daftar pengguna & password_hash terbaru langsung dari tabel `users` MySQL
   * agar login dan pengelolaan akun selalu menggunakan Single Source of Truth di MySQL.
   */
  public async refreshUsersFromMysql(force = false): Promise<User[]> {
    if (
      !isMysqlConfigured() ||
      this.mysqlStatus !== 'ready' ||
      this.hasUncommittedChanges() ||
      this.isCommittingWrite
    ) {
      return this.data.users || [];
    }
    const now = Date.now();
    if (!force && now - this.lastUsersRefreshAt < 2_000 && this.data.users.length > 0) {
      return this.data.users;
    }
    const versionBeforeFetch = this.mutationVersion;
    try {
      const pool = await getMysqlPool();
      if (!pool) return this.data.users || [];
      const freshUsers = await fetchUsersFromMysql(pool);
      if (
        Array.isArray(freshUsers) &&
        freshUsers.length > 0 &&
        !this.hasUncommittedChanges() &&
        !this.isCommittingWrite &&
        this.mutationVersion === versionBeforeFetch
      ) {
        this.data.users = freshUsers as User[];
        this.lastUsersRefreshAt = now;
        this.lastCommittedJson = JSON.stringify(this.data);
      }
    } catch (err) {
      console.warn(`[DB] Warning refreshing users from MySQL: ${sanitizeDbError(err)}`);
    }
    return this.data.users || [];
  }

  /**
   * Menjamin perubahan akun / password pengguna langsung tersimpan atomik ke tabel users MySQL
   * sebelum server mengembalikan respons sukses ke klien. Jika gagal, melempar error & rollback memori.
   */
  public async syncUserImmediately(
    user: User,
    options?: { bestEffortMetadataOnly?: boolean; contextLabel?: string }
  ): Promise<void> {
    const label = options?.contextLabel || `user-sync:${user?.id || 'unknown'}`;
    if (!this.isStrictMysqlRequired()) {
      await this.commitPendingWrites(label);
      return;
    }

    try {
      if (this.hasUncommittedChanges()) {
        await this.commitPendingWrites(label);
      } else if (isMysqlConfigured() && this.mysqlStatus === 'ready' && user?.id) {
        await this.enqueueWriteTask(async () => {
          const pool = await getMysqlPool();
          if (!pool) throw new Error('MySQL connection pool is unavailable.');
          await upsertMysqlUserRow(pool, user);
          this.lastUsersRefreshAt = Date.now();
          if (!this.hasUncommittedChanges()) {
            this.lastCommittedJson = JSON.stringify(this.data);
          }
        });
      }
    } catch (err) {
      if (options?.bestEffortMetadataOnly) {
        console.warn(
          `[DB] Non-critical login/session metadata update skipped (${label}): ${sanitizeDbError(err)}`
        );
        return;
      }
      throw err;
    }
  }

  public async removeUserImmediately(userId: string): Promise<void> {
    const label = `user-delete:${userId}`;
    if (!this.isStrictMysqlRequired()) {
      await this.commitPendingWrites(label);
      return;
    }

    if (this.mysqlStatus !== 'ready') {
      this.rollbackUncommittedChanges();
      throw Object.assign(new Error('MySQL database is not ready for user deletion.'), {
        httpStatus: 503,
        userMessage: 'Database MySQL sedang tidak tersedia untuk menghapus akun pengguna.',
      });
    }

    await this.enqueueWriteTask(async () => {
      this.isCommittingWrite = true;
      try {
        const pool = await getMysqlPool();
        if (!pool) {
          throw new Error('MySQL connection pool is unavailable.');
        }

        await deleteMysqlUserRow(pool, userId);

        while (this.mutationVersion > this.committedVersion) {
          const targetVersion = this.mutationVersion;
          const prevData: DatabaseSchema = this.lastCommittedJson
            ? JSON.parse(this.lastCommittedJson)
            : createEmptyDatabaseState();
          const nextSnapshotJson = JSON.stringify(this.data);
          const nextData: DatabaseSchema = JSON.parse(nextSnapshotJson);
          await saveDiffToMysql(pool, prevData, nextData, label);
          this.lastCommittedJson = nextSnapshotJson;
          this.committedVersion = targetVersion;
        }
        this.lastCommittedJson = JSON.stringify(this.data);

        this.lastUsersRefreshAt = Date.now();
        this.lastFullMysqlSyncAt = Date.now();
      } catch (err) {
        this.lastMysqlErrorSummary = sanitizeDbError(err);
        if (this.lastCommittedJson) {
          try {
            this.data = JSON.parse(this.lastCommittedJson);
          } catch {
            // ignore
          }
        }
        this.mutationVersion = this.committedVersion;
        throw buildMysqlWriteFailureError(err, label);
      } finally {
        this.isCommittingWrite = false;
      }
    });
  }

  private ensureDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private persistLocalJsonOnly(snapshot: DatabaseSchema) {
    if (this.isStrictMysqlRequired()) {
      return; // Jangan pernah menulis ke data/db.json ketika menggunakan MySQL / produksi
    }
    this.ensureDirectory();
    const jsonText = JSON.stringify(snapshot, null, 2);
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, jsonText, 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
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
   * Hanya digunakan untuk mode preview Cloud Run ketika tidak ada MySQL eksternal yang dikonfigurasi.
   * Tidak pernah dipanggil di lingkungan produksi Hostinger atau ketika MySQL dikonfigurasi.
   */
  private loadInitialLocalDevData(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        const rawParsed: DatabaseSchema = JSON.parse(fileContent);
        const normalized = normalizeSchema(rawParsed, { isFromMysql: false });
        this.persistLocalJsonOnly(normalized);
        return normalized;
      }
    } catch (err) {
      console.warn('[DB] Failed to read preview data/db.json, using default seed:', sanitizeDbError(err));
    }

    const fresh = normalizeSchema(createDefaultSeed(), { isFromMysql: false });
    this.persistLocalJsonOnly(fresh);
    return fresh;
  }

  private async initializeMysqlStorage(maxAttempts = 3): Promise<void> {
    const envCheck = validateMysqlEnvConfiguration();

    if (!isMysqlConfigured()) {
      if (this.isStrictMysqlRequired()) {
        this.mysqlStatus = 'failed';
        this.data = createEmptyDatabaseState();
        this.lastCommittedJson = JSON.stringify(this.data);
        this.lastMysqlErrorSummary = `Missing required MySQL environment variables (${envCheck.missingVars.join(', ')})`;
        console.error(
          `[DB] MySQL connection or initialization failed: ${this.lastMysqlErrorSummary}. Set MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.`
        );
      } else {
        this.mysqlStatus = 'unconfigured';
      }
      return;
    }

    this.isInitializing = true;
    let lastError: unknown = null;

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // 1. Buat & verifikasi koneksi ke MySQL dengan query ringan (SELECT 1)
          const pool = await verifyAndGetMysqlPool();
          console.log(`[DB] MySQL connected successfully (${envCheck.safeSummary}).`);

          // 2. Periksa privilege user MySQL secara non-destructive & pastikan tabel pendukung tersedia (CREATE TABLE IF NOT EXISTS)
          this.privilegeSummary = await checkMysqlWritePrivileges(pool);
          try {
            await ensureMysqlSchema(pool);
          } catch (schemaErr) {
            console.warn(
              `[DB] Non-destructive schema verification notice: ${sanitizeDbError(schemaErr)}`
            );
          }

          // 3. Muat data existing dari MySQL (Jalur READ yang sudah bekerja)
          const existingFromMysql = await loadDatabaseFromMysql(pool);
          if (existingFromMysql) {
            const missingFlags: Record<string, boolean> = {};
            if (existingFromMysql.cleanResetPrj3581V1 === undefined) {
              missingFlags.cleanResetPrj3581V1 = true;
            }
            if (existingFromMysql.cleanResetPrj3581V2 === undefined) {
              missingFlags.cleanResetPrj3581V2 = true;
            }

            if (!existingFromMysql.users || existingFromMysql.users.length === 0) {
              const seededUsers = cloneInitialUsers();
              for (const u of seededUsers) {
                await upsertMysqlUserRow(pool, u);
              }
              existingFromMysql.users = seededUsers;
              existingFromMysql.currentUserId = 'user-director';
            }

            this.data = normalizeSchema(existingFromMysql, { isFromMysql: true });
            await this.ensureSystemAdministratorInMysql(pool);

            this.lastCommittedJson = JSON.stringify(this.data);
            this.committedVersion = this.mutationVersion;
            this.mysqlStatus = 'ready';
            this.lastMysqlErrorSummary = '';
            this.failedMysqlCycles = 0;
            this.lastUsersRefreshAt = Date.now();
            this.lastFullMysqlSyncAt = Date.now();

            if (Object.keys(missingFlags).length > 0) {
              try {
                await upsertMysqlKvEntries(pool, missingFlags);
              } catch (kvErr) {
                console.warn(
                  `[DB] Metadata flag initialization skipped: ${sanitizeDbError(kvErr)}`
                );
              }
            }

            console.log(
              `[DB] Existing application data loaded from MySQL (users=${this.data.users.length}, programs=${this.data.programs.length}, tors=${this.data.tors.length}).`
            );
            return;
          }

          // 4. Hanya jika seluruh tabel di database MySQL benar-benar kosong (0 baris di semua tabel)
          console.log('[DB] Database is empty. Initial seed is being created.');
          let baseSeedSource: DatabaseSchema | null = null;
          try {
            if (fs.existsSync(DB_FILE)) {
              const existingJsonText = fs.readFileSync(DB_FILE, 'utf-8');
              const parsedLocal = JSON.parse(existingJsonText) as DatabaseSchema;
              if (parsedLocal && typeof parsedLocal === 'object') {
                const initialHash = buildInitialPasswordHash();
                if (Array.isArray(parsedLocal.users)) {
                  parsedLocal.users = parsedLocal.users.map((u) => ({
                    ...u,
                    username:
                      u.username ||
                      (u.email || '').split('@')[0]?.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') ||
                      u.id,
                    accountStatus: u.accountStatus || (u.isActive === false ? 'Nonaktif' : 'Aktif'),
                    passwordHash: u.passwordHash || initialHash,
                    passwordUpdatedAt: u.passwordUpdatedAt || u.createdAt,
                  }));
                }
                baseSeedSource = parsedLocal;
              }
            }
          } catch {
            baseSeedSource = null;
          }

          const initialSeed = normalizeSchema(
            baseSeedSource || createDefaultSeed(),
            { isFromMysql: false }
          );
          await saveDatabaseToMysql(pool, initialSeed);
          this.data = initialSeed;
          await this.ensureSystemAdministratorInMysql(pool);

          this.lastCommittedJson = JSON.stringify(this.data);
          this.committedVersion = this.mutationVersion;
          this.mysqlStatus = 'ready';
          this.lastMysqlErrorSummary = '';
          this.failedMysqlCycles = 0;
          this.lastUsersRefreshAt = Date.now();
          this.lastFullMysqlSyncAt = Date.now();
          console.log('[DB] Initial seed saved successfully to MySQL.');
          return;
        } catch (err) {
          lastError = err;
          await resetMysqlPool();
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      this.lastFailedMysqlAttemptAt = Date.now();
      this.failedMysqlCycles += 1;
      this.mysqlStatus = 'failed';
      this.lastMysqlErrorSummary = sanitizeDbError(lastError);
      // Proteksi mutlak: JANGAN memuat data/db.json atau dummy seed apabila MySQL gagal terhubung!
      this.data = createEmptyDatabaseState();
      this.lastCommittedJson = JSON.stringify(this.data);
      this.committedVersion = this.mutationVersion;
      console.error(`[DB] MySQL connection or initialization failed: ${this.lastMysqlErrorSummary}`);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Memastikan tepat satu akun System Administrator (`role = 'system_admin'`) tersedia di MySQL
   * sebagai recovery & high-level system management access tanpa pernah menghapus, mengubah,
   * atau menimpa akun Administrator (`role = 'admin'`) maupun akun System Administrator yang sudah ada.
   */
  private async ensureSystemAdministratorInMysql(pool: MysqlPoolLike): Promise<void> {
    const existingSysAdmin = await fetchSystemAdminFromMysql(pool);

    if (existingSysAdmin && existingSysAdmin.id) {
      // Jika System Administrator sudah ada di MySQL: JANGAN duplikasi dan JANGAN timpa password_hash / data user.
      // Hanya perbaiki jika password_hash benar-benar kosong/rusak agar akses pemulihan tetap berfungsi.
      if (!existingSysAdmin.passwordHash || !String(existingSysAdmin.passwordHash).trim()) {
        const repairedSysAdmin: User = {
          ...existingSysAdmin,
          role: 'system_admin',
          passwordHash: buildSystemAdminDefaultPasswordHash(),
          passwordUpdatedAt: new Date().toISOString(),
          permissions: {
            canManagePrograms: true,
            canCreateTor: true,
            canApproveTor: true,
            canManageUsers: true,
            canViewAllTors: true,
          },
        };
        await upsertMysqlUserRow(pool, repairedSysAdmin);
      }

      const refreshedUsers = await fetchUsersFromMysql(pool);
      if (Array.isArray(refreshedUsers) && refreshedUsers.length > 0) {
        this.data = normalizeSchema(
          { ...this.data, users: refreshedUsers as User[] },
          { isFromMysql: true }
        );
      }
      console.log(
        `[AUTH-INIT] System Administrator account verified in MySQL (id=${existingSysAdmin.id}, role=system_admin).`
      );
      return;
    }

    // Jika System Administrator belum ada di MySQL: buat 1 akun default dengan hash password kriptografis (scrypt)
    const nowIso = new Date().toISOString();
    const currentUsers = await fetchUsersFromMysql(pool);
    const takenUsernames = new Set(
      currentUsers.map((u: any) => String(u.username || '').trim().toLowerCase()).filter(Boolean)
    );
    const takenEmails = new Set(
      currentUsers.map((u: any) => String(u.email || '').trim().toLowerCase()).filter(Boolean)
    );

    const preferredUsername = String(process.env.SYSADMIN_DEFAULT_USERNAME || 'sysadmin')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '') || 'sysadmin';
    const resolvedUsername = takenUsernames.has(preferredUsername)
      ? 'system.admin'
      : preferredUsername;

    const preferredEmail = String(process.env.SYSADMIN_DEFAULT_EMAIL || 'sysadmin@wijna.org')
      .trim()
      .toLowerCase();
    const resolvedEmail = takenEmails.has(preferredEmail)
      ? 'sysadmin.recovery@wijna.org'
      : preferredEmail;

    const resolvedName =
      String(process.env.SYSADMIN_DEFAULT_NAME || 'System Administrator').trim() ||
      'System Administrator';

    const newSysAdmin: User = {
      id: 'user-sysadmin',
      username: resolvedUsername,
      name: resolvedName,
      email: resolvedEmail,
      role: 'system_admin',
      roleTitle: 'System Administrator',
      department: 'Pemulihan & Tata Kelola Sistem Utama',
      isActive: true,
      accountStatus: 'Aktif',
      mustChangePassword: false,
      passwordHash: buildSystemAdminDefaultPasswordHash(),
      passwordUpdatedAt: nowIso,
      permissions: {
        canManagePrograms: true,
        canCreateTor: true,
        canApproveTor: true,
        canManageUsers: true,
        canViewAllTors: true,
      },
      createdAt: nowIso,
    };

    // INSERT ke tabel users MySQL
    await upsertMysqlUserRow(pool, newSysAdmin);

    // SELECT kembali langsung dari MySQL untuk memastikan data benar-benar tersimpan
    const verifiedSysAdmin = await fetchSystemAdminFromMysql(pool);
    if (!verifiedSysAdmin || !verifiedSysAdmin.id) {
      throw new Error(
        'Failed to verify newly created System Administrator account in MySQL users table.'
      );
    }

    const allUsersFromMysql = await fetchUsersFromMysql(pool);
    this.data = normalizeSchema(
      { ...this.data, users: allUsersFromMysql as User[] },
      { isFromMysql: true }
    );
    console.log(
      `[AUTH-INIT] System Administrator account created and stored in MySQL (id=${verifiedSysAdmin.id}, role=system_admin).`
    );
  }

  public getData(): DatabaseSchema {
    return this.data;
  }

  public update(updater: (data: DatabaseSchema) => void): DatabaseSchema {
    if (!this.isStrictMysqlRequired()) {
      updater(this.data);
      this.persistLocalJsonOnly(this.data);
      this.lastCommittedJson = JSON.stringify(this.data);
      this.committedVersion = this.mutationVersion;
      return this.data;
    }

    if (this.mysqlStatus !== 'ready') {
      throw Object.assign(new Error('MySQL database is not ready to accept updates.'), {
        httpStatus: 503,
        userMessage:
          'Database MySQL sedang tidak tersedia. Perubahan tidak dapat diproses saat ini.',
      });
    }

    if (!this.lastCommittedJson) {
      this.lastCommittedJson = JSON.stringify(this.data);
    }

    updater(this.data);
    this.mutationVersion += 1;
    return this.data;
  }

  public resetToSeed(): DatabaseSchema {
    if (this.isStrictMysqlRequired()) {
      throw new Error('Reset to seed is strictly prohibited when connected to MySQL production database.');
    }
    this.data = normalizeSchema(createDefaultSeed(), { isFromMysql: false });
    this.persistExplicitBackup(this.data);
    this.persistLocalJsonOnly(this.data);
    this.lastCommittedJson = JSON.stringify(this.data);
    this.committedVersion = this.mutationVersion;
    return this.data;
  }
}

export const db = new Database();
