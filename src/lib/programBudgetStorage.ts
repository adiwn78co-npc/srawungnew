import * as XLSX from 'xlsx';
import {
  Program,
  Outcome,
  Output,
  Activity,
  Tor,
  CashAdvanceRecord,
  ApprovalHubItem,
} from '../types/index.js';
import { saveMasterBudgetList, getMasterBudgetList } from './masterBudgetStorage.js';
import { api } from './api.js';

export type BudgetPeriodStructureType = 'quarterly' | 'semester' | 'custom';

export interface ProgramBudgetPeriod {
  id: string;
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  allocatedAmount: number;
  isActiveForTor?: boolean;
}

export interface ProgramMasterBudgetCode {
  id: string;
  code: string;
  budgetCategory: string;
  allocatedAmount?: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  source: 'Manual' | 'Excel Import' | 'Database Activity';
}

export type FinancialRecordType =
  | 'CASH_ADVANCE'
  | 'FINAL_FINANCIAL_REPORT';

export type ReconciliationStatus =
  | 'Outstanding Advance'
  | 'Verified & Reconciled'
  | 'Pending Verification';

export interface ProgramFinancialTransaction {
  id: string;
  cashAdvanceId: string;
  programId: string;
  fiscalYear: number;
  periodId: string;
  budgetCode: string;
  budgetCategory: string;
  type: FinancialRecordType;
  referenceNumber: string;
  parentCashAdvanceRef?: string;
  externalEntityId: string; // Deterministic ID linked to actual CashAdvanceRecord.id
  sourceSystem: 'Database Record (Single Source of Truth)';
  sourceDocumentType: 'Cash Advance' | 'Final Financial Report';
  activityTitle: string;
  torId: string;
  torNumber: string;
  requesterName: string;
  transactionDate: string;
  cashAdvanceStatus: string;
  isDisbursed: boolean;
  isReported: boolean;
  reportApprovalStatus?: string;
  expensifyPdfLink?: string;
  advanceApprovedAmount: number; // Total amount on the CashAdvanceRecord
  disbursedAmount: number; // Actual disbursed amount (when status === 'Dicairkan')
  reportedRealizationAmount: number | null; // Reported realization on LPJ (if isReported === true)
  verifiedActualExpenditure: number; // Verified actual spend ONLY when Final Financial Report is 'Telah Disetujui'
  outstandingCommitment: number; // Active commitment / unreconciled advance balance
  returnedFunds: number; // Excess cash advance returned ONLY when Final Financial Report is 'Telah Disetujui'
  reconciliationStatus: ReconciliationStatus;
  reconciledAt?: string;
  reconciledBy?: string;
  syncedAt: string;
  notes?: string;
}

export type ProgramBudgetApprovalStatus =
  | 'Draft'
  | 'Menunggu Persetujuan Direktur'
  | 'Disetujui Direktur'
  | 'Perlu Revisi Direktur';

export interface ProgramBudgetRevisionRecord {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: string;
  actionType:
    | 'ANNUAL_BUDGET_UPDATE'
    | 'PERIOD_ALLOCATION_UPDATE'
    | 'MASTER_CODE_UPDATE'
    | 'CONNECTOR_SYNC'
    | 'RECONCILIATION'
    | 'BUDGET_SUBMITTED_TO_DIRECTOR'
    | 'BUDGET_APPROVED_BY_DIRECTOR'
    | 'BUDGET_REVISION_REQUESTED'
    | 'ACTIVE_TOR_PERIOD_CHANGED';
  previousAnnualBudget: number;
  newAnnualBudget: number;
  periodStructureType: BudgetPeriodStructureType;
  summary: string;
}

export interface ProgramIntegrationSyncLog {
  id: string;
  timestamp: string;
  actorName: string;
  sourceSystem: string;
  importedCashAdvances: number;
  reconciledFinancialReports: number;
  skippedDuplicates: number;
  status: 'Success' | 'Partial';
  summary: string;
}

export interface ProgramBudgetDataset {
  id: string; // `${programId}__${fiscalYear}`
  programId: string;
  programName: string;
  fiscalYear: number;
  currency: 'IDR';
  isBudgetConfigured?: boolean;
  budgetApprovalStatus?: ProgramBudgetApprovalStatus;
  budgetSubmittedBy?: string;
  budgetSubmittedAt?: string;
  budgetApprovedBy?: string;
  budgetApprovedAt?: string;
  budgetRevisionNotes?: string;
  budgetRevisionRequestedBy?: string;
  budgetRevisionRequestedAt?: string;
  totalProgramBudget?: number; // Total Program Budget across the program lifecycle
  annualApprovedBudget: number; // Automatically reflects the sum of all budget periods entered for that year
  periodStructureType: BudgetPeriodStructureType;
  quarterlyPeriods: ProgramBudgetPeriod[];
  semesterPeriods: ProgramBudgetPeriod[];
  customPeriods: ProgramBudgetPeriod[];
  masterBudgetCodes: ProgramMasterBudgetCode[];
  transactions: ProgramFinancialTransaction[];
  revisions: ProgramBudgetRevisionRecord[];
  syncLogs: ProgramIntegrationSyncLog[];
  updatedAt: string;
  updatedBy: string;
}

export interface ExcelImportPreviewRow {
  rowNumber: number;
  code: string;
  budgetCategory: string;
  status: 'valid' | 'duplicate_existing' | 'duplicate_in_file' | 'invalid';
  statusMessage: string;
}

const STORAGE_KEY = 'wijna_finance_program_budgets_v3';

export function buildDefaultQuarterlyPeriods(
  fiscalYear: number,
  annualBudget: number = 0
): ProgramBudgetPeriod[] {
  const q1 = annualBudget > 0 ? Math.floor(annualBudget * 0.25) : 0;
  const q2 = annualBudget > 0 ? Math.floor(annualBudget * 0.25) : 0;
  const q3 = annualBudget > 0 ? Math.floor(annualBudget * 0.25) : 0;
  const q4 = annualBudget > 0 ? annualBudget - (q1 + q2 + q3) : 0;
  return [
    {
      id: `q1-${fiscalYear}`,
      code: 'Q1',
      label: `Quarter 1 (Jan – Mar ${fiscalYear})`,
      startDate: `${fiscalYear}-01-01`,
      endDate: `${fiscalYear}-03-31`,
      allocatedAmount: q1,
    },
    {
      id: `q2-${fiscalYear}`,
      code: 'Q2',
      label: `Quarter 2 (Apr – Jun ${fiscalYear})`,
      startDate: `${fiscalYear}-04-01`,
      endDate: `${fiscalYear}-06-30`,
      allocatedAmount: q2,
    },
    {
      id: `q3-${fiscalYear}`,
      code: 'Q3',
      label: `Quarter 3 (Jul – Sep ${fiscalYear})`,
      startDate: `${fiscalYear}-07-01`,
      endDate: `${fiscalYear}-09-30`,
      allocatedAmount: q3,
    },
    {
      id: `q4-${fiscalYear}`,
      code: 'Q4',
      label: `Quarter 4 (Oct – Dec ${fiscalYear})`,
      startDate: `${fiscalYear}-10-01`,
      endDate: `${fiscalYear}-12-31`,
      allocatedAmount: q4,
    },
  ];
}

export function buildDefaultSemesterPeriods(
  fiscalYear: number,
  annualBudget: number = 0
): ProgramBudgetPeriod[] {
  const s1 = annualBudget > 0 ? Math.floor(annualBudget * 0.5) : 0;
  const s2 = annualBudget > 0 ? annualBudget - s1 : 0;
  return [
    {
      id: `s1-${fiscalYear}`,
      code: 'S1',
      label: `Semester 1 (Jan – Jun ${fiscalYear})`,
      startDate: `${fiscalYear}-01-01`,
      endDate: `${fiscalYear}-06-30`,
      allocatedAmount: s1,
    },
    {
      id: `s2-${fiscalYear}`,
      code: 'S2',
      label: `Semester 2 (Jul – Dec ${fiscalYear})`,
      startDate: `${fiscalYear}-07-01`,
      endDate: `${fiscalYear}-12-31`,
      allocatedAmount: s2,
    },
  ];
}

export function buildDefaultCustomPeriods(
  fiscalYear: number,
  annualBudget: number = 0
): ProgramBudgetPeriod[] {
  const p1 = annualBudget > 0 ? Math.floor(annualBudget * 0.5) : 0;
  const p2 = annualBudget > 0 ? annualBudget - p1 : 0;
  return [
    {
      id: `cust-1-${fiscalYear}`,
      code: 'P1',
      label: `Custom Period 1 (Jan – Jun ${fiscalYear})`,
      startDate: `${fiscalYear}-01-01`,
      endDate: `${fiscalYear}-06-30`,
      allocatedAmount: p1,
      isActiveForTor: true,
    },
    {
      id: `cust-2-${fiscalYear}`,
      code: 'P2',
      label: `Custom Period 2 (Jul – Dec ${fiscalYear})`,
      startDate: `${fiscalYear}-07-01`,
      endDate: `${fiscalYear}-12-31`,
      allocatedAmount: p2,
      isActiveForTor: false,
    },
  ];
}

export function getActivePeriods(dataset: ProgramBudgetDataset): ProgramBudgetPeriod[] {
  const fy = dataset.fiscalYear || new Date().getFullYear();
  if (Array.isArray(dataset.customPeriods) && dataset.customPeriods.length > 0) {
    const customSum = dataset.customPeriods.reduce(
      (s, p) => s + (Number(p.allocatedAmount) || 0),
      0
    );
    if (customSum > 0 || dataset.periodStructureType === 'custom') {
      return dataset.customPeriods;
    }
    if (
      dataset.periodStructureType === 'quarterly' &&
      Array.isArray(dataset.quarterlyPeriods) &&
      dataset.quarterlyPeriods.some((p) => (Number(p.allocatedAmount) || 0) > 0)
    ) {
      return dataset.quarterlyPeriods;
    }
    if (
      dataset.periodStructureType === 'semester' &&
      Array.isArray(dataset.semesterPeriods) &&
      dataset.semesterPeriods.some((p) => (Number(p.allocatedAmount) || 0) > 0)
    ) {
      return dataset.semesterPeriods;
    }
    return dataset.customPeriods;
  }
  return buildDefaultCustomPeriods(fy, 0);
}

export function matchPeriodForDate(
  periods: ProgramBudgetPeriod[],
  dateStr: string
): ProgramBudgetPeriod {
  if (!periods.length) {
    return {
      id: 'unmatched-period',
      code: '-',
      label: 'Unmatched Period',
      startDate: '',
      endDate: '',
      allocatedAmount: 0,
    };
  }
  const cleanDate = (dateStr || '').slice(0, 10);
  const matched = periods.find(
    (p) => cleanDate >= p.startDate && cleanDate <= p.endDate
  );
  return matched || periods[periods.length - 1];
}

/**
 * Extracts Master Budget Codes that actually exist in database records
 * (Activities, ToRs, Cash Advances) for a specific Program.
 * Does NOT invent fictional budget codes.
 */
export function deriveDatabaseMasterCodesForProgram(params: {
  programId: string;
  programName: string;
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  tors?: Tor[];
  cashAdvances?: CashAdvanceRecord[];
}): ProgramMasterBudgetCode[] {
  const {
    programId,
    programName,
    outcomes = [],
    outputs = [],
    activities = [],
    tors = [],
    cashAdvances = [],
  } = params;

  const codeMap = new Map<string, ProgramMasterBudgetCode>();

  // 1. From actual Program -> Outcome -> Output -> Activity hierarchy
  const progOutcomeIds = new Set(
    outcomes.filter((oc) => oc.programId === programId).map((oc) => oc.id)
  );
  const progOutputIds = new Set(
    outputs.filter((op) => progOutcomeIds.has(op.outcomeId)).map((op) => op.id)
  );
  const progActivities = activities.filter((act) => progOutputIds.has(act.outputId));

  for (const act of progActivities) {
    const code = (act.code || '').trim();
    if (code && !codeMap.has(code)) {
      codeMap.set(code, {
        id: `mbc-act-${act.id}`,
        code,
        budgetCategory: act.name,
        allocatedAmount: 0,
        createdAt: act.createdAt || new Date().toISOString(),
        updatedAt: act.createdAt || new Date().toISOString(),
        createdBy: act.picName || 'Database Activity',
        source: 'Database Activity',
      });
    }
  }

  // 2. From actual ToR records belonging strictly to this program
  const cleanProgName = (programName || '').trim().toLowerCase();
  const progTors = tors.filter((t) => {
    if (programId && t.programId) {
      return t.programId === programId;
    }
    if (programId && t.programId === programId) {
      return true;
    }
    if (!t.programId && cleanProgName && t.programName) {
      return t.programName.trim().toLowerCase() === cleanProgName;
    }
    return false;
  });
  for (const tor of progTors) {
    const code = (tor.activityCode || tor.hierarchyCode || '').trim();
    if (code && !codeMap.has(code)) {
      codeMap.set(code, {
        id: `mbc-tor-${tor.id}`,
        code,
        budgetCategory: tor.activityName || tor.title,
        allocatedAmount: 0,
        createdAt: tor.createdAt || new Date().toISOString(),
        updatedAt: tor.updatedAt || new Date().toISOString(),
        createdBy: tor.createdByName || 'Database ToR',
        source: 'Database Activity',
      });
    }
  }

  // 3. From actual Cash Advance items belonging strictly to this program's ToRs
  const progTorIds = new Set(progTors.map((t) => t.id));
  const progCas = cashAdvances.filter((ca) => {
    if (ca.torId) {
      return progTorIds.has(ca.torId);
    }
    if (cleanProgName && ca.programName) {
      return ca.programName.trim().toLowerCase() === cleanProgName;
    }
    return false;
  });
  for (const ca of progCas) {
    for (const item of ca.items || []) {
      const code = (item.budgetCode || '').trim();
      if (code && !codeMap.has(code)) {
        codeMap.set(code, {
          id: `mbc-ca-${ca.id}-${item.id}`,
          code,
          budgetCategory: ca.activityTitle || item.description,
          allocatedAmount: 0,
          createdAt: ca.createdAt || new Date().toISOString(),
          updatedAt: ca.updatedAt || new Date().toISOString(),
          createdBy: ca.requesterName || 'Database Cash Advance',
          source: 'Database Activity',
        });
      }
    }
  }

  return Array.from(codeMap.values()).sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );
}

/**
 * Creates an initial dataset for (programId, fiscalYear) with NO fabricated budget numbers.
 * Annual Approved Budget starts at 0 (unconfigured state) until set in Master Budget.
 */
export function createInitialDatasetForProgram(
  programId: string,
  programName: string,
  fiscalYear: number,
  initialCodes: ProgramMasterBudgetCode[] = []
): ProgramBudgetDataset {
  const quarterlyPeriods = buildDefaultQuarterlyPeriods(fiscalYear, 0);
  const semesterPeriods = buildDefaultSemesterPeriods(fiscalYear, 0);
  const customPeriods = buildDefaultCustomPeriods(fiscalYear, 0);

  return {
    id: `${programId}__${fiscalYear}`,
    programId,
    programName,
    fiscalYear,
    currency: 'IDR',
    isBudgetConfigured: false,
    totalProgramBudget: 0,
    annualApprovedBudget: 0,
    periodStructureType: 'custom',
    quarterlyPeriods,
    semesterPeriods,
    customPeriods,
    masterBudgetCodes: initialCodes,
    transactions: [],
    revisions: [],
    syncLogs: [],
    updatedAt: new Date().toISOString(),
    updatedBy: 'System',
  };
}

export function loadAllProgramBudgetDatasets(): Record<string, ProgramBudgetDataset> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveAllProgramBudgetDatasets(
  datasets: Record<string, ProgramBudgetDataset>
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('program-budget-updated'));
      window.dispatchEvent(new CustomEvent('program-budget-dataset-updated'));
    }, 0);
  } catch (e) {
    console.error('Failed to save program budget datasets:', e);
  }
}

/**
 * Hydrates localStorage with the authoritative ProgramBudgetDatasets from the backend server.
 */
export function hydrateProgramBudgetDatasetsFromServer(
  remoteDatasets: Record<string, ProgramBudgetDataset> | null | undefined
): Record<string, ProgramBudgetDataset> {
  if (!remoteDatasets || typeof remoteDatasets !== 'object') {
    return loadAllProgramBudgetDatasets();
  }
  const authoritative: Record<string, ProgramBudgetDataset> = {};
  for (const [k, ds] of Object.entries(remoteDatasets)) {
    if (ds && typeof ds === 'object' && ds.programId) {
      authoritative[k] = ds;
    }
  }
  saveAllProgramBudgetDatasets(authoritative);
  return authoritative;
}

/**
 * Returns the agreed Custom Periods configured for a specific Program (used as the foundation for creating a TOR).
 */
export function getProgramAgreedCustomPeriods(params: {
  programId?: string;
  programName?: string;
  fiscalYear?: number;
  programStartDate?: string;
}): ProgramBudgetPeriod[] {
  const {
    programId = '',
    programName = '',
    fiscalYear,
    programStartDate = '',
  } = params;

  const cleanId = programId.trim();
  const cleanName = programName.trim().toLowerCase();
  const resolvedYear =
    fiscalYear ||
    (programStartDate && Number(programStartDate.slice(0, 4)) >= 2020
      ? Number(programStartDate.slice(0, 4))
      : new Date().getFullYear());

  if (!cleanId && !cleanName) {
    return buildDefaultCustomPeriods(resolvedYear, 0);
  }

  const all = loadAllProgramBudgetDatasets();
  const matchingDatasets = Object.values(all).filter((ds) => {
    if (!ds) return false;
    if (cleanId && ds.programId === cleanId) return true;
    if (!cleanId && cleanName && ds.programName?.trim().toLowerCase() === cleanName) {
      return true;
    }
    return false;
  });

  const exactYearDs = matchingDatasets.find((ds) => ds.fiscalYear === resolvedYear);
  const targetDs =
    exactYearDs ||
    matchingDatasets.find((ds) => {
      const periods = getActivePeriods(ds);
      return periods.length > 0;
    });

  if (targetDs) {
    const periods = getActivePeriods(targetDs);
    if (periods.length > 0) {
      return periods;
    }
  }

  if (cleanId) {
    const created = getOrCreateProgramBudgetDataset(
      cleanId,
      programName || 'Program WIJNA',
      resolvedYear
    );
    return getActivePeriods(created);
  }

  return buildDefaultCustomPeriods(resolvedYear, 0);
}

/**
 * Sets which Custom Period is automatically selected by Finance as the active Time Period for TOR creation.
 */
export function setFinanceActiveCustomPeriod(params: {
  programId: string;
  programName?: string;
  programStartDate?: string;
  periodId: string;
}): ProgramBudgetPeriod[] {
  const { programId, programName = 'Program WIJNA', programStartDate = '', periodId } = params;
  const resolvedYear =
    programStartDate && Number(programStartDate.slice(0, 4)) >= 2020
      ? Number(programStartDate.slice(0, 4))
      : new Date().getFullYear();

  const ds = getOrCreateProgramBudgetDataset(programId, programName, resolvedYear);
  const periods = getActivePeriods(ds);
  const updatedPeriods = periods.map((p) => ({
    ...p,
    isActiveForTor: p.id === periodId,
  }));

  const updatedDs: ProgramBudgetDataset = {
    ...ds,
    periodStructureType: 'custom',
    customPeriods: updatedPeriods,
    updatedAt: new Date().toISOString(),
  };

  const all = loadAllProgramBudgetDatasets();
  all[updatedDs.id] = updatedDs;
  saveAllProgramBudgetDatasets(all);
  api.saveFinanceProgramBudget(updatedDs.id, updatedDs).catch(() => {});
  return updatedPeriods;
}

/**
 * Returns the exclusive list of Master Budget Codes registered for a specific Program.
 * Never returns codes from other Programs or hardcoded global defaults.
 */
export function getRegisteredProgramBudgetCodes(params: {
  programId?: string;
  programName?: string;
  fiscalYear?: number;
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  tors?: Tor[];
}): ProgramMasterBudgetCode[] {
  const {
    programId = '',
    programName = '',
    fiscalYear,
    outcomes = [],
    outputs = [],
    activities = [],
    tors = [],
  } = params;

  const cleanId = programId.trim();
  const cleanName = programName.trim().toLowerCase();
  if (!cleanId && !cleanName) return [];

  const all = loadAllProgramBudgetDatasets();
  const matchingDatasets = Object.values(all).filter((ds) => {
    if (!ds) return false;
    if (cleanId && ds.programId === cleanId) return true;
    if (!cleanId && cleanName && ds.programName?.trim().toLowerCase() === cleanName) {
      return true;
    }
    return false;
  });

  // Prefer the exact fiscalYear dataset if it has codes, otherwise any dataset of this exact Program
  const targetDs =
    (fiscalYear
      ? matchingDatasets.find(
          (ds) => ds.fiscalYear === fiscalYear && (ds.masterBudgetCodes?.length || 0) > 0
        )
      : undefined) ||
    matchingDatasets.find((ds) => (ds.masterBudgetCodes?.length || 0) > 0);

  if (targetDs && Array.isArray(targetDs.masterBudgetCodes) && targetDs.masterBudgetCodes.length > 0) {
    return [...targetDs.masterBudgetCodes].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );
  }

  // If no saved dataset has codes yet, derive strictly from this Program's hierarchy & ToRs
  if (cleanId || cleanName) {
    return deriveDatabaseMasterCodesForProgram({
      programId: cleanId,
      programName: programName.trim(),
      outcomes,
      outputs,
      activities,
      tors,
      cashAdvances: [],
    });
  }

  return [];
}

export function getOrCreateProgramBudgetDataset(
  programId: string,
  programName: string,
  fiscalYear: number,
  contextData?: {
    outcomes?: Outcome[];
    outputs?: Output[];
    activities?: Activity[];
    tors?: Tor[];
    cashAdvances?: CashAdvanceRecord[];
  }
): ProgramBudgetDataset {
  const all = loadAllProgramBudgetDatasets();
  const key = `${programId}__${fiscalYear}`;
  const dbCodes = deriveDatabaseMasterCodesForProgram({
    programId,
    programName,
    outcomes: contextData?.outcomes,
    outputs: contextData?.outputs,
    activities: contextData?.activities,
    tors: contextData?.tors,
    cashAdvances: contextData?.cashAdvances,
  });

  // Check if any fiscal year dataset for this exact program already has totalProgramBudget or masterBudgetCodes
  const siblingDatasets = Object.values(all).filter(
    (ds) => ds && ds.programId === programId
  );
  const sharedTotalProgramBudget =
    siblingDatasets.find((ds) => (Number(ds.totalProgramBudget) || 0) > 0)
      ?.totalProgramBudget || 0;

  if (all[key]) {
    const existing = all[key];
    let authoritativeCodes = [...(existing.masterBudgetCodes || [])];

    // Only seed from sibling datasets of the SAME Program or DB hierarchy if this Program has no codes registered yet
    if (authoritativeCodes.length === 0) {
      const seen = new Set<string>();
      for (const sib of siblingDatasets) {
        for (const sc of sib.masterBudgetCodes || []) {
          const norm = sc.code.trim().toLowerCase();
          if (norm && !seen.has(norm)) {
            authoritativeCodes.push(sc);
            seen.add(norm);
          }
        }
      }
      if (authoritativeCodes.length === 0) {
        for (const dbc of dbCodes) {
          const norm = dbc.code.trim().toLowerCase();
          if (norm && !seen.has(norm)) {
            authoritativeCodes.push(dbc);
            seen.add(norm);
          }
        }
      }
    }

    authoritativeCodes.sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );
    const activePeriods = getActivePeriods(existing);
    const periodSum = activePeriods.reduce(
      (s, p) => s + (Number(p.allocatedAmount) || 0),
      0
    );
    const computedAnnual = periodSum > 0 ? periodSum : Number(existing.annualApprovedBudget) || 0;
    const totalProg = computedAnnual;

    return {
      ...existing,
      programName: programName || existing.programName,
      periodStructureType: 'custom',
      customPeriods: activePeriods,
      totalProgramBudget: totalProg,
      annualApprovedBudget: computedAnnual,
      isBudgetConfigured: Boolean(
        existing.isBudgetConfigured || computedAnnual > 0
      ),
      masterBudgetCodes: authoritativeCodes,
    };
  }

  // Inherit program-specific Master Budget Codes from any other year of the exact same program first, or seed from DB
  const siblingWithCodes = siblingDatasets.find(
    (sib) => Array.isArray(sib.masterBudgetCodes) && sib.masterBudgetCodes.length > 0
  );
  const inheritedCodes = siblingWithCodes
    ? [...siblingWithCodes.masterBudgetCodes]
    : [...dbCodes];

  inheritedCodes.sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );

  const created = createInitialDatasetForProgram(
    programId,
    programName,
    fiscalYear,
    inheritedCodes
  );
  created.totalProgramBudget = created.annualApprovedBudget;
  all[key] = created;
  saveAllProgramBudgetDatasets(all);
  return created;
}

export function saveProgramBudgetDataset(
  dataset: ProgramBudgetDataset,
  persistToServer: boolean = true
): void {
  const all = loadAllProgramBudgetDatasets();
  const activePeriods = getActivePeriods(dataset);
  const periodSum = activePeriods.reduce(
    (s, p) => s + (Number(p.allocatedAmount) || 0),
    0
  );
  // The total budget for one year automatically reflects the sum of all budget periods entered for that year
  const effectiveAnnualBudget =
    periodSum > 0 ? periodSum : Number(dataset.annualApprovedBudget) || 0;
  const effectiveTotalProgramBudget = effectiveAnnualBudget;

  const normalized: ProgramBudgetDataset = {
    ...dataset,
    periodStructureType: 'custom',
    customPeriods: activePeriods,
    totalProgramBudget: effectiveTotalProgramBudget,
    annualApprovedBudget: effectiveAnnualBudget,
    isBudgetConfigured: Boolean(
      dataset.isBudgetConfigured ||
        effectiveAnnualBudget > 0
    ),
    updatedAt: new Date().toISOString(),
  };
  all[dataset.id] = normalized;

  // Keep totalProgramBudget and program-specific Master Budget Codes consistent across all years of the SAME Program only
  for (const [k, otherDs] of Object.entries(all)) {
    if (k !== dataset.id && otherDs && otherDs.programId === dataset.programId) {
      all[k] = {
        ...otherDs,
        totalProgramBudget: effectiveTotalProgramBudget,
        masterBudgetCodes: normalized.masterBudgetCodes,
      };
    }
  }

  saveAllProgramBudgetDatasets(all);

  if (persistToServer) {
    api.saveFinanceProgramBudget(dataset.id, normalized).catch((err) => {
      console.warn('Could not persist program budget to server:', err);
    });
  }
}

/**
 * Synchronizes Cash Advance records and verified Final Financial Reports from actual database records
 * into the selected Program's Finance Workspace dataset with 100% traceability and ZERO fabricated figures.
 */
export function syncProgramFinancialDataFromMealConnect(params: {
  dataset: ProgramBudgetDataset;
  programs: Program[];
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  tors?: Tor[];
  cashAdvances: CashAdvanceRecord[];
  approvalHubItems?: ApprovalHubItem[];
  actorName: string;
  recordSyncLog?: boolean;
}): {
  updatedDataset: ProgramBudgetDataset;
  importedCashAdvances: number;
  reconciledReports: number;
  skippedDuplicates: number;
} {
  const {
    dataset,
    outcomes = [],
    outputs = [],
    activities = [],
    tors = [],
    cashAdvances,
    approvalHubItems = [],
    actorName,
    recordSyncLog = false,
  } = params;

  // Preserve the Program's authoritative Master Budget Codes; only derive from DB if none exist yet for this Program
  let mergedMasterCodes = [...(dataset.masterBudgetCodes || [])];
  if (mergedMasterCodes.length === 0) {
    mergedMasterCodes = deriveDatabaseMasterCodesForProgram({
      programId: dataset.programId,
      programName: dataset.programName,
      outcomes,
      outputs,
      activities,
      tors,
      cashAdvances,
    });
  }
  mergedMasterCodes.sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );

  const activePeriods = getActivePeriods(dataset);

  // Identify ToRs belonging to this Program
  const programTorIds = new Set(
    tors
      .filter(
        (t) =>
          t.programId === dataset.programId ||
          (t.programName &&
            dataset.programName &&
            t.programName.toLowerCase() === dataset.programName.toLowerCase())
      )
      .map((t) => t.id)
  );

  // Filter Cash Advances that traceably belong to this Program & Fiscal Year
  const programCashAdvances = cashAdvances.filter((ca) => {
    if (ca.status === 'Ditolak' || ca.status === 'Draft') return false;
    const dateRef = ca.requestDate || ca.activityStartDate || ca.createdAt || '';
    const reqYear = Number(dateRef.slice(0, 4));
    if (reqYear && reqYear !== dataset.fiscalYear) return false;

    const belongsByTor = Boolean(ca.torId && programTorIds.has(ca.torId));
    const belongsByProgramName = Boolean(
      ca.programName &&
        dataset.programName &&
        ca.programName.trim().toLowerCase() === dataset.programName.trim().toLowerCase()
    );
    return belongsByTor || belongsByProgramName;
  });

  const codeMap = new Map<string, string>();
  for (const mc of mergedMasterCodes) {
    codeMap.set(mc.code, mc.budgetCategory);
  }

  let importedCashAdvances = 0;
  let reconciledReports = 0;
  let skippedDuplicates = 0;

  const previousTxByExtId = new Map(
    (dataset.transactions || []).map((t) => [t.externalEntityId, t])
  );

  // Rebuild transactions strictly from actual database CashAdvanceRecords (Zero fabricated/orphaned records)
  const rebuiltTransactions: ProgramFinancialTransaction[] = [];

  for (const ca of programCashAdvances) {
    const externalKey = `meal-ca-${ca.id}`;
    const prevTx = previousTxByExtId.get(externalKey);

    const linkedTor = tors.find((t) => t.id === ca.torId);
    const rawItemCode =
      ca.items?.[0]?.budgetCode ||
      linkedTor?.activityCode ||
      linkedTor?.hierarchyCode ||
      '';
    const budgetCategory =
      codeMap.get(rawItemCode) ||
      linkedTor?.activityName ||
      ca.activityTitle ||
      'Uncategorized';

    const period = matchPeriodForDate(
      activePeriods,
      ca.activityStartDate || ca.requestDate || ca.createdAt
    );

    const finReportHubItem = approvalHubItems.find(
      (it) =>
        it.categoryCode === 'laporan_keuangan_akhir' &&
        (it.sourceCashAdvanceId === ca.id || it.sourceEntityId === ca.id)
    );

    // STRICT TRACEABILITY: A Final Financial Report is verified ONLY if actually reported and approved in DB
    const isReportedInDb = Boolean(ca.isReported);
    const isFinalReportVerified = Boolean(
      isReportedInDb &&
        (ca.reportApprovalStatus === 'Telah Disetujui' ||
          finReportHubItem?.status === 'Approved')
    );

    const isDisbursed =
      ca.status === 'Dicairkan' || Boolean(ca.signatures?.disbursedBy?.isDisbursed);
    const advanceApprovedAmt = Number(ca.totalAmount) || 0;
    const disbursedAmt = isDisbursed ? advanceApprovedAmt : 0;

    const reportedRealizationAmt =
      isReportedInDb && typeof ca.realizedAmount === 'number'
        ? ca.realizedAmount
        : null;

    const verifiedExpenditure =
      isFinalReportVerified && reportedRealizationAmt !== null
        ? reportedRealizationAmt
        : 0;

    const returnedFunds =
      isFinalReportVerified && reportedRealizationAmt !== null
        ? Math.max(0, advanceApprovedAmt - reportedRealizationAmt)
        : 0;

    const outstandingCommitment = isFinalReportVerified ? 0 : advanceApprovedAmt;

    const finRefNumber = ca.advanceNumber.replace(/^CA\//i, 'LPJ-FIN/');

    const reconciliationStatus: ReconciliationStatus = isFinalReportVerified
      ? 'Verified & Reconciled'
      : isDisbursed
      ? 'Outstanding Advance'
      : 'Pending Verification';

    if (!prevTx) {
      importedCashAdvances += 1;
      if (isFinalReportVerified) reconciledReports += 1;
    } else if (
      isFinalReportVerified &&
      prevTx.reconciliationStatus !== 'Verified & Reconciled'
    ) {
      reconciledReports += 1;
    } else {
      skippedDuplicates += 1;
    }

    rebuiltTransactions.push({
      id: prevTx?.id || `tx-${ca.id}`,
      cashAdvanceId: ca.id,
      programId: dataset.programId,
      fiscalYear: dataset.fiscalYear,
      periodId: period.id,
      budgetCode: rawItemCode,
      budgetCategory,
      type: isFinalReportVerified ? 'FINAL_FINANCIAL_REPORT' : 'CASH_ADVANCE',
      referenceNumber: isFinalReportVerified ? finRefNumber : ca.advanceNumber,
      parentCashAdvanceRef: ca.advanceNumber,
      externalEntityId: externalKey,
      sourceSystem: 'Database Record (Single Source of Truth)',
      sourceDocumentType: isFinalReportVerified
        ? 'Final Financial Report'
        : 'Cash Advance',
      activityTitle: ca.activityTitle,
      torId: ca.torId,
      torNumber: ca.torNumber,
      requesterName: ca.requesterName,
      transactionDate: (ca.requestDate || ca.createdAt || '').slice(0, 10),
      cashAdvanceStatus: ca.status,
      isDisbursed,
      isReported: isReportedInDb,
      reportApprovalStatus: ca.reportApprovalStatus,
      expensifyPdfLink: ca.expensifyPdfLink,
      advanceApprovedAmount: advanceApprovedAmt,
      disbursedAmount: disbursedAmt,
      reportedRealizationAmount: reportedRealizationAmt,
      verifiedActualExpenditure: verifiedExpenditure,
      outstandingCommitment,
      returnedFunds,
      reconciliationStatus,
      reconciledAt: isFinalReportVerified
        ? ca.reportApprovedAt || ca.updatedAt
        : undefined,
      reconciledBy: isFinalReportVerified
        ? ca.reportApprovedByName || ca.reportVerifiedByName
        : undefined,
      syncedAt: new Date().toISOString(),
      notes: isFinalReportVerified
        ? `Verified Final Financial Report (${finRefNumber}). Cash Advance: Rp ${advanceApprovedAmt.toLocaleString(
            'id-ID'
          )}, Verified Expenditure: Rp ${verifiedExpenditure.toLocaleString(
            'id-ID'
          )}, Returned Funds: Rp ${returnedFunds.toLocaleString('id-ID')}.`
        : isReportedInDb
        ? `Final Financial Report submitted (${
            ca.reportApprovalStatus || 'Menunggu Pemeriksaan Finance'
          }) — Reported expenditure: Rp ${(
            reportedRealizationAmt || 0
          ).toLocaleString('id-ID')}.`
        : `Cash Advance status: ${ca.status}. Linked to ToR ${ca.torNumber}.`,
    });
  }

  const nextSyncLogs = [...(dataset.syncLogs || [])];
  if (recordSyncLog) {
    nextSyncLogs.unshift({
      id: `sync-${Date.now()}`,
      timestamp: new Date().toISOString(),
      actorName,
      sourceSystem: 'Database Single Source of Truth',
      importedCashAdvances,
      reconciledFinancialReports: reconciledReports,
      skippedDuplicates,
      status: 'Success',
      summary: `Synchronized ${rebuiltTransactions.length} active financial record(s) from database (${importedCashAdvances} newly linked, ${reconciledReports} verified Final Financial Report(s)).`,
    });
  }

  const updatedDataset: ProgramBudgetDataset = {
    ...dataset,
    masterBudgetCodes: mergedMasterCodes,
    transactions: rebuiltTransactions,
    syncLogs: nextSyncLogs.slice(0, 20),
    updatedAt: new Date().toISOString(),
    updatedBy: actorName,
  };

  saveProgramBudgetDataset(updatedDataset, false);
  return {
    updatedDataset,
    importedCashAdvances,
    reconciledReports,
    skippedDuplicates,
  };
}

export interface ProgramBudgetSummaryMetrics {
  isBudgetConfigured: boolean;
  totalProgramBudget: number;
  annualApprovedBudget: number;
  totalPeriodAllocated: number;
  isPeriodAllocationBalanced: boolean;
  periodAllocationVariance: number;
  totalDisbursedAdvances: number;
  outstandingDisbursedAdvances: number;
  pendingApprovalCommitments: number;
  verifiedActualExpenditure: number;
  outstandingCommitments: number;
  totalReturnedFunds: number;
  availableBudget: number | null; // null when Annual Approved Budget is not yet configured (0)
  utilizationRatePercent: number | null;
  commitmentRatePercent: number | null;
}

export function calculateProgramBudgetMetrics(
  dataset: ProgramBudgetDataset
): ProgramBudgetSummaryMetrics {
  const activePeriods = getActivePeriods(dataset);
  const totalPeriodAllocated = activePeriods.reduce(
    (sum, p) => sum + (Number(p.allocatedAmount) || 0),
    0
  );
  // The total budget for one year automatically reflects the sum of all budget periods entered for that year
  const annualApprovedBudget =
    totalPeriodAllocated > 0
      ? totalPeriodAllocated
      : Number(dataset.annualApprovedBudget) || 0;
  const totalProgramBudget = annualApprovedBudget;
  const isBudgetConfigured = Boolean(
    dataset.isBudgetConfigured && annualApprovedBudget > 0
  );
  const periodAllocationVariance = annualApprovedBudget - totalPeriodAllocated;
  const isPeriodAllocationBalanced =
    isBudgetConfigured && Math.abs(periodAllocationVariance) === 0;

  const totalDisbursedAdvances = dataset.transactions.reduce(
    (sum, tx) => sum + (Number(tx.disbursedAmount) || 0),
    0
  );
  const outstandingDisbursedAdvances = dataset.transactions
    .filter((tx) => tx.reconciliationStatus === 'Outstanding Advance')
    .reduce((sum, tx) => sum + (Number(tx.outstandingCommitment) || 0), 0);

  const pendingApprovalCommitments = dataset.transactions
    .filter((tx) => tx.reconciliationStatus === 'Pending Verification')
    .reduce((sum, tx) => sum + (Number(tx.outstandingCommitment) || 0), 0);

  const verifiedActualExpenditure = dataset.transactions.reduce(
    (sum, tx) => sum + (Number(tx.verifiedActualExpenditure) || 0),
    0
  );
  const outstandingCommitments = dataset.transactions.reduce(
    (sum, tx) => sum + (Number(tx.outstandingCommitment) || 0),
    0
  );
  const totalReturnedFunds = dataset.transactions.reduce(
    (sum, tx) => sum + (Number(tx.returnedFunds) || 0),
    0
  );

  // Formula required by specification (only computed when Annual Approved Budget is configured):
  // Available Budget = Annual Approved Budget - Verified Actual Expenditure - Outstanding Commitments
  const availableBudget =
    annualApprovedBudget > 0
      ? annualApprovedBudget - verifiedActualExpenditure - outstandingCommitments
      : null;

  const utilizationRatePercent =
    annualApprovedBudget > 0
      ? Math.min(
          100,
          Math.round((verifiedActualExpenditure / annualApprovedBudget) * 1000) /
            10
        )
      : null;

  const commitmentRatePercent =
    annualApprovedBudget > 0
      ? Math.min(
          100,
          Math.round(
            ((verifiedActualExpenditure + outstandingCommitments) /
              annualApprovedBudget) *
              1000
          ) / 10
        )
      : null;

  return {
    isBudgetConfigured,
    totalProgramBudget,
    annualApprovedBudget,
    totalPeriodAllocated,
    isPeriodAllocationBalanced,
    periodAllocationVariance,
    totalDisbursedAdvances,
    outstandingDisbursedAdvances,
    pendingApprovalCommitments,
    verifiedActualExpenditure,
    outstandingCommitments,
    totalReturnedFunds,
    availableBudget,
    utilizationRatePercent,
    commitmentRatePercent,
  };
}

/**
 * Generates and downloads an official Excel (.xlsx) template for Master Budget Codes
 * containing the exact two required columns: Code | Budget Category.
 * Uses existing program codes if available, or empty rows ready for user input.
 */
export function downloadMasterBudgetExcelTemplate(
  programName: string,
  existingCodes: ProgramMasterBudgetCode[] = []
): void {
  const rows =
    existingCodes.length > 0
      ? existingCodes.map((c) => ({
          Code: c.code,
          'Budget Category': c.budgetCategory,
        }))
      : [{ Code: '', 'Budget Category': '' }];

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['Code', 'Budget Category'],
  });
  worksheet['!cols'] = [{ wch: 16 }, { wch: 42 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Master Budget Codes');

  const cleanSlug = (programName || 'Program')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .slice(0, 30);
  XLSX.writeFile(workbook, `Template_Master_Budget_Code_${cleanSlug}.xlsx`);
}

/**
 * Parses an uploaded Excel/CSV file and validates rows against existing Master Budget Codes.
 */
export async function parseMasterBudgetExcelFile(
  file: File,
  existingCodes: ProgramMasterBudgetCode[]
): Promise<ExcelImportPreviewRow[]> {
  const MAX_EXCEL_FILE_BYTES = 5 * 1024 * 1024; // 5 MB max
  if (file.size > MAX_EXCEL_FILE_BYTES) {
    throw new Error('Ukuran file Excel melebihi batas keamanan maksimum (5 MB).');
  }
  const lowerFileName = (file.name || '').toLowerCase();
  if (!/\.(xlsx|xls|csv)$/.test(lowerFileName)) {
    throw new Error('Format file tidak diizinkan. Gunakan hanya file resmi .xlsx, .xls, atau .csv.');
  }

  const sanitizeSpreadsheetCell = (val: unknown): string => {
    const str = String(val ?? '').trim();
    // Prevent CSV/Excel Formula Injection (DDE / macro prefix characters =, +, -, @, tab, CR)
    return str.replace(/^[=+\-@\t\r]+/, '').trim();
  };

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: '',
  });

  const existingCodeSet = new Set(
    existingCodes.map((c) => c.code.trim().toLowerCase())
  );
  const seenInFile = new Set<string>();

  return rawRows.slice(0, 1000).map((row, idx) => {
    const keys = Object.keys(row);
    const codeKey =
      keys.find((k) =>
        /^(code|kode|budget\s*code|kode\s*budget)$/i.test(k.trim())
      ) || keys[0];
    const catKey =
      keys.find((k) =>
        /^(budget\s*category|category|kategori|kategori\s*budget|nama|uraian)$/i.test(
          k.trim()
        )
      ) || keys[1];

    const code = sanitizeSpreadsheetCell(codeKey ? row[codeKey] ?? '' : '');
    const budgetCategory = sanitizeSpreadsheetCell(catKey ? row[catKey] ?? '' : '');
    const normalizedCode = code.toLowerCase();

    if (!code || !budgetCategory) {
      return {
        rowNumber: idx + 2,
        code: code || '-',
        budgetCategory: budgetCategory || '-',
        status: 'invalid',
        statusMessage: 'Missing Code or Budget Category value',
      };
    }

    if (existingCodeSet.has(normalizedCode)) {
      return {
        rowNumber: idx + 2,
        code,
        budgetCategory,
        status: 'duplicate_existing',
        statusMessage: `Duplicate: Code "${code}" already exists in this program`,
      };
    }

    if (seenInFile.has(normalizedCode)) {
      return {
        rowNumber: idx + 2,
        code,
        budgetCategory,
        status: 'duplicate_in_file',
        statusMessage: `Duplicate: Code "${code}" appears multiple times in uploaded file`,
      };
    }

    seenInFile.add(normalizedCode);
    return {
      rowNumber: idx + 2,
      code,
      budgetCategory,
      status: 'valid',
      statusMessage: 'Ready to import',
    };
  });
}

export interface FinanceReportingPeriod {
  id: string;
  code: string;
  periodNumber: number;
  periodTitle: string; // e.g. "Period 1", "Period 2", "Period 3"
  label: string;
  startDate: string;
  endDate: string;
  programName: string;
  isActiveForTor?: boolean;
}

/**
 * Returns the reporting periods (Period 1, Period 2, Period 3, etc.) defined by Finance
 * in the Program Budget workspace, so that Rekap Kerja (Timesheet & Attendance)
 * automatically follows the Finance reporting periods.
 */
export function getFinanceReportingPeriods(fiscalYear: number = 2026): FinanceReportingPeriod[] {
  const all = loadAllProgramBudgetDatasets();
  const datasets = Object.values(all).filter(Boolean);

  // Prioritize datasets that have been configured by Finance or have customPeriods
  const sortedDatasets = [...datasets].sort((a, b) => {
    const aConfigured = a.isBudgetConfigured || (a.annualApprovedBudget || 0) > 0 ? 1 : 0;
    const bConfigured = b.isBudgetConfigured || (b.annualApprovedBudget || 0) > 0 ? 1 : 0;
    if (aConfigured !== bConfigured) return bConfigured - aConfigured;
    const aLen = (a.customPeriods || []).length;
    const bLen = (b.customPeriods || []).length;
    if (aLen !== bLen) return bLen - aLen;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });

  const primaryDs =
    sortedDatasets.find((ds) => ds.fiscalYear === fiscalYear) || sortedDatasets[0];

  const rawPeriods = primaryDs
    ? getActivePeriods(primaryDs)
    : buildDefaultCustomPeriods(fiscalYear, 0);

  const safePeriods =
    rawPeriods.length > 0 ? rawPeriods : buildDefaultCustomPeriods(fiscalYear, 0);

  return safePeriods.map((p, idx) => {
    const num = idx + 1;
    const periodTitle = `Period ${num}`;
    const cleanLabel = p.label
      ? p.label.replace(/^Custom\s+/i, '')
      : `${periodTitle} (${p.startDate} – ${p.endDate})`;
    return {
      id: p.id || `period-${num}-${fiscalYear}`,
      code: p.code || `P${num}`,
      periodNumber: num,
      periodTitle,
      label: cleanLabel.toLowerCase().startsWith('period')
        ? cleanLabel
        : `${periodTitle} — ${cleanLabel}`,
      startDate: p.startDate || `${fiscalYear}-01-01`,
      endDate: p.endDate || `${fiscalYear}-12-31`,
      programName: primaryDs?.programName || 'Organisasi Yayasan WIJNA',
      isActiveForTor: Boolean(p.isActiveForTor),
    };
  });
}

