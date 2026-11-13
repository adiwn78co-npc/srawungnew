import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Wallet,
  FileSpreadsheet,
  Banknote,
  Receipt,
  PieChart,
  CheckCircle2,
  Search,
  Calendar,
  Layers,
  FileText,
  AlertCircle,
  Clock,
  ArrowLeft,
  Plus,
  Eye,
  Trash2,
  Upload,
  Download,
  RefreshCw,
  AlertTriangle,
  Edit3,
  History,
  Check,
  X,
  Link2,
  ArrowUpRight,
  Sliders,
  Building2,
  ExternalLink,
  Send,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import {
  Tor,
  Program,
  ProgramStatus,
  Outcome,
  Output,
  Activity,
  SubActivity,
  CashAdvanceRecord,
  ApprovalHubItem,
} from '../../types/index.js';
import { formatRupiah } from '../../lib/terbilang.js';
import { api } from '../../lib/api.js';
import { CashAdvanceFormModal } from './CashAdvanceFormModal.js';
import { CashAdvanceDetailModal } from './CashAdvanceDetailModal.js';
import { ProgramStructureView } from '../program/ProgramStructureView.js';
import {
  MasterBudgetItem,
  DEFAULT_MASTER_BUDGET_ITEMS,
} from '../../lib/masterBudgetStorage.js';
import {
  BudgetPeriodStructureType,
  ProgramBudgetDataset,
  ProgramBudgetPeriod,
  ProgramMasterBudgetCode,
  ExcelImportPreviewRow,
  getOrCreateProgramBudgetDataset,
  saveProgramBudgetDataset,
  saveProgramBudgetDatasetAsync,
  hydrateProgramBudgetDatasetsFromServer,
  getActivePeriods,
  matchPeriodForDate,
  calculateProgramBudgetMetrics,
  syncProgramFinancialDataFromMealConnect,
  downloadMasterBudgetExcelTemplate,
  parseMasterBudgetExcelFile,
  buildDefaultQuarterlyPeriods,
  buildDefaultSemesterPeriods,
  buildDefaultCustomPeriods,
} from '../../lib/programBudgetStorage.js';

export type FinanceTab =
  | 'dashboard'
  | 'program-master'
  | 'budget-planning'
  | 'master-budget'
  | 'master-tor'
  | 'cash-advance'
  | 'cash-advance-tambahan'
  | 'laporan-keuangan'
  | 'revision-history';

export type { MasterBudgetItem };
export const WIJNA_MASTER_BUDGET_ITEMS = DEFAULT_MASTER_BUDGET_ITEMS;

interface FinanceWorkspaceViewProps {
  initialTab?: FinanceTab;
  contextTor?: Tor | null;
  onBackToTor?: () => void;
  programs?: Program[];
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  subActivities?: SubActivity[];
  tors?: Tor[];
  onRefreshData?: () => void;
  onSelectTor?: (torId: string, initialStage?: number) => void;
  onCreateTor?: (selection?: {
    outcomeId: string;
    outputId: string;
    activityId: string;
  }) => void;
}

export const FinanceWorkspaceView: React.FC<FinanceWorkspaceViewProps> = ({
  initialTab = 'dashboard',
  contextTor = null,
  onBackToTor,
  programs = [],
  outcomes = [],
  outputs = [],
  activities = [],
  subActivities = [],
  tors = [],
  onRefreshData,
  onSelectTor,
  onCreateTor,
}) => {
  const { currentUser, isDirector, isFinance, isAdmin } = useAuth();
  const canEditFinance = isFinance || isDirector || isAdmin;
  const canManagePrograms =
    Boolean(currentUser?.permissions?.canManagePrograms) ||
    isDirector ||
    currentUser?.role === 'program_manager';

  // Derive available fiscal years strictly from actual database records (Programs, ToRs, Cash Advances)
  const availableFiscalYears = useMemo<number[]>(() => {
    const years = new Set<number>();
    for (const p of programs) {
      const sy = Number((p.startDate || '').slice(0, 4));
      const ey = Number((p.endDate || '').slice(0, 4));
      if (sy >= 2020 && sy <= 2035) years.add(sy);
      if (ey >= 2020 && ey <= 2035) years.add(ey);
    }
    for (const t of tors) {
      const ty = Number((t.startDate || t.createdAt || '').slice(0, 4));
      if (ty >= 2020 && ty <= 2035) years.add(ty);
    }
    if (years.size === 0) {
      years.add(new Date().getFullYear());
    }
    return Array.from(years).sort((a, b) => a - b);
  }, [programs, tors]);

  // 1. Select an existing program & 2. Select the fiscal year
  const [selectedProgramId, setSelectedProgramId] = useState<string>(() => {
    if (contextTor?.programId) return contextTor.programId;
    return programs[0]?.id || '';
  });

  useEffect(() => {
    if (!selectedProgramId && programs.length > 0) {
      setSelectedProgramId(contextTor?.programId || programs[0].id);
    }
  }, [programs, selectedProgramId, contextTor]);

  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(() => {
    const torYr = Number((contextTor?.startDate || '').slice(0, 4));
    if (torYr >= 2020) return torYr;
    return availableFiscalYears[0] || 2026;
  });

  const [activeTab, setActiveTab] = useState<FinanceTab>(
    initialTab === 'cash-advance-tambahan' ? 'cash-advance' : initialTab
  );

  const selectedProgram = useMemo(
    () => programs.find((p) => p.id === selectedProgramId) || programs[0] || null,
    [programs, selectedProgramId]
  );

  // Connected Database Records (Cash Advances & Approval Hub)
  const [cashAdvances, setCashAdvances] = useState<CashAdvanceRecord[]>([]);
  const [approvalHubItems, setApprovalHubItems] = useState<ApprovalHubItem[]>([]);
  const [syncLoading, setSyncLoading] = useState<boolean>(false);

  // Authoritative Program Budget Dataset for (selectedProgramId, selectedFiscalYear)
  const [dataset, setDataset] = useState<ProgramBudgetDataset>(() =>
    getOrCreateProgramBudgetDataset(
      selectedProgram?.id || 'unselected',
      selectedProgram?.name || '',
      selectedFiscalYear,
      { outcomes, outputs, activities, tors, cashAdvances: [] }
    )
  );

  // Local editable states for Master Budget (Total Program Budget, Annual Budget & Period Allocations)
  const [draftTotalProgramBudget, setDraftTotalProgramBudget] = useState<number>(
    Number(dataset.totalProgramBudget) || 0
  );
  const [draftAnnualBudget, setDraftAnnualBudget] = useState<number>(
    dataset.annualApprovedBudget
  );
  const [draftStructureType, setDraftStructureType] =
    useState<BudgetPeriodStructureType>(dataset.periodStructureType);
  const [draftQuarterly, setDraftQuarterly] = useState<ProgramBudgetPeriod[]>(
    dataset.quarterlyPeriods
  );
  const [draftSemester, setDraftSemester] = useState<ProgramBudgetPeriod[]>(
    dataset.semesterPeriods
  );
  const [draftCustom, setDraftCustom] = useState<ProgramBudgetPeriod[]>(
    dataset.customPeriods
  );
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Module 2: Program Master Modal States
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [progName, setProgName] = useState('');
  const [progLocation, setProgLocation] = useState('');
  const [progStartDate, setProgStartDate] = useState('2026-01-01');
  const [progEndDate, setProgEndDate] = useState('2026-12-31');
  const [progDescription, setProgDescription] = useState('');
  const [progStatus, setProgStatus] = useState<ProgramStatus>('Aktif');
  const [progSaving, setProgSaving] = useState(false);

  // Module 4: Master Budget Code States (2-Column Code | Budget Category + Excel Import)
  const [codeSearch, setCodeSearch] = useState('');
  const [showAddCodeModal, setShowAddCodeModal] = useState(false);
  const [editingCodeItem, setEditingCodeItem] =
    useState<ProgramMasterBudgetCode | null>(null);
  const [newCodeValue, setNewCodeValue] = useState('');
  const [newCategoryValue, setNewCategoryValue] = useState('');
  const [codeFormError, setCodeFormError] = useState<string | null>(null);

  // Excel Import Preview States
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [excelPreviewRows, setExcelPreviewRows] = useState<ExcelImportPreviewRow[]>([]);
  const [excelFileName, setExcelFileName] = useState<string>('');
  const [showExcelPreviewModal, setShowExcelPreviewModal] = useState(false);

  // Module 5: Master ToR Editing States
  const [editingTorBudget, setEditingTorBudget] = useState<Tor | null>(null);
  const [torEditCode, setTorEditCode] = useState('');
  const [torEditRequested, setTorEditRequested] = useState<number>(0);
  const [torEditApproved, setTorEditApproved] = useState<number>(0);
  const [torEditNotes, setTorEditNotes] = useState('');
  const [torSaving, setTorSaving] = useState(false);

  // Module 6: Cash Advance Modals & Action States
  const [showCaFormModal, setShowCaFormModal] = useState(false);
  const [caFormInitialTorId, setCaFormInitialTorId] = useState<string | undefined>(
    contextTor?.id
  );
  const [editingCaRecord, setEditingCaRecord] = useState<CashAdvanceRecord | null>(null);
  const [selectedCaDetail, setSelectedCaDetail] = useState<CashAdvanceRecord | null>(null);
  const [disbursingCa, setDisbursingCa] = useState<CashAdvanceRecord | null>(null);
  const [disburseRefNumber, setDisburseRefNumber] = useState('');
  const [disburseBankSource, setDisburseBankSource] = useState(
    'Bank Mandiri Operasional Yayasan'
  );
  const [caActionBusyId, setCaActionBusyId] = useState<string | null>(null);
  const [txFilterStatus, setTxFilterStatus] = useState<string>('all');
  const [txSearch, setTxSearch] = useState<string>('');

  // Module 7: Final Financial Report (LPJ) Submission & Approval Modal States
  const [closingReportCa, setClosingReportCa] = useState<CashAdvanceRecord | null>(null);
  const [lpjExpensifyLink, setLpjExpensifyLink] = useState('');
  const [lpjItemActuals, setLpjItemActuals] = useState<Record<string, number>>({});
  const [lpjNotes, setLpjNotes] = useState('');
  const [lpjSaving, setLpjSaving] = useState(false);

  // Load server-persisted budgets & connected records (Single Source of Truth)
  const fetchAndSyncAllData = useCallback(
    async (recordManualSync = false) => {
      try {
        setSyncLoading(true);
        const [serverBudgets, caRes, apvRes] = await Promise.all([
          api.getFinanceProgramBudgets().catch(() => ({} as Record<string, any>)),
          api.getCashAdvances().catch(() => [] as CashAdvanceRecord[]),
          api.getApprovalHub().catch(() => null),
        ]);

        const caList = Array.isArray(caRes) ? caRes : [];
        const hubList =
          apvRes && Array.isArray(apvRes.items) ? apvRes.items : [];

        setCashAdvances(caList);
        setApprovalHubItems(hubList);

        // Hydrate directly from authoritative MySQL server budgets
        if (serverBudgets && typeof serverBudgets === 'object') {
          hydrateProgramBudgetDatasetsFromServer(serverBudgets);
        }

        if (selectedProgram) {
          const currentDs = getOrCreateProgramBudgetDataset(
            selectedProgram.id,
            selectedProgram.name,
            selectedFiscalYear,
            { outcomes, outputs, activities, tors, cashAdvances: caList }
          );
          const syncResult = syncProgramFinancialDataFromMealConnect({
            dataset: currentDs,
            programs,
            outcomes,
            outputs,
            activities,
            tors,
            cashAdvances: caList,
            approvalHubItems: hubList,
            actorName: currentUser?.name || 'System',
            recordSyncLog: recordManualSync,
          });
          setDataset(syncResult.updatedDataset);
          setDraftTotalProgramBudget(Number(syncResult.updatedDataset.totalProgramBudget) || 0);
          setDraftAnnualBudget(syncResult.updatedDataset.annualApprovedBudget);
          setDraftStructureType(syncResult.updatedDataset.periodStructureType);
          setDraftQuarterly(syncResult.updatedDataset.quarterlyPeriods);
          setDraftSemester(syncResult.updatedDataset.semesterPeriods);
          setDraftCustom(syncResult.updatedDataset.customPeriods);

          if (recordManualSync) {
            setStatusBanner({
              type: 'success',
              message: `Data terintegrasi berhasil disinkronkan dari database: ${(syncResult.updatedDataset.transactions || []).length} rekaman Cash Advance / Final Financial Report terhubung.`,
            });
          }
        }
      } catch (err) {
        console.error('Failed to sync Finance Workspace data:', err);
      } finally {
        setSyncLoading(false);
      }
    },
    [
      selectedProgram,
      selectedFiscalYear,
      programs,
      outcomes,
      outputs,
      activities,
      tors,
      currentUser,
    ]
  );

  useEffect(() => {
    fetchAndSyncAllData(false);
  }, [fetchAndSyncAllData]);

  // Actual ToR records in database belonging to the selected Program & Fiscal Year
  const programTors = useMemo<Tor[]>(() => {
    if (!selectedProgram) return [];
    return tors.filter((t) => {
      const matchProg =
        t.programId === selectedProgram.id ||
        (t.programName &&
          t.programName.trim().toLowerCase() ===
            selectedProgram.name.trim().toLowerCase());
      if (!matchProg) return false;
      const torYear = Number((t.startDate || t.createdAt || '').slice(0, 4));
      return !torYear || torYear === selectedFiscalYear;
    });
  }, [tors, selectedProgram, selectedFiscalYear]);

  // Actual CashAdvanceRecords in database belonging to the selected Program & Fiscal Year
  const programCashAdvances = useMemo<CashAdvanceRecord[]>(() => {
    if (!selectedProgram) return [];
    const torIdSet = new Set(programTors.map((t) => t.id));
    return cashAdvances.filter((ca) => {
      const matchByTor = Boolean(ca.torId && torIdSet.has(ca.torId));
      const matchByProgName = Boolean(
        ca.programName &&
          ca.programName.trim().toLowerCase() ===
            selectedProgram.name.trim().toLowerCase()
      );
      if (!matchByTor && !matchByProgName) return false;
      const caYear = Number(
        (ca.requestDate || ca.activityStartDate || ca.createdAt || '').slice(0, 4)
      );
      return !caYear || caYear === selectedFiscalYear;
    });
  }, [cashAdvances, selectedProgram, programTors, selectedFiscalYear]);

  // Active draft periods for the currently selected period structure in Master Budget
  const activeDraftPeriods = useMemo(() => {
    if (draftStructureType === 'quarterly') return draftQuarterly;
    if (draftStructureType === 'semester') return draftSemester;
    return draftCustom;
  }, [draftStructureType, draftQuarterly, draftSemester, draftCustom]);

  const draftTotalPeriodAllocated = useMemo(
    () =>
      activeDraftPeriods.reduce(
        (sum, p) => sum + (Number(p.allocatedAmount) || 0),
        0
      ),
    [activeDraftPeriods]
  );

  // Annual budget automatically reflects the sum of all budget periods entered for that year
  useEffect(() => {
    setDraftAnnualBudget(draftTotalPeriodAllocated);
  }, [draftTotalPeriodAllocated]);

  const draftAllocationVariance = 0;
  const isDraftAllocationBalanced = draftTotalPeriodAllocated > 0;

  // Live metrics from authoritative dataset
  const metrics = useMemo(
    () => calculateProgramBudgetMetrics(dataset),
    [dataset]
  );

  const activeSavedPeriods = useMemo(
    () => getActivePeriods(dataset),
    [dataset]
  );

  // Per-period financial performance breakdown (including connected ToRs, Cash Advances, and Verified LPJs)
  const periodPerformanceRows = useMemo(() => {
    return activeSavedPeriods.map((period) => {
      const periodTors = programTors.filter((t) => {
        const d = (t.startDate || t.createdAt || '').slice(0, 10);
        return d >= period.startDate && d <= period.endDate;
      });
      const torApprovedSum = periodTors.reduce(
        (s, t) => s + (Number(t.budgetApproved ?? t.budgetRequested) || 0),
        0
      );

      const periodTxs = dataset.transactions.filter(
        (t) =>
          t.periodId === period.id ||
          (t.transactionDate >= period.startDate &&
            t.transactionDate <= period.endDate)
      );
      const disbursedSum = periodTxs.reduce(
        (s, t) => s + (Number(t.disbursedAmount) || 0),
        0
      );
      const verifiedSpent = periodTxs.reduce(
        (s, t) => s + (Number(t.verifiedActualExpenditure) || 0),
        0
      );
      const outstanding = periodTxs.reduce(
        (s, t) => s + (Number(t.outstandingCommitment) || 0),
        0
      );
      const returned = periodTxs.reduce(
        (s, t) => s + (Number(t.returnedFunds) || 0),
        0
      );
      const allocated = Number(period.allocatedAmount) || 0;
      const available =
        allocated > 0 ? allocated - verifiedSpent - outstanding : null;
      const pct =
        allocated > 0
          ? Math.min(
              100,
              Math.round(((verifiedSpent + outstanding) / allocated) * 1000) /
                10
            )
          : null;
      return {
        period,
        torCount: periodTors.length,
        torApprovedSum,
        disbursedSum,
        verifiedSpent,
        outstanding,
        returned,
        available,
        utilizationPct: pct,
        txCount: periodTxs.length,
      };
    });
  }, [activeSavedPeriods, programTors, dataset.transactions]);

  // Per-Master Budget Code financial performance breakdown
  const codePerformanceRows = useMemo(() => {
    return dataset.masterBudgetCodes.map((mc) => {
      const codeTors = programTors.filter(
        (t) => (t.activityCode || t.hierarchyCode) === mc.code
      );
      const torBudgetApproved = codeTors.reduce(
        (s, t) => s + (Number(t.budgetApproved ?? t.budgetRequested) || 0),
        0
      );
      const codeTxs = dataset.transactions.filter(
        (t) => t.budgetCode === mc.code
      );
      const disbursed = codeTxs.reduce(
        (s, t) => s + (Number(t.disbursedAmount) || 0),
        0
      );
      const verifiedSpent = codeTxs.reduce(
        (s, t) => s + (Number(t.verifiedActualExpenditure) || 0),
        0
      );
      const outstanding = codeTxs.reduce(
        (s, t) => s + (Number(t.outstandingCommitment) || 0),
        0
      );
      const returned = codeTxs.reduce(
        (s, t) => s + (Number(t.returnedFunds) || 0),
        0
      );
      const totalCommittedOrSpent = verifiedSpent + outstanding;
      const shareOfAnnualPct =
        metrics.isBudgetConfigured && dataset.annualApprovedBudget > 0
          ? Math.round(
              (totalCommittedOrSpent / dataset.annualApprovedBudget) * 1000
            ) / 10
          : null;
      return {
        masterCode: mc,
        torCount: codeTors.length,
        torBudgetApproved,
        disbursed,
        verifiedSpent,
        outstanding,
        returned,
        totalCommittedOrSpent,
        shareOfAnnualPct,
        txCount: codeTxs.length,
      };
    });
  }, [
    dataset.masterBudgetCodes,
    dataset.transactions,
    dataset.annualApprovedBudget,
    metrics.isBudgetConfigured,
    programTors,
  ]);

  // Cross-program comparison (strictly from real database records)
  const crossProgramComparison = useMemo(() => {
    return programs.map((prog) => {
      const baseDs =
        prog.id === dataset.programId
          ? dataset
          : getOrCreateProgramBudgetDataset(
              prog.id,
              prog.name,
              selectedFiscalYear,
              { outcomes, outputs, activities, tors, cashAdvances }
            );
      const syncedDs =
        prog.id === dataset.programId
          ? dataset
          : syncProgramFinancialDataFromMealConnect({
              dataset: baseDs,
              programs,
              outcomes,
              outputs,
              activities,
              tors,
              cashAdvances,
              approvalHubItems,
              actorName: 'System',
              recordSyncLog: false,
            }).updatedDataset;
      const m = calculateProgramBudgetMetrics(syncedDs);
      const progTorList = tors.filter(
        (t) =>
          t.programId === prog.id ||
          (t.programName &&
            t.programName.trim().toLowerCase() ===
              prog.name.trim().toLowerCase())
      );
      return {
        program: prog,
        dataset: syncedDs,
        metrics: m,
        torCount: progTorList.length,
        torApprovedTotal: progTorList.reduce(
          (s, t) => s + (Number(t.budgetApproved ?? t.budgetRequested) || 0),
          0
        ),
      };
    });
  }, [
    programs,
    dataset,
    selectedFiscalYear,
    outcomes,
    outputs,
    activities,
    tors,
    cashAdvances,
    approvalHubItems,
  ]);

  // Handlers for Period Allocation editing
  const handleUpdateDraftPeriodAmount = (periodId: string, amount: number) => {
    const safeAmt = Math.max(0, Number(amount) || 0);
    if (draftStructureType === 'quarterly') {
      setDraftQuarterly((prev) =>
        prev.map((p) =>
          p.id === periodId ? { ...p, allocatedAmount: safeAmt } : p
        )
      );
    } else if (draftStructureType === 'semester') {
      setDraftSemester((prev) =>
        prev.map((p) =>
          p.id === periodId ? { ...p, allocatedAmount: safeAmt } : p
        )
      );
    } else {
      setDraftCustom((prev) =>
        prev.map((p) =>
          p.id === periodId ? { ...p, allocatedAmount: safeAmt } : p
        )
      );
    }
  };

  const handleUpdateCustomPeriodMeta = (
    periodId: string,
    field: 'code' | 'label' | 'startDate' | 'endDate',
    value: string
  ) => {
    setDraftCustom((prev) =>
      prev.map((p) => (p.id === periodId ? { ...p, [field]: value } : p))
    );
  };

  const handleAddCustomPeriod = () => {
    const nextIdx = draftCustom.length + 1;
    const newPeriod: ProgramBudgetPeriod = {
      id: `cust-${Date.now()}`,
      code: `P${nextIdx}`,
      label: `Custom Period ${nextIdx} (${selectedFiscalYear})`,
      startDate: `${selectedFiscalYear}-01-01`,
      endDate: `${selectedFiscalYear}-12-31`,
      allocatedAmount: 0,
    };
    setDraftCustom((prev) => [...prev, newPeriod]);
  };

  const handleRemoveCustomPeriod = (periodId: string) => {
    if (draftCustom.length <= 1) return;
    setDraftCustom((prev) => prev.filter((p) => p.id !== periodId));
  };

  const handleSaveBudgetAndPeriods = async () => {
    const computedAnnualBudget = draftTotalPeriodAllocated;
    const safeTotalProgramBudget = Math.max(0, Number(draftTotalProgramBudget) || 0);

    if (computedAnnualBudget <= 0 && safeTotalProgramBudget <= 0) {
      setStatusBanner({
        type: 'error',
        message: 'Masukkan nominal anggaran pada periode anggaran atau Total Program Budget terlebih dahulu.',
      });
      return;
    }

    const prevAnnual = dataset.annualApprovedBudget;
    const prevStructure = dataset.periodStructureType;
    const updatedDataset: ProgramBudgetDataset = {
      ...dataset,
      isBudgetConfigured: computedAnnualBudget > 0,
      totalProgramBudget: safeTotalProgramBudget,
      annualApprovedBudget: computedAnnualBudget,
      periodStructureType: draftStructureType,
      quarterlyPeriods:
        draftStructureType === 'quarterly'
          ? draftQuarterly
          : buildDefaultQuarterlyPeriods(selectedFiscalYear, 0),
      semesterPeriods:
        draftStructureType === 'semester'
          ? draftSemester
          : buildDefaultSemesterPeriods(selectedFiscalYear, 0),
      customPeriods:
        draftStructureType === 'custom'
          ? draftCustom
          : buildDefaultCustomPeriods(selectedFiscalYear, 0),
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actorName: currentUser?.name || 'Finance User',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType:
            prevAnnual !== computedAnnualBudget
              ? 'ANNUAL_BUDGET_UPDATE'
              : 'PERIOD_ALLOCATION_UPDATE',
          previousAnnualBudget: prevAnnual,
          newAnnualBudget: computedAnnualBudget,
          periodStructureType: draftStructureType,
          summary: `Updated Total Program Budget (${formatRupiah(
            safeTotalProgramBudget
          )}), FY ${selectedFiscalYear} Annual Budget (${formatRupiah(
            computedAnnualBudget
          )}) calculated automatically from ${draftStructureType.toUpperCase()} periods (${
            activeDraftPeriods.length
          } periods; previous structure: ${prevStructure}).`,
        },
        ...dataset.revisions,
      ],
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.name || 'Finance User',
    };

    try {
      const persisted = await saveProgramBudgetDatasetAsync(updatedDataset);
      setDataset(persisted);
      setStatusBanner({
        type: 'success',
        message: `Finance Program (${dataset.programName}) berhasil disimpan: Total Program Budget ${formatRupiah(
          safeTotalProgramBudget
        )} dan Annual Budget FY ${selectedFiscalYear} ${formatRupiah(
          computedAnnualBudget
        )} (${draftStructureType.toUpperCase()}).`,
      });
      onRefreshData?.();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal menyimpan konfigurasi anggaran ke database server.',
      });
    }
  };

  // Module 2: Program Master Handlers
  const handleOpenCreateProgram = () => {
    setEditingProgram(null);
    setProgName('');
    setProgLocation('');
    setProgStartDate(`${selectedFiscalYear}-01-01`);
    setProgEndDate(`${selectedFiscalYear}-12-31`);
    setProgDescription('');
    setProgStatus('Aktif');
    setShowProgramModal(true);
  };

  const handleOpenEditProgram = (prog: Program) => {
    setEditingProgram(prog);
    setProgName(prog.name);
    setProgLocation(prog.location);
    setProgStartDate(prog.startDate);
    setProgEndDate(prog.endDate);
    setProgDescription(prog.description || '');
    setProgStatus(prog.status);
    setShowProgramModal(true);
  };

  const handleSaveProgramMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!progName.trim() || !progLocation.trim()) return;
    try {
      setProgSaving(true);
      if (editingProgram) {
        await api.updateProgram(editingProgram.id, {
          name: progName.trim(),
          location: progLocation.trim(),
          startDate: progStartDate,
          endDate: progEndDate,
          description: progDescription.trim(),
          status: progStatus,
        });
        setStatusBanner({
          type: 'success',
          message: `Program "${progName.trim()}" berhasil diperbarui di Program Master.`,
        });
      } else {
        const created = await api.createProgram({
          name: progName.trim(),
          location: progLocation.trim(),
          startDate: progStartDate,
          endDate: progEndDate,
          description: progDescription.trim(),
          status: progStatus,
        });
        setSelectedProgramId(created.id);
        setStatusBanner({
          type: 'success',
          message: `Program baru "${created.name}" berhasil ditambahkan ke Program Master.`,
        });
      }
      setShowProgramModal(false);
      onRefreshData?.();
      await fetchAndSyncAllData(false);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal menyimpan data Program Master.',
      });
    } finally {
      setProgSaving(false);
    }
  };

  // Module 4: Master Budget Code Handlers (Code | Budget Category)
  const filteredMasterCodes = useMemo(() => {
    const q = codeSearch.trim().toLowerCase();
    if (!q) return dataset.masterBudgetCodes;
    return dataset.masterBudgetCodes.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.budgetCategory.toLowerCase().includes(q)
    );
  }, [dataset.masterBudgetCodes, codeSearch]);

  const handleOpenAddCode = () => {
    setEditingCodeItem(null);
    setNewCodeValue('');
    setNewCategoryValue('');
    setCodeFormError(null);
    setShowAddCodeModal(true);
  };

  const handleOpenEditCode = (item: ProgramMasterBudgetCode) => {
    setEditingCodeItem(item);
    setNewCodeValue(item.code);
    setNewCategoryValue(item.budgetCategory);
    setCodeFormError(null);
    setShowAddCodeModal(true);
  };

  const handleSaveMasterCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = newCodeValue.trim();
    const cleanCat = newCategoryValue.trim();
    if (!cleanCode || !cleanCat) {
      setCodeFormError('Both Code and Budget Category are required.');
      return;
    }

    // Duplicate validation
    const duplicate = dataset.masterBudgetCodes.find(
      (c) =>
        c.code.trim().toLowerCase() === cleanCode.toLowerCase() &&
        c.id !== editingCodeItem?.id
    );
    if (duplicate) {
      setCodeFormError(
        `Duplicate Code: "${cleanCode}" already exists (${duplicate.budgetCategory}) in ${dataset.programName}.`
      );
      return;
    }

    let nextCodes: ProgramMasterBudgetCode[];
    let actionDesc: string;

    if (editingCodeItem) {
      nextCodes = dataset.masterBudgetCodes.map((c) =>
        c.id === editingCodeItem.id
          ? {
              ...c,
              code: cleanCode,
              budgetCategory: cleanCat,
              updatedAt: new Date().toISOString(),
            }
          : c
      );
      actionDesc = `Updated Master Budget Code ${cleanCode} (${cleanCat}).`;
    } else {
      const created: ProgramMasterBudgetCode = {
        id: `mbc-${Date.now()}`,
        code: cleanCode,
        budgetCategory: cleanCat,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: currentUser?.name || 'Finance User',
        source: 'Manual',
      };
      nextCodes = [...dataset.masterBudgetCodes, created].sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true })
      );
      actionDesc = `Added new Master Budget Code ${cleanCode} — ${cleanCat}.`;
    }

    const updatedDataset: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: nextCodes,
      revisions: [
        {
          id: `rev-code-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actorName: currentUser?.name || 'Finance User',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: 'MASTER_CODE_UPDATE',
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
          periodStructureType: dataset.periodStructureType,
          summary: actionDesc,
        },
        ...dataset.revisions,
      ],
    };

    try {
      const persisted = await saveProgramBudgetDatasetAsync(updatedDataset);
      setDataset(persisted);
      setShowAddCodeModal(false);
      setStatusBanner({
        type: 'success',
        message: `Master Budget Code ${cleanCode} (${cleanCat}) berhasil disimpan dan terhubung ke seluruh modul.`,
      });
    } catch (err: any) {
      setCodeFormError(
        err?.message || 'Gagal menyimpan Master Budget Code ke database server.'
      );
    }
  };

  const handleDeleteMasterCode = async (item: ProgramMasterBudgetCode) => {
    const updatedCodes = dataset.masterBudgetCodes.filter(
      (c) => c.id !== item.id
    );
    const updatedDataset: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: updatedCodes,
      revisions: [
        {
          id: `rev-delcode-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actorName: currentUser?.name || 'Finance User',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: 'MASTER_CODE_UPDATE',
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
          periodStructureType: dataset.periodStructureType,
          summary: `Removed Master Budget Code ${item.code} (${item.budgetCategory}).`,
        },
        ...dataset.revisions,
      ],
    };
    try {
      const persisted = await saveProgramBudgetDatasetAsync(updatedDataset);
      setDataset(persisted);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal menghapus Master Budget Code pada database server.',
      });
    }
  };

  // Excel Upload & Preview Handlers
  const handleExcelFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setExcelFileName(file.name);
      const parsed = await parseMasterBudgetExcelFile(
        file,
        dataset.masterBudgetCodes
      );
      setExcelPreviewRows(parsed);
      setShowExcelPreviewModal(true);
    } catch (err) {
      console.error('Failed to parse Excel file:', err);
      setStatusBanner({
        type: 'error',
        message:
          'Gagal membaca file Excel. Pastikan format kolom terdiri dari "Code" dan "Budget Category".',
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmExcelImport = async () => {
    const validRows = excelPreviewRows.filter((r) => r.status === 'valid');
    if (validRows.length === 0) {
      setShowExcelPreviewModal(false);
      return;
    }

    const nowIso = new Date().toISOString();
    const importedItems: ProgramMasterBudgetCode[] = validRows.map(
      (row, idx) => ({
        id: `mbc-imp-${Date.now()}-${idx}`,
        code: row.code,
        budgetCategory: row.budgetCategory,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: currentUser?.name || 'Finance User',
        source: 'Excel Import',
      })
    );

    const nextCodes = [...dataset.masterBudgetCodes, ...importedItems].sort(
      (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })
    );

    const updatedDataset: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: nextCodes,
      revisions: [
        {
          id: `rev-imp-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Finance User',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: 'MASTER_CODE_UPDATE',
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
          periodStructureType: dataset.periodStructureType,
          summary: `Imported ${validRows.length} Master Budget Code(s) from Excel file "${excelFileName}".`,
        },
        ...dataset.revisions,
      ],
    };

    try {
      const persisted = await saveProgramBudgetDatasetAsync(updatedDataset);
      setDataset(persisted);
      setShowExcelPreviewModal(false);
      setStatusBanner({
        type: 'success',
        message: `Berhasil mengimpor ${validRows.length} Master Budget Code dari "${excelFileName}".`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal menyimpan hasil impor Excel ke database server.',
      });
    }
  };

  // Module 5: Master ToR Financial Update Handler
  const handleOpenEditTorBudget = (tor: Tor) => {
    setEditingTorBudget(tor);
    setTorEditCode(tor.activityCode || tor.hierarchyCode || '');
    setTorEditRequested(Number(tor.budgetRequested) || 0);
    setTorEditApproved(Number(tor.budgetApproved ?? tor.budgetRequested) || 0);
    setTorEditNotes(tor.budgetNotes || '');
  };

  const handleSaveTorBudgetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTorBudget) return;
    try {
      setTorSaving(true);
      await api.updateTor(editingTorBudget.id, {
        activityCode: torEditCode.trim() || editingTorBudget.activityCode,
        hierarchyCode: torEditCode.trim() || editingTorBudget.hierarchyCode,
        budgetRequested: torEditRequested,
        budgetApproved: torEditApproved,
        budgetNotes: torEditNotes.trim(),
      });
      setEditingTorBudget(null);
      onRefreshData?.();
      await fetchAndSyncAllData(false);
      setStatusBanner({
        type: 'success',
        message: `Konfigurasi anggaran dan kode budget pada Master ToR ${editingTorBudget.torNumber} berhasil diperbarui.`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal memperbarui anggaran Master ToR.',
      });
    } finally {
      setTorSaving(false);
    }
  };

  // Module 6: Cash Advance Workflow Action Handlers (Real Database API Calls)
  const handleVerifyCaInDatabase = async (
    ca: CashAdvanceRecord,
    action: 'verify' | 'revision' | 'reject'
  ) => {
    try {
      setCaActionBusyId(ca.id);
      await api.verifyCashAdvance(
        ca.id,
        action,
        action === 'verify'
          ? `Diverifikasi oleh ${currentUser?.name} di Finance Workspace sesuai Master ToR ${ca.torNumber}.`
          : `Perlu penyesuaian rincian anggaran.`
      );
      onRefreshData?.();
      await fetchAndSyncAllData(false);
      setStatusBanner({
        type: 'success',
        message: `Status Cash Advance ${ca.advanceNumber} berhasil diperbarui (${action}).`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal memproses verifikasi Cash Advance.',
      });
    } finally {
      setCaActionBusyId(null);
    }
  };

  const handleApproveCaInDatabase = async (
    ca: CashAdvanceRecord,
    action: 'approve' | 'reject'
  ) => {
    try {
      setCaActionBusyId(ca.id);
      await api.approveCashAdvance(
        ca.id,
        action,
        action === 'approve'
          ? `Disetujui Direktur (${currentUser?.name}) di Finance Workspace.`
          : 'Pengajuan Cash Advance ditolak.'
      );
      onRefreshData?.();
      await fetchAndSyncAllData(false);
      setStatusBanner({
        type: 'success',
        message: `Keputusan Direktur untuk Cash Advance ${ca.advanceNumber} berhasil disimpan.`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal memproses persetujuan Cash Advance.',
      });
    } finally {
      setCaActionBusyId(null);
    }
  };

  const handleConfirmDisburseCa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disbursingCa) return;
    try {
      setCaActionBusyId(disbursingCa.id);
      await api.disburseCashAdvance(
        disbursingCa.id,
        disburseRefNumber.trim() || undefined,
        disburseBankSource.trim() || undefined
      );
      const targetNum = disbursingCa.advanceNumber;
      setDisbursingCa(null);
      setDisburseRefNumber('');
      onRefreshData?.();
      await fetchAndSyncAllData(false);
      setStatusBanner({
        type: 'success',
        message: `Dana Cash Advance ${targetNum} berhasil dicairkan (Disbursed) dan tercatat sebagai Outstanding Advance hingga LPJ diverifikasi.`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal mencairkan Cash Advance.',
      });
    } finally {
      setCaActionBusyId(null);
    }
  };

  // Module 7: Final Financial Report (LPJ) Submission & Verification Handlers (Real Database API Calls)
  const handleOpenCloseReportModal = (ca: CashAdvanceRecord) => {
    setClosingReportCa(ca);
    setLpjExpensifyLink(
      ca.expensifyPdfLink ||
        `https://www.expensify.com/report?ca=${encodeURIComponent(ca.advanceNumber)}`
    );
    const map: Record<string, number> = {};
    for (const item of ca.items || []) {
      map[item.id] =
        typeof item.actualSpent === 'number'
          ? item.actualSpent
          : Number(item.totalAmount) || 0;
    }
    setLpjItemActuals(map);
    setLpjNotes(ca.reportNotes || '');
  };

  const handleConfirmSubmitFinalReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingReportCa) return;
    if (!lpjExpensifyLink.trim()) {
      setStatusBanner({
        type: 'error',
        message: 'Link PDF Expensify wajib diisi untuk menutup laporan keuangan akhir.',
      });
      return;
    }

    const totalRealized = Object.values(lpjItemActuals).reduce<number>(
      (sum, v) => sum + Math.max(0, Number(v) || 0),
      0
    );

    try {
      setLpjSaving(true);
      await api.closeCashAdvanceReport(closingReportCa.id, {
        expensifyPdfLink: lpjExpensifyLink.trim(),
        realizedAmount: totalRealized,
        reportNotes: lpjNotes.trim(),
        itemRealizations: lpjItemActuals,
      });
      const caNum = closingReportCa.advanceNumber;
      setClosingReportCa(null);
      onRefreshData?.();
      await fetchAndSyncAllData(false);
      setStatusBanner({
        type: 'success',
        message: `Final Financial Report untuk ${caNum} berhasil diajukan dengan realisasi ${formatRupiah(
          totalRealized
        )} (Menunggu Pemeriksaan Finance).`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Gagal menyimpan Final Financial Report.',
      });
    } finally {
      setLpjSaving(false);
    }
  };

  const handleApproveFinalReportStage = async (
    ca: CashAdvanceRecord,
    stage: 'finance' | 'director',
    action: 'approve' | 'revision'
  ) => {
    try {
      setCaActionBusyId(ca.id);
      await api.approveCashAdvanceReport(ca.id, {
        stage,
        action,
        notes:
          action === 'approve'
            ? `Final Financial Report ${ca.advanceNumber} disetujui pada tahap ${stage.toUpperCase()} di Finance Workspace.`
            : `Perlu revisi bukti realisasi pengeluaran pada ${ca.advanceNumber}.`,
      });
      onRefreshData?.();
      await fetchAndSyncAllData(false);
      setStatusBanner({
        type: 'success',
        message:
          action === 'approve' && stage === 'director'
            ? `Final Financial Report ${ca.advanceNumber} telah disetujui final! Pengeluaran aktual (${formatRupiah(
                ca.realizedAmount ?? ca.totalAmount
              )}) dan pengembalian dana (${formatRupiah(
                Math.max(
                  0,
                  Number(ca.totalAmount) -
                    Number(ca.realizedAmount ?? ca.totalAmount)
                )
              )}) otomatis memperbarui Master ToR dan Financial Dashboard.`
            : `Status verifikasi Final Financial Report ${ca.advanceNumber} berhasil diperbarui.`,
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message:
          err?.message ||
          'Gagal memproses persetujuan Final Financial Report.',
      });
    } finally {
      setCaActionBusyId(null);
    }
  };

  const filteredTransactions = useMemo(() => {
    return dataset.transactions.filter((tx) => {
      const matchesStatus =
        txFilterStatus === 'all' ||
        (txFilterStatus === 'outstanding' &&
          tx.reconciliationStatus === 'Outstanding Advance') ||
        (txFilterStatus === 'pending' &&
          tx.reconciliationStatus === 'Pending Verification') ||
        (txFilterStatus === 'reconciled' &&
          tx.reconciliationStatus === 'Verified & Reconciled');
      const q = txSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        tx.referenceNumber.toLowerCase().includes(q) ||
        tx.activityTitle.toLowerCase().includes(q) ||
        tx.budgetCode.toLowerCase().includes(q) ||
        tx.budgetCategory.toLowerCase().includes(q) ||
        tx.requesterName.toLowerCase().includes(q) ||
        tx.torNumber.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [dataset.transactions, txFilterStatus, txSearch]);

  const workspaceTabs: Array<{
    id: FinanceTab;
    stepBadge: string;
    label: string;
    desc: string;
    icon: React.FC<{ className?: string }>;
    badgeCount?: number;
  }> = [
    {
      id: 'dashboard',
      stepBadge: 'MODUL 7',
      label: 'Financial Dashboard',
      desc: 'Alokasi, komitmen, pencairan, pengeluaran aktual & sisa anggaran',
      icon: PieChart,
    },
    {
      id: 'program-master',
      stepBadge: 'MODUL 1',
      label: 'Program Master',
      desc: 'Referensi terpusat seluruh program & struktur hierarki',
      icon: Building2,
      badgeCount: programs.length,
    },
    {
      id: 'budget-planning',
      stepBadge: 'MODUL 2',
      label: 'Master Budget',
      desc: 'Anggaran tahunan & alokasi periode (Quarterly, Semester, Custom)',
      icon: Sliders,
    },
    {
      id: 'master-budget',
      stepBadge: 'MODUL 3',
      label: 'Master Budget Code',
      desc: '2 Kolom (Code | Budget Category) & Import Excel (.xlsx)',
      icon: FileSpreadsheet,
      badgeCount: (dataset.masterBudgetCodes || []).length,
    },
    {
      id: 'master-tor',
      stepBadge: 'MODUL 4',
      label: 'Master ToR',
      desc: 'Terhubung ke Program, Periode Anggaran, & Master Budget Code',
      icon: FileText,
      badgeCount: programTors.length,
    },
    {
      id: 'cash-advance',
      stepBadge: 'MODUL 5',
      label: 'Cash Advance',
      desc: 'Otomatis merujuk ToR, Program, Periode, & Kode Budget',
      icon: Banknote,
      badgeCount: programCashAdvances.length,
    },
    {
      id: 'laporan-keuangan',
      stepBadge: 'MODUL 6',
      label: 'Final Financial Report',
      desc: 'Terhubung ke Cash Advance & ToR, pengeluaran aktual & sisa dana',
      icon: Receipt,
      badgeCount: programCashAdvances.filter(
        (ca) => ca.isReported || ca.status === 'Dicairkan'
      ).length,
    },
    {
      id: 'revision-history',
      stepBadge: 'AUDIT',
      label: 'Jejak Revisi',
      desc: 'Log perubahan anggaran & sinkronisasi antar-modul',
      icon: History,
    },
  ];

  // Empty state if no programs exist in the database
  if (programs.length === 0) {
    return (
      <div className="bg-white border border-[#E5E5E3] rounded-md p-8 text-center">
        <Building2 className="w-10 h-10 text-[#9B9A97] mx-auto mb-3" />
        <h3 className="text-base font-bold text-[#252525]">
          Belum Ada Data Program di Database
        </h3>
        <p className="text-xs text-[#787774] mt-1 max-w-md mx-auto">
          Finance Workspace menggunakan data program nyata dari Program Master.
          Silakan tambahkan program terlebih dahulu untuk memulai pengelolaan anggaran.
        </p>
        {canManagePrograms && (
          <button
            type="button"
            onClick={handleOpenCreateProgram}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-[#252525] text-white hover:bg-[#37352F]"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Program Pertama
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Contextual Back Button if navigated from a specific ToR */}
      {contextTor && onBackToTor && (
        <div className="flex items-center justify-between bg-[#EEF3FF] border border-[#C7D7FE] px-4 py-2.5 rounded-md">
          <div className="flex items-center gap-2.5 text-xs text-[#2851C5]">
            <FileText className="w-4 h-4 shrink-0" />
            <span>
              Konteks Dokumen Aktif:{' '}
              <strong className="font-mono">{contextTor.torNumber}</strong> —{' '}
              {contextTor.title}
            </span>
          </div>
          <button
            type="button"
            onClick={onBackToTor}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2851C5] hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Kembali ke Dokumen ToR
          </button>
        </div>
      )}

      {/* Top Header & Integrated Context Selector (One Integrated System, One Source of Truth) */}
      <div className="bg-white border border-[#E5E5E3] rounded-md p-4 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-3.5 border-b border-[#EAEAEA]">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] font-bold uppercase tracking-wider bg-[#252525] text-white">
                <Wallet className="w-3 h-3 text-[#60A5FA]" />
                FINANCE WORKSPACE
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-medium bg-[#EAF3EC] text-[#2B6E3F] border border-[#B7DFC1]">
                <CheckCircle2 className="w-3 h-3" />
                One Integrated System • One Source of Truth
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-medium bg-[#EEF3FF] text-[#2851C5] border border-[#C7D7FE]">
                <Link2 className="w-3 h-3" />
                100% Database Traceable
              </span>
            </div>
            <h2 className="text-lg font-bold text-[#252525] tracking-tight">
              Integrated Financial Management System
            </h2>
            <p className="text-xs text-[#787774]">
              Seluruh 7 modul keuangan (Program Master, Master Budget, Master Budget Code, Master ToR, Cash Advance, Final Financial Report, dan Financial Dashboard) saling terhubung pada satu basis data tunggal.
            </p>
          </div>

          {/* Global Program & Fiscal Year Selector Bar */}
          <div className="flex flex-wrap items-end gap-2.5 bg-[#F7F7F5] p-2.5 rounded-md border border-[#E5E5E3]">
            <div className="min-w-[260px] flex-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#787774] mb-1">
                1. Program Master Aktif
              </label>
              <select
                value={selectedProgram?.id || ''}
                onChange={(e) => setSelectedProgramId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-semibold text-[#252525] bg-white border border-[#D4D4D0] rounded-sm focus:outline-none focus:border-[#3867F5]"
              >
                {programs.map((prog) => (
                  <option key={prog.id} value={prog.id}>
                    {prog.name} ({prog.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="w-28">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#787774] mb-1">
                2. Fiscal Year
              </label>
              <select
                value={selectedFiscalYear}
                onChange={(e) => setSelectedFiscalYear(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-semibold text-[#252525] bg-white border border-[#D4D4D0] rounded-sm focus:outline-none focus:border-[#3867F5]"
              >
                {availableFiscalYears.map((fy) => (
                  <option key={fy} value={fy}>
                    FY {fy}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => fetchAndSyncAllData(true)}
              disabled={syncLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-[#252525] text-white hover:bg-[#37352F] disabled:opacity-50 transition-colors cursor-pointer"
              title="Muat ulang & sinkronkan seluruh modul dari database"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncLoading ? 'animate-spin' : ''}`}
              />
              <span>{syncLoading ? 'Syncing...' : 'Refresh Database'}</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs across the Integrated Modules (Structured 4-Column Grid Without Scrollbar) */}
        <div className="mt-3 p-2 bg-[#FAFAF9] border border-[#EDEDEC] rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
            {workspaceTabs.map((tab, idx) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.desc}
                  className={`group/item flex items-center justify-between px-3 py-1.5 min-h-[34px] rounded border text-left transition-colors duration-150 min-w-0 cursor-pointer ${
                    isActive
                      ? 'border-[#1D4ED8]/40 bg-blue-50/30 ring-1 ring-[#1D4ED8]/20'
                      : 'border-[#EDEDEC] bg-white hover:border-[#D3D3D0] hover:bg-[#F2F1EE]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-1.5">
                    <span className="text-[11px] font-mono font-medium text-[#787774] shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={`text-[12px] truncate ${
                        isActive
                          ? 'font-semibold text-[#1D4ED8]'
                          : 'font-medium text-[#2F3437] group-hover/item:text-[#1D4ED8]'
                      }`}
                    >
                      {tab.label}
                    </span>
                    {tab.badgeCount !== undefined && (
                      <span
                        className={`text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded tabular-nums shrink-0 ${
                          isActive
                            ? 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]'
                            : 'bg-[#F1F0EC] text-[#5F5E5B]'
                        }`}
                      >
                        {tab.badgeCount}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        isActive ? 'text-[#0F7B6C]' : 'text-[#787774]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isActive ? 'bg-[#0F7B6C]' : 'bg-[#D3D3D0]'
                        }`}
                      />
                      <span>{isActive ? 'Aktif' : 'Buka'}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Status Notification Banner */}
      {statusBanner && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-md border text-xs ${
            statusBanner.type === 'success'
              ? 'bg-[#EAF3EC] border-[#B7DFC1] text-[#2B6E3F]'
              : 'bg-[#FDECEC] border-[#F5C2C2] text-[#C93B3B]'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span className="font-medium">{statusBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-current opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Financial KPI Summary Strip (Strictly Traceable to Real Records) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        {/* Card 1: Annual Approved Budget */}
        <div className="bg-white border border-[#E5E5E3] rounded-md p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#787774]">
            <span>ANNUAL APPROVED BUDGET</span>
            <Wallet className="w-3.5 h-3.5 text-[#3867F5]" />
          </div>
          {metrics.isBudgetConfigured ? (
            <>
              <div className="text-sm font-bold text-[#252525] mt-1 font-mono">
                {formatRupiah(metrics.annualApprovedBudget)}
              </div>
              <div className="text-[10px] text-[#787774] mt-1 flex items-center gap-1">
                <span className="font-semibold text-[#252525] uppercase">
                  {dataset.periodStructureType}
                </span>
                <span>•</span>
                <span>{activeSavedPeriods.length} Periode</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-[#B26B00] mt-1">
                Belum Dikonfigurasi (Rp 0)
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('budget-planning')}
                className="text-[10px] font-semibold text-[#3867F5] hover:underline mt-1 inline-flex items-center gap-0.5 cursor-pointer"
              >
                Atur di Master Budget →
              </button>
            </>
          )}
        </div>

        {/* Card 2: Master ToR Approved Budgets */}
        <div className="bg-white border border-[#E5E5E3] rounded-md p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#787774]">
            <span>MASTER ToR BUDGET</span>
            <FileText className="w-3.5 h-3.5 text-[#2851C5]" />
          </div>
          <div className="text-sm font-bold text-[#2851C5] mt-1 font-mono">
            {formatRupiah(
              programTors.reduce(
                (s, t) => s + (Number(t.budgetApproved ?? t.budgetRequested) || 0),
                0
              )
            )}
          </div>
          <div className="text-[10px] text-[#787774] mt-1">
            Dari <strong>{programTors.length}</strong> dokumen ToR terdaftar
          </div>
        </div>

        {/* Card 3: Disbursed Cash Advances */}
        <div className="bg-white border border-[#E5E5E3] rounded-md p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#787774]">
            <span>DISBURSED ADVANCES</span>
            <Banknote className="w-3.5 h-3.5 text-[#37352F]" />
          </div>
          <div className="text-sm font-bold text-[#252525] mt-1 font-mono">
            {formatRupiah(metrics.totalDisbursedAdvances)}
          </div>
          <div className="text-[10px] text-[#787774] mt-1">
            Pending/Review CA: {formatRupiah(metrics.pendingApprovalCommitments)}
          </div>
        </div>

        {/* Card 4: Outstanding Advances */}
        <div className="bg-white border border-[#E5E5E3] rounded-md p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#787774]">
            <span>OUTSTANDING ADVANCES</span>
            <Clock className="w-3.5 h-3.5 text-[#D97706]" />
          </div>
          <div className="text-sm font-bold text-[#B26B00] mt-1 font-mono">
            {formatRupiah(metrics.outstandingDisbursedAdvances)}
          </div>
          <div className="text-[10px] text-[#787774] mt-1">
            Total Komitmen Aktif: {formatRupiah(metrics.outstandingCommitments)}
          </div>
        </div>

        {/* Card 5: Verified Actual Expenditure */}
        <div className="bg-white border border-[#E5E5E3] rounded-md p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#787774]">
            <span>VERIFIED EXPENDITURE</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-[#2B6E3F]" />
          </div>
          <div className="text-sm font-bold text-[#2B6E3F] mt-1 font-mono">
            {formatRupiah(metrics.verifiedActualExpenditure)}
          </div>
          <div className="text-[10px] text-[#787774] mt-1">
            Returned Funds: {formatRupiah(metrics.totalReturnedFunds)}
          </div>
        </div>

        {/* Card 6: Available / Remaining Budget */}
        <div
          className={`border rounded-md p-3 ${
            !metrics.isBudgetConfigured
              ? 'bg-[#FAFAF9] border-[#E5E5E3]'
              : (metrics.availableBudget ?? 0) < 0
              ? 'bg-[#FDECEC] border-[#F5C2C2]'
              : 'bg-[#F2F6FF] border-[#C7D7FE]'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] font-bold text-[#2851C5]">
            <span>REMAINING BUDGET</span>
            <PieChart className="w-3.5 h-3.5 text-[#2851C5]" />
          </div>
          {metrics.isBudgetConfigured && metrics.availableBudget !== null ? (
            <>
              <div
                className={`text-sm font-bold mt-1 font-mono ${
                  metrics.availableBudget < 0
                    ? 'text-[#C93B3B]'
                    : 'text-[#1E3A8A]'
                }`}
              >
                {formatRupiah(metrics.availableBudget)}
              </div>
              <div className="text-[10px] text-[#475569] mt-1 font-mono">
                Annual − Verified − Commitments
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold text-[#787774] mt-1">
                Menunggu Pagu Tahunan
              </div>
              <div className="text-[10px] text-[#787774] mt-1">
                Set Annual Budget di Modul 2
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODULE 7: FINANCIAL DASHBOARD (DEFAULT OVERVIEW & TRACEABILITY)       */}
      {/* ===================================================================== */}
      {activeTab === 'dashboard' && (
        <div className="space-y-4">
          {/* Prompt to configure Annual Budget if not yet configured */}
          {!metrics.isBudgetConfigured && (
            <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#B26B00] shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-[#92400E]">
                    Annual Approved Budget Belum Ditetapkan untuk {selectedProgram?.name} (FY {selectedFiscalYear})
                  </h4>
                  <p className="text-[11px] text-[#B45309] mt-0.5">
                    Sesuai prinsip integritas data (tanpa angka fiktif), sistem tidak menampilkan saldo anggaran simulasi sebelum Anda menetapkan Annual Budget dan alokasi periode di modul <strong>Master Budget</strong>. Seluruh data ToR ({programTors.length}) dan Cash Advance ({programCashAdvances.length}) dari database tetap ditampilkan secara utuh di bawah ini.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('budget-planning')}
                className="px-3 py-1.5 rounded-sm text-xs font-semibold bg-[#B26B00] text-white hover:bg-[#92400E] shrink-0 cursor-pointer"
              >
                Konfigurasi Master Budget →
              </button>
            </div>
          )}

          {/* End-to-End Traceability Chain Overview */}
          <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EAEAEA] flex flex-wrap items-center justify-between gap-2 bg-[#FAFAF9]">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  End-to-End Financial Traceability Matrix (Program → Period → Budget Code → ToR → Cash Advance → Final Report)
                </h3>
                <p className="text-xs text-[#787774]">
                  Setiap baris di bawah ini ditelusuri langsung dari rekaman database aktual tanpa duplikasi atau angka simulasi.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('master-tor')}
                  className="px-2.5 py-1 rounded-sm text-xs font-semibold border border-[#D4D4D0] bg-white text-[#252525] hover:bg-[#F7F7F5] cursor-pointer"
                >
                  Kelola Master ToR ({programTors.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('cash-advance')}
                  className="px-2.5 py-1 rounded-sm text-xs font-semibold border border-[#D4D4D0] bg-white text-[#252525] hover:bg-[#F7F7F5] cursor-pointer"
                >
                  Kelola Cash Advance ({programCashAdvances.length})
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#787774]">
                    <th className="py-2.5 px-3">Periode</th>
                    <th className="py-2.5 px-3">Budget Code</th>
                    <th className="py-2.5 px-3">Master ToR Reference</th>
                    <th className="py-2.5 px-3 text-right">ToR Approved</th>
                    <th className="py-2.5 px-3">Cash Advance Reference</th>
                    <th className="py-2.5 px-3 text-right">CA Amount</th>
                    <th className="py-2.5 px-3">Final Financial Report (LPJ)</th>
                    <th className="py-2.5 px-3 text-right">Verified Actual</th>
                    <th className="py-2.5 px-3 text-right">Returned Funds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {programTors.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-xs text-[#787774]">
                        Belum ada dokumen ToR atau transaksi keuangan pada program ini untuk FY {selectedFiscalYear}.
                      </td>
                    </tr>
                  ) : (
                    programTors.flatMap((tor) => {
                      const matchedPeriod = matchPeriodForDate(
                        activeSavedPeriods,
                        tor.startDate || tor.createdAt
                      );
                      const torCode = tor.activityCode || tor.hierarchyCode || '-';
                      const codeCategory =
                        dataset.masterBudgetCodes.find((c) => c.code === torCode)
                          ?.budgetCategory || tor.activityName;
                      const linkedCas = programCashAdvances.filter(
                        (ca) => ca.torId === tor.id && ca.status !== 'Ditolak'
                      );

                      if (linkedCas.length === 0) {
                        return [
                          <tr key={tor.id} className="hover:bg-[#FAFAF9]">
                            <td className="py-2.5 px-3 font-mono text-[11px] font-bold text-[#2851C5]">
                              {matchedPeriod.code}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-mono font-bold text-[#252525]">
                                {torCode}
                              </span>
                              <div className="text-[10px] text-[#787774] truncate max-w-[160px]">
                                {codeCategory}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-mono font-semibold text-[#252525]">
                                {tor.torNumber}
                              </div>
                              <div className="text-[11px] text-[#5A5A58] truncate max-w-[220px]">
                                {tor.title}
                              </div>
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded-xs text-[10px] font-semibold bg-[#F1F1EF] text-[#5A5A58]">
                                {tor.submissionStatus}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#252525]">
                              {formatRupiah(
                                Number(tor.budgetApproved ?? tor.budgetRequested) || 0
                              )}
                            </td>
                            <td
                              colSpan={5}
                              className="py-2.5 px-3 text-[11px] text-[#9B9A97] italic"
                            >
                              Belum ada Cash Advance yang diajukan untuk ToR ini
                            </td>
                          </tr>,
                        ];
                      }

                      return linkedCas.map((ca, idx) => {
                        const isVerifiedLpj = Boolean(
                          ca.isReported &&
                            ca.reportApprovalStatus === 'Telah Disetujui'
                        );
                        const verifiedActual = isVerifiedLpj
                          ? Number(ca.realizedAmount ?? ca.totalAmount) || 0
                          : 0;
                        const returnedAmt = isVerifiedLpj
                          ? Math.max(0, (Number(ca.totalAmount) || 0) - verifiedActual)
                          : 0;

                        return (
                          <tr
                            key={`${tor.id}-${ca.id}`}
                            className="hover:bg-[#FAFAF9]"
                          >
                            <td className="py-2.5 px-3 font-mono text-[11px] font-bold text-[#2851C5]">
                              {matchedPeriod.code}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-mono font-bold text-[#252525]">
                                {ca.items?.[0]?.budgetCode || torCode}
                              </span>
                              <div className="text-[10px] text-[#787774] truncate max-w-[160px]">
                                {codeCategory}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-mono font-semibold text-[#252525]">
                                {tor.torNumber}
                              </div>
                              <div className="text-[11px] text-[#5A5A58] truncate max-w-[200px]">
                                {tor.title}
                              </div>
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded-xs text-[10px] font-semibold bg-[#F1F1EF] text-[#5A5A58]">
                                ToR: {tor.submissionStatus}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[#252525]">
                              {idx === 0
                                ? formatRupiah(
                                    Number(
                                      tor.budgetApproved ?? tor.budgetRequested
                                    ) || 0
                                  )
                                : '↳ (sama)'}
                            </td>
                            <td className="py-2.5 px-3">
                              <button
                                type="button"
                                onClick={() => setSelectedCaDetail(ca)}
                                className="font-mono font-semibold text-[#2851C5] hover:underline cursor-pointer text-left"
                              >
                                {ca.advanceNumber}
                              </button>
                              <div className="text-[10px] text-[#787774]">
                                Pemohon: {ca.requesterName} • Status:{' '}
                                <strong className="text-[#252525]">
                                  {ca.status}
                                </strong>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#252525]">
                              {formatRupiah(ca.totalAmount)}
                            </td>
                            <td className="py-2.5 px-3">
                              {ca.isReported ? (
                                <div>
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[10px] font-semibold ${
                                      isVerifiedLpj
                                        ? 'bg-[#EAF3EC] text-[#2B6E3F]'
                                        : 'bg-[#FFF8E6] text-[#B26B00]'
                                    }`}
                                  >
                                    {ca.reportApprovalStatus ||
                                      'Menunggu Pemeriksaan Finance'}
                                  </span>
                                  <div className="text-[10px] text-[#787774] mt-0.5 font-mono">
                                    Dilaporkan: {formatRupiah(ca.realizedAmount || 0)}
                                  </div>
                                </div>
                              ) : ca.status === 'Dicairkan' ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenCloseReportModal(ca)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[10px] font-semibold bg-[#FFF8E6] text-[#B26B00] border border-[#F5D996] hover:bg-[#FEF0C7] cursor-pointer"
                                >
                                  Outstanding Advance • Buat LPJ →
                                </button>
                              ) : (
                                <span className="text-[11px] text-[#9B9A97]">
                                  Menunggu Pencairan CA
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#2B6E3F]">
                              {isVerifiedLpj ? formatRupiah(verifiedActual) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[#2851C5]">
                              {isVerifiedLpj ? formatRupiah(returnedAmt) : '—'}
                            </td>
                          </tr>
                        );
                      });
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Breakdown by Budget Period & by Master Budget Code */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Performance by Budget Period */}
            <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
              <div className="px-4 py-3 border-b border-[#EAEAEA] flex items-center justify-between bg-[#FAFAF9]">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#252525]">
                    Performa per Periode Anggaran ({dataset.periodStructureType.toUpperCase()})
                  </h3>
                  <p className="text-[11px] text-[#787774]">
                    Alokasi periode vs ToR, Komitmen CA, dan Pengeluaran Terverifikasi
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('budget-planning')}
                  className="text-xs font-semibold text-[#3867F5] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Atur Alokasi</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[10px] font-bold uppercase text-[#787774]">
                      <th className="py-2 px-3">Periode</th>
                      <th className="py-2 px-3 text-right">Alokasi</th>
                      <th className="py-2 px-3 text-right">ToR ({programTors.length})</th>
                      <th className="py-2 px-3 text-right">Komitmen CA</th>
                      <th className="py-2 px-3 text-right">Verified Spent</th>
                      <th className="py-2 px-3 text-right">Sisa Periode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAEAEA]">
                    {periodPerformanceRows.map((row) => (
                      <tr key={row.period.id} className="hover:bg-[#FAFAF9]">
                        <td className="py-2 px-3">
                          <span className="font-mono font-bold text-[#2851C5]">
                            {row.period.code}
                          </span>
                          <div className="text-[10px] text-[#787774]">
                            {row.period.startDate} s/d {row.period.endDate}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {row.period.allocatedAmount > 0 ? (
                            formatRupiah(row.period.allocatedAmount)
                          ) : (
                            <span className="text-[#9B9A97]">Belum diatur</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[#2851C5]">
                          {formatRupiah(row.torApprovedSum)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[#B26B00]">
                          {formatRupiah(row.outstanding)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-[#2B6E3F]">
                          {formatRupiah(row.verifiedSpent)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {row.available !== null ? (
                            <span
                              className={
                                row.available < 0
                                  ? 'text-[#C93B3B]'
                                  : 'text-[#252525]'
                              }
                            >
                              {formatRupiah(row.available)}
                            </span>
                          ) : (
                            <span className="text-[#9B9A97]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Performance by Master Budget Code */}
            <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
              <div className="px-4 py-3 border-b border-[#EAEAEA] flex items-center justify-between bg-[#FAFAF9]">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#252525]">
                    Performa per Master Budget Code
                  </h3>
                  <p className="text-[11px] text-[#787774]">
                    Realisasi & komitmen berdasarkan kode anggaran yang terdaftar
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('master-budget')}
                  className="text-xs font-semibold text-[#3867F5] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Kelola Kode</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[10px] font-bold uppercase text-[#787774]">
                      <th className="py-2 px-3">Code</th>
                      <th className="py-2 px-3">Budget Category</th>
                      <th className="py-2 px-3 text-right">ToR Budget</th>
                      <th className="py-2 px-3 text-right">Komitmen CA</th>
                      <th className="py-2 px-3 text-right">Verified Spent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAEAEA]">
                    {codePerformanceRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-6 text-center text-xs text-[#787774]"
                        >
                          Belum ada Master Budget Code pada program ini.
                        </td>
                      </tr>
                    ) : (
                      codePerformanceRows.map((row) => (
                        <tr
                          key={row.masterCode.id}
                          className="hover:bg-[#FAFAF9]"
                        >
                          <td className="py-2 px-3 font-mono font-bold text-[#252525]">
                            {row.masterCode.code}
                          </td>
                          <td className="py-2 px-3 font-medium text-[#252525]">
                            {row.masterCode.budgetCategory}
                            <div className="text-[10px] text-[#787774]">
                              {row.torCount} ToR • {row.txCount} CA
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-[#2851C5]">
                            {formatRupiah(row.torBudgetApproved)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-[#B26B00]">
                            {formatRupiah(row.outstanding)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-[#2B6E3F]">
                            {formatRupiah(row.verifiedSpent)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Cross-Program Summary Table */}
          <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EAEAEA] bg-[#FAFAF9] flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#252525]">
                  Ringkasan Lintas Program (FY {selectedFiscalYear})
                </h3>
                <p className="text-[11px] text-[#787774]">
                  Klik program mana pun untuk beralih fokus pengelolaan anggaran
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[10px] font-bold uppercase text-[#787774]">
                    <th className="py-2 px-3">Program</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Annual Budget</th>
                    <th className="py-2 px-3 text-right">Master ToR ({tors.length})</th>
                    <th className="py-2 px-3 text-right">Outstanding CA</th>
                    <th className="py-2 px-3 text-right">Verified Spent</th>
                    <th className="py-2 px-3 text-right">Available Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {crossProgramComparison.map((item) => {
                    const isCurrent = item.program.id === selectedProgram?.id;
                    return (
                      <tr
                        key={item.program.id}
                        onClick={() => setSelectedProgramId(item.program.id)}
                        className={`cursor-pointer transition-colors ${
                          isCurrent ? 'bg-[#F2F6FF]' : 'hover:bg-[#FAFAF9]'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-semibold text-[#252525]">
                          {item.program.name}
                          <div className="text-[10px] text-[#787774] font-normal">
                            PIC: {item.program.picName || '-'} • {item.program.location}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-xs text-[10px] font-semibold bg-[#F1F1EF] text-[#37352F]">
                            {item.program.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold">
                          {item.metrics.isBudgetConfigured ? (
                            formatRupiah(item.metrics.annualApprovedBudget)
                          ) : (
                            <span className="text-[#9B9A97] font-normal">
                              Belum diatur
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#2851C5]">
                          {formatRupiah(item.torApprovedTotal)} ({item.torCount} ToR)
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#B26B00]">
                          {formatRupiah(item.metrics.outstandingCommitments)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#2B6E3F]">
                          {formatRupiah(item.metrics.verifiedActualExpenditure)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          {item.metrics.availableBudget !== null ? (
                            formatRupiah(item.metrics.availableBudget)
                          ) : (
                            <span className="text-[#9B9A97] font-normal">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODULE 1: PROGRAM MASTER & STRUKTUR HIERARKI PROGRAM TERINTEGRASI     */}
      {/* ===================================================================== */}
      {activeTab === 'program-master' && (
        <ProgramStructureView
          programs={programs}
          outcomes={outcomes}
          outputs={outputs}
          activities={activities}
          subActivities={subActivities}
          tors={tors}
          onRefresh={() => {
            onRefreshData?.();
            fetchAndSyncAllData(false);
          }}
          onSelectTor={onSelectTor}
          onOpenCreateTorForActivity={
            onCreateTor
              ? (ocId, opId, actId) =>
                  onCreateTor({
                    outcomeId: ocId,
                    outputId: opId,
                    activityId: actId,
                  })
              : undefined
          }
          embeddedInFinanceWorkspace={true}
          externalSelectedProgramId={selectedProgram?.id}
          onExternalSelectProgramId={(progId) => setSelectedProgramId(progId)}
          externalFiscalYear={selectedFiscalYear}
          onExternalChangeFiscalYear={(fy) => setSelectedFiscalYear(fy)}
          onNavigateToFinanceTab={(tab) => setActiveTab(tab)}
        />
      )}

      {/* ===================================================================== */}
      {/* MODULE 2: MASTER BUDGET (ANNUAL BUDGET & EXCLUSIVE PERIOD STRUCTURE)  */}
      {/* ===================================================================== */}
      {activeTab === 'budget-planning' && (
        <div className="bg-white border border-[#E5E5E3] rounded-md p-4 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[#EAEAEA]">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-xs text-[10px] font-bold bg-[#252525] text-white uppercase">
                  MODUL 2 • MASTER BUDGET
                </span>
                <span className="text-xs text-[#787774]">
                  {dataset.programName} (FY {selectedFiscalYear})
                </span>
              </div>
              <h3 className="text-sm font-bold text-[#252525] mt-1">
                Konfigurasi Annual Program Budget & Struktur Periode Anggaran
              </h3>
              <p className="text-xs text-[#787774]">
                Pilih tepat satu struktur periode (Quarterly, Semester, atau Custom Period) dan alokasikan anggaran tahunan secara proporsional.
              </p>
            </div>
            {canEditFinance && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveBudgetAndPeriods}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-sm text-xs font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Simpan Master Budget</span>
                </button>
              </div>
            )}
          </div>

          {/* Step 3 & Step 4 Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3.5 rounded-md bg-[#F7F7F5] border border-[#E5E5E3]">
              <label className="block text-xs font-bold text-[#252525] mb-1">
                Total Program Budget (IDR)
              </label>
              <p className="text-[11px] text-[#787774] mb-2">
                Total keseluruhan anggaran multi-tahun untuk {dataset.programName}.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#787774]">
                  Rp
                </span>
                <input
                  type="number"
                  min={0}
                  step={500000}
                  disabled={!canEditFinance}
                  value={draftTotalProgramBudget || ''}
                  placeholder="Masukkan Total Program Budget"
                  onChange={(e) =>
                    setDraftTotalProgramBudget(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono font-bold text-[#252525] bg-white border border-[#D4D4D0] rounded-sm focus:outline-none focus:border-[#3867F5]"
                />
              </div>
              <div className="mt-1.5 text-[11px] text-[#5A5A58] font-mono">
                {draftTotalProgramBudget > 0 ? (
                  <>
                    Terformat: <strong>{formatRupiah(draftTotalProgramBudget)}</strong>
                  </>
                ) : (
                  <span className="text-[#787774] font-sans">Belum diisi</span>
                )}
              </div>
            </div>

            <div className="p-3.5 rounded-md bg-[#F7F7F5] border border-[#E5E5E3]">
              <div className="flex items-center justify-between gap-1 mb-1">
                <label className="block text-xs font-bold text-[#252525]">
                  Annual Budget (FY {selectedFiscalYear})
                </label>
                <span className="px-1.5 py-0.5 rounded-xs text-[9.5px] font-bold bg-[#E8F0FE] text-[#2851C5] uppercase">
                  Otomatis dari Periode
                </span>
              </div>
              <p className="text-[11px] text-[#787774] mb-2">
                Dihitung otomatis dari jumlah seluruh periode pada FY {selectedFiscalYear}.
              </p>
              <div className="px-3 py-2 text-sm font-mono font-bold text-[#2851C5] bg-white border border-[#D4D4D0] rounded-sm">
                {draftTotalPeriodAllocated > 0
                  ? formatRupiah(draftTotalPeriodAllocated)
                  : 'Rp 0 (Belum ada nominal periode)'}
              </div>
              <div className="mt-1.5 text-[11px] text-[#5A5A58]">
                Jumlah otomatis dari <strong>{activeDraftPeriods.length} periode</strong>
              </div>
            </div>

            <div className="p-3.5 rounded-md bg-[#F7F7F5] border border-[#E5E5E3]">
              <label className="block text-xs font-bold text-[#252525] mb-1">
                Struktur Periode Anggaran (Eksklusif)
              </label>
              <p className="text-[11px] text-[#787774] mb-2">
                Pilih satu struktur periode: Quarter, Semester, atau Custom Period.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'quarterly',
                      title: 'Quarter',
                      sub: '4 Kuartal (Q1–Q4)',
                    },
                    {
                      id: 'semester',
                      title: 'Semester',
                      sub: '2 Semester (S1–S2)',
                    },
                    {
                      id: 'custom',
                      title: 'Custom Period',
                      sub: 'Periode Fleksibel',
                    },
                  ] as const
                ).map((opt) => {
                  const selected = draftStructureType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!canEditFinance}
                      onClick={() => setDraftStructureType(opt.id)}
                      className={`p-2.5 rounded-sm border text-left transition-all cursor-pointer ${
                        selected
                          ? 'bg-[#252525] text-white border-[#252525]'
                          : 'bg-white text-[#252525] border-[#D4D4D0] hover:bg-[#F1F1EF]'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.title}</div>
                      <div
                        className={`text-[10px] mt-0.5 ${
                          selected ? 'text-[#D4D4D0]' : 'text-[#787774]'
                        }`}
                      >
                        {opt.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Info Bar: Annual Budget == Sum of Period Allocations */}
          <div
            className={`p-3 rounded-md border flex flex-wrap items-center justify-between gap-2 text-xs ${
              draftTotalPeriodAllocated === 0
                ? 'bg-[#FFF8E6] border-[#F5D996] text-[#8F5300]'
                : 'bg-[#EAF3EC] border-[#B7DFC1] text-[#2B6E3F]'
            }`}
          >
            <div className="flex items-center gap-2">
              {draftTotalPeriodAllocated > 0 ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>
                {draftTotalPeriodAllocated === 0 ? (
                  `Belum ada nominal anggaran periode untuk FY ${selectedFiscalYear}. Silakan isi nominal anggaran pada setiap periode di bawah ini.`
                ) : (
                  <>
                    <strong>Annual Budget FY {selectedFiscalYear}:</strong> Otomatis merefleksikan jumlah seluruh periode{' '}
                    <span className="uppercase font-bold">
                      ({draftStructureType === 'quarterly' ? 'Quarter' : draftStructureType === 'semester' ? 'Semester' : 'Custom Period'})
                    </span>{' '}
                    yang diinput.
                  </>
                )}
              </span>
            </div>
            <div className="font-mono font-bold">
              Annual Budget FY {selectedFiscalYear}: {formatRupiah(draftTotalPeriodAllocated)}
            </div>
          </div>

          {/* Period Allocation Table */}
          <div className="border border-[#E5E5E3] rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-[#FAFAF9] border-b border-[#E5E5E3] flex items-center justify-between">
              <span className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                Tabel Alokasi Periode ({draftStructureType.toUpperCase()})
              </span>
              {draftStructureType === 'custom' && canEditFinance && (
                <button
                  type="button"
                  onClick={handleAddCustomPeriod}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xs text-xs font-semibold bg-[#252525] text-white hover:bg-[#37352F] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Custom Period</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#787774]">
                    <th className="py-2.5 px-4">Kode</th>
                    <th className="py-2.5 px-4">Nama Periode</th>
                    <th className="py-2.5 px-4">Rentang Tanggal</th>
                    <th className="py-2.5 px-4 text-right">
                      Alokasi Anggaran (IDR)
                    </th>
                    <th className="py-2.5 px-4 text-right">Proporsi</th>
                    {draftStructureType === 'custom' && canEditFinance && (
                      <th className="py-2.5 px-4 text-center">Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {activeDraftPeriods.map((period) => {
                    const share =
                      draftAnnualBudget > 0
                        ? Math.round(
                            ((Number(period.allocatedAmount) || 0) /
                              draftAnnualBudget) *
                              1000
                          ) / 10
                        : 0;
                    return (
                      <tr key={period.id} className="hover:bg-[#FAFAF9]">
                        <td className="py-2.5 px-4 font-mono font-bold text-[#2851C5]">
                          {draftStructureType === 'custom' && canEditFinance ? (
                            <input
                              type="text"
                              value={period.code}
                              onChange={(e) =>
                                handleUpdateCustomPeriodMeta(
                                  period.id,
                                  'code',
                                  e.target.value
                                )
                              }
                              className="w-16 px-2 py-1 text-xs font-mono border border-[#D4D4D0] rounded-xs"
                            />
                          ) : (
                            period.code
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-[#252525]">
                          {draftStructureType === 'custom' && canEditFinance ? (
                            <input
                              type="text"
                              value={period.label}
                              onChange={(e) =>
                                handleUpdateCustomPeriodMeta(
                                  period.id,
                                  'label',
                                  e.target.value
                                )
                              }
                              className="w-full px-2 py-1 text-xs border border-[#D4D4D0] rounded-xs"
                            />
                          ) : (
                            period.label
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-[#787774]">
                          {draftStructureType === 'custom' && canEditFinance ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="date"
                                value={period.startDate}
                                onChange={(e) =>
                                  handleUpdateCustomPeriodMeta(
                                    period.id,
                                    'startDate',
                                    e.target.value
                                  )
                                }
                                className="px-2 py-1 text-xs border border-[#D4D4D0] rounded-xs"
                              />
                              <span>s/d</span>
                              <input
                                type="date"
                                value={period.endDate}
                                onChange={(e) =>
                                  handleUpdateCustomPeriodMeta(
                                    period.id,
                                    'endDate',
                                    e.target.value
                                  )
                                }
                                className="px-2 py-1 text-xs border border-[#D4D4D0] rounded-xs"
                              />
                            </div>
                          ) : (
                            `${period.startDate} s/d ${period.endDate}`
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <input
                            type="number"
                            min={0}
                            step={500000}
                            disabled={!canEditFinance}
                            value={period.allocatedAmount || ''}
                            placeholder="0"
                            onChange={(e) =>
                              handleUpdateDraftPeriodAmount(
                                period.id,
                                Number(e.target.value)
                              )
                            }
                            className="w-44 text-right px-2.5 py-1.5 text-xs font-mono font-bold text-[#252525] bg-white border border-[#D4D4D0] rounded-xs focus:outline-none focus:border-[#3867F5]"
                          />
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#5A5A58]">
                          {share}%
                        </td>
                        {draftStructureType === 'custom' && canEditFinance && (
                          <td className="py-2.5 px-4 text-center">
                            <button
                              type="button"
                              disabled={draftCustom.length <= 1}
                              onClick={() => handleRemoveCustomPeriod(period.id)}
                              className="text-[#C93B3B] hover:opacity-80 disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODULE 3: MASTER BUDGET CODE (EXACT 2-COLUMN TABLE & EXCEL IMPORT)    */}
      {/* ===================================================================== */}
      {activeTab === 'master-budget' && (
        <div className="bg-white border border-[#E5E5E3] rounded-md p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-3 border-b border-[#EAEAEA]">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-xs text-[10px] font-bold bg-[#252525] text-white uppercase">
                  MODUL 3 • MASTER BUDGET CODE
                </span>
                <span className="text-xs text-[#787774]">
                  {dataset.programName} (FY {selectedFiscalYear})
                </span>
              </div>
              <h3 className="text-sm font-bold text-[#252525] mt-1">
                Master Budget Code (2-Column Structure: Code | Budget Category)
              </h3>
              <p className="text-xs text-[#787774]">
                Daftar kode anggaran resmi yang digunakan bersama oleh Master ToR, Cash Advance, dan Final Financial Report.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari Code / Category..."
                  value={codeSearch}
                  onChange={(e) => setCodeSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-[#F7F7F5] border border-[#D4D4D0] rounded-sm focus:outline-none focus:bg-white focus:border-[#3867F5]"
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  downloadMasterBudgetExcelTemplate(
                    dataset.programName,
                    dataset.masterBudgetCodes
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold border border-[#D4D4D0] bg-white text-[#252525] hover:bg-[#F7F7F5] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#2B6E3F]" />
                <span>Download Template (.xlsx)</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelFileSelected}
                className="hidden"
              />

              {canEditFinance && (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold border border-[#2B6E3F] bg-[#EAF3EC] text-[#2B6E3F] hover:bg-[#D8ECDD] cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Import Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenAddCode}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Code</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Strict 2-Column Master Budget Code Table (Code | Budget Category) */}
          <div className="border border-[#E5E5E3] rounded-md overflow-hidden max-w-3xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#252525]">
                  <th className="py-2.5 px-4 w-44 border-r border-[#E5E5E3]">
                    Code
                  </th>
                  <th className="py-2.5 px-4">Budget Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAEAEA]">
                {filteredMasterCodes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2}
                      className="py-8 text-center text-xs text-[#787774]"
                    >
                      Belum ada Master Budget Code yang terdaftar untuk program ini. Gunakan tombol <strong>Add Code</strong> atau <strong>Import Excel</strong>.
                    </td>
                  </tr>
                ) : (
                  filteredMasterCodes.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-[#FAFAF9] group transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono font-bold text-[#252525] border-r border-[#EAEAEA]">
                        {item.code}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[#252525]">
                            {item.budgetCategory}
                          </span>
                          {canEditFinance && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditCode(item)}
                                className="p-1 text-[#787774] hover:text-[#252525] cursor-pointer"
                                title="Edit Code"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMasterCode(item)}
                                className="p-1 text-[#787774] hover:text-[#C93B3B] cursor-pointer"
                                title="Delete Code"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODULE 4: MASTER ToR (CONNECTED TO PROGRAM, PERIOD & BUDGET CODE)     */}
      {/* ===================================================================== */}
      {activeTab === 'master-tor' && (
        <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[#EAEAEA] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#FAFAF9]">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-xs text-[10px] font-bold bg-[#252525] text-white uppercase">
                  MODUL 4 • MASTER ToR
                </span>
                <span className="text-xs text-[#787774]">
                  {dataset.programName} (FY {selectedFiscalYear})
                </span>
              </div>
              <h3 className="text-sm font-bold text-[#252525] mt-1">
                Master Terms of Reference (ToR) Terhubung ({programTors.length} Dokumen)
              </h3>
              <p className="text-xs text-[#787774]">
                Setiap ToR terhubung langsung ke Program, Periode Anggaran, Master Budget Code, serta menjadi dasar pengajuan Cash Advance.
              </p>
            </div>
            {onCreateTor && (
              <button
                type="button"
                onClick={() => onCreateTor()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-sm text-xs font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buat Dokumen ToR Baru</span>
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#787774]">
                  <th className="py-2.5 px-3">Nomor & Judul ToR</th>
                  <th className="py-2.5 px-3">Periode Anggaran</th>
                  <th className="py-2.5 px-3">Master Budget Code</th>
                  <th className="py-2.5 px-3">Status ToR</th>
                  <th className="py-2.5 px-3 text-right">ToR Budget Approved</th>
                  <th className="py-2.5 px-3 text-right">Total Cash Advance</th>
                  <th className="py-2.5 px-3 text-right">Verified Spent</th>
                  <th className="py-2.5 px-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAEAEA]">
                {programTors.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-xs text-[#787774]"
                    >
                      Belum ada dokumen ToR untuk {dataset.programName} pada FY{' '}
                      {selectedFiscalYear}.
                    </td>
                  </tr>
                ) : (
                  programTors.map((tor) => {
                    const matchedPeriod = matchPeriodForDate(
                      activeSavedPeriods,
                      tor.startDate || tor.createdAt
                    );
                    const budgetCode =
                      tor.activityCode || tor.hierarchyCode || '-';
                    const matchedCodeObj = dataset.masterBudgetCodes.find(
                      (c) => c.code === budgetCode
                    );
                    const linkedCas = programCashAdvances.filter(
                      (ca) =>
                        ca.torId === tor.id &&
                        ca.status !== 'Ditolak' &&
                        ca.status !== 'Draft'
                    );
                    const caSum = linkedCas.reduce(
                      (s, c) => s + (Number(c.totalAmount) || 0),
                      0
                    );
                    const verifiedCas = linkedCas.filter(
                      (c) =>
                        c.isReported &&
                        c.reportApprovalStatus === 'Telah Disetujui'
                    );
                    const verifiedSum = verifiedCas.reduce(
                      (s, c) =>
                        s + (Number(c.realizedAmount ?? c.totalAmount) || 0),
                      0
                    );

                    return (
                      <tr key={tor.id} className="hover:bg-[#FAFAF9]">
                        <td className="py-3 px-3">
                          <div className="font-mono font-bold text-[#2851C5]">
                            {tor.torNumber}
                          </div>
                          <div className="font-semibold text-[#252525] mt-0.5">
                            {tor.title}
                          </div>
                          <div className="text-[10px] text-[#787774] mt-0.5">
                            PIC: {tor.picName} • Pelaksanaan: {tor.startDate} s/d{' '}
                            {tor.endDate}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-mono font-bold text-[#2851C5] bg-[#EEF3FF] px-2 py-0.5 rounded-xs">
                            {matchedPeriod.code}
                          </span>
                          <div className="text-[10px] text-[#787774] mt-0.5">
                            {matchedPeriod.label}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-mono font-bold text-[#252525] bg-[#F1F1EF] px-2 py-0.5 rounded-xs">
                            {budgetCode}
                          </span>
                          <div className="text-[10px] text-[#787774] mt-0.5 max-w-[180px] truncate">
                            {matchedCodeObj?.budgetCategory || tor.activityName}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-xs text-[10px] font-semibold ${
                              tor.submissionStatus === 'Disetujui'
                                ? 'bg-[#EAF3EC] text-[#2B6E3F]'
                                : tor.submissionStatus === 'Perlu Perbaikan' ||
                                  tor.submissionStatus === 'Ditolak'
                                ? 'bg-[#FDECEC] text-[#C93B3B]'
                                : 'bg-[#FFF8E6] text-[#B26B00]'
                            }`}
                          >
                            {tor.submissionStatus}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-[#252525]">
                          {formatRupiah(
                            Number(tor.budgetApproved ?? tor.budgetRequested) || 0
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-[#B26B00]">
                          {formatRupiah(caSum)}
                          <div className="text-[10px] text-[#787774]">
                            {linkedCas.length} dokumen CA
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-[#2B6E3F]">
                          {formatRupiah(verifiedSum)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <div className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                setCaFormInitialTorId(tor.id);
                                setEditingCaRecord(null);
                                setShowCaFormModal(true);
                              }}
                              className="px-2 py-1 rounded-xs text-[11px] font-semibold bg-[#252525] text-white hover:bg-[#37352F] cursor-pointer"
                            >
                              + Cash Advance
                            </button>
                            {canEditFinance && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditTorBudget(tor)}
                                className="p-1.5 rounded-xs border border-[#D4D4D0] text-[#5A5A58] hover:text-[#252525] hover:bg-white cursor-pointer"
                                title="Edit Pagu & Kode Anggaran ToR"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onSelectTor && (
                              <button
                                type="button"
                                onClick={() => onSelectTor(tor.id, 1)}
                                className="p-1.5 rounded-xs border border-[#D4D4D0] text-[#2851C5] hover:bg-[#EEF3FF] cursor-pointer"
                                title="Buka Detail Dokumen ToR"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODULE 5: CASH ADVANCE (AUTOMATICALLY REFERENCES ToR, PROGRAM & CODE) */}
      {/* ===================================================================== */}
      {activeTab === 'cash-advance' && (
        <div className="bg-white border border-[#E5E5E3] rounded-md p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-3 border-b border-[#EAEAEA]">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-xs text-[10px] font-bold bg-[#252525] text-white uppercase">
                  MODUL 5 • CASH ADVANCE
                </span>
                <span className="text-xs text-[#787774]">
                  {dataset.programName} (FY {selectedFiscalYear})
                </span>
              </div>
              <h3 className="text-sm font-bold text-[#252525] mt-1">
                Daftar Pengajuan, Verifikasi, Persetujuan & Pencairan Cash Advance ({programCashAdvances.length} Rekaman)
              </h3>
              <p className="text-xs text-[#787774]">
                Setiap Cash Advance otomatis merujuk pada Master ToR, Program, Periode Anggaran, dan Master Budget Code.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCaFormInitialTorId(programTors[0]?.id);
                  setEditingCaRecord(null);
                  setShowCaFormModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buat Cash Advance</span>
              </button>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {[
                { id: 'all', label: `Semua (${(dataset.transactions || []).length})` },
                {
                  id: 'pending',
                  label: `Menunggu Verifikasi/Approve (${
                    (dataset.transactions || []).filter(
                      (t) => t.reconciliationStatus === 'Pending Verification'
                    ).length
                  })`,
                },
                {
                  id: 'outstanding',
                  label: `Dicairkan / Outstanding (${
                    (dataset.transactions || []).filter(
                      (t) => t.reconciliationStatus === 'Outstanding Advance'
                    ).length
                  })`,
                },
                {
                  id: 'reconciled',
                  label: `LPJ Selesai (${
                    dataset.transactions.filter(
                      (t) => t.reconciliationStatus === 'Verified & Reconciled'
                    ).length
                  })`,
                },
              ].map((flt) => (
                <button
                  key={flt.id}
                  type="button"
                  onClick={() => setTxFilterStatus(flt.id)}
                  className={`px-2.5 py-1 rounded-sm text-xs font-semibold border cursor-pointer ${
                    txFilterStatus === flt.id
                      ? 'bg-[#252525] text-white border-[#252525]'
                      : 'bg-[#F7F7F5] text-[#5A5A58] border-[#D4D4D0] hover:bg-[#EAEAE8]'
                  }`}
                >
                  {flt.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari nomor CA, ToR, kegiatan, kode..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-[#F7F7F5] border border-[#D4D4D0] rounded-sm focus:outline-none focus:bg-white focus:border-[#3867F5] w-64"
              />
            </div>
          </div>

          {/* Cash Advance Records Table */}
          <div className="border border-[#E5E5E3] rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#787774]">
                    <th className="py-2.5 px-3">Nomor Cash Advance</th>
                    <th className="py-2.5 px-3">Master ToR & Kegiatan</th>
                    <th className="py-2.5 px-3">Periode & Budget Code</th>
                    <th className="py-2.5 px-3 text-right">Nominal CA</th>
                    <th className="py-2.5 px-3">Status Pencairan & LPJ</th>
                    <th className="py-2.5 px-3 text-center">Tindakan Otorisasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-xs text-[#787774]"
                      >
                        Tidak ada rekaman Cash Advance yang sesuai dengan filter.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const rawCa = cashAdvances.find(
                        (c) => c.id === tx.cashAdvanceId
                      );
                      const periodObj = activeSavedPeriods.find(
                        (p) => p.id === tx.periodId
                      );
                      const isBusy = caActionBusyId === tx.cashAdvanceId;

                      return (
                        <tr key={tx.id} className="hover:bg-[#FAFAF9]">
                          <td className="py-3 px-3">
                            <div className="font-mono font-bold text-[#2851C5]">
                              {tx.parentCashAdvanceRef || tx.referenceNumber}
                            </div>
                            <div className="text-[10px] text-[#787774] mt-0.5">
                              Tanggal: {tx.transactionDate} • Pemohon:{' '}
                              {tx.requesterName}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-[#252525]">
                              {tx.activityTitle}
                            </div>
                            <div className="text-[10px] text-[#2851C5] font-mono mt-0.5">
                              ToR: {tx.torNumber}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-[#2851C5] bg-[#EEF3FF] px-1.5 py-0.5 rounded-xs text-[10px]">
                                {periodObj?.code || 'Q4'}
                              </span>
                              <span className="font-mono font-bold text-[#252525] bg-[#F1F1EF] px-1.5 py-0.5 rounded-xs text-[10px]">
                                {tx.budgetCode}
                              </span>
                            </div>
                            <div className="text-[10px] text-[#787774] mt-0.5 truncate max-w-[180px]">
                              {tx.budgetCategory}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-[#252525]">
                            {formatRupiah(tx.advanceApprovedAmount)}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[10px] font-semibold ${
                                tx.cashAdvanceStatus === 'Dicairkan'
                                  ? 'bg-[#EAF3EC] text-[#2B6E3F]'
                                  : tx.cashAdvanceStatus === 'Disetujui'
                                  ? 'bg-[#EEF3FF] text-[#2851C5]'
                                  : 'bg-[#FFF8E6] text-[#B26B00]'
                              }`}
                            >
                              CA: {tx.cashAdvanceStatus}
                            </span>
                            <div className="text-[10px] text-[#787774] mt-0.5">
                              {tx.reconciliationStatus}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                              {rawCa && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedCaDetail(rawCa)}
                                  className="px-2 py-1 rounded-xs text-[11px] font-semibold border border-[#D4D4D0] bg-white text-[#252525] hover:bg-[#F7F7F5] cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>Detail</span>
                                </button>
                              )}

                              {/* Disbursement Action */}
                              {rawCa &&
                                rawCa.status === 'Disetujui' &&
                                (isFinance || isDirector || isAdmin) && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => {
                                      setDisbursingCa(rawCa);
                                      setDisburseRefNumber(
                                        `TRF-WIJNA-${Date.now().toString().slice(-6)}`
                                      );
                                    }}
                                    className="px-2 py-1 rounded-xs text-[11px] font-semibold bg-[#252525] text-white hover:bg-[#37352F] cursor-pointer disabled:opacity-50"
                                  >
                                    Cairkan Dana
                                  </button>
                                )}

                              {/* Submit LPJ Action if Disbursed */}
                              {rawCa &&
                                rawCa.status === 'Dicairkan' &&
                                !rawCa.isReported && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenCloseReportModal(rawCa)
                                    }
                                    className="px-2 py-1 rounded-xs text-[11px] font-semibold bg-[#B26B00] text-white hover:bg-[#92400E] cursor-pointer"
                                  >
                                    Buat Final Report (LPJ)
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODULE 6: FINAL FINANCIAL REPORT (CONNECTED TO CA & ToR)              */}
      {/* ===================================================================== */}
      {activeTab === 'laporan-keuangan' && (
        <div className="space-y-4">
          {/* Section A: Disbursed Cash Advances Awaiting Final Financial Report */}
          <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EAEAEA] bg-[#FFFBEB] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-xs text-[10px] font-bold bg-[#B26B00] text-white uppercase">
                    MODUL 6A • OUTSTANDING CASH ADVANCES
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#92400E] mt-1">
                  Cash Advance Dicairkan yang Menunggu Final Financial Report (LPJ)
                </h3>
                <p className="text-xs text-[#B45309]">
                  Rekaman Cash Advance yang sudah dicairkan (status: Dicairkan) dan wajib dipertanggungjawabkan dengan pengeluaran aktual serta pengembalian sisa dana.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#787774]">
                    <th className="py-2.5 px-4">Cash Advance Reference</th>
                    <th className="py-2.5 px-4">Master ToR & Kegiatan</th>
                    <th className="py-2.5 px-4">Budget Code</th>
                    <th className="py-2.5 px-4 text-right">Disbursed Amount</th>
                    <th className="py-2.5 px-4">Batas Pelaporan (H+7)</th>
                    <th className="py-2.5 px-4 text-center">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {programCashAdvances.filter(
                    (ca) => ca.status === 'Dicairkan' && !ca.isReported
                  ).length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-6 text-center text-xs text-[#787774]"
                      >
                        Tidak ada Cash Advance berstatus Dicairkan yang belum memiliki Final Financial Report pada program ini.
                      </td>
                    </tr>
                  ) : (
                    programCashAdvances
                      .filter((ca) => ca.status === 'Dicairkan' && !ca.isReported)
                      .map((ca) => (
                        <tr key={ca.id} className="hover:bg-[#FAFAF9]">
                          <td className="py-3 px-4 font-mono font-bold text-[#2851C5]">
                            {ca.advanceNumber}
                            <div className="text-[10px] text-[#787774] font-sans font-normal">
                              Ref Transfer:{' '}
                              {ca.signatures?.disbursedBy?.transferReference || '-'}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-[#252525]">
                              {ca.activityTitle}
                            </div>
                            <div className="text-[10px] font-mono text-[#2851C5]">
                              ToR: {ca.torNumber}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-[#252525]">
                            {ca.items?.[0]?.budgetCode || '-'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-[#B26B00]">
                            {formatRupiah(ca.totalAmount)}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#5A5A58]">
                            {ca.reportingDeadlineDate || '-'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => handleOpenCloseReportModal(ca)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-xs font-semibold bg-[#252525] text-white hover:bg-[#37352F] cursor-pointer"
                            >
                              <Send className="w-3 h-3" />
                              <span>Input Final Financial Report (LPJ)</span>
                            </button>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section B: Submitted & Verified Final Financial Reports */}
          <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-[#EAEAEA] bg-[#FAFAF9] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-xs text-[10px] font-bold bg-[#2B6E3F] text-white uppercase">
                    MODUL 6B • SUBMITTED & VERIFIED FINAL FINANCIAL REPORTS
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#252525] mt-1">
                  Daftar Final Financial Report (LPJ) Terhubung ke Cash Advance & Master ToR
                </h3>
                <p className="text-xs text-[#787774]">
                  Menampilkan pengeluaran aktual (Actual Expenditure), pengembalian sisa dana (Returned Funds), link bukti Expensify PDF, dan status verifikasi berjenjang (Finance → Director).
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#787774]">
                    <th className="py-2.5 px-3">Final Report & CA Ref</th>
                    <th className="py-2.5 px-3">Master ToR & Budget Code</th>
                    <th className="py-2.5 px-3 text-right">Original CA</th>
                    <th className="py-2.5 px-3 text-right">Actual Expenditure</th>
                    <th className="py-2.5 px-3 text-right">Returned Funds</th>
                    <th className="py-2.5 px-3">Bukti Expensify</th>
                    <th className="py-2.5 px-3">Status Persetujuan LPJ</th>
                    <th className="py-2.5 px-3 text-center">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {programCashAdvances.filter((ca) => ca.isReported).length ===
                  0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-xs text-[#787774]"
                      >
                        Belum ada Final Financial Report (LPJ) yang diajukan untuk program ini di database. Gunakan tombol <strong>Input Final Financial Report (LPJ)</strong> pada tabel Outstanding Cash Advances di atas untuk melaporkan realisasi.
                      </td>
                    </tr>
                  ) : (
                    programCashAdvances
                      .filter((ca) => ca.isReported)
                      .map((ca) => {
                        const finRef = ca.advanceNumber.replace(
                          /^CA\//i,
                          'LPJ-FIN/'
                        );
                        const actualAmt =
                          Number(ca.realizedAmount ?? ca.totalAmount) || 0;
                        const returnedAmt = Math.max(
                          0,
                          (Number(ca.totalAmount) || 0) - actualAmt
                        );
                        const isApproved =
                          ca.reportApprovalStatus === 'Telah Disetujui';
                        const isWaitingFinance =
                          !ca.reportApprovalStatus ||
                          ca.reportApprovalStatus ===
                            'Menunggu Pemeriksaan Finance';
                        const isWaitingDirector =
                          ca.reportApprovalStatus ===
                          'Menunggu Persetujuan Director';
                        const isBusy = caActionBusyId === ca.id;

                        return (
                          <tr key={ca.id} className="hover:bg-[#FAFAF9]">
                            <td className="py-3 px-3">
                              <div className="font-mono font-bold text-[#2B6E3F]">
                                {finRef}
                              </div>
                              <div className="text-[10px] font-mono text-[#787774]">
                                CA Asal: {ca.advanceNumber}
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-medium text-[#252525]">
                                {ca.activityTitle}
                              </div>
                              <div className="text-[10px] font-mono text-[#2851C5]">
                                ToR: {ca.torNumber} • Code:{' '}
                                <strong>{ca.items?.[0]?.budgetCode || '-'}</strong>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-[#5A5A58]">
                              {formatRupiah(ca.totalAmount)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-[#2B6E3F]">
                              {formatRupiah(actualAmt)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-semibold text-[#2851C5]">
                              {formatRupiah(returnedAmt)}
                            </td>
                            <td className="py-3 px-3">
                              {ca.expensifyPdfLink ? (
                                <a
                                  href={ca.expensifyPdfLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2851C5] hover:underline"
                                >
                                  <span>Expensify PDF</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className="text-[#9B9A97]">-</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-xs text-[10px] font-semibold ${
                                  isApproved
                                    ? 'bg-[#EAF3EC] text-[#2B6E3F]'
                                    : ca.reportApprovalStatus === 'Perlu Revisi'
                                    ? 'bg-[#FDECEC] text-[#C93B3B]'
                                    : 'bg-[#FFF8E6] text-[#B26B00]'
                                }`}
                              >
                                {ca.reportApprovalStatus ||
                                  'Menunggu Pemeriksaan Finance'}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <div className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                                <button
                                  type="button"
                                  onClick={() => handleOpenCloseReportModal(ca)}
                                  className="px-2 py-1 rounded-xs text-[11px] font-semibold border border-[#D4D4D0] bg-white text-[#252525] hover:bg-[#F7F7F5] cursor-pointer"
                                >
                                  Edit LPJ
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* AUDIT & REVISION HISTORY                                              */}
      {/* ===================================================================== */}
      {activeTab === 'revision-history' && (
        <div className="bg-white border border-[#E5E5E3] rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-[#EAEAEA] bg-[#FAFAF9]">
            <h3 className="text-sm font-bold text-[#252525]">
              Revision History — {dataset.programName} (FY {selectedFiscalYear})
            </h3>
            <p className="text-xs text-[#787774]">
              Jejak audit perubahan konfigurasi anggaran tahunan, periode anggaran, dan Master Budget Code pada program ini.
            </p>
          </div>
          <div className="divide-y divide-[#EAEAEA]">
            {(dataset.revisions || []).length === 0 ? (
              <div className="p-8 text-center text-xs text-[#787774]">
                Belum ada riwayat revisi konfigurasi anggaran untuk program ini pada FY {selectedFiscalYear}.
              </div>
            ) : (
              (dataset.revisions || []).map((rev) => (
                <div
                  key={rev.id}
                  className="p-3.5 hover:bg-[#FAFAF9] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded-xs text-[10px] font-bold bg-[#EEF3FF] text-[#2851C5]">
                        {rev.actionType}
                      </span>
                      <span className="font-semibold text-[#252525]">
                        {rev.actorName}
                      </span>
                      <span className="text-[#787774]">({rev.actorRole})</span>
                    </div>
                    <p className="text-[#37352F] mt-1">{rev.summary}</p>
                  </div>
                  <div className="text-right font-mono text-[11px] text-[#787774] shrink-0">
                    <div>{new Date(rev.timestamp).toLocaleString('id-ID')}</div>
                    <div className="font-semibold text-[#252525]">
                      Annual Budget: {formatRupiah(rev.newAnnualBudget)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODALS FOR INTERCONNECTED ACTIONS                                     */}
      {/* ===================================================================== */}

      {/* 1. Program Master Create/Edit Modal */}
      {showProgramModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md max-w-md w-full p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-[#EAEAEA] pb-3">
              <h3 className="text-sm font-bold text-[#252525]">
                {editingProgram
                  ? 'Edit Program Master'
                  : 'Tambah Program Master Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowProgramModal(false)}
                className="text-[#787774] hover:text-[#252525]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveProgramMaster} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Nama Program
                </label>
                <input
                  type="text"
                  required
                  value={progName}
                  onChange={(e) => setProgName(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Lokasi Program
                </label>
                <input
                  type="text"
                  required
                  value={progLocation}
                  onChange={(e) => setProgLocation(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-[#252525] mb-1">
                    Tanggal Mulai
                  </label>
                  <input
                    type="date"
                    required
                    value={progStartDate}
                    onChange={(e) => setProgStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#252525] mb-1">
                    Tanggal Selesai
                  </label>
                  <input
                    type="date"
                    required
                    value={progEndDate}
                    onChange={(e) => setProgEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Status Program
                </label>
                <select
                  value={progStatus}
                  onChange={(e) => setProgStatus(e.target.value as ProgramStatus)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm bg-white"
                >
                  <option value="Aktif">Aktif</option>
                  <option value="Draft">Draft</option>
                  <option value="Selesai">Selesai</option>
                  <option value="Diarsipkan">Diarsipkan</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Deskripsi Program
                </label>
                <textarea
                  rows={2}
                  value={progDescription}
                  onChange={(e) => setProgDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EAEAEA]">
                <button
                  type="button"
                  onClick={() => setShowProgramModal(false)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={progSaving}
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer"
                >
                  {progSaving ? 'Menyimpan...' : 'Simpan ke Database'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Add / Edit Master Budget Code Modal */}
      {showAddCodeModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md max-w-md w-full p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-[#EAEAEA] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  {editingCodeItem
                    ? 'Edit Master Budget Code'
                    : 'Add Master Budget Code'}
                </h3>
                <p className="text-[11px] text-[#787774]">
                  {dataset.programName} (FY {selectedFiscalYear})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCodeModal(false)}
                className="text-[#787774] hover:text-[#252525]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMasterCode} className="space-y-3 text-xs">
              {codeFormError && (
                <div className="p-2.5 rounded-sm bg-[#FDECEC] border border-[#F5C2C2] text-[#C93B3B]">
                  {codeFormError}
                </div>
              )}

              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Code
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: 1.1.1"
                  value={newCodeValue}
                  onChange={(e) => setNewCodeValue(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-[#D4D4D0] rounded-sm focus:outline-none focus:border-[#3867F5]"
                />
              </div>

              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Budget Category
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Personnel, Travel, Training, Activities..."
                  value={newCategoryValue}
                  onChange={(e) => setNewCategoryValue(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm focus:outline-none focus:border-[#3867F5]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EAEAEA]">
                <button
                  type="button"
                  onClick={() => setShowAddCodeModal(false)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer"
                >
                  Save Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Excel Import Preview & Duplicate Validation Modal */}
      {showExcelPreviewModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md max-w-2xl w-full p-5 shadow-lg space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#EAEAEA] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  Excel Import Preview & Duplicate Validation
                </h3>
                <p className="text-xs text-[#787774]">
                  File: <strong>{excelFileName}</strong> • Target:{' '}
                  {dataset.programName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExcelPreviewModal(false)}
                className="text-[#787774] hover:text-[#252525]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 border border-[#E5E5E3] rounded-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[11px] font-bold uppercase text-[#787774]">
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Code</th>
                    <th className="py-2 px-3">Budget Category</th>
                    <th className="py-2 px-3">Validation Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {excelPreviewRows.map((row) => (
                    <tr key={row.rowNumber} className="hover:bg-[#FAFAF9]">
                      <td className="py-2 px-3 font-mono text-[#787774]">
                        #{row.rowNumber}
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-[#252525]">
                        {row.code}
                      </td>
                      <td className="py-2 px-3 text-[#252525]">
                        {row.budgetCategory}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-xs text-[10px] font-semibold ${
                            row.status === 'valid'
                              ? 'bg-[#EAF3EC] text-[#2B6E3F]'
                              : 'bg-[#FDECEC] text-[#C93B3B]'
                          }`}
                        >
                          {row.statusMessage}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#EAEAEA] text-xs">
              <span className="text-[#787774]">
                Valid rows ready to import:{' '}
                <strong className="text-[#2B6E3F]">
                  {excelPreviewRows.filter((r) => r.status === 'valid').length}
                </strong>{' '}
                of {excelPreviewRows.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowExcelPreviewModal(false)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    excelPreviewRows.filter((r) => r.status === 'valid')
                      .length === 0
                  }
                  onClick={handleConfirmExcelImport}
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#2B6E3F] text-white hover:bg-[#1E522D] disabled:opacity-40 cursor-pointer"
                >
                  Confirm Import (
                  {excelPreviewRows.filter((r) => r.status === 'valid').length}{' '}
                  Codes)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Edit Master ToR Budget & Budget Code Modal */}
      {editingTorBudget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md max-w-md w-full p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-[#EAEAEA] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  Hubungkan Master Budget Code & Pagu ToR
                </h3>
                <p className="text-[11px] font-mono text-[#2851C5]">
                  {editingTorBudget.torNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTorBudget(null)}
                className="text-[#787774] hover:text-[#252525]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveTorBudgetLink} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Master Budget Code (Eksklusif Program: {dataset.programName})
                </label>
                <select
                  value={torEditCode}
                  onChange={(e) => setTorEditCode(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm bg-white font-mono"
                >
                  <option value="">-- Pilih Kode Finance Program Ini --</option>
                  {dataset.masterBudgetCodes.map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code} — {c.budgetCategory}
                    </option>
                  ))}
                </select>
                <p className="text-[10.5px] text-[#787774] mt-1">
                  Hanya menampilkan kode yang terdaftar pada Pengaturan Finance Program ini.
                </p>
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Budget Requested (IDR)
                </label>
                <input
                  type="number"
                  min={0}
                  value={torEditRequested}
                  onChange={(e) =>
                    setTorEditRequested(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full px-3 py-2 font-mono border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Budget Approved (IDR)
                </label>
                <input
                  type="number"
                  min={0}
                  value={torEditApproved}
                  onChange={(e) =>
                    setTorEditApproved(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full px-3 py-2 font-mono font-bold border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Catatan Anggaran ToR
                </label>
                <textarea
                  rows={2}
                  value={torEditNotes}
                  onChange={(e) => setTorEditNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EAEAEA]">
                <button
                  type="button"
                  onClick={() => setEditingTorBudget(null)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={torSaving}
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer"
                >
                  {torSaving ? 'Menyimpan...' : 'Simpan Perubahan ToR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Disburse Cash Advance Modal */}
      {disbursingCa && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md max-w-md w-full p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-[#EAEAEA] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  Pencairan Dana Cash Advance (Disbursement)
                </h3>
                <p className="text-[11px] font-mono text-[#2851C5]">
                  {disbursingCa.advanceNumber} —{' '}
                  {formatRupiah(disbursingCa.totalAmount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDisbursingCa(null)}
                className="text-[#787774] hover:text-[#252525]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmDisburseCa} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Nomor Referensi Bukti Transfer Bank
                </label>
                <input
                  type="text"
                  required
                  value={disburseRefNumber}
                  onChange={(e) => setDisburseRefNumber(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Rekening Sumber Pencairan
                </label>
                <input
                  type="text"
                  required
                  value={disburseBankSource}
                  onChange={(e) => setDisburseBankSource(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EAEAEA]">
                <button
                  type="button"
                  onClick={() => setDisbursingCa(null)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#2B6E3F] text-white hover:bg-[#1E522D] cursor-pointer"
                >
                  Konfirmasi Pencairan Dana
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Final Financial Report (LPJ) Submission Modal Connected to Original CA & ToR */}
      {closingReportCa && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md max-w-2xl w-full p-5 shadow-lg space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#EAEAEA] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  Final Financial Report (LPJ) — Rekonsiliasi Pengeluaran Aktual & Sisa Dana
                </h3>
                <p className="text-[11px] text-[#787774]">
                  Terhubung ke Cash Advance:{' '}
                  <strong className="font-mono text-[#2851C5]">
                    {closingReportCa.advanceNumber}
                  </strong>{' '}
                  • Master ToR:{' '}
                  <strong className="font-mono">{closingReportCa.torNumber}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClosingReportCa(null)}
                className="text-[#787774] hover:text-[#252525]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleConfirmSubmitFinalReport}
              className="space-y-4 text-xs overflow-y-auto flex-1 pr-1"
            >
              <div className="border border-[#E5E5E3] rounded-sm overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[10px] font-bold uppercase text-[#787774]">
                      <th className="py-2 px-3">Code</th>
                      <th className="py-2 px-3">Uraian Item Cash Advance</th>
                      <th className="py-2 px-3 text-right">Uang Muka (CA)</th>
                      <th className="py-2 px-3 text-right">
                        Pengeluaran Aktual (IDR)
                      </th>
                      <th className="py-2 px-3 text-right">Sisa / Kembali</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAEAEA]">
                    {(closingReportCa.items || []).map((item) => {
                      const actVal =
                        lpjItemActuals[item.id] ?? Number(item.totalAmount) ?? 0;
                      const remVal = Math.max(
                        0,
                        (Number(item.totalAmount) || 0) - actVal
                      );
                      return (
                        <tr key={item.id}>
                          <td className="py-2 px-3 font-mono font-bold">
                            {item.budgetCode}
                          </td>
                          <td className="py-2 px-3">{item.description}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {formatRupiah(item.totalAmount)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              min={0}
                              value={actVal}
                              onChange={(e) =>
                                setLpjItemActuals((prev) => ({
                                  ...prev,
                                  [item.id]: Math.max(
                                    0,
                                    Number(e.target.value) || 0
                                  ),
                                }))
                              }
                              className="w-36 text-right px-2 py-1 font-mono font-bold border border-[#D4D4D0] rounded-xs"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-[#2851C5]">
                            {formatRupiah(remVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {(() => {
                const totalActual = Object.values(lpjItemActuals).reduce<number>(
                  (s, v) => s + Math.max(0, Number(v) || 0),
                  0
                );
                const totalReturned = Math.max(
                  0,
                  (Number(closingReportCa.totalAmount) || 0) - totalActual
                );
                return (
                  <div className="grid grid-cols-3 gap-2.5 p-3 rounded-sm bg-[#F7F7F5] border border-[#E5E5E3]">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#787774]">
                        Original Cash Advance
                      </div>
                      <div className="font-mono font-bold text-sm text-[#252525]">
                        {formatRupiah(closingReportCa.totalAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#2B6E3F]">
                        Actual Expenditure
                      </div>
                      <div className="font-mono font-bold text-sm text-[#2B6E3F]">
                        {formatRupiah(totalActual)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[#2851C5]">
                        Returned Funds
                      </div>
                      <div className="font-mono font-bold text-sm text-[#2851C5]">
                        {formatRupiah(totalReturned)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Link Bukti PDF Expensify (Wajib)
                </label>
                <input
                  type="url"
                  required
                  value={lpjExpensifyLink}
                  onChange={(e) => setLpjExpensifyLink(e.target.value)}
                  placeholder="https://www.expensify.com/report?..."
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-[#252525] mb-1">
                  Catatan Pertanggungjawaban & Bukti Pengembalian Dana
                </label>
                <textarea
                  rows={2}
                  value={lpjNotes}
                  onChange={(e) => setLpjNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EAEAEA]">
                <button
                  type="button"
                  onClick={() => setClosingReportCa(null)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={lpjSaving}
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#2B6E3F] text-white hover:bg-[#1E522D] cursor-pointer"
                >
                  {lpjSaving
                    ? 'Menyimpan...'
                    : 'Simpan & Ajukan Final Financial Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Cash Advance Creation / Edit Modal */}
      {showCaFormModal && (
        <CashAdvanceFormModal
          isOpen={showCaFormModal}
          onClose={() => {
            setShowCaFormModal(false);
            setEditingCaRecord(null);
          }}
          onSuccess={() => {
            setShowCaFormModal(false);
            setEditingCaRecord(null);
            onRefreshData?.();
            fetchAndSyncAllData(false);
          }}
          existingRecord={editingCaRecord}
          initialTorId={caFormInitialTorId}
          tors={programTors}
          programs={programs}
          outcomes={outcomes}
          outputs={outputs}
          activities={activities}
          currentUser={currentUser}
        />
      )}

      {/* Official Cash Advance Detail / Print Modal */}
      {selectedCaDetail && (
        <CashAdvanceDetailModal
          isOpen={Boolean(selectedCaDetail)}
          record={selectedCaDetail}
          onClose={() => setSelectedCaDetail(null)}
          onEdit={(rec) => {
            setSelectedCaDetail(null);
            setEditingCaRecord(rec);
            setShowCaFormModal(true);
          }}
          onRefresh={() => {
            onRefreshData?.();
            fetchAndSyncAllData(false);
          }}
          currentUser={currentUser}
        />
      )}
    </div>
  );
};
