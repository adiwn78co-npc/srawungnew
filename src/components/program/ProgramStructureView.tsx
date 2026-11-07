import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Outcome,
  Output,
  Activity,
  SubActivity,
  Indicator,
  Tor,
  Program,
  ProgramStatus,
  CashAdvanceRecord,
  ApprovalHubItem,
  MasterParticipantRecord,
  MonitoringReportItem,
} from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { SubmissionStatusBadge, ActivityStatusBadge } from '../common/Badges.js';
import { formatPeriodRange, getDeadlineInfo } from '../../lib/dateUtils.js';
import { getStatusDotInfo } from '../../lib/statusDot.js';
import {
  FolderTree,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Calendar,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  FileText,
  BarChart3,
  X,
  Lock,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Edit3,
  Search,
  RotateCcw,
  Building,
  Building2,
  Layers,
  MoreHorizontal,
  Sliders,
  FileSpreadsheet,
  Wallet,
  Upload,
  Download,
  Check,
  RefreshCw,
  Receipt,
  Users,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  ProgramParticipantsModal,
  ProgramOutcomeParticipantTracing,
} from '../participants/ProgramParticipantsModal.js';
import {
  BudgetPeriodStructureType,
  ProgramBudgetApprovalStatus,
  ProgramBudgetDataset,
  ProgramBudgetPeriod,
  ProgramMasterBudgetCode,
  ExcelImportPreviewRow,
  getOrCreateProgramBudgetDataset,
  saveProgramBudgetDataset,
  saveAllProgramBudgetDatasets,
  loadAllProgramBudgetDatasets,
  getActivePeriods,
  calculateProgramBudgetMetrics,
  syncProgramFinancialDataFromMealConnect,
  downloadMasterBudgetExcelTemplate,
  parseMasterBudgetExcelFile,
} from '../../lib/programBudgetStorage.js';

const WORKFLOW_STAGES = [
  { num: '01', title: 'TOR', available: true, desc: 'Penyusunan kerangka acuan kerja, target kegiatan, dan pengajuan persetujuan' },
  { num: '02', title: 'Cash Advance', available: true, desc: 'Pengajuan uang muka operasional kegiatan ke bagian keuangan' },
  { num: '03', title: 'Ringkasan Cash Advance', available: true, desc: 'Rekapitulasi realisasi anggaran dan penutupan laporan Cash Advance' },
  { num: '04', title: 'Notulen', available: true, desc: 'Catatan poin-poin penting musyawarah, lokakarya, atau rapat lapangan' },
  { num: '05', title: 'Dokumentasi Kegiatan', available: true, desc: 'Dokumentasi Five Best Photos, Human Interest Story, dan General Photo Documentation' },
  { num: '06', title: 'Monitoring', available: true, desc: 'Monitoring kegiatan terintegrasi otomatis dengan ToR, Cash Advance, dan Monitoring Tools' },
  { num: '07', title: 'Laporan Kontribusi', available: true, desc: 'Catatan swadaya masyarakat atau kontribusi mitra setempat' },
  { num: '08', title: 'Laporan Keuangan', available: true, desc: 'Pertanggungjawaban struk, kuitansi riil, dan rekonsiliasi kasbon' },
];

function formatRupiah(amount?: number | null): string {
  if (amount == null || isNaN(amount)) return 'Belum tersedia';
  return `Rp ${Number(amount).toLocaleString('id-ID')}`;
}

export type IntegratedProgramModuleTab =
  | 'program-master'
  | 'budget-planning'
  | 'master-budget-code';

interface ProgramStructureViewProps {
  programs?: Program[];
  outcomes: Outcome[];
  outputs: Output[];
  activities: Activity[];
  subActivities: SubActivity[];
  tors?: Tor[];
  onRefresh: () => void;
  onOpenCreateTorForActivity?: (outcomeId: string, outputId: string, activityId: string) => void;
  onSelectTor?: (torId: string, initialStage?: number) => void;
  /** Optional integration props when embedded inside Finance Workspace */
  embeddedInFinanceWorkspace?: boolean;
  externalSelectedProgramId?: string;
  onExternalSelectProgramId?: (programId: string) => void;
  externalFiscalYear?: number;
  onExternalChangeFiscalYear?: (fy: number) => void;
  onNavigateToFinanceTab?: (tab: 'budget-planning' | 'master-budget' | 'master-tor' | 'cash-advance' | 'laporan-keuangan' | 'dashboard') => void;
}

export const ProgramStructureView: React.FC<ProgramStructureViewProps> = ({
  programs = [],
  outcomes,
  outputs,
  activities,
  subActivities,
  tors = [],
  onRefresh,
  onOpenCreateTorForActivity,
  onSelectTor,
  embeddedInFinanceWorkspace = false,
  externalSelectedProgramId,
  onExternalSelectProgramId,
  externalFiscalYear,
  onExternalChangeFiscalYear,
  onNavigateToFinanceTab,
}) => {
  const { currentUser, isDirector, isProgramManager, isFinance, allUsers } = useAuth();
  const canManage = isDirector || isProgramManager || Boolean(currentUser?.permissions?.canManagePrograms);
  // Hanya Director dan Finance yang dapat melihat dan mengelola kolom Pengaturan Finance Program
  const canEditFinance = isDirector || isFinance;

  // Active main section inside Program Detail: 'hierarchy' (Bagian 1: Hierarki Hasil & ToR), 'participants' (Tracing Peserta per Outcome), or 'finance' (Bagian 2: Pengaturan & Ringkasan Finance Program)
  const [programDetailSection, setProgramDetailSection] = useState<'hierarchy' | 'participants' | 'finance'>('hierarchy');

  // Active sub-tab inside Pengaturan Finance Program panel
  const [financeSectionTab, setFinanceSectionTab] = useState<'budget' | 'codes' | 'ca'>('budget');

  // Selected Program ID for drill-down into Detail Program & Hierarchy (null = Daftar Program; string = Detail Program)
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [participantsModalProgram, setParticipantsModalProgram] = useState<Program | null>(null);

  // Active Program ID for Master Budget & Master Budget Code context
  const [budgetContextProgramId, setBudgetContextProgramId] = useState<string>(() => {
    return externalSelectedProgramId || programs[0]?.id || '';
  });

  useEffect(() => {
    if (externalSelectedProgramId) {
      setBudgetContextProgramId(externalSelectedProgramId);
    } else if (!budgetContextProgramId && programs.length > 0) {
      setBudgetContextProgramId(programs[0].id);
    }
  }, [externalSelectedProgramId, programs, budgetContextProgramId]);

  const currentSelectedProgram = programs.find((p) => p.id === selectedProgramId) || null;
  const activeBudgetProgram =
    programs.find((p) => p.id === (selectedProgramId || budgetContextProgramId)) ||
    programs[0] ||
    null;

  // Derive program fiscal year directly from the active program's start date (no duplicate fiscal year selector)
  const selectedFiscalYear = useMemo<number>(() => {
    if (externalFiscalYear) return externalFiscalYear;
    const progYear = Number((activeBudgetProgram?.startDate || '').slice(0, 4));
    if (progYear >= 2020 && progYear <= 2035) return progYear;
    return new Date().getFullYear();
  }, [externalFiscalYear, activeBudgetProgram]);

  const handleSelectBudgetProgram = (progId: string) => {
    setBudgetContextProgramId(progId);
    onExternalSelectProgramId?.(progId);
  };

  // When drilling into a specific program, open either Bagian 1 (Hierarki) or Bagian 2 (Finance) as separate pages
  const handleOpenProgramDetail = (progId: string, openFinancePanel = false, initialFinanceTab: 'budget' | 'codes' | 'ca' = 'budget') => {
    setSelectedProgramId(progId);
    handleSelectBudgetProgram(progId);
    setProgramDetailSection(openFinancePanel && canEditFinance ? 'finance' : 'hierarchy');
    setShowInlineFinanceEditor(true);
    setFinanceSectionTab(initialFinanceTab);
  };

  // Connected Database Records (Cash Advances, Approval Hub, Master Participants, Monitoring Reports)
  const [cashAdvances, setCashAdvances] = useState<CashAdvanceRecord[]>([]);
  const [approvalHubItems, setApprovalHubItems] = useState<ApprovalHubItem[]>([]);
  const [masterParticipants, setMasterParticipants] = useState<MasterParticipantRecord[]>([]);
  const [allMonitoringReports, setAllMonitoringReports] = useState<MonitoringReportItem[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);

  const [dataset, setDataset] = useState<ProgramBudgetDataset>(() =>
    getOrCreateProgramBudgetDataset(
      activeBudgetProgram?.id || 'unselected',
      activeBudgetProgram?.name || '',
      selectedFiscalYear,
      { outcomes, outputs, activities, tors, cashAdvances: [] }
    )
  );

  // Draft states for Finance: Total Program Budget, Annual Budget (auto-summed from periods), and Budget Periods
  const [draftTotalProgramBudget, setDraftTotalProgramBudget] = useState<number>(
    Number(dataset.totalProgramBudget) || 0
  );
  const [draftAnnualBudget, setDraftAnnualBudget] = useState<number>(dataset.annualApprovedBudget);
  const [draftStructureType, setDraftStructureType] = useState<BudgetPeriodStructureType>('custom');
  const [draftQuarterly, setDraftQuarterly] = useState<ProgramBudgetPeriod[]>(
    dataset.quarterlyPeriods
  );
  const [draftSemester, setDraftSemester] = useState<ProgramBudgetPeriod[]>(
    dataset.semesterPeriods
  );
  const [draftCustom, setDraftCustom] = useState<ProgramBudgetPeriod[]>(
    getActivePeriods(dataset)
  );
  const [showInlineFinanceEditor, setShowInlineFinanceEditor] = useState<boolean>(false);

  // Modul 3: Master Budget Code states
  const [codeSearch, setCodeSearch] = useState('');
  const [showAddCodeModal, setShowAddCodeModal] = useState(false);
  const [editingCodeItem, setEditingCodeItem] = useState<ProgramMasterBudgetCode | null>(null);
  const [newCodeValue, setNewCodeValue] = useState('');
  const [newCategoryValue, setNewCategoryValue] = useState('');
  const [codeFormError, setCodeFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [excelPreviewRows, setExcelPreviewRows] = useState<ExcelImportPreviewRow[]>([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [showExcelPreviewModal, setShowExcelPreviewModal] = useState(false);

  // Fetch & sync server-persisted budgets + Cash Advances
  const fetchBudgetAndFinancialRecords = useCallback(async () => {
    try {
      setSyncLoading(true);
      const [serverBudgets, caRes, apvRes, pRes, monRes] = await Promise.all([
        api.getFinanceProgramBudgets().catch(() => ({} as Record<string, any>)),
        api.getCashAdvances().catch(() => [] as CashAdvanceRecord[]),
        api.getApprovalHub().catch(() => null),
        api.getParticipantDatabase().catch(() => ({ records: [] as MasterParticipantRecord[] })),
        api.getMonitoringReports().catch(() => ({ items: [] as MonitoringReportItem[] })),
      ]);

      const caList = Array.isArray(caRes) ? caRes : [];
      const hubList = apvRes && Array.isArray(apvRes.items) ? apvRes.items : [];
      setCashAdvances(caList);
      setApprovalHubItems(hubList);
      setMasterParticipants(Array.isArray(pRes?.records) ? pRes.records : []);
      setAllMonitoringReports(Array.isArray(monRes?.items) ? monRes.items : []);

      if (serverBudgets && typeof serverBudgets === 'object') {
        const localAll = loadAllProgramBudgetDatasets();
        let changed = false;
        for (const [k, v] of Object.entries(serverBudgets)) {
          if (v && typeof v === 'object') {
            localAll[k] = v as ProgramBudgetDataset;
            changed = true;
          }
        }
        if (changed) {
          saveAllProgramBudgetDatasets(localAll);
        }
      }

      if (activeBudgetProgram) {
        const currentDs = getOrCreateProgramBudgetDataset(
          activeBudgetProgram.id,
          activeBudgetProgram.name,
          selectedFiscalYear,
          { outcomes, outputs, activities, tors, cashAdvances: caList }
        );
        const syncRes = syncProgramFinancialDataFromMealConnect({
          dataset: currentDs,
          programs,
          outcomes,
          outputs,
          activities,
          tors,
          cashAdvances: caList,
          approvalHubItems: hubList,
          actorName: currentUser?.name || 'System',
          recordSyncLog: false,
        });
        setDataset(syncRes.updatedDataset);
        setDraftTotalProgramBudget(Number(syncRes.updatedDataset.totalProgramBudget) || 0);
        setDraftAnnualBudget(syncRes.updatedDataset.annualApprovedBudget);
        setDraftStructureType('custom');
        setDraftQuarterly(syncRes.updatedDataset.quarterlyPeriods);
        setDraftSemester(syncRes.updatedDataset.semesterPeriods);
        setDraftCustom(getActivePeriods(syncRes.updatedDataset));
      }
    } catch (err) {
      console.error('Failed to sync program budget data:', err);
    } finally {
      setSyncLoading(false);
    }
  }, [
    activeBudgetProgram,
    selectedFiscalYear,
    programs,
    outcomes,
    outputs,
    activities,
    tors,
    currentUser,
  ]);

  useEffect(() => {
    fetchBudgetAndFinancialRecords();
  }, [fetchBudgetAndFinancialRecords]);

  // Persist helper to both localStorage and server db.json
  const persistDatasetToServerAndLocal = async (updated: ProgramBudgetDataset) => {
    saveProgramBudgetDataset(updated);
    setDataset(updated);
    const key = `${updated.programId}__${updated.fiscalYear}`;
    try {
      await api.saveFinanceProgramBudget(key, updated);
    } catch (err) {
      console.error('Failed to persist program budget to server:', err);
    }
  };

  // Per-program summary map so every Program card in Gambar 2 shows live Annual Budget, Period Structure, Master Budget Codes & Realization
  const programFinancialSummaryMap = useMemo(() => {
    const map: Record<
      string,
      {
        dataset: ProgramBudgetDataset;
        metrics: ReturnType<typeof calculateProgramBudgetMetrics>;
        torCount: number;
        caCount: number;
      }
    > = {};
    for (const prog of programs) {
      const baseDs =
        prog.id === dataset.programId
          ? dataset
          : getOrCreateProgramBudgetDataset(prog.id, prog.name, selectedFiscalYear, {
              outcomes,
              outputs,
              activities,
              tors,
              cashAdvances,
            });
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
      const progTors = tors.filter(
        (t) =>
          t.programId === prog.id ||
          (t.programName &&
            t.programName.trim().toLowerCase() === prog.name.trim().toLowerCase())
      );
      const torIdSet = new Set(progTors.map((t) => t.id));
      const progCas = cashAdvances.filter(
        (ca) =>
          (ca.torId && torIdSet.has(ca.torId)) ||
          (ca.programName &&
            ca.programName.trim().toLowerCase() === prog.name.trim().toLowerCase())
      );
      map[prog.id] = {
        dataset: syncedDs,
        metrics: m,
        torCount: progTors.length,
        caCount: progCas.length,
      };
    }
    return map;
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

  const programScopedCashAdvances = useMemo<CashAdvanceRecord[]>(() => {
    if (!activeBudgetProgram) return [];
    const progTors = tors.filter(
      (t) =>
        t.programId === activeBudgetProgram.id ||
        (t.programName &&
          t.programName.trim().toLowerCase() ===
            activeBudgetProgram.name.trim().toLowerCase())
    );
    const torIdSet = new Set(progTors.map((t) => t.id));
    return cashAdvances.filter(
      (ca) =>
        (ca.torId && torIdSet.has(ca.torId)) ||
        (ca.programName &&
          ca.programName.trim().toLowerCase() ===
            activeBudgetProgram.name.trim().toLowerCase())
    );
  }, [activeBudgetProgram, tors, cashAdvances]);

  // Search & filter for programs list
  const [programSearchTerm, setProgramSearchTerm] = useState('');
  const [programStatusFilter, setProgramStatusFilter] = useState<string>('all');

  // Program Creation / Edit Modal
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [programForm, setProgramForm] = useState({
    name: '',
    location: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    description: '',
    folderUrl: '',
    picId: currentUser?.id || '',
    status: 'Aktif' as ProgramStatus,
  });
  const [editingInlineFolderProgId, setEditingInlineFolderProgId] = useState<string | null>(null);
  const [inlineFolderUrlDraft, setInlineFolderUrlDraft] = useState<string>('');

  // Track expanded TOR accordion inside activity
  const [expandedTorId, setExpandedTorId] = useState<string | null>(null);
  const toggleTorAccordion = (torId: string) => {
    setExpandedTorId((prev) => (prev === torId ? null : torId));
  };

  // Track expanded activities inside output
  const [expandedActivities, setExpandedActivities] = useState<Record<string, boolean>>({});
  const toggleActivity = (id: string) => {
    setExpandedActivities((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Track open dropdown menus (e.g. program-id, output-id, activity-id)
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Expansion states
  const [expandedOutcomes, setExpandedOutcomes] = useState<Record<string, boolean>>({
    [outcomes[0]?.id || '']: true,
  });
  const [expandedOutputs, setExpandedOutputs] = useState<Record<string, boolean>>({
    [outputs[0]?.id || '']: true,
  });

  // Modal / Detail drawer states
  const [selectedOutcomeDetail, setSelectedOutcomeDetail] = useState<Outcome | null>(null);
  const [selectedOutputDetail, setSelectedOutputDetail] = useState<Output | null>(null);
  const [selectedActivityDetail, setSelectedActivityDetail] = useState<Activity | null>(null);

  // Creation / Edit Modals for Hierarchy
  const [showAddOutcome, setShowAddOutcome] = useState(false);
  const [showAddOutput, setShowAddOutput] = useState<{ outcomeId: string } | null>(null);
  const [showAddActivity, setShowAddActivity] = useState<{ outputId: string } | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [showAddSubActivity, setShowAddSubActivity] = useState<{ activityId: string } | null>(null);

  // Form states
  const [outcomeForm, setOutcomeForm] = useState({
    name: '',
    projectName: '',
    description: '',
    indicatorName: '',
    baseline: '',
    target: '',
    unit: '',
    verificationMethod: '',
    reportingFrequency: 'Bulanan',
    dataSource: '',
  });

  const [outputForm, setOutputForm] = useState({
    name: '',
    description: '',
    indicatorName: '',
    baseline: '',
    target: '',
    unit: '',
    verificationMethod: '',
    reportingFrequency: 'Bulanan',
  });

  const [activityForm, setActivityForm] = useState({
    name: '',
    code: '',
    description: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
  });

  const [subActivityForm, setSubActivityForm] = useState({
    name: '',
    description: '',
    picName: '',
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const toggleOutcome = (id: string) => {
    setExpandedOutcomes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleOutput = (id: string) => {
    setExpandedOutputs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Active draft periods for Modul 2: Master Budget (Strictly Custom Period)
  const activeDraftPeriods = useMemo(() => draftCustom, [draftCustom]);

  // The total budget for one year automatically reflects the sum of all budget periods entered for that year
  const draftTotalPeriodAllocated = useMemo(
    () => activeDraftPeriods.reduce((sum, p) => sum + (Number(p.allocatedAmount) || 0), 0),
    [activeDraftPeriods]
  );

  useEffect(() => {
    setDraftAnnualBudget(draftTotalPeriodAllocated);
    setDraftTotalProgramBudget(draftTotalPeriodAllocated);
  }, [draftTotalPeriodAllocated]);

  const draftAllocationVariance = 0;
  const isDraftAllocationBalanced = draftTotalPeriodAllocated > 0;

  const metrics = useMemo(() => calculateProgramBudgetMetrics(dataset), [dataset]);
  const activeSavedPeriods = useMemo(() => getActivePeriods(dataset), [dataset]);

  const handleUpdateDraftPeriodAmount = (periodId: string, amount: number) => {
    const safeAmt = Math.max(0, Number(amount) || 0);
    setDraftCustom((prev) =>
      prev.map((p) => (p.id === periodId ? { ...p, allocatedAmount: safeAmt } : p))
    );
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

  const [showBudgetRevisionInput, setShowBudgetRevisionInput] = useState(false);
  const [budgetRevisionNotesInput, setBudgetRevisionNotesInput] = useState('');

  const currentBudgetApprovalStatus: ProgramBudgetApprovalStatus = useMemo(() => {
    if (dataset.budgetApprovalStatus) {
      return dataset.budgetApprovalStatus;
    }
    if (dataset.isBudgetConfigured && (dataset.annualApprovedBudget > 0 || (dataset.totalProgramBudget || 0) > 0)) {
      return 'Menunggu Persetujuan Direktur';
    }
    return 'Draft';
  }, [dataset]);

  const isBudgetApprovedByDirector = currentBudgetApprovalStatus === 'Disetujui Direktur';

  const handleSaveBudgetAndPeriods = async () => {
    setErrorMessage(null);
    const computedAnnualForYear = draftTotalPeriodAllocated;
    if (computedAnnualForYear <= 0) {
      setErrorMessage(
        'Masukkan nominal anggaran pada periode anggaran (Custom Period) terlebih dahulu.'
      );
      return;
    }

    const nowIso = new Date().toISOString();
    const prevAnnual = dataset.annualApprovedBudget;
    const isRevisionSubmission =
      dataset.budgetApprovalStatus === 'Disetujui Direktur' ||
      dataset.budgetApprovalStatus === 'Perlu Revisi Direktur';

    // Ketika Finance mengajukan anggaran (atau revisi anggaran), status menjadi Menunggu Persetujuan Direktur.
    // Jika Direktur sendiri yang menyimpan langsung, otomatis Disetujui Direktur.
    const nextApprovalStatus: ProgramBudgetApprovalStatus = isDirector
      ? 'Disetujui Direktur'
      : 'Menunggu Persetujuan Direktur';

    const updated: ProgramBudgetDataset = {
      ...dataset,
      isBudgetConfigured: true,
      budgetApprovalStatus: nextApprovalStatus,
      budgetSubmittedBy: currentUser?.name || 'Finance Officer',
      budgetSubmittedAt: nowIso,
      ...(isDirector
        ? {
            budgetApprovedBy: currentUser?.name || 'Executive Director',
            budgetApprovedAt: nowIso,
            budgetRevisionNotes: undefined,
          }
        : {
            budgetRevisionNotes: undefined,
          }),
      totalProgramBudget: computedAnnualForYear,
      annualApprovedBudget: computedAnnualForYear,
      periodStructureType: draftStructureType,
      quarterlyPeriods: draftQuarterly,
      semesterPeriods: draftSemester,
      customPeriods: draftCustom,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Finance Officer',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: isDirector ? 'BUDGET_APPROVED_BY_DIRECTOR' : 'BUDGET_SUBMITTED_TO_DIRECTOR',
          periodStructureType: draftStructureType,
          summary: isDirector
            ? `Direktur menyimpan & meng-ACC Anggaran Program ${dataset.programName}: Total Annual Budget (${draftCustom.length} Custom Period) = ${formatRupiah(computedAnnualForYear)}.`
            : `${isRevisionSubmission ? 'Mengajukan Revisi Anggaran' : 'Mengajukan Anggaran'} Program ${
                dataset.programName
              } ke Direktur: Total Annual Budget (${draftCustom.length} Custom Period) = ${formatRupiah(computedAnnualForYear)}.`,
          previousAnnualBudget: prevAnnual,
          newAnnualBudget: computedAnnualForYear,
        },
        ...(dataset.revisions || []),
      ],
    };

    await persistDatasetToServerAndLocal(updated);
    setSuccessMessage(
      isDirector
        ? `Anggaran & Custom Period "${dataset.programName}" berhasil disimpan dan di-ACC Direktur.`
        : `${
            isRevisionSubmission ? 'Revisi anggaran' : 'Anggaran'
          } "${dataset.programName}" berhasil diajukan ke Direktur untuk di-ACC.`
    );
  };

  const handleDirectorApproveBudget = async () => {
    if (!isDirector) return;
    setErrorMessage(null);
    const computedAnnualForYear = draftTotalPeriodAllocated;
    if (computedAnnualForYear <= 0) {
      setErrorMessage('Nominal anggaran pada Custom Period belum diisi.');
      return;
    }

    const nowIso = new Date().toISOString();
    const updated: ProgramBudgetDataset = {
      ...dataset,
      isBudgetConfigured: true,
      budgetApprovalStatus: 'Disetujui Direktur',
      budgetApprovedBy: currentUser?.name || 'Executive Director',
      budgetApprovedAt: nowIso,
      budgetRevisionNotes: undefined,
      totalProgramBudget: computedAnnualForYear,
      annualApprovedBudget: computedAnnualForYear,
      customPeriods: draftCustom,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Executive Director',
          actorRole: currentUser?.roleTitle || 'Director',
          actionType: 'BUDGET_APPROVED_BY_DIRECTOR',
          periodStructureType: draftStructureType,
          summary: `Direktur menyetujui (ACC) Anggaran & Custom Period Program ${dataset.programName}: Total Annual Budget = ${formatRupiah(computedAnnualForYear)}. Finance kini dapat mengaktifkan Time Period Aktif (TOR).`,
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: computedAnnualForYear,
        },
        ...(dataset.revisions || []),
      ],
    };

    await persistDatasetToServerAndLocal(updated);
    setShowBudgetRevisionInput(false);
    setBudgetRevisionNotesInput('');
    setSuccessMessage(
      `Anggaran & Custom Period "${dataset.programName}" telah di-ACC Direktur. Finance kini dapat mengaktifkan Time Period Aktif (TOR).`
    );
  };

  const handleDirectorRequestBudgetRevision = async () => {
    if (!isDirector) return;
    const cleanNote = budgetRevisionNotesInput.trim();
    if (!cleanNote) {
      setErrorMessage('Masukkan catatan revisi anggaran untuk Finance terlebih dahulu.');
      return;
    }

    const nowIso = new Date().toISOString();
    const updated: ProgramBudgetDataset = {
      ...dataset,
      budgetApprovalStatus: 'Perlu Revisi Direktur',
      budgetRevisionNotes: cleanNote,
      budgetRevisionRequestedBy: currentUser?.name || 'Executive Director',
      budgetRevisionRequestedAt: nowIso,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Executive Director',
          actorRole: currentUser?.roleTitle || 'Director',
          actionType: 'BUDGET_REVISION_REQUESTED',
          periodStructureType: draftStructureType,
          summary: `Direktur meminta revisi Anggaran Program ${dataset.programName}. Catatan: "${cleanNote}"`,
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
        },
        ...(dataset.revisions || []),
      ],
    };

    await persistDatasetToServerAndLocal(updated);
    setShowBudgetRevisionInput(false);
    setBudgetRevisionNotesInput('');
    setSuccessMessage(`Permintaan revisi anggaran berhasil dikirim ke Finance.`);
  };

  const handleFinanceActivateTorPeriod = async (periodId: string) => {
    setErrorMessage(null);
    if (!isFinance) {
      setErrorMessage(
        'Hanya Finance yang berhak mengaktifkan Time Period Aktif (TOR).'
      );
      return;
    }
    if (!isBudgetApprovedByDirector) {
      setErrorMessage(
        'Time Period Aktif (TOR) hanya dapat diaktifkan oleh Finance setelah Anggaran di-ACC oleh Direktur.'
      );
      return;
    }

    const targetPeriod = draftCustom.find((p) => p.id === periodId);
    const nextPeriods = draftCustom.map((p) => ({
      ...p,
      isActiveForTor: p.id === periodId,
    }));
    setDraftCustom(nextPeriods);

    const nowIso = new Date().toISOString();
    const updated: ProgramBudgetDataset = {
      ...dataset,
      customPeriods: nextPeriods,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Finance Officer',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: 'ACTIVE_TOR_PERIOD_CHANGED',
          periodStructureType: draftStructureType,
          summary: `Finance mengaktifkan Time Period TOR: ${targetPeriod?.code || ''} — ${
            targetPeriod?.label || ''
          }.`,
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
        },
        ...(dataset.revisions || []),
      ],
    };

    await persistDatasetToServerAndLocal(updated);
    setSuccessMessage(
      `Time Period Aktif (TOR) berhasil diatur ke "${targetPeriod?.code} — ${targetPeriod?.label}" oleh Finance.`
    );
  };

  // Modul 3: Master Budget Code Handlers
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
      setCodeFormError('Kolom Code dan Budget Category wajib diisi.');
      return;
    }

    const isDuplicate = dataset.masterBudgetCodes.some(
      (c) =>
        c.code.toLowerCase() === cleanCode.toLowerCase() &&
        (!editingCodeItem || c.id !== editingCodeItem.id)
    );

    if (isDuplicate) {
      setCodeFormError(
        `Kode anggaran "${cleanCode}" sudah terdaftar pada program "${dataset.programName}". Duplikasi tidak diizinkan.`
      );
      return;
    }

    const nowIso = new Date().toISOString();
    let nextCodes: ProgramMasterBudgetCode[];
    let actionLabel: string;

    if (editingCodeItem) {
      nextCodes = dataset.masterBudgetCodes.map((c) =>
        c.id === editingCodeItem.id
          ? { ...c, code: cleanCode, budgetCategory: cleanCat, updatedAt: nowIso }
          : c
      );
      actionLabel = `Memperbarui Master Budget Code ${cleanCode} — ${cleanCat}`;
    } else {
      const newItem: ProgramMasterBudgetCode = {
        id: `mbc-${Date.now()}`,
        code: cleanCode,
        budgetCategory: cleanCat,
        source: 'Manual',
        createdBy: currentUser?.name || 'Finance Officer',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      nextCodes = [...dataset.masterBudgetCodes, newItem].sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true })
      );
      actionLabel = `Menambahkan Master Budget Code baru: ${cleanCode} — ${cleanCat}`;
    }

    const updated: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: nextCodes,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Finance Officer',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: 'MASTER_CODE_UPDATE',
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
          periodStructureType: dataset.periodStructureType,
          summary: actionLabel,
        },
        ...(dataset.revisions || []),
      ],
    };

    await persistDatasetToServerAndLocal(updated);
    setShowAddCodeModal(false);
    setSuccessMessage(`${actionLabel} berhasil disimpan.`);
  };

  const handleDeleteMasterCode = async (item: ProgramMasterBudgetCode) => {
    const usedInTor = tors.some(
      (t) =>
        (t.programId === activeBudgetProgram?.id ||
          t.programName === activeBudgetProgram?.name) &&
        (t.activityCode === item.code || t.hierarchyCode === item.code)
    );
    const usedInAct = activities.some((a) => a.code === item.code);
    if (usedInTor || usedInAct) {
      setErrorMessage(
        `Kode anggaran ${item.code} sedang digunakan oleh Activity atau Dokumen ToR aktif dan tidak dapat dihapus.`
      );
      return;
    }

    const nextCodes = dataset.masterBudgetCodes.filter((c) => c.id !== item.id);
    const updated: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: nextCodes,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actorName: currentUser?.name || 'Finance Officer',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: 'MASTER_CODE_UPDATE',
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
          periodStructureType: dataset.periodStructureType,
          summary: `Menghapus Master Budget Code ${item.code} (${item.budgetCategory}).`,
        },
        ...(dataset.revisions || []),
      ],
    };
    await persistDatasetToServerAndLocal(updated);
    setSuccessMessage(`Master Budget Code ${item.code} berhasil dihapus.`);
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setExcelFileName(file.name);
      const preview = await parseMasterBudgetExcelFile(file, dataset.masterBudgetCodes);
      setExcelPreviewRows(preview);
      setShowExcelPreviewModal(true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membaca file Excel.');
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
    const importedCodes: ProgramMasterBudgetCode[] = validRows.map((r, idx) => ({
      id: `mbc-imp-${Date.now()}-${idx}`,
      code: r.code,
      budgetCategory: r.budgetCategory,
      source: 'Excel Import',
      createdBy: currentUser?.name || 'Finance Officer',
      createdAt: nowIso,
      updatedAt: nowIso,
    }));

    const combined = [...dataset.masterBudgetCodes, ...importedCodes].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );

    const updated: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: combined,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Finance Officer',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: 'MASTER_CODE_UPDATE',
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
          periodStructureType: dataset.periodStructureType,
          summary: `Import Excel (${excelFileName}): berhasil menambahkan ${importedCodes.length} Master Budget Code ke "${dataset.programName}".`,
        },
        ...(dataset.revisions || []),
      ],
    };

    await persistDatasetToServerAndLocal(updated);
    setShowExcelPreviewModal(false);
    setExcelPreviewRows([]);
    setSuccessMessage(
      `Berhasil mengimpor ${importedCodes.length} Master Budget Code dari "${excelFileName}".`
    );
  };

  // Program Handlers
  const handleOpenAddProgram = () => {
    setEditingProgram(null);
    setProgramForm({
      name: '',
      location: '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      description: '',
      folderUrl: '',
      picId: currentUser?.id || '',
      status: 'Aktif',
    });
    setShowProgramModal(true);
  };

  const handleOpenEditProgram = (prog: Program, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingProgram(prog);
    setProgramForm({
      name: prog.name,
      location: prog.location,
      startDate: prog.startDate,
      endDate: prog.endDate,
      description: prog.description || '',
      folderUrl: prog.folderUrl || '',
      picId: prog.picId || currentUser?.id || '',
      status: prog.status,
    });
    setShowProgramModal(true);
  };

  const handleSaveInlineFolderUrl = async (prog: Program) => {
    try {
      const cleanUrl = inlineFolderUrlDraft.trim();
      await api.updateProgram(prog.id, {
        ...prog,
        folderUrl: cleanUrl,
      });
      try {
        localStorage.setItem(`meal_prog_folder_${prog.id}`, cleanUrl);
      } catch {
        // ignore storage errors
      }
      setEditingInlineFolderProgId(null);
      setSuccessMessage('Link Folder Program berhasil disimpan.');
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menyimpan Link Folder Program.');
    }
  };

  const handleSaveProgramSubmit = async (asDraft = false) => {
    setErrorMessage(null);
    if (!programForm.name.trim()) {
      setErrorMessage('Nama Program / Judul Program wajib diisi.');
      return;
    }
    if (!programForm.location.trim()) {
      setErrorMessage('Lokasi Program wajib diisi.');
      return;
    }
    if (!programForm.startDate) {
      setErrorMessage('Tanggal Mulai pelaksanaan program wajib diisi.');
      return;
    }
    if (!programForm.endDate) {
      setErrorMessage('Tanggal Selesai pelaksanaan program wajib diisi.');
      return;
    }
    if (new Date(programForm.endDate) < new Date(programForm.startDate)) {
      setErrorMessage('Tanggal selesai tidak boleh lebih awal daripada tanggal mulai.');
      return;
    }

    const payload = {
      ...programForm,
      name: programForm.name.trim(),
      location: programForm.location.trim(),
      description: programForm.description.trim(),
      folderUrl: (programForm.folderUrl || '').trim(),
      status: asDraft ? ('Draft' as ProgramStatus) : programForm.status,
    };

    try {
      if (editingProgram) {
        await api.updateProgram(editingProgram.id, payload);
        try {
          localStorage.setItem(`meal_prog_folder_${editingProgram.id}`, payload.folderUrl);
        } catch {
          // ignore
        }
        setSuccessMessage('Program berhasil diperbarui.');
      } else {
        const created = await api.createProgram(payload);
        try {
          if (payload.folderUrl) {
            localStorage.setItem(`meal_prog_folder_${created.id}`, payload.folderUrl);
          }
        } catch {
          // ignore
        }
        setSuccessMessage('Program baru berhasil dibuat.');
        setSelectedProgramId(created.id);
        handleSelectBudgetProgram(created.id);
      }
      setShowProgramModal(false);
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menyimpan program.');
    }
  };

  const handleDeleteProgram = async (progId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetProg = programs.find((p) => p.id === progId);
    if (!targetProg) return;
    if (targetProg.status !== 'Selesai') {
      setErrorMessage('Hanya Program yang sudah berstatus Selesai yang dapat dihapus.');
      return;
    }
    try {
      await api.deleteProgram(progId);
      setSuccessMessage(`Program "${targetProg.name}" berhasil dihapus.`);
      if (selectedProgramId === progId) {
        setSelectedProgramId(null);
      }
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menghapus program.');
    }
  };

  // Delete handlers with relational checks
  const handleDeleteOutcome = async (id: string) => {
    try {
      await api.deleteOutcome(id);
      setSuccessMessage('Outcome berhasil dihapus');
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleDeleteOutput = async (id: string) => {
    try {
      await api.deleteOutput(id);
      setSuccessMessage('Output berhasil dihapus');
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleDeleteActivity = async (id: string) => {
    try {
      await api.deleteActivity(id);
      setSuccessMessage('Activity berhasil dihapus');
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  // Hierarchy Creation / Update Submits
  const handleCreateOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProgId = selectedProgramId || activeBudgetProgram?.id;
    if (!targetProgId) {
      setErrorMessage('Pilih Program terlebih dahulu sebelum membuat Outcome.');
      return;
    }
    const currentProg = programs.find((p) => p.id === targetProgId);

    try {
      const indicators: Indicator[] = [];
      if (outcomeForm.indicatorName) {
        indicators.push({
          id: `ind-${Date.now()}`,
          name: outcomeForm.indicatorName,
          description: '',
          baseline: outcomeForm.baseline || '0',
          target: outcomeForm.target || '100%',
          unit: outcomeForm.unit || '%',
          verificationMethod: outcomeForm.verificationMethod || 'Laporan MEAL',
          reportingFrequency: outcomeForm.reportingFrequency,
          dataSource: outcomeForm.dataSource || 'Data Lapangan',
        });
      }

      await api.createOutcome({
        programId: targetProgId,
        name: outcomeForm.name.trim(),
        projectName: currentProg?.name || outcomeForm.projectName,
        description: outcomeForm.description,
        indicators,
        status: 'Belum Dimulai',
      });
      setShowAddOutcome(false);
      setOutcomeForm({
        name: '',
        projectName: '',
        description: '',
        indicatorName: '',
        baseline: '',
        target: '',
        unit: '',
        verificationMethod: '',
        reportingFrequency: 'Bulanan',
        dataSource: '',
      });
      setSuccessMessage('Outcome baru berhasil ditambahkan');
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleCreateOutputSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddOutput) return;
    try {
      const indicators: Indicator[] = [];
      if (outputForm.indicatorName) {
        indicators.push({
          id: `ind-${Date.now()}`,
          name: outputForm.indicatorName,
          description: '',
          baseline: outputForm.baseline || '0',
          target: outputForm.target || '100',
          unit: outputForm.unit || 'Unit',
          verificationMethod: outputForm.verificationMethod || 'Dokumentasi & Berita Acara',
          reportingFrequency: outputForm.reportingFrequency,
        });
      }

      await api.createOutput({
        outcomeId: showAddOutput.outcomeId,
        name: outputForm.name,
        description: outputForm.description,
        indicators,
        status: 'Belum Dimulai',
      });
      setShowAddOutput(null);
      setOutputForm({
        name: '',
        description: '',
        indicatorName: '',
        baseline: '',
        target: '',
        unit: '',
        verificationMethod: '',
        reportingFrequency: 'Bulanan',
      });
      setSuccessMessage('Output baru berhasil ditambahkan');
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleCreateOrUpdateActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddActivity && !editingActivity) return;
    try {
      const cleanCode = activityForm.code.trim();
      const cleanName = activityForm.name.trim();

      if (editingActivity) {
        await api.updateActivity(editingActivity.id, {
          name: cleanName,
          code: cleanCode || undefined,
          description: activityForm.description,
          startDate: activityForm.startDate,
          endDate: activityForm.endDate,
        });
      } else if (showAddActivity) {
        await api.createActivity({
          outputId: showAddActivity.outputId,
          name: cleanName,
          code: cleanCode || undefined,
          description: activityForm.description,
          startDate: activityForm.startDate,
          endDate: activityForm.endDate,
          status: 'Belum Dimulai',
        });
      }

      // If Activity has a Master Budget Code, automatically ensure it is registered in Modul 3: Master Budget Code
      if (cleanCode && activeBudgetProgram) {
        const existingCode = dataset.masterBudgetCodes.find(
          (c) => c.code.toLowerCase() === cleanCode.toLowerCase()
        );
        if (!existingCode) {
          const nowIso = new Date().toISOString();
          const newCodeEntry: ProgramMasterBudgetCode = {
            id: `mbc-act-${Date.now()}`,
            code: cleanCode,
            budgetCategory: cleanName,
            source: 'Database Activity',
            createdBy: currentUser?.name || 'System',
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          const updatedDs: ProgramBudgetDataset = {
            ...dataset,
            masterBudgetCodes: [...dataset.masterBudgetCodes, newCodeEntry].sort((a, b) =>
              a.code.localeCompare(b.code, undefined, { numeric: true })
            ),
          };
          await persistDatasetToServerAndLocal(updatedDs);
        }
      }

      setShowAddActivity(null);
      setEditingActivity(null);
      setActivityForm({
        name: '',
        code: '',
        description: '',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
      });
      setSuccessMessage(
        editingActivity
          ? 'Activity & Master Budget Code berhasil diperbarui'
          : 'Activity baru berhasil ditambahkan dan terhubung dengan Master Budget Code'
      );
      onRefresh();
      await fetchBudgetAndFinancialRecords();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleCreateSubActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddSubActivity) return;
    try {
      await api.createSubActivity({
        activityId: showAddSubActivity.activityId,
        name: subActivityForm.name,
        description: subActivityForm.description,
        picName: subActivityForm.picName,
        status: 'Belum Dimulai',
      });
      setShowAddSubActivity(null);
      setSubActivityForm({ name: '', description: '', picName: '' });
      setSuccessMessage('Sub-Activity berhasil ditambahkan');
      onRefresh();
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Hidden file input for Master Budget Code Excel import (available for Director & Finance) */}
      {canEditFinance && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleExcelFileChange}
          className="hidden"
        />
      )}

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* VIEW STATE 1: DAFTAR PROGRAM (Tetap pada list yang sudah ada) */}
      {!selectedProgramId ? (
        <div className="space-y-3 animate-in fade-in duration-150">
          {/* Toolbar Ringkas: Search Program, Filter Status & Tombol Tambah Program */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-[#9A9996] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari program, lokasi, PIC, atau deskripsi..."
                value={programSearchTerm}
                onChange={(e) => setProgramSearchTerm(e.target.value)}
                className="w-full h-[36px] pl-8.5 pr-8 text-[13px] bg-white border border-[#EAEAEA] hover:border-[#D4D4D0] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] focus:border-[#1D4ED8] text-[#171717] placeholder:text-[#9A9996] transition-all"
              />
              {programSearchTerm && (
                <button
                  onClick={() => setProgramSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9A9996] hover:text-[#171717] p-0.5 rounded cursor-pointer"
                  title="Hapus pencarian"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <select
                  value={programStatusFilter}
                  onChange={(e) => setProgramStatusFilter(e.target.value)}
                  className={`h-[36px] pl-3 pr-7 text-[12.5px] bg-white border rounded-md appearance-none text-[#2F3437] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] cursor-pointer transition-colors ${
                    programStatusFilter !== 'all'
                      ? 'border-[#1D4ED8] bg-blue-50/30 font-medium text-[#1D4ED8]'
                      : 'border-[#EAEAEA] hover:border-[#D4D4D0]'
                  }`}
                >
                  <option value="all">Semua Status</option>
                  <option value="Aktif">Aktif</option>
                  <option value="Draft">Draft</option>
                  <option value="Selesai">Selesai</option>
                  <option value="Diarsipkan">Diarsipkan</option>
                </select>
                <ChevronDown className="w-3 h-3 text-[#9A9996] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {(programSearchTerm || programStatusFilter !== 'all') && (
                <button
                  onClick={() => {
                    setProgramSearchTerm('');
                    setProgramStatusFilter('all');
                  }}
                  className="h-[36px] px-2.5 inline-flex items-center gap-1 text-[12px] text-[#787774] hover:text-rose-600 hover:bg-rose-50/50 border border-[#EAEAEA] rounded-md transition-colors cursor-pointer"
                  title="Reset Filter"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}

              {canManage && (
                <button
                  onClick={handleOpenAddProgram}
                  className="h-[36px] px-3.5 inline-flex items-center gap-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] active:bg-[#1E3A8A] text-white text-[12.5px] font-medium rounded-md shadow-2xs shrink-0 cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Program Baru</span>
                </button>
              )}
            </div>
          </div>

          {/* List Program yang sudah ada */}
          {(() => {
            const filteredPrograms = programs.filter((p) => {
              if (programStatusFilter !== 'all' && p.status !== programStatusFilter) return false;
              if (programSearchTerm.trim()) {
                const q = programSearchTerm.toLowerCase();
                return (
                  p.name.toLowerCase().includes(q) ||
                  p.location.toLowerCase().includes(q) ||
                  (p.description && p.description.toLowerCase().includes(q)) ||
                  (p.picName && p.picName.toLowerCase().includes(q))
                );
              }
              return true;
            });

            if (programs.length === 0) {
              return (
                <div className="bg-white rounded-md border border-dashed border-[#EAEAEA] p-10 text-center space-y-2.5">
                  <div className="w-10 h-10 rounded-full bg-[#F7F7F5] text-[#787774] flex items-center justify-center mx-auto">
                    <Building className="w-5 h-5" />
                  </div>
                  <h4 className="text-[14px] font-semibold text-[#171717]">Belum ada program kerja</h4>
                  <p className="text-[12.5px] text-[#787774] max-w-md mx-auto">
                    Buat program pertama untuk mulai menata hierarki Outcome, Output, Activity, Sub-Activity, dan dokumen TOR.
                  </p>
                  {canManage && (
                    <button
                      onClick={handleOpenAddProgram}
                      className="inline-flex items-center gap-1.5 h-[34px] px-3.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[12px] font-medium rounded-md transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Program Baru</span>
                    </button>
                  )}
                </div>
              );
            }

            if (filteredPrograms.length === 0) {
              return (
                <div className="bg-white rounded-md border border-[#EAEAEA] p-8 text-center text-[12.5px] text-[#787774]">
                  Tidak ditemukan program yang cocok dengan filter pencarian.
                </div>
              );
            }

            return (
              <div className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA]">
                {filteredPrograms.map((prog) => {
                  const progOutcomes = outcomes.filter((o) => o.programId === prog.id);
                  const progOutputs = outputs.filter((op) =>
                    progOutcomes.some((o) => o.id === op.outcomeId)
                  );
                  const progActivities = activities.filter((act) =>
                    progOutputs.some((op) => op.id === act.outputId)
                  );
                  const isMenuOpen = activeMenuId === `prog-${prog.id}`;
                  const finSummary = programFinancialSummaryMap[prog.id];

                  const dotColor =
                    prog.status === 'Aktif'
                      ? 'bg-[#16A34A]'
                      : prog.status === 'Selesai'
                      ? 'bg-[#1D4ED8]'
                      : prog.status === 'Diarsipkan'
                      ? 'bg-[#D97706]'
                      : 'bg-[#9A9996]';

                  return (
                    <div
                      key={prog.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpenProgramDetail(prog.id, false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpenProgramDetail(prog.id, false);
                        }
                      }}
                      className="px-4 sm:px-5 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white hover:bg-[#FAF9F7] transition-colors duration-150 cursor-pointer group outline-none first:rounded-t-lg last:rounded-b-lg"
                    >
                      {/* Left Column: Status Dot + 3 Compact Editorial Lines */}
                      <div className="flex-1 flex items-start gap-3 min-w-0 pr-2">
                        <div className="pt-1.5 shrink-0" title={`Status: ${prog.status}`}>
                          <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
                        </div>

                        <div className="min-w-0 flex-1 space-y-0.5">
                          {/* Row 1: Status · Hierarchy Count · Finance Summary */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[#787774]">
                            <span>
                              Status: <strong className="font-medium text-[#2F3437]">{prog.status}</strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-[#2F3437] font-medium">
                              {progOutcomes.length} Outcome / {progOutputs.length} Output / {progActivities.length} Activity
                            </span>
                            {canEditFinance && finSummary && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  Anggaran:{' '}
                                  <strong
                                    className={
                                      finSummary.metrics.isBudgetConfigured
                                        ? 'text-[#0F7B6C] font-semibold'
                                        : 'text-[#787774] font-medium'
                                    }
                                  >
                                    {finSummary.metrics.isBudgetConfigured
                                      ? formatRupiah(finSummary.metrics.annualApprovedBudget)
                                      : 'Belum Diisi'}
                                  </strong>
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums text-[#1D4ED8] font-medium">
                                  {finSummary.dataset.masterBudgetCodes.length} Budget Code
                                </span>
                              </>
                            )}
                          </div>

                          {/* Row 2: Program Title */}
                          <h3 className="text-[15px] font-semibold text-[#2F3437] group-hover:text-[#1D4ED8] transition-colors leading-snug truncate">
                            {prog.name}
                          </h3>

                          {/* Row 3: Location · Period · PIC */}
                          <div className="text-[12px] text-[#787774] flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span>{prog.location || 'Lokasi belum ditentukan'}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatPeriodRange(prog.startDate, prog.endDate)}</span>
                            {prog.picName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  PIC: <strong className="font-medium text-[#2F3437]">{prog.picName}</strong>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Vertical Accent Line & Compact Actions */}
                      <div
                        className="flex flex-wrap items-center gap-1.5 shrink-0 lg:pl-3 lg:border-l lg:border-[#EAEAEA]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEditFinance && (
                          <button
                            type="button"
                            onClick={() => handleOpenProgramDetail(prog.id, true, 'budget')}
                            className="h-7 px-2.5 bg-white hover:bg-[#F2F1EE] text-[#2F3437] text-[11.5px] font-medium rounded border border-[#E3E2E0] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                            title="Buka Pengaturan Finance Program (Khusus Director & Finance)"
                          >
                            <Wallet className="w-3.5 h-3.5 text-[#5F5E5B]" />
                            <span>Pengaturan Finance</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setParticipantsModalProgram(prog)}
                          className="h-7 px-2.5 bg-white hover:bg-[#F2F1EE] text-[#2F3437] text-[11.5px] font-medium rounded border border-[#E3E2E0] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                          title="Pilih & Kelola Peserta Program dari Master Database Peserta"
                        >
                          <Users className="w-3.5 h-3.5 text-[#5F5E5B]" />
                          <span>Peserta Program</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenProgramDetail(prog.id, false)}
                          className="h-7 px-3 rounded border border-[#E3E2E0] bg-[#FAF9F6] group-hover:bg-[#1D4ED8] group-hover:text-white group-hover:border-[#1D4ED8] text-[#2F3437] text-[11.5px] font-medium transition-colors inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>Buka Program →</span>
                        </button>

                        {canManage && prog.status === 'Selesai' && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteProgram(prog.id, e)}
                            className="h-7 px-2.5 rounded border border-rose-200 bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white text-[11.5px] font-medium transition-colors inline-flex items-center gap-1 cursor-pointer"
                            title="Hapus Program yang sudah Selesai"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus</span>
                          </button>
                        )}

                        {canManage && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(isMenuOpen ? null : `prog-${prog.id}`);
                              }}
                              className="h-7 w-7 flex items-center justify-center text-[#787774] hover:text-[#2F3437] bg-white hover:bg-[#F2F1EE] rounded border border-[#E3E2E0] transition-colors cursor-pointer"
                              title="Tindakan program lainnya"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>

                            {isMenuOpen && (
                              <div
                                className="absolute right-0 top-full mt-1 w-40 bg-white border border-[#EAEAEA] rounded-md shadow-md py-1 z-30 animate-in fade-in zoom-in-95 duration-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    setActiveMenuId(null);
                                    handleOpenEditProgram(prog, e);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-[12px] text-[#2F3437] hover:bg-[#F2F1EE] flex items-center gap-2 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-[#787774]" />
                                  <span>Edit Program</span>
                                </button>
                                {prog.status === 'Selesai' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      setActiveMenuId(null);
                                      handleDeleteProgram(prog.id, e);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-[12px] text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                    <span>Hapus Program</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ) : (
        /* VIEW STATE 2: HALAMAN DETAIL PROGRAM (Informasi Program + Pengaturan Finance untuk Director/Finance + Hierarki Hasil) */
        (() => {
          const currentProg = programs.find((p) => p.id === selectedProgramId);
          if (!currentProg) {
            return (
              <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-xs text-slate-500">
                Program tidak ditemukan.{' '}
                <button
                  onClick={() => setSelectedProgramId(null)}
                  className="text-blue-600 font-semibold underline ml-1 cursor-pointer"
                >
                  Kembali ke Daftar Program
                </button>
              </div>
            );
          }

          const programOutcomes = outcomes.filter((o) => o.programId === currentProg.id);

          return (
            <div className="space-y-2.5 animate-in fade-in duration-150">
              {/* COMPACT UNIFIED PROGRAM HEADER & NAVIGATION BAR */}
              <div className="bg-white rounded-md border border-[#EAEAEA] px-3.5 py-2.5 space-y-2">
                {/* Top Row: Back + Title + Status + Metadata + Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedProgramId(null)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#787774] hover:text-[#171717] px-2 py-1 rounded bg-[#F7F7F5] hover:bg-[#EAEAE8] border border-[#E5E5E3] transition-colors cursor-pointer shrink-0"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Program</span>
                    </button>

                    <h2 className="text-sm sm:text-[15px] font-bold text-[#171717] tracking-tight truncate">
                      {currentProg.name}
                    </h2>

                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${
                        currentProg.status === 'Aktif'
                          ? 'bg-[#EBF7F5] text-[#0F7B6C]'
                          : currentProg.status === 'Selesai'
                          ? 'bg-blue-50 text-[#1D4ED8]'
                          : currentProg.status === 'Diarsipkan'
                          ? 'bg-amber-50 text-[#D97706]'
                          : 'bg-[#F1F0EC] text-[#5F5E5B]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          currentProg.status === 'Aktif'
                            ? 'bg-[#0F7B6C]'
                            : currentProg.status === 'Selesai'
                            ? 'bg-[#1D4ED8]'
                            : currentProg.status === 'Diarsipkan'
                            ? 'bg-[#D97706]'
                            : 'bg-[#9A9996]'
                        }`}
                      />
                      {currentProg.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setParticipantsModalProgram(currentProg)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1D4ED8] bg-blue-50/70 border border-blue-200 hover:bg-blue-100/70 px-2.5 py-1 rounded transition-colors cursor-pointer"
                    >
                      <Users className="w-3.5 h-3.5 text-[#1D4ED8]" />
                      <span>Peserta Program</span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={(e) => handleOpenEditProgram(currentProg, e)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#2F3437] bg-white border border-[#EAEAEA] hover:bg-[#F2F1EE] px-2.5 py-1 rounded transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#787774]" />
                        <span>Edit</span>
                      </button>
                    )}
                    {canManage && currentProg.status === 'Selesai' && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteProgram(currentProg.id, e)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-600 hover:text-white px-2.5 py-1 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus Program</span>
                      </button>
                    )}
                    {canManage && programDetailSection === 'hierarchy' && (
                      <button
                        type="button"
                        onClick={() => {
                          setOutcomeForm({
                            name: '',
                            projectName: currentProg.name,
                            description: '',
                            indicatorName: '',
                            baseline: '',
                            target: '',
                            unit: '',
                            verificationMethod: '',
                            reportingFrequency: 'Bulanan',
                            dataSource: '',
                          });
                          setShowAddOutcome(true);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] px-2.5 py-1 rounded transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tambah Outcome</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Second Row: Inline Compact Metadata + Single-line Section Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#F1F1EF] text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#6B6B68]">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#9A9996]" />
                      <strong className="font-medium text-[#252525]">{currentProg.location}</strong>
                    </span>
                    <span className="text-[#D9D9D6]">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-[#9A9996]" />
                      <strong className="font-medium text-[#252525]">
                        {formatPeriodRange(currentProg.startDate, currentProg.endDate)}
                      </strong>
                    </span>
                    {currentProg.picName && (
                      <>
                        <span className="text-[#D9D9D6]">·</span>
                        <span className="inline-flex items-center gap-1">
                          <UserIcon className="w-3 h-3 text-[#9A9996]" />
                          <span>PIC:</span>
                          <strong className="font-medium text-[#252525]">
                            {currentProg.picName}
                          </strong>
                        </span>
                      </>
                    )}

                    {/* Compact Proportional Program Folder Link (Fillable by Program Manager / Director) */}
                    {(() => {
                      const savedLocalFolder = (() => {
                        try {
                          return localStorage.getItem(`meal_prog_folder_${currentProg.id}`) || '';
                        } catch {
                          return '';
                        }
                      })();
                      const activeFolderUrl = (currentProg.folderUrl || savedLocalFolder || '').trim();
                      const isEditingFolder = editingInlineFolderProgId === currentProg.id;

                      return (
                        <>
                          <span className="text-[#D9D9D6]">·</span>
                          {isEditingFolder ? (
                            <span className="inline-flex items-center gap-1 bg-[#F7F7F5] border border-[#D4D4D0] rounded px-1.5 py-0.5">
                              <FolderOpen className="w-3 h-3 text-[#1D4ED8] shrink-0" />
                              <input
                                type="url"
                                value={inlineFolderUrlDraft}
                                onChange={(e) => setInlineFolderUrlDraft(e.target.value)}
                                placeholder="https://drive.google.com/..."
                                className="w-44 sm:w-52 text-[11px] bg-white border border-[#E5E5E3] rounded px-1.5 py-0.5 text-[#171717] focus:outline-none focus:border-[#1D4ED8]"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveInlineFolderUrl(currentProg)}
                                className="px-1.5 py-0.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[10.5px] font-semibold rounded cursor-pointer"
                              >
                                Simpan
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingInlineFolderProgId(null)}
                                className="p-0.5 text-[#787774] hover:text-[#171717] cursor-pointer"
                                title="Batal"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ) : activeFolderUrl ? (
                            <span className="inline-flex items-center gap-1">
                              <a
                                href={
                                  activeFolderUrl.startsWith('http')
                                    ? activeFolderUrl
                                    : `https://${activeFolderUrl}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50/70 hover:bg-blue-100/80 border border-blue-200 text-[#1D4ED8] text-[11px] font-medium transition-colors"
                                title={`Buka Folder Program: ${activeFolderUrl}`}
                              >
                                <FolderOpen className="w-3 h-3 shrink-0" />
                                <span className="max-w-[140px] truncate">Folder Program</span>
                                <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-75" />
                              </a>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInlineFolderUrlDraft(activeFolderUrl);
                                    setEditingInlineFolderProgId(currentProg.id);
                                  }}
                                  className="p-0.5 text-[#9A9996] hover:text-[#171717] rounded hover:bg-[#F1F1EF] transition-colors cursor-pointer"
                                  title="Ubah Link Folder Program (Program Manager)"
                                >
                                  <Edit3 className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </span>
                          ) : canManage ? (
                            <button
                              type="button"
                              onClick={() => {
                                setInlineFolderUrlDraft('');
                                setEditingInlineFolderProgId(currentProg.id);
                              }}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#F7F7F5] hover:bg-[#EAEAE8] border border-dashed border-[#D4D4D0] text-[#5F5E5B] hover:text-[#1D4ED8] text-[11px] font-medium transition-colors cursor-pointer"
                              title="Isi Link Folder Program (Drive / OneDrive)"
                            >
                              <FolderOpen className="w-3 h-3 text-[#787774]" />
                              <span>+ Link Folder</span>
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-[#9A9996]">
                              <FolderOpen className="w-3 h-3" />
                              <span>Folder belum diisi</span>
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {/* Single-Line Compact Tab Switcher */}
                  <div className="inline-flex items-center gap-1 bg-[#F4F4F2] p-1 rounded border border-[#E5E5E3]">
                    <button
                      type="button"
                      onClick={() => setProgramDetailSection('hierarchy')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        programDetailSection === 'hierarchy'
                          ? 'bg-white text-[#1D4ED8] shadow-2xs border border-[#E5E5E3]'
                          : 'text-[#5F5E5B] hover:text-[#171717]'
                      }`}
                    >
                      <FolderTree className="w-3.5 h-3.5" />
                      <span>Hierarki &amp; ToR ({programOutcomes.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setProgramDetailSection('participants')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        programDetailSection === 'participants'
                          ? 'bg-white text-[#1D4ED8] shadow-2xs border border-[#E5E5E3]'
                          : 'text-[#5F5E5B] hover:text-[#171717]'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Tracing Peserta</span>
                    </button>

                    {canEditFinance && (
                      <button
                        type="button"
                        onClick={() => setProgramDetailSection('finance')}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                          programDetailSection === 'finance'
                            ? 'bg-white text-[#1D4ED8] shadow-2xs border border-[#E5E5E3]'
                            : 'text-[#5F5E5B] hover:text-[#171717]'
                        }`}
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        <span>Finance ({dataset.masterBudgetCodes.length} Kode)</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* =================================================================== */}
              {/* TRACING PESERTA: AKUMULASI PER OUTCOME TANPA DUPLIKASI ACTIVITY     */}
              {/* =================================================================== */}
              {programDetailSection === 'participants' && (
                <div className="animate-in fade-in duration-150">
                  <ProgramOutcomeParticipantTracing
                    program={currentProg}
                    outcomes={outcomes}
                    outputs={outputs}
                    activities={activities}
                    participants={masterParticipants}
                    monitoringItems={allMonitoringReports}
                    onOpenManageModal={() => setParticipantsModalProgram(currentProg)}
                  />
                </div>
              )}

              {/* =================================================================== */}
              {/* BAGIAN 2 (HALAMAN TERPISAH): RINGKASAN & PENGATURAN FINANCE PROGRAM */}
              {/* =================================================================== */}
              {canEditFinance && programDetailSection === 'finance' && (
                <div className="bg-white rounded-md border border-[#EAEAEA] overflow-hidden animate-in fade-in duration-150">
                  {/* Single Unified 3-Tab Metric Navigation Bar (Clean, Proportional, Zero Wrapping) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#EAEAEA] border-b border-[#EAEAEA] bg-[#FAFAF9]">
                    {/* TAB 1: ANGGARAN & PERIODE */}
                    <button
                      type="button"
                      onClick={() => setFinanceSectionTab('budget')}
                      className={`text-left px-4 py-2.5 flex flex-col justify-between gap-1.5 transition-colors cursor-pointer ${
                        financeSectionTab === 'budget'
                          ? 'bg-white shadow-[inset_0_2px_0_0_#1D4ED8]'
                          : 'hover:bg-[#F4F4F2]/70 text-[#5F5E5B]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span
                          className={`text-[11.5px] font-bold uppercase tracking-wider whitespace-nowrap ${
                            financeSectionTab === 'budget' ? 'text-[#1D4ED8]' : 'text-[#171717]'
                          }`}
                        >
                          1. Anggaran &amp; Periode
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-mono font-semibold whitespace-nowrap shrink-0 ${
                            currentBudgetApprovalStatus === 'Disetujui Direktur'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : currentBudgetApprovalStatus === 'Perlu Revisi Direktur'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : currentBudgetApprovalStatus === 'Menunggu Persetujuan Direktur'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-[#F1F1EF] text-[#5F5E5B] border-[#E5E5E3]'
                          }`}
                        >
                          {currentBudgetApprovalStatus === 'Disetujui Direktur'
                            ? 'ACC Direktur'
                            : currentBudgetApprovalStatus === 'Perlu Revisi Direktur'
                            ? 'Perlu Revisi'
                            : currentBudgetApprovalStatus === 'Menunggu Persetujuan Direktur'
                            ? 'Menunggu Direktur'
                            : 'Draft'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 w-full text-[11px]">
                        <span className="text-[#787774] font-mono truncate">
                          Total:{' '}
                          <strong className="text-[#171717]">
                            {metrics.totalProgramBudget > 0
                              ? formatRupiah(metrics.totalProgramBudget)
                              : 'Belum Diisi'}
                          </strong>{' '}
                          ({activeSavedPeriods.length} Periode)
                        </span>
                        <span className="font-mono font-bold text-[#171717] whitespace-nowrap shrink-0">
                          Annual:{' '}
                          {metrics.isBudgetConfigured ? (
                            formatRupiah(metrics.annualApprovedBudget)
                          ) : (
                            <span className="text-[#B26B00] font-sans font-semibold">Belum Diisi</span>
                          )}
                        </span>
                      </div>
                    </button>

                    {/* TAB 2: MASTER BUDGET CODE */}
                    <button
                      type="button"
                      onClick={() => setFinanceSectionTab('codes')}
                      className={`text-left px-4 py-2.5 flex flex-col justify-between gap-1.5 transition-colors cursor-pointer ${
                        financeSectionTab === 'codes'
                          ? 'bg-white shadow-[inset_0_2px_0_0_#1D4ED8]'
                          : 'hover:bg-[#F4F4F2]/70 text-[#5F5E5B]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span
                          className={`text-[11.5px] font-bold uppercase tracking-wider whitespace-nowrap ${
                            financeSectionTab === 'codes' ? 'text-[#1D4ED8]' : 'text-[#171717]'
                          }`}
                        >
                          2. Master Budget Code
                        </span>
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-[#1D4ED8] border border-blue-200 text-[10px] font-mono font-semibold whitespace-nowrap shrink-0">
                          {dataset.masterBudgetCodes.length} Kode Aktif
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 w-full text-[11px]">
                        <span className="text-[#787774] truncate">
                          Tabel 2 Kolom (Code | Category)
                        </span>
                        <span className="font-mono font-semibold text-[#1D4ED8] whitespace-nowrap shrink-0">
                          Terdaftar: {dataset.masterBudgetCodes.length}
                        </span>
                      </div>
                    </button>

                    {/* TAB 3: CASH ADVANCE & SISA ANGGARAN */}
                    <button
                      type="button"
                      onClick={() => setFinanceSectionTab('ca')}
                      className={`text-left px-4 py-2.5 flex flex-col justify-between gap-1.5 transition-colors cursor-pointer ${
                        financeSectionTab === 'ca'
                          ? 'bg-white shadow-[inset_0_2px_0_0_#1D4ED8]'
                          : 'hover:bg-[#F4F4F2]/70 text-[#5F5E5B]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span
                          className={`text-[11.5px] font-bold uppercase tracking-wider whitespace-nowrap ${
                            financeSectionTab === 'ca' ? 'text-[#1D4ED8]' : 'text-[#171717]'
                          }`}
                        >
                          3. Cash Advance &amp; Sisa
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#EBF7F5] border border-[#C6E9E3] text-[10px] font-mono font-semibold text-[#0F7B6C] whitespace-nowrap shrink-0">
                          {programScopedCashAdvances.length} Dokumen CA
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 w-full text-[11px]">
                        <span className="text-[#787774] truncate">
                          Realisasi &amp; sisa anggaran
                        </span>
                        <span
                          className={`font-mono font-bold whitespace-nowrap shrink-0 ${
                            metrics.availableBudget !== null && metrics.availableBudget < 0
                              ? 'text-rose-600'
                              : 'text-[#0F7B6C]'
                          }`}
                        >
                          Sisa:{' '}
                          {metrics.isBudgetConfigured && metrics.availableBudget !== null
                            ? formatRupiah(metrics.availableBudget)
                            : 'Belum Diisi'}
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Panel Pengaturan Finance Terstruktur */}
                  <div>
                    {/* SUB-TAB 1: ANGGARAN & BUDGET PERIOD */}
                    {financeSectionTab === 'budget' && (
                      <div className="p-3 space-y-2.5">
                        {/* Compact Single-Row Budget Controls & Director Approval Bar */}
                        <div className="px-3 py-2 rounded bg-[#F7F7F5] border border-[#E5E5E3] space-y-2">
                          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2.5 flex-1">
                              {/* Total Budget (IDR) otomatis didapat dari Total Annual Budget (Jumlah Seluruh Custom Period) */}
                              <div className="inline-flex items-center gap-2 bg-white px-2.5 py-1 rounded border border-[#D4D4D0]">
                                <span className="text-[11px] font-bold text-[#252525] whitespace-nowrap">
                                  Total Budget (IDR):
                                </span>
                                <span className="text-xs font-mono font-bold text-[#1D4ED8] tabular-nums">
                                  {draftTotalPeriodAllocated > 0
                                    ? formatRupiah(draftTotalPeriodAllocated)
                                    : 'Rp 0'}
                                </span>
                                <span className="text-[10.5px] text-[#787774] font-mono">
                                  ({activeDraftPeriods.length} Periode)
                                </span>
                              </div>

                              <span className="text-[#D4D4D0] hidden sm:inline">·</span>

                              {/* Status Persetujuan Direktur Badge */}
                              <div className="inline-flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold whitespace-nowrap ${
                                    currentBudgetApprovalStatus === 'Disetujui Direktur'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : currentBudgetApprovalStatus === 'Perlu Revisi Direktur'
                                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                                      : currentBudgetApprovalStatus === 'Menunggu Persetujuan Direktur'
                                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                                      : 'bg-white text-[#5F5E5B] border-[#D4D4D0]'
                                  }`}
                                >
                                  Status: {currentBudgetApprovalStatus}
                                </span>
                                {dataset.budgetApprovedBy &&
                                  currentBudgetApprovalStatus === 'Disetujui Direktur' && (
                                    <span className="text-[10.5px] text-[#787774] font-mono">
                                      oleh {dataset.budgetApprovedBy}
                                    </span>
                                  )}
                                {currentBudgetApprovalStatus === 'Menunggu Persetujuan Direktur' &&
                                  dataset.budgetSubmittedBy && (
                                    <span className="text-[10.5px] text-amber-800 font-mono">
                                      (Pengajuan dari {dataset.budgetSubmittedBy})
                                    </span>
                                  )}
                              </div>
                            </div>

                            {/* Action Buttons: Jika sudah di-ACC Direktur, tidak perlu tampilkan tombol ACC/Revisi lagi kecuali ada notifikasi pengajuan baru dari Finance */}
                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                              {/* Finance dapat menambah periode & mengajukan anggaran/revisi ke Direktur */}
                              {isFinance && (
                                <>
                                  <button
                                    type="button"
                                    onClick={handleAddCustomPeriod}
                                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded border border-[#D4D4D0] bg-white hover:bg-[#F4F4F2] text-[11px] font-semibold text-[#252525] cursor-pointer whitespace-nowrap"
                                  >
                                    <Plus className="w-3 h-3 text-[#1D4ED8]" />
                                    <span>Tambah Periode</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleSaveBudgetAndPeriods}
                                    className="inline-flex items-center gap-1 h-7 px-3 rounded text-[11px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] cursor-pointer whitespace-nowrap"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>
                                      {currentBudgetApprovalStatus === 'Disetujui Direktur' ||
                                      currentBudgetApprovalStatus === 'Perlu Revisi Direktur'
                                        ? 'Ajukan Revisi ke Direktur'
                                        : 'Ajukan Anggaran ke Direktur'}
                                    </span>
                                  </button>
                                </>
                              )}

                              {/* Direktur: Hanya tampilkan tombol ACC / Minta Revisi jika belum di-ACC atau ada pengajuan/notifikasi baru dari Finance */}
                              {isDirector && currentBudgetApprovalStatus !== 'Disetujui Direktur' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={handleAddCustomPeriod}
                                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded border border-[#D4D4D0] bg-white hover:bg-[#F4F4F2] text-[11px] font-semibold text-[#252525] cursor-pointer whitespace-nowrap"
                                  >
                                    <Plus className="w-3 h-3 text-[#1D4ED8]" />
                                    <span>Tambah Periode</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleDirectorApproveBudget}
                                    className="inline-flex items-center gap-1 h-7 px-3 rounded text-[11px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>Setujui Anggaran (ACC Direktur)</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setShowBudgetRevisionInput((prev) => !prev)}
                                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                  >
                                    <span>Minta Revisi</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Catatan Revisi Direktur (Jika Ada) */}
                          {dataset.budgetRevisionNotes &&
                            currentBudgetApprovalStatus === 'Perlu Revisi Direktur' && (
                              <div className="px-2.5 py-1.5 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800 flex items-center justify-between gap-2">
                                <span>
                                  <strong>Catatan Revisi Direktur:</strong> &ldquo;
                                  {dataset.budgetRevisionNotes}&rdquo;
                                </span>
                                {dataset.budgetRevisionRequestedBy && (
                                  <span className="font-mono text-[10px] shrink-0">
                                    Oleh: {dataset.budgetRevisionRequestedBy}
                                  </span>
                                )}
                              </div>
                            )}

                          {/* Form Input Revisi Direktur */}
                          {isDirector && showBudgetRevisionInput && (
                            <div className="p-2 rounded bg-amber-50/80 border border-amber-200 flex flex-col sm:flex-row gap-2 text-xs">
                              <input
                                type="text"
                                value={budgetRevisionNotesInput}
                                onChange={(e) => setBudgetRevisionNotesInput(e.target.value)}
                                placeholder="Tuliskan catatan revisi anggaran / periode untuk Finance..."
                                className="flex-1 h-7 px-2.5 rounded border border-amber-300 bg-white text-[#252525] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={handleDirectorRequestBudgetRevision}
                                className="h-7 px-3 rounded bg-amber-800 hover:bg-amber-900 text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                              >
                                Kirim Revisi ke Finance
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="overflow-x-auto border border-[#E5E5E3] rounded">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[10.5px] font-bold uppercase text-[#787774]">
                                <th className="py-1.5 px-3">Kode</th>
                                <th className="py-1.5 px-3">Nama Periode (Custom Period)</th>
                                <th className="py-1.5 px-3">Rentang Tanggal Disepakati</th>
                                <th className="py-1.5 px-3 text-right">Nominal Periode (IDR)</th>
                                <th className="py-1.5 px-3 text-center">
                                  Time Period Aktif (TOR)
                                </th>
                                <th className="py-1.5 px-3 text-center w-14">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EAEAEA]">
                              {activeDraftPeriods.map((period, idx) => {
                                const hasExplicitActive = activeDraftPeriods.some(
                                  (p) => p.isActiveForTor
                                );
                                const isTorActive = hasExplicitActive
                                  ? Boolean(period.isActiveForTor)
                                  : idx === 0;
                                return (
                                  <tr key={period.id} className="hover:bg-[#FAFAF9]">
                                    <td className="py-1.5 px-3 font-mono font-bold text-[#252525]">
                                      <input
                                        type="text"
                                        value={period.code}
                                        onChange={(e) =>
                                          handleUpdateCustomPeriodMeta(period.id, 'code', e.target.value)
                                        }
                                        className="w-20 px-2 py-1 text-xs font-mono border border-[#D4D4D0] rounded"
                                      />
                                    </td>
                                    <td className="py-1.5 px-3 font-medium text-[#252525]">
                                      <input
                                        type="text"
                                        value={period.label}
                                        onChange={(e) =>
                                          handleUpdateCustomPeriodMeta(period.id, 'label', e.target.value)
                                        }
                                        className="w-full px-2 py-1 text-xs border border-[#D4D4D0] rounded"
                                      />
                                    </td>
                                    <td className="py-1.5 px-3 font-mono text-[11px] text-[#5A5A58]">
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          type="date"
                                          value={period.startDate}
                                          onChange={(e) =>
                                            handleUpdateCustomPeriodMeta(period.id, 'startDate', e.target.value)
                                          }
                                          className="px-2 py-1 text-xs font-mono border border-[#D4D4D0] rounded"
                                        />
                                        <span>s/d</span>
                                        <input
                                          type="date"
                                          value={period.endDate}
                                          onChange={(e) =>
                                            handleUpdateCustomPeriodMeta(period.id, 'endDate', e.target.value)
                                          }
                                          className="px-2 py-1 text-xs font-mono border border-[#D4D4D0] rounded"
                                        />
                                      </div>
                                    </td>
                                    <td className="py-1.5 px-3 text-right">
                                      <input
                                        type="number"
                                        min={0}
                                        step={500000}
                                        value={period.allocatedAmount || ''}
                                        placeholder="0"
                                        onChange={(e) =>
                                          handleUpdateDraftPeriodAmount(period.id, Number(e.target.value))
                                        }
                                        className="w-40 text-right px-2.5 py-1 text-xs font-mono font-bold text-[#252525] bg-white border border-[#D4D4D0] rounded focus:outline-none focus:border-[#1D4ED8]"
                                      />
                                    </td>
                                    <td className="py-1.5 px-3 text-center whitespace-nowrap">
                                      {!isBudgetApprovedByDirector ? (
                                        <span
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F4F3EF] border border-[#E3E2E0] text-[#787774] text-[10.5px] font-medium cursor-not-allowed"
                                          title="Time Period Aktif (TOR) hanya dapat diaktifkan oleh Finance setelah Anggaran di-ACC oleh Direktur"
                                        >
                                          <Lock className="w-3 h-3 text-[#9B9A97]" />
                                          <span>Menunggu ACC Direktur</span>
                                        </span>
                                      ) : isFinance ? (
                                        <button
                                          type="button"
                                          onClick={() => handleFinanceActivateTorPeriod(period.id)}
                                          className={`px-2.5 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                                            isTorActive
                                              ? 'bg-emerald-600 text-white'
                                              : 'bg-white border border-[#D4D4D0] text-[#5A5A58] hover:bg-[#F4F4F2]'
                                          }`}
                                          title="Wewenang Finance: Aktifkan periode ini sebagai dasar pembuatan TOR"
                                        >
                                          {isTorActive ? 'Aktif' : 'Pilih'}
                                        </button>
                                      ) : (
                                        <span
                                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10.5px] font-semibold ${
                                            isTorActive
                                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                              : 'bg-[#F7F7F5] text-[#787774] border border-[#E5E5E3]'
                                          }`}
                                          title="Hanya Finance yang berhak mengubah Time Period Aktif (TOR)"
                                        >
                                          {isTorActive ? 'Aktif (TOR)' : 'Nonaktif'}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-3 text-center">
                                      <button
                                        type="button"
                                        disabled={draftCustom.length <= 1}
                                        onClick={() => handleRemoveCustomPeriod(period.id)}
                                        className="p-1 text-rose-600 hover:bg-rose-50 rounded disabled:opacity-30 cursor-pointer"
                                        title="Hapus periode custom"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-[#252525] bg-[#F7F7F5] font-bold text-[#252525]">
                                <td colSpan={3} className="py-1.5 px-3">
                                  Total Annual Budget (Jumlah Seluruh Custom Period)
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono text-[#1D4ED8]">
                                  {formatRupiah(draftTotalPeriodAllocated)}
                                </td>
                                <td colSpan={2} className="py-1.5 px-3 text-center text-[10.5px] font-normal text-[#5F5E5B]">
                                  {isBudgetApprovedByDirector
                                    ? 'Anggaran Di-ACC Direktur · Finance Dapat Mengaktifkan TOR'
                                    : 'Menunggu ACC Direktur'}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* SUB-TAB 2: MASTER BUDGET CODE (2 KOLOM: CODE | BUDGET CATEGORY) */}
                    {financeSectionTab === 'codes' && (
                      <div className="p-3 space-y-2.5">
                        {/* Single-Row Toolbar: Search + Count + Excel Actions + Add Code */}
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F7F7F5] px-3 py-2 rounded border border-[#E5E5E3]">
                          <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
                            <div className="relative flex-1 max-w-xs">
                              <Search className="w-3.5 h-3.5 text-[#9B9A97] absolute left-2.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={codeSearch}
                                onChange={(e) => setCodeSearch(e.target.value)}
                                placeholder="Cari Code atau Budget Category..."
                                className="w-full h-7 pl-8 pr-2.5 text-xs bg-white border border-[#D4D4D0] rounded focus:outline-none focus:border-[#1D4ED8]"
                              />
                            </div>
                            <span className="text-[11px] font-mono text-[#5F5E5B] shrink-0">
                              <strong>{dataset.masterBudgetCodes.length}</strong> Kode Aktif
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => downloadMasterBudgetExcelTemplate(dataset.programName)}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded text-[11px] font-semibold border border-[#D4D4D0] bg-white text-[#252525] hover:bg-[#EAEAE8] cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              <span>Template Excel</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded text-[11px] font-semibold border border-[#B7DFC1] bg-[#EAF3EC] text-[#2B6E3F] hover:bg-[#D5E9D9] cursor-pointer"
                            >
                              <Upload className="w-3 h-3" />
                              <span>Import Excel</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleOpenAddCode}
                              className="inline-flex items-center gap-1 h-7 px-3 rounded text-[11px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Code</span>
                            </button>
                          </div>
                        </div>

                        <div className="overflow-x-auto border border-[#E5E5E3] rounded">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[10.5px] font-bold uppercase text-[#252525]">
                                <th className="py-1.5 px-3 w-44 border-r border-[#E5E5E3]">Code</th>
                                <th className="py-1.5 px-3">Budget Category</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EAEAEA]">
                              {dataset.masterBudgetCodes
                                .filter((item) => {
                                  const q = codeSearch.trim().toLowerCase();
                                  return (
                                    !q ||
                                    item.code.toLowerCase().includes(q) ||
                                    item.budgetCategory.toLowerCase().includes(q)
                                  );
                                })
                                .map((item) => (
                                  <tr key={item.id} className="hover:bg-[#FAFAF9] group">
                                    <td className="py-1.5 px-3 font-mono font-bold text-[#1D4ED8] border-r border-[#EAEAEA]">
                                      {item.code}
                                    </td>
                                    <td className="py-1.5 px-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium text-[#252525]">
                                          {item.budgetCategory}
                                        </span>
                                        <div className="inline-flex items-center gap-1 opacity-80 group-hover:opacity-100">
                                          <button
                                            type="button"
                                            onClick={() => handleOpenEditCode(item)}
                                            className="px-2 py-0.5 rounded text-[10px] font-semibold border border-[#D4D4D0] text-[#5A5A58] hover:text-[#252525] bg-white cursor-pointer"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteMasterCode(item)}
                                            className="px-2 py-0.5 rounded text-[10px] font-semibold border border-[#F5C2C2] text-[#C93B3B] hover:bg-[#FDECEC] cursor-pointer"
                                          >
                                            Hapus
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              {dataset.masterBudgetCodes.length === 0 && (
                                <tr>
                                  <td colSpan={2} className="py-6 text-center text-xs text-[#787774]">
                                    Belum ada Budget Code pada Program ini. Gunakan tombol{' '}
                                    <strong>Add Code</strong> atau <strong>Import Excel</strong>.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* SUB-TAB 3: CASH ADVANCE CONNECTION */}
                    {financeSectionTab === 'ca' && (
                      <div className="p-3 space-y-2.5">
                        {programScopedCashAdvances.length === 0 ? (
                          <div className="p-5 rounded border border-dashed border-[#D4D4D0] bg-[#FAFAF9] text-center text-xs text-[#787774]">
                            Belum ada dokumen Cash Advance yang tercatat untuk Program ini.
                          </div>
                        ) : (
                          <div className="overflow-x-auto border border-[#E5E5E3] rounded">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-[#E5E5E3] bg-[#F7F7F5] text-[10.5px] font-bold uppercase text-[#787774]">
                                  <th className="py-1.5 px-3">No. Dokumen CA</th>
                                  <th className="py-1.5 px-3">Kegiatan / Pemohon</th>
                                  <th className="py-1.5 px-3">Budget Code Program</th>
                                  <th className="py-1.5 px-3 text-right">Total Diajukan</th>
                                  <th className="py-1.5 px-3 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#EAEAEA]">
                                {programScopedCashAdvances.map((ca) => {
                                  const referencedCodes = Array.from(
                                    new Set(
                                      (ca.items || [])
                                        .map((it) => String(it.budgetCode || '').trim())
                                        .filter(Boolean)
                                    )
                                  );
                                  return (
                                    <tr key={ca.id} className="hover:bg-[#FAFAF9]">
                                      <td className="py-1.5 px-3 font-mono font-bold text-[#252525]">
                                        {ca.advanceNumber || ca.id}
                                      </td>
                                      <td className="py-1.5 px-3">
                                        <div className="font-medium text-[#252525]">
                                          {ca.activityTitle || '-'}
                                        </div>
                                        <div className="text-[10.5px] text-[#787774]">
                                          Pemohon: {ca.requesterName || '-'}
                                        </div>
                                      </td>
                                      <td className="py-1.5 px-3 font-mono text-[11px] text-[#1D4ED8]">
                                        {referencedCodes.length > 0 ? (
                                          referencedCodes.map((code) => {
                                            const matchedCat = dataset.masterBudgetCodes.find(
                                              (mc) => mc.code.toLowerCase() === code.toLowerCase()
                                            );
                                            return (
                                              <div key={code}>
                                                <strong>{code}</strong>
                                                {matchedCat ? ` — ${matchedCat.budgetCategory}` : ''}
                                              </div>
                                            );
                                          })
                                        ) : (
                                          <span className="text-[#9A9996]">-</span>
                                        )}
                                      </td>
                                      <td className="py-1.5 px-3 text-right font-mono font-semibold text-[#252525]">
                                        {formatRupiah(Number(ca.totalAmount) || 0)}
                                      </td>
                                      <td className="py-1.5 px-3 text-center">
                                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F7F7F5] border border-[#D4D4D0] text-[#252525]">
                                          {ca.status}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

                  {/* =================================================================== */}
                  {/* BAGIAN 1: STRUKTUR HIERARKI HASIL & TOR PROGRAM                     */}
                  {/* =================================================================== */}
                  {programDetailSection === 'hierarchy' && (
                    <div className="space-y-2.5 animate-in fade-in duration-150">
                  {/* HIERARKI OUTCOME -> OUTPUT -> ACTIVITY -> SUB-ACTIVITY -> TOR */}
                  {programOutcomes.length === 0 ? (
                    <div className="bg-white rounded-md border border-dashed border-[#EAEAEA] p-8 text-center space-y-2">
                      <div className="w-9 h-9 rounded-full bg-[#F7F7F5] text-[#787774] flex items-center justify-center mx-auto">
                        <FolderTree className="w-4 h-4" />
                      </div>
                      <h4 className="text-[13.5px] font-semibold text-[#171717]">
                        Belum ada Outcome pada Program ini
                      </h4>
                      <p className="text-[12px] text-[#787774] max-w-sm mx-auto">
                        Mulai susun rantai hasil program dengan menambahkan Outcome pertama.
                      </p>
                      {canManage && (
                        <button
                          onClick={() => {
                            setOutcomeForm({
                              name: '',
                              projectName: currentProg.name,
                              description: '',
                              indicatorName: '',
                              baseline: '',
                              target: '',
                              unit: '',
                              verificationMethod: '',
                              reportingFrequency: 'Bulanan',
                              dataSource: '',
                            });
                            setShowAddOutcome(true);
                          }}
                          className="inline-flex items-center gap-1.5 h-[30px] px-3 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[11.5px] font-medium rounded transition-colors cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Tambah Outcome Pertama</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {programOutcomes.map((outcome) => {
                        const isOutExpanded = expandedOutcomes[outcome.id] ?? false;
                        const relatedOutputs = outputs.filter((op) => op.outcomeId === outcome.id);

                        return (
                          <div
                            key={outcome.id}
                            className="bg-white rounded-md border border-[#EAEAEA] overflow-hidden transition-all"
                          >
                            {/* 1. OUTCOME ROW */}
                            <div className="px-3 py-2.5 bg-white hover:bg-[#FAFAF9] flex items-center justify-between gap-2.5 transition-colors border-b border-[#EAEAEA]">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => toggleOutcome(outcome.id)}
                                  className="p-1 text-[#787774] hover:text-[#171717] rounded hover:bg-[#F2F1EE] cursor-pointer shrink-0 transition-colors"
                                  title={isOutExpanded ? 'Tutup Outcome' : 'Buka Outcome'}
                                >
                                  {isOutExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-[#1D4ED8]" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-[#9A9996]" />
                                  )}
                                </button>

                                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className="text-[10px] font-mono font-semibold tracking-wider text-[#1D4ED8] bg-blue-50/70 border border-blue-200/60 px-1.5 py-0.2 rounded uppercase shrink-0">
                                    OUTCOME
                                  </span>
                                  <h3 className="text-[13.5px] sm:text-[14px] font-semibold text-[#171717] leading-snug">
                                    {outcome.name}
                                  </h3>
                                  <span className="text-[11px] text-[#787774]">
                                    ({outcome.indicators.length} Indikator · {relatedOutputs.length} Output
                                    {outcome.picName ? ` · PIC: ${outcome.picName}` : ''})
                                  </span>
                                </div>
                              </div>

                              {/* Outcome Actions */}
                              <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
                                <button
                                  type="button"
                                  onClick={() => setSelectedOutcomeDetail(outcome)}
                                  className="h-[28px] px-2.5 text-[11.5px] font-medium text-[#2F3437] hover:text-[#171717] bg-white hover:bg-[#F2F1EE] border border-[#EAEAEA] rounded transition-colors cursor-pointer"
                                >
                                  Detail Indikator
                                </button>

                                {canManage && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setShowAddOutput({ outcomeId: outcome.id })}
                                      className="h-[28px] px-2.5 text-[11.5px] font-medium text-[#0F7B6C] bg-[#EBF7F5] hover:bg-[#D5EFEA] border border-[#C0E8DF] rounded transition-colors inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>Output</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteOutcome(outcome.id)}
                                      className="h-[28px] w-[28px] flex items-center justify-center text-[#9A9996] hover:text-rose-600 hover:bg-rose-50 rounded border border-[#EAEAEA] transition-colors cursor-pointer"
                                      title="Hapus Outcome"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* 2. OUTPUTS HIERARCHY */}
                            {isOutExpanded && (
                              <div className="p-2 sm:p-3 pl-4 sm:pl-7 border-l-2 border-[#EAEAEA] ml-3 sm:ml-5 my-2 space-y-3">
                                {relatedOutputs.length === 0 ? (
                                  <div className="p-3 bg-[#FAFAF9] rounded border border-dashed border-[#EAEAEA] text-[12px] text-[#787774] text-center">
                                    Belum ada Output pada Outcome ini.{' '}
                                    {canManage && (
                                      <button
                                        onClick={() => setShowAddOutput({ outcomeId: outcome.id })}
                                        className="text-[#1D4ED8] font-medium hover:underline ml-1 cursor-pointer"
                                      >
                                        Tambah Output sekarang
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  relatedOutputs.map((output) => {
                                    const isOpExpanded = expandedOutputs[output.id] ?? false;
                                    const relatedActivities = activities.filter(
                                      (a) => a.outputId === output.id
                                    );
                                    const isOutputMenuOpen = activeMenuId === `op-${output.id}`;

                                    return (
                                      <div
                                        key={output.id}
                                        className="bg-white rounded border border-[#EAEAEA] overflow-hidden"
                                      >
                                        {/* Level 2: Output Row */}
                                        <div className="p-2.5 sm:p-3 bg-white hover:bg-[#FAFAF9] flex items-start justify-between gap-3 transition-colors border-b border-[#EAEAEA]">
                                          <div className="flex items-start gap-2 flex-1 min-w-0">
                                            <button
                                              type="button"
                                              onClick={() => toggleOutput(output.id)}
                                              className="p-1 text-[#787774] hover:text-[#171717] rounded hover:bg-[#F2F1EE] mt-0.5 cursor-pointer shrink-0 transition-colors"
                                              title={isOpExpanded ? 'Tutup Output' : 'Buka Output'}
                                            >
                                              {isOpExpanded ? (
                                                <ChevronDown className="w-3.5 h-3.5 text-[#0F7B6C]" />
                                              ) : (
                                                <ChevronRight className="w-3.5 h-3.5 text-[#9A9996]" />
                                              )}
                                            </button>

                                            <div className="flex-1 min-w-0 space-y-0.5">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[9.5px] font-mono font-semibold tracking-wider text-[#0F7B6C] bg-[#EBF7F5] border border-[#C0E8DF] px-1.5 py-0.2 rounded uppercase">
                                                  OUTPUT
                                                </span>
                                                {output.picName && (
                                                  <span className="text-[11.5px] text-[#787774]">
                                                    PIC:{' '}
                                                    <strong className="text-[#2F3437] font-medium">
                                                      {output.picName}
                                                    </strong>
                                                  </span>
                                                )}
                                                <span className="text-[#D3D3D0]">·</span>
                                                <span className="text-[11.5px] text-[#787774]">
                                                  {output.indicators.length} Indikator
                                                </span>
                                                <span className="text-[#D3D3D0]">·</span>
                                                <span className="text-[11.5px] text-[#787774]">
                                                  {relatedActivities.length} Activity
                                                </span>
                                              </div>

                                              <h4 className="text-[13.5px] sm:text-[14.5px] font-semibold text-[#171717] leading-snug">
                                                {output.name}
                                              </h4>
                                            </div>
                                          </div>

                                          {/* Output Actions */}
                                          <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
                                            <button
                                              type="button"
                                              onClick={() => setSelectedOutputDetail(output)}
                                              className="h-[26px] px-2 text-[11px] font-medium text-[#2F3437] hover:text-[#171717] bg-white hover:bg-[#F2F1EE] border border-[#EAEAEA] rounded transition-colors cursor-pointer"
                                            >
                                              Detail Indikator
                                            </button>

                                            {canManage && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditingActivity(null);
                                                  setActivityForm({
                                                    name: '',
                                                    code: '',
                                                    description: '',
                                                    startDate: new Date().toISOString().slice(0, 10),
                                                    endDate: new Date().toISOString().slice(0, 10),
                                                  });
                                                  setShowAddActivity({ outputId: output.id });
                                                }}
                                                className="h-[26px] px-2 text-[11px] font-medium text-[#1D4ED8] bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200/70 rounded transition-colors inline-flex items-center gap-1 cursor-pointer"
                                              >
                                                <Plus className="w-3 h-3" />
                                                <span>Activity</span>
                                              </button>
                                            )}

                                            {canManage && (
                                              <div className="relative">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveMenuId(
                                                      isOutputMenuOpen ? null : `op-${output.id}`
                                                    );
                                                  }}
                                                  className="h-[26px] w-[26px] flex items-center justify-center text-[#787774] hover:text-[#171717] hover:bg-[#F2F1EE] rounded border border-[#EAEAEA] transition-colors cursor-pointer"
                                                  title="Tindakan Output"
                                                >
                                                  <MoreHorizontal className="w-3.5 h-3.5" />
                                                </button>

                                                {isOutputMenuOpen && (
                                                  <div
                                                    className="absolute right-0 top-full mt-1 w-32 bg-white border border-[#EAEAEA] rounded-md shadow-md py-1 z-30 animate-in fade-in zoom-in-95 duration-100"
                                                    onClick={(e) => e.stopPropagation()}
                                                  >
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        setActiveMenuId(null);
                                                        handleDeleteOutput(output.id);
                                                      }}
                                                      className="w-full text-left px-3 py-1.5 text-[11.5px] text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 cursor-pointer"
                                                    >
                                                      <Trash2 className="w-3.5 h-3.5" />
                                                      <span>Hapus Output</span>
                                                    </button>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* 3. ACTIVITIES HIERARCHY */}
                                        {isOpExpanded && (
                                          <div className="p-2 sm:p-2.5 pl-3 sm:pl-6 border-l-2 border-[#EAEAEA] ml-3 sm:ml-5 my-2 space-y-2.5">
                                            {relatedActivities.length === 0 ? (
                                              <div className="p-2.5 bg-[#FAFAF9] rounded border border-dashed border-[#EAEAEA] text-[11.5px] text-[#787774] text-center">
                                                Belum ada Activity pada Output ini.{' '}
                                                {canManage && (
                                                  <button
                                                    onClick={() => {
                                                      setEditingActivity(null);
                                                      setActivityForm({
                                                        name: '',
                                                        code: '',
                                                        description: '',
                                                        startDate: new Date().toISOString().slice(0, 10),
                                                        endDate: new Date().toISOString().slice(0, 10),
                                                      });
                                                      setShowAddActivity({ outputId: output.id });
                                                    }}
                                                    className="text-[#1D4ED8] font-medium hover:underline ml-1 cursor-pointer"
                                                  >
                                                    Tambah Activity
                                                  </button>
                                                )}
                                              </div>
                                            ) : (
                                              relatedActivities.map((act) => {
                                                const relatedSubs = subActivities.filter(
                                                  (s) => s.activityId === act.id
                                                );
                                                const relatedTors = tors.filter(
                                                  (t) => t.activityId === act.id
                                                );
                                                const canCreate =
                                                  currentUser?.permissions?.canCreateTor &&
                                                  currentUser.role !== 'admin';
                                                const isActMenuOpen = activeMenuId === `act-${act.id}`;

                                                const isActCompleted = act.status === 'Selesai';
                                                const totalTorRequested = relatedTors.reduce(
                                                  (acc, t) => acc + (Number(t.budgetRequested) || 0),
                                                  0
                                                );

                                                return (
                                                  <div
                                                    key={act.id}
                                                    className="rounded-lg border border-[#E5E7EB] border-l-[3px] border-l-[#2563EB] bg-white shadow-2xs overflow-hidden transition-all hover:border-[#CBD5E1] hover:border-l-[#1D4ED8]"
                                                  >
                                                    {/* Level 3: Activity Card Header */}
                                                    <div className="px-3.5 py-3 bg-gradient-to-r from-[#F8FAFC] via-white to-white border-b border-[#F1F5F9]">
                                                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                                                        <div className="flex-1 min-w-0 space-y-1.5">
                                                          {/* Top Kicker: Code & Status */}
                                                          <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold tracking-wider text-[#1E40AF] bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded">
                                                              ACTIVITY {act.code ? `· ${act.code}` : ''}
                                                            </span>

                                                            {act.code ? (
                                                              <button
                                                                type="button"
                                                                onClick={() => {
                                                                  if (canEditFinance) {
                                                                    setProgramDetailSection('finance');
                                                                    setFinanceSectionTab('codes');
                                                                  }
                                                                }}
                                                                className={`text-[10.5px] font-mono font-medium text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 rounded transition-colors ${
                                                                  canEditFinance
                                                                    ? 'cursor-pointer hover:bg-[#EFF6FF] hover:text-[#1D4ED8] hover:border-[#BFDBFE]'
                                                                    : ''
                                                                }`}
                                                                title="Klik untuk membuka Master Budget Code di Bagian 2 (Finance Program)"
                                                              >
                                                                Kode Anggaran: <strong className="text-[#0F172A]">{act.code}</strong>
                                                              </button>
                                                            ) : (
                                                              <span className="text-[10.5px] text-[#94A3B8] italic">
                                                                Belum ada Budget Code
                                                              </span>
                                                            )}

                                                            <span
                                                              className={`inline-flex items-center gap-1.5 text-[10.5px] font-medium px-2 py-0.5 rounded ${
                                                                isActCompleted
                                                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                                                                  : 'bg-amber-50/80 text-amber-800 border border-amber-200/70'
                                                              }`}
                                                            >
                                                              <span
                                                                className={`w-1.5 h-1.5 rounded-full ${
                                                                  isActCompleted ? 'bg-emerald-500' : 'bg-amber-500'
                                                                }`}
                                                              />
                                                              {act.status}
                                                            </span>
                                                          </div>

                                                          {/* Activity Title & Description */}
                                                          <div>
                                                            <h5 className="text-[14px] sm:text-[15px] font-semibold text-[#0F172A] leading-snug">
                                                              {act.name}
                                                            </h5>
                                                            {act.description && (
                                                              <p className="text-[12px] text-[#64748B] mt-0.5 leading-relaxed">
                                                                {act.description}
                                                              </p>
                                                            )}
                                                          </div>

                                                          {/* Structured Key Info Strip */}
                                                          <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#475569]">
                                                            <div className="flex items-center gap-1.5">
                                                              <span className="text-[#94A3B8]">Jadwal:</span>
                                                              <span className="font-medium text-[#1E293B]">
                                                                {formatPeriodRange(act.startDate, act.endDate)}
                                                              </span>
                                                            </div>
                                                            <span className="text-[#CBD5E1]">•</span>
                                                            <div className="flex items-center gap-1.5">
                                                              <span className="text-[#94A3B8]">PIC:</span>
                                                              <span className="font-medium text-[#1E293B]">
                                                                {act.picName}
                                                              </span>
                                                            </div>
                                                            <span className="text-[#CBD5E1]">•</span>
                                                            <div className="flex items-center gap-1.5">
                                                              <span className="text-[#94A3B8]">Sub-Kegiatan:</span>
                                                              <span className="font-semibold text-[#1E293B]">
                                                                {relatedSubs.length}
                                                              </span>
                                                            </div>
                                                            <span className="text-[#CBD5E1]">•</span>
                                                            <div className="flex items-center gap-1.5">
                                                              <span className="text-[#94A3B8]">Dokumen TOR:</span>
                                                              <span className="font-semibold text-[#1D4ED8]">
                                                                {relatedTors.length}
                                                              </span>
                                                              {totalTorRequested > 0 && (
                                                                <span className="text-[11px] text-[#64748B]">
                                                                  ({formatRupiah(totalTorRequested)})
                                                                </span>
                                                              )}
                                                            </div>
                                                          </div>
                                                        </div>

                                                        {/* Activity Actions */}
                                                        <div className="flex items-center gap-1.5 shrink-0 self-start">
                                                          {onOpenCreateTorForActivity && canCreate && (
                                                            <button
                                                              type="button"
                                                              onClick={() =>
                                                                onOpenCreateTorForActivity(
                                                                  outcome.id,
                                                                  output.id,
                                                                  act.id
                                                                )
                                                              }
                                                              className="h-7 px-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11.5px] font-medium rounded-md transition-colors inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                                                            >
                                                              <Plus className="w-3.5 h-3.5" />
                                                              <span>Buat TOR</span>
                                                            </button>
                                                          )}

                                                          <button
                                                            type="button"
                                                            onClick={() => setSelectedActivityDetail(act)}
                                                            className="h-7 px-2.5 text-[11.5px] font-medium text-[#334155] hover:text-[#0F172A] bg-white hover:bg-[#F8FAFC] border border-[#CBD5E1] rounded-md transition-colors cursor-pointer"
                                                          >
                                                            Detail Indikator
                                                          </button>

                                                          {(canManage || canEditFinance) && (
                                                            <div className="relative">
                                                              <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  setActiveMenuId(
                                                                    isActMenuOpen ? null : `act-${act.id}`
                                                                  );
                                                                }}
                                                                className="h-7 w-7 flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] rounded-md border border-[#CBD5E1] transition-colors cursor-pointer"
                                                                title="Tindakan Activity"
                                                              >
                                                                <MoreHorizontal className="w-3.5 h-3.5" />
                                                              </button>

                                                              {isActMenuOpen && (
                                                                <div
                                                                  className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#E2E8F0] rounded-md shadow-md py-1 z-30 animate-in fade-in zoom-in-95 duration-100"
                                                                  onClick={(e) => e.stopPropagation()}
                                                                >
                                                                  <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                      setActiveMenuId(null);
                                                                      setEditingActivity(act);
                                                                      setActivityForm({
                                                                        name: act.name,
                                                                        code: act.code || '',
                                                                        description: act.description || '',
                                                                        startDate: act.startDate,
                                                                        endDate: act.endDate,
                                                                      });
                                                                    }}
                                                                    className="w-full text-left px-3 py-1.5 text-[11px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-1.5 cursor-pointer"
                                                                  >
                                                                    <Edit3 className="w-3 h-3 text-[#64748B]" />
                                                                    <span>Edit Activity & Budget Code</span>
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                      setActiveMenuId(null);
                                                                      setShowAddSubActivity({
                                                                        activityId: act.id,
                                                                      });
                                                                    }}
                                                                    className="w-full text-left px-3 py-1.5 text-[11px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-1.5 cursor-pointer"
                                                                  >
                                                                    <Plus className="w-3 h-3 text-[#64748B]" />
                                                                    <span>+ Sub-Activity</span>
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                      setActiveMenuId(null);
                                                                      handleDeleteActivity(act.id);
                                                                    }}
                                                                    className="w-full text-left px-3 py-1.5 text-[11px] text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 cursor-pointer"
                                                                  >
                                                                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                                                    <span>Hapus Activity</span>
                                                                  </button>
                                                                </div>
                                                              )}
                                                            </div>
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>

                                                    {/* Activity Body: Sub-Activities & TOR Documents */}
                                                    <div className="p-3 bg-[#FCFBF9] space-y-3">
                                                      {/* Level 4: Sub-Activities */}
                                                      {relatedSubs.length > 0 && (
                                                        <div className="rounded-md border border-[#E2E8F0] bg-white overflow-hidden">
                                                          <div className="px-3 py-1.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between">
                                                            <span className="text-[10.5px] font-semibold text-[#475569] uppercase tracking-wider">
                                                              Tahapan Sub-Kegiatan ({relatedSubs.length})
                                                            </span>
                                                            <span className="text-[10.5px] text-[#64748B]">
                                                              {relatedSubs.filter((s) => s.status === 'Selesai').length} dari {relatedSubs.length} selesai
                                                            </span>
                                                          </div>
                                                          <div className="divide-y divide-[#F1F5F9]">
                                                            {relatedSubs.map((sub, subIdx) => {
                                                              const isSubDone = sub.status === 'Selesai';
                                                              return (
                                                                <div
                                                                  key={sub.id}
                                                                  className="flex items-center justify-between py-1.5 px-3 hover:bg-[#F8FAFC] text-[12px] text-[#1E293B] transition-colors gap-3"
                                                                >
                                                                  <div className="flex items-center gap-2.5 min-w-0">
                                                                    <span className="text-[10.5px] font-mono font-semibold text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.5 rounded shrink-0">
                                                                      {String(subIdx + 1).padStart(2, '0')}
                                                                    </span>
                                                                    <span className="font-medium text-[#1E293B] truncate">
                                                                      {sub.name}
                                                                    </span>
                                                                  </div>
                                                                  <div className="flex items-center gap-2.5 shrink-0">
                                                                    {sub.picName && (
                                                                      <span className="text-[11px] text-[#64748B] hidden sm:inline">
                                                                        PIC: <strong className="font-medium text-[#334155]">{sub.picName}</strong>
                                                                      </span>
                                                                    )}
                                                                    <span
                                                                      className={`text-[10.5px] font-medium px-2 py-0.5 rounded ${
                                                                        isSubDone
                                                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                                                          : 'bg-blue-50/70 text-[#1D4ED8] border border-blue-200/60'
                                                                      }`}
                                                                    >
                                                                      {sub.status}
                                                                    </span>
                                                                  </div>
                                                                </div>
                                                              );
                                                            })}
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* Level 5: Dokumen TOR Terpadu */}
                                                      <div className="space-y-1.5">
                                                        <div className="flex items-center justify-between px-0.5">
                                                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#334155] uppercase tracking-wider">
                                                            <FileText className="w-3.5 h-3.5 text-[#2563EB]" />
                                                            <span>Dokumen TOR Terkait ({relatedTors.length})</span>
                                                          </div>

                                                          {onOpenCreateTorForActivity && canCreate && (
                                                            <button
                                                              type="button"
                                                              onClick={() =>
                                                                onOpenCreateTorForActivity(
                                                                  outcome.id,
                                                                  output.id,
                                                                  act.id
                                                                )
                                                              }
                                                              className="text-[11px] font-medium text-[#2563EB] hover:text-[#1D4ED8] hover:underline flex items-center gap-1 cursor-pointer"
                                                            >
                                                              <Plus className="w-3 h-3" />
                                                              <span>Tambah TOR</span>
                                                            </button>
                                                          )}
                                                        </div>

                                                        {relatedTors.length === 0 ? (
                                                          <div className="px-3 py-2.5 bg-white border border-dashed border-[#CBD5E1] rounded-md text-[11.5px] text-[#64748B] flex items-center justify-between">
                                                            <span>
                                                              Belum ada dokumen TOR untuk kegiatan ini.
                                                            </span>
                                                            {onOpenCreateTorForActivity && canCreate ? (
                                                              <button
                                                                type="button"
                                                                onClick={() =>
                                                                  onOpenCreateTorForActivity(
                                                                    outcome.id,
                                                                    output.id,
                                                                    act.id
                                                                  )
                                                                }
                                                                className="text-[11.5px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                                                              >
                                                                + Buat TOR
                                                              </button>
                                                            ) : (
                                                              <span className="text-[10.5px] text-[#94A3B8]">
                                                                Hanya Lihat
                                                              </span>
                                                            )}
                                                          </div>
                                                        ) : (
                                                          <div className="space-y-2">
                                                            {relatedTors.map((tor) => {
                                                              const isTorExpanded = expandedTorId === tor.id;
                                                              const deadlineInfo = getDeadlineInfo(
                                                                tor.reportingDeadline,
                                                                tor.activityStatus === 'Selesai'
                                                              );
                                                              const statusDot = getStatusDotInfo(tor);
                                                              const isOwner =
                                                                tor.createdById === currentUser?.id;
                                                              const isPic = tor.picId === currentUser?.id;
                                                              const canEditTor =
                                                                isOwner ||
                                                                isPic ||
                                                                currentUser?.role === 'director' ||
                                                                currentUser?.role === 'admin';

                                                              return (
                                                                <div
                                                                  key={tor.id}
                                                                  className="rounded-md border border-[#E2E8F0] bg-white overflow-hidden transition-all hover:border-[#CBD5E1]"
                                                                >
                                                                  <div
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    onClick={() => toggleTorAccordion(tor.id)}
                                                                    onKeyDown={(e) => {
                                                                      if (e.key === 'Enter' || e.key === ' ') {
                                                                        e.preventDefault();
                                                                        toggleTorAccordion(tor.id);
                                                                      }
                                                                    }}
                                                                    className={`px-3.5 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 cursor-pointer select-none transition-colors ${
                                                                      isTorExpanded
                                                                        ? 'bg-[#F8FAFC]'
                                                                        : 'hover:bg-[#F8FAFC]/70'
                                                                    }`}
                                                                  >
                                                                    {/* Left: Title first, clean metadata row below */}
                                                                    <div className="flex-1 min-w-0 space-y-1">
                                                                      <div className="flex items-center gap-2 min-w-0">
                                                                        <span
                                                                          className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDot.dotColorClass}`}
                                                                          title={`Status: ${statusDot.label}`}
                                                                        />
                                                                        <span className="text-[13px] font-semibold text-[#0F172A] hover:text-[#2563EB] transition-colors leading-snug">
                                                                          {tor.title}
                                                                        </span>
                                                                        {canEditTor ? (
                                                                          <span className="text-[10px] font-medium text-[#0F7B6C] bg-[#EBF7F5] border border-[#C0E8DF] px-1.5 py-0.2 rounded shrink-0">
                                                                            Akses Edit
                                                                          </span>
                                                                        ) : (
                                                                          <span className="text-[10px] text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.2 rounded shrink-0">
                                                                            Lihat Saja
                                                                          </span>
                                                                        )}
                                                                      </div>

                                                                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-[#64748B] pl-4">
                                                                        <span className="font-mono font-semibold text-[#1D4ED8]">
                                                                          {tor.torNumber}
                                                                        </span>
                                                                        {(tor.activityCode ||
                                                                          tor.hierarchyCode) && (
                                                                          <>
                                                                            <span className="text-[#CBD5E1]">·</span>
                                                                            <span className="font-mono font-medium text-[#334155]">
                                                                              Kode: {tor.activityCode || tor.hierarchyCode}
                                                                            </span>
                                                                          </>
                                                                        )}
                                                                        <span className="text-[#CBD5E1]">·</span>
                                                                        <span>
                                                                          PIC: <strong className="text-[#334155] font-medium">{tor.picName}</strong>
                                                                        </span>
                                                                        <span className="text-[#CBD5E1]">·</span>
                                                                        <span>
                                                                          {formatPeriodRange(tor.startDate, tor.endDate)}
                                                                        </span>
                                                                        {(tor.budgetRequested ?? 0) > 0 && (
                                                                          <>
                                                                            <span className="text-[#CBD5E1]">·</span>
                                                                            <span className="font-medium text-[#0F172A]">
                                                                              {formatRupiah(tor.budgetRequested ?? 0)}
                                                                            </span>
                                                                          </>
                                                                        )}
                                                                      </div>
                                                                    </div>

                                                                    {/* Right: Deadline & Status Badges */}
                                                                    <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0 pl-4 lg:pl-0 border-t lg:border-t-0 pt-1.5 lg:pt-0 border-[#F1F5F9]">
                                                                      <div className="text-left lg:text-right leading-tight">
                                                                        <div className="text-[10.5px] text-[#64748B]">
                                                                          Batas LPJ: <strong className="text-[#1E293B] font-medium">{deadlineInfo.formattedDate}</strong>
                                                                        </div>
                                                                        <div
                                                                          className={`text-[10.5px] font-medium ${deadlineInfo.colorClasses.text}`}
                                                                        >
                                                                          {deadlineInfo.indicatorText}
                                                                        </div>
                                                                      </div>

                                                                      <div className="flex items-center gap-1.5">
                                                                        <SubmissionStatusBadge
                                                                          status={tor.submissionStatus}
                                                                        />
                                                                        <ActivityStatusBadge
                                                                          status={tor.activityStatus}
                                                                        />
                                                                      </div>

                                                                      <ChevronDown
                                                                        className={`w-4 h-4 text-[#64748B] transition-transform duration-200 shrink-0 ${
                                                                          isTorExpanded
                                                                            ? 'rotate-180 text-[#0F172A]'
                                                                            : ''
                                                                        }`}
                                                                      />
                                                                    </div>
                                                                  </div>

                                                                {isTorExpanded && (
                                                                  <div className="p-3 border-t border-[#EDEDEC] bg-[#FAFAF9] space-y-2.5 text-[12px] animate-in fade-in duration-150">
                                                                    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-white rounded border border-[#EDEDEC]">
                                                                      <div className="flex items-center gap-2 text-[11.5px]">
                                                                        <span
                                                                          className={`w-2 h-2 rounded-full shrink-0 ${statusDot.dotColorClass}`}
                                                                        />
                                                                        <span className="font-semibold text-[#171717]">
                                                                          {statusDot.label}
                                                                        </span>
                                                                        <span className="text-[#787774]">
                                                                          ({statusDot.reason})
                                                                        </span>
                                                                      </div>

                                                                      <div className="flex items-center gap-2">
                                                                        <SubmissionStatusBadge
                                                                          status={tor.submissionStatus}
                                                                        />
                                                                        <ActivityStatusBadge
                                                                          status={tor.activityStatus}
                                                                        />
                                                                      </div>
                                                                    </div>

                                                                    <div className="p-2 bg-[#F8FAFC] rounded border border-[#E2E8F0] text-[11px] flex flex-wrap items-center justify-between gap-2">
                                                                      <div className="font-mono text-[#1E3A8A]">
                                                                        <span className="font-semibold">Rantai Integrasi:</span>{' '}
                                                                        {currentProg.name} → {outcome.name} → {output.name} → {act.name}
                                                                      </div>
                                                                      <span className="font-mono font-bold text-[#2851C5] bg-[#EEF3FF] px-2 py-0.5 rounded border border-[#C7D7FE]">
                                                                        Finance Code: {tor.activityCode || act.code || tor.hierarchyCode || '-'}
                                                                      </span>
                                                                    </div>

                                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2.5 bg-white rounded border border-[#EDEDEC]">
                                                                      <div>
                                                                        <span className="text-[10px] font-mono text-[#9A9996] uppercase block">
                                                                          DANA DIMINTA
                                                                        </span>
                                                                        <span className="text-[13px] font-semibold text-[#171717]">
                                                                          {formatRupiah(tor.budgetRequested)}
                                                                        </span>
                                                                      </div>
                                                                      <div>
                                                                        <span className="text-[10px] font-mono text-[#9A9996] uppercase block">
                                                                          DANA DISETUJUI
                                                                        </span>
                                                                        <span className="text-[13px] font-semibold text-[#0F7B6C]">
                                                                          {tor.budgetApproved != null
                                                                            ? formatRupiah(tor.budgetApproved)
                                                                            : 'Menunggu Approval'}
                                                                        </span>
                                                                      </div>
                                                                      <div>
                                                                        <span className="text-[10px] font-mono text-[#9A9996] uppercase block">
                                                                          REALISASI AKTUAL (LPJ FINAL)
                                                                        </span>
                                                                        <span className="text-[13px] font-semibold text-[#2F3437]">
                                                                          {tor.budgetActualSpent != null &&
                                                                          tor.budgetActualSpent > 0
                                                                            ? formatRupiah(
                                                                                tor.budgetActualSpent
                                                                              )
                                                                            : 'Belum Ada LPJ Terverifikasi'}
                                                                        </span>
                                                                      </div>
                                                                    </div>

                                                                    <div className="p-2 bg-white rounded border border-[#EDEDEC] space-y-1.5">
                                                                      <div className="flex items-center justify-between">
                                                                        <span className="text-[11px] font-mono font-medium text-[#787774] uppercase">
                                                                          DOKUMEN PROGRAM (8 TAHAPAN)
                                                                        </span>
                                                                        <span className="text-[10.5px] text-[#0F7B6C] font-medium">
                                                                          Tahap 1 Aktif
                                                                        </span>
                                                                      </div>
                                                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                                                                        {WORKFLOW_STAGES.map(
                                                                          (st, stageIdx) => (
                                                                            <button
                                                                              type="button"
                                                                              key={st.num}
                                                                              onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                onSelectTor?.(
                                                                                  tor.id,
                                                                                  stageIdx + 1
                                                                                );
                                                                              }}
                                                                              className="p-1.5 rounded border text-[11px] flex items-center justify-between text-left transition-colors cursor-pointer border-[#EDEDEC] bg-white hover:border-[#1D4ED8]/40 hover:bg-blue-50/30 text-[#2F3437]"
                                                                              title={`Klik untuk membuka Tahap ${st.num}: ${st.title}`}
                                                                            >
                                                                              <span className="truncate font-medium">
                                                                                <span className="font-mono text-[#787774] mr-1">
                                                                                  {st.num}
                                                                                </span>
                                                                                {st.title}
                                                                              </span>
                                                                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#0F7B6C] shrink-0">
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-[#0F7B6C]" />
                                                                                Aktif
                                                                              </span>
                                                                            </button>
                                                                          )
                                                                        )}
                                                                      </div>
                                                                    </div>

                                                                    <div className="flex items-center justify-between pt-1">
                                                                      <span className="text-[11px] text-[#9A9996]">
                                                                        PIC: {tor.picName} · Pembuat:{' '}
                                                                        {tor.createdByName}
                                                                      </span>

                                                                      {onSelectTor && (
                                                                        <button
                                                                          type="button"
                                                                          onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            onSelectTor(tor.id);
                                                                          }}
                                                                          className="h-[28px] px-3 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[11.5px] font-medium rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                                                        >
                                                                          <span>Buka TOR Lengkap</span>
                                                                          <ArrowRight className="w-3 h-3" />
                                                                        </button>
                                                                      )}
                                                                    </div>
                                                                  </div>
                                                                )}
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                      )}
                                                      </div>
                                                    </div>
                                                  </div>
                                                );
                                              })
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()
      )}

      {/* =================================================================== */}
      {/* MODALS FOR MASTER BUDGET CODE & EXCEL IMPORT PREVIEW                */}
      {/* =================================================================== */}
      {showAddCodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md shadow-lg max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#EAEAEA]">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  {editingCodeItem ? 'Edit Master Budget Code' : 'Add Master Budget Code'}
                </h3>
                <p className="text-[11px] text-[#787774]">Program: {dataset.programName}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCodeModal(false)}
                className="text-[#787774] hover:text-[#252525]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {codeFormError && (
              <div className="p-2.5 rounded-sm bg-[#FDECEC] border border-[#F5C2C2] text-[11px] text-[#C93B3B]">
                {codeFormError}
              </div>
            )}

            <form onSubmit={handleSaveMasterCode} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#252525] mb-1">Code *</label>
                <input
                  type="text"
                  required
                  value={newCodeValue}
                  onChange={(e) => setNewCodeValue(e.target.value)}
                  placeholder="Mis. 1.1.1"
                  className="w-full px-3 py-2 font-mono border border-[#D4D4D0] rounded-sm focus:outline-none focus:border-[#3867F5]"
                />
              </div>
              <div>
                <label className="block font-bold text-[#252525] mb-1">Budget Category *</label>
                <input
                  type="text"
                  required
                  value={newCategoryValue}
                  onChange={(e) => setNewCategoryValue(e.target.value)}
                  placeholder="Mis. Personnel / Travel / Training / Activities"
                  className="w-full px-3 py-2 border border-[#D4D4D0] rounded-sm focus:outline-none focus:border-[#3867F5]"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EAEAEA]">
                <button
                  type="button"
                  onClick={() => setShowAddCodeModal(false)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#3867F5] text-white hover:bg-[#2851C5] cursor-pointer"
                >
                  Simpan Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExcelPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md shadow-lg max-w-2xl w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#EAEAEA]">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">
                  Preview Import Excel — Master Budget Code
                </h3>
                <p className="text-[11px] text-[#787774]">
                  File: <strong>{excelFileName}</strong> • Program: {dataset.programName}
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
                    <th className="py-2 px-3">Baris</th>
                    <th className="py-2 px-3">Code</th>
                    <th className="py-2 px-3">Budget Category</th>
                    <th className="py-2 px-3">Validasi Duplikat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAEAEA]">
                  {excelPreviewRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="py-2 px-3 font-mono text-[#787774]">{row.rowNumber}</td>
                      <td className="py-2 px-3 font-mono font-bold text-[#252525]">
                        {row.code || '-'}
                      </td>
                      <td className="py-2 px-3 text-[#252525]">{row.budgetCategory || '-'}</td>
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
              <div className="text-[#787774]">
                Siap diimpor:{' '}
                <strong className="text-[#2B6E3F]">
                  {excelPreviewRows.filter((r) => r.status === 'valid').length} baris valid
                </strong>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowExcelPreviewModal(false)}
                  className="px-3 py-1.5 rounded-sm border border-[#D4D4D0] text-[#5A5A58]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={excelPreviewRows.filter((r) => r.status === 'valid').length === 0}
                  onClick={handleConfirmExcelImport}
                  className="px-4 py-1.5 rounded-sm font-semibold bg-[#2B6E3F] text-white hover:bg-[#235A33] disabled:opacity-50 cursor-pointer"
                >
                  Konfirmasi Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL MODALS (For Outcome Indicators, Output Indicators, Activity Details) */}
      {selectedOutcomeDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 uppercase">
                  Detail Indikator Outcome
                </span>
                <h4 className="text-base font-bold text-slate-900 mt-1">
                  {selectedOutcomeDetail.name}
                </h4>
              </div>
              <button
                onClick={() => setSelectedOutcomeDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs md:text-sm">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase">Deskripsi</div>
                <p className="text-slate-700 mt-0.5">{selectedOutcomeDetail.description || '-'}</p>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <h5 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span>Daftar Indikator Outcome ({selectedOutcomeDetail.indicators.length})</span>
                </h5>

                {selectedOutcomeDetail.indicators.length === 0 ? (
                  <p className="text-slate-500 italic">Belum ada indikator yang dicatat.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedOutcomeDetail.indicators.map((ind, idx) => (
                      <div
                        key={ind.id}
                        className="p-3.5 rounded border border-slate-200 bg-slate-50/60 space-y-2"
                      >
                        <div className="font-semibold text-slate-900">
                          {idx + 1}. {ind.name}
                        </div>
                        {ind.description && (
                          <div className="text-xs text-slate-600">{ind.description}</div>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-200/80 text-xs">
                          <div>
                            <span className="text-slate-400 block text-[11px]">Baseline:</span>
                            <span className="font-semibold text-slate-800">{ind.baseline}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Target:</span>
                            <span className="font-semibold text-blue-700">{ind.target}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Satuan:</span>
                            <span className="text-slate-800">{ind.unit}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Frekuensi:</span>
                            <span className="text-slate-800">{ind.reportingFrequency}</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 pt-1">
                          <span className="text-slate-400">Metode Verifikasi: </span>
                          <span className="font-medium">{ind.verificationMethod}</span>
                          {ind.dataSource && (
                            <span className="block text-slate-500 mt-0.5">
                              Sumber Data: {ind.dataSource}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedOutcomeDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedOutputDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">
                  Detail Indikator Output
                </span>
                <h4 className="text-base font-bold text-slate-900 mt-1">
                  {selectedOutputDetail.name}
                </h4>
              </div>
              <button
                onClick={() => setSelectedOutputDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs md:text-sm">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase">Deskripsi</div>
                <p className="text-slate-700 mt-0.5">{selectedOutputDetail.description || '-'}</p>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <h5 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  <span>Daftar Indikator Output ({selectedOutputDetail.indicators.length})</span>
                </h5>

                {selectedOutputDetail.indicators.length === 0 ? (
                  <p className="text-slate-500 italic">Belum ada indikator yang dicatat.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedOutputDetail.indicators.map((ind, idx) => (
                      <div
                        key={ind.id}
                        className="p-3.5 rounded border border-slate-200 bg-slate-50/60 space-y-2"
                      >
                        <div className="font-semibold text-slate-900">
                          {idx + 1}. {ind.name}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-200/80 text-xs">
                          <div>
                            <span className="text-slate-400 block text-[11px]">Baseline:</span>
                            <span className="font-semibold text-slate-800">{ind.baseline}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Target:</span>
                            <span className="font-semibold text-emerald-700">{ind.target}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Satuan:</span>
                            <span className="text-slate-800">{ind.unit}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">Frekuensi:</span>
                            <span className="text-slate-800">{ind.reportingFrequency}</span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 pt-1">
                          <span className="text-slate-400">Metode Verifikasi: </span>
                          <span className="font-medium">{ind.verificationMethod}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedOutputDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedActivityDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 uppercase">
                  Detail Kegiatan (Activity)
                </span>
                <h4 className="text-base font-bold text-slate-900 mt-1">
                  {selectedActivityDetail.name}
                </h4>
              </div>
              <button
                onClick={() => setSelectedActivityDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs md:text-sm">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase">Deskripsi Kegiatan</div>
                <p className="text-slate-700 mt-0.5">{selectedActivityDetail.description || '-'}</p>
              </div>

              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block">Master Budget Code:</span>
                  <span className="font-mono font-bold text-blue-700">
                    {selectedActivityDetail.code || 'Belum diatur'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Penanggung Jawab (PIC):</span>
                  <span className="font-semibold text-slate-800">{selectedActivityDetail.picName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Jadwal Pelaksanaan:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedActivityDetail.startDate} s/d {selectedActivityDetail.endDate}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
                  Sub-Kegiatan Terkait (Opsional)
                </div>
                {subActivities.filter((s) => s.activityId === selectedActivityDetail.id).length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Tidak ada sub-kegiatan tambahan.</p>
                ) : (
                  <div className="space-y-1.5">
                    {subActivities
                      .filter((s) => s.activityId === selectedActivityDetail.id)
                      .map((sub, i) => (
                        <div
                          key={sub.id}
                          className="p-2 text-xs bg-slate-50 rounded border border-slate-200 flex items-center justify-between"
                        >
                          <div>
                            <span className="font-medium text-slate-800">
                              {i + 1}. {sub.name}
                            </span>
                            {sub.picName && (
                              <span className="text-slate-500 block text-[11px]">
                                PIC: {sub.picName}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                            {sub.status}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedActivityDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATION MODALS FOR HIERARCHY */}
      {showAddOutcome && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateOutcomeSubmit}
            className="bg-white rounded-lg shadow-xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h4 className="font-bold text-slate-900">Tambah Outcome Baru</h4>
              <button
                type="button"
                onClick={() => setShowAddOutcome(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs md:text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Program Induk</label>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 font-medium flex items-center justify-between">
                  <span>{currentSelectedProgram?.name || activeBudgetProgram?.name || 'Program Terpilih'}</span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {currentSelectedProgram?.location || activeBudgetProgram?.location}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Outcome <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Peningkatan Akses Air Bersih dan Sanitasi..."
                  value={outcomeForm.name}
                  onChange={(e) => setOutcomeForm({ ...outcomeForm, name: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Outcome</label>
                <textarea
                  rows={2}
                  placeholder="Deskripsi dampak jangka panjang yang ingin dicapai..."
                  value={outcomeForm.description}
                  onChange={(e) => setOutcomeForm({ ...outcomeForm, description: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="font-semibold text-slate-800 mb-2">
                  Indikator Capaian Outcome Utama (Opsional)
                </div>
                <div className="space-y-3 p-3 bg-slate-50 rounded border border-slate-200">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Nama Indikator
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: % Rumah tangga dengan akses air bersih"
                      value={outcomeForm.indicatorName}
                      onChange={(e) =>
                        setOutcomeForm({ ...outcomeForm, indicatorName: e.target.value })
                      }
                      className="w-full p-1.5 text-xs bg-white border border-slate-300 rounded focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Baseline
                      </label>
                      <input
                        type="text"
                        placeholder="Contoh: 30%"
                        value={outcomeForm.baseline}
                        onChange={(e) =>
                          setOutcomeForm({ ...outcomeForm, baseline: e.target.value })
                        }
                        className="w-full p-1.5 bg-white border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Target
                      </label>
                      <input
                        type="text"
                        placeholder="Contoh: 85%"
                        value={outcomeForm.target}
                        onChange={(e) =>
                          setOutcomeForm({ ...outcomeForm, target: e.target.value })
                        }
                        className="w-full p-1.5 bg-white border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Satuan
                      </label>
                      <input
                        type="text"
                        placeholder="Contoh: % KK"
                        value={outcomeForm.unit}
                        onChange={(e) => setOutcomeForm({ ...outcomeForm, unit: e.target.value })}
                        className="w-full p-1.5 bg-white border border-slate-300 rounded"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddOutcome(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
              >
                Simpan Outcome
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddOutput && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateOutputSubmit}
            className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h4 className="font-bold text-slate-900">Tambah Output Baru</h4>
              <button
                type="button"
                onClick={() => setShowAddOutput(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs md:text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Output <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Pembangunan 15 Titik Sarana Air..."
                  value={outputForm.name}
                  onChange={(e) => setOutputForm({ ...outputForm, name: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Output</label>
                <textarea
                  rows={2}
                  placeholder="Keluaran terukur yang akan dihasilkan..."
                  value={outputForm.description}
                  onChange={(e) => setOutputForm({ ...outputForm, description: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Indikator Output (Target Fisik)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Jumlah unit sarana terbangun"
                  value={outputForm.indicatorName}
                  onChange={(e) => setOutputForm({ ...outputForm, indicatorName: e.target.value })}
                  className="w-full p-1.5 text-xs border border-slate-300 rounded mb-2"
                />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <input
                    type="text"
                    placeholder="Baseline: 0"
                    value={outputForm.baseline}
                    onChange={(e) => setOutputForm({ ...outputForm, baseline: e.target.value })}
                    className="p-1.5 border border-slate-300 rounded"
                  />
                  <input
                    type="text"
                    placeholder="Target: 15"
                    value={outputForm.target}
                    onChange={(e) => setOutputForm({ ...outputForm, target: e.target.value })}
                    className="p-1.5 border border-slate-300 rounded"
                  />
                  <input
                    type="text"
                    placeholder="Satuan: Unit"
                    value={outputForm.unit}
                    onChange={(e) => setOutputForm({ ...outputForm, unit: e.target.value })}
                    className="p-1.5 border border-slate-300 rounded"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddOutput(null)}
                className="px-3 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold"
              >
                Simpan Output
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add / Edit Activity Modal (Connected with Master Budget Code!) */}
      {(showAddActivity || editingActivity) && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateOrUpdateActivitySubmit}
            className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h4 className="font-bold text-slate-900">
                {editingActivity
                  ? 'Edit Activity & Master Budget Code'
                  : 'Tambah Activity Baru (Terintegrasi Master Budget Code)'}
              </h4>
              <button
                type="button"
                onClick={() => {
                  setShowAddActivity(null);
                  setEditingActivity(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs md:text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Master Budget Code (Eksklusif Program: {dataset.programName})
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Contoh: 1.1.5"
                    value={activityForm.code}
                    onChange={(e) => setActivityForm({ ...activityForm, code: e.target.value })}
                    className="w-full p-2 font-mono border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  {dataset.masterBudgetCodes.length > 0 && (
                    <select
                      value={activityForm.code}
                      onChange={(e) => {
                        const chosen = dataset.masterBudgetCodes.find(
                          (c) => c.code === e.target.value
                        );
                        setActivityForm((prev) => ({
                          ...prev,
                          code: e.target.value,
                          name: prev.name || chosen?.budgetCategory || '',
                        }));
                      }}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded text-xs"
                    >
                      <option value="">-- Pilih Kode Finance Program Ini --</option>
                      {dataset.masterBudgetCodes.map((mc) => (
                        <option key={mc.id} value={mc.code}>
                          {mc.code} — {mc.budgetCategory}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Hanya menampilkan kode finance dari Program ini. Kode baru yang diketik akan otomatis didaftarkan khusus untuk Program ini.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Kegiatan (Activity / Budget Category) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Survei Geolistrik Titik Sumur Bor..."
                  value={activityForm.name}
                  onChange={(e) => setActivityForm({ ...activityForm, name: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Kegiatan</label>
                <textarea
                  rows={2}
                  placeholder="Rincian teknis kegiatan..."
                  value={activityForm.description}
                  onChange={(e) => setActivityForm({ ...activityForm, description: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Mulai</label>
                  <input
                    type="date"
                    value={activityForm.startDate}
                    onChange={(e) =>
                      setActivityForm({ ...activityForm, startDate: e.target.value })
                    }
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Selesai</label>
                  <input
                    type="date"
                    value={activityForm.endDate}
                    onChange={(e) => setActivityForm({ ...activityForm, endDate: e.target.value })}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddActivity(null);
                  setEditingActivity(null);
                }}
                className="px-3 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold cursor-pointer"
              >
                {editingActivity ? 'Simpan Perubahan' : 'Simpan Activity'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddSubActivity && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSubActivitySubmit}
            className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h4 className="font-bold text-slate-900">Tambah Sub-Activity (Opsional)</h4>
              <button
                type="button"
                onClick={() => setShowAddSubActivity(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs md:text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Sub-Activity <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Sosialisasi awal koordinat GPS..."
                  value={subActivityForm.name}
                  onChange={(e) =>
                    setSubActivityForm({ ...subActivityForm, name: e.target.value })
                  }
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  PIC Sub-Kegiatan (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Budi Santoso / Tim Konsultan"
                  value={subActivityForm.picName}
                  onChange={(e) =>
                    setSubActivityForm({ ...subActivityForm, picName: e.target.value })
                  }
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi</label>
                <textarea
                  rows={2}
                  placeholder="Catatan tahapan sub-kegiatan..."
                  value={subActivityForm.description}
                  onChange={(e) =>
                    setSubActivityForm({ ...subActivityForm, description: e.target.value })
                  }
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddSubActivity(null)}
                className="px-3 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-semibold"
              >
                Simpan Sub-Activity
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Program Creation & Edit Modal */}
      {showProgramModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveProgramSubmit(false);
            }}
            className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Building className="w-5 h-5 text-blue-600" />
                <h4 className="font-bold text-slate-900 text-sm md:text-base">
                  {editingProgram ? 'Edit Informasi Program' : 'Tambah Program Baru'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowProgramModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto text-xs md:text-sm">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Nama Program / Judul Program <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Penguatan Kohesi Sosial melalui Kolaborasi Tokoh Adat, Agama, dan Pemerintah"
                  value={programForm.name}
                  onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })}
                  className="w-full p-2.5 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Lokasi Program <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Kabupaten Jayapura, Papua"
                    value={programForm.location}
                    onChange={(e) => setProgramForm({ ...programForm, location: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Tanggal Mulai <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={programForm.startDate}
                    onChange={(e) => setProgramForm({ ...programForm, startDate: e.target.value })}
                    className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Tanggal Selesai <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={programForm.endDate}
                    onChange={(e) => setProgramForm({ ...programForm, endDate: e.target.value })}
                    className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Deskripsi Program <span className="text-slate-400 font-normal">(opsional)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Penjelasan singkat mengenai tujuan, latar belakang, dan ruang lingkup program..."
                  value={programForm.description}
                  onChange={(e) => setProgramForm({ ...programForm, description: e.target.value })}
                  className="w-full p-2.5 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Link Folder Program <span className="text-slate-400 font-normal">(Diisi oleh Program Manager — Drive / Cloud Folder)</span>
                </label>
                <div className="relative">
                  <FolderOpen className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="url"
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={programForm.folderUrl || ''}
                    onChange={(e) => setProgramForm({ ...programForm, folderUrl: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  PIC Program <span className="text-slate-400 font-normal">(Penanggung Jawab)</span>
                </label>
                <select
                  value={programForm.picId}
                  onChange={(e) => setProgramForm({ ...programForm, picId: e.target.value })}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">Pilih Pengguna...</option>
                  {allUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.roleTitle} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">Status Program</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['Draft', 'Aktif', 'Selesai', 'Diarsipkan'] as ProgramStatus[]).map((st) => (
                    <label
                      key={st}
                      className={`flex items-center justify-center p-2 rounded border text-xs font-medium cursor-pointer transition-colors ${
                        programForm.status === st
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="programStatus"
                        value={st}
                        checked={programForm.status === st}
                        onChange={() => setProgramForm({ ...programForm, status: st })}
                        className="sr-only"
                      />
                      <span>{st}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowProgramModal(false)}
                className="px-3.5 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Batal
              </button>

              <div className="flex items-center gap-2">
                {!editingProgram && (
                  <button
                    type="button"
                    onClick={() => handleSaveProgramSubmit(true)}
                    className="px-3.5 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 rounded text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                  >
                    Simpan Draft
                  </button>
                )}
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  {editingProgram ? 'Simpan Perubahan' : 'Simpan Program'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {participantsModalProgram && (
        <ProgramParticipantsModal
          program={participantsModalProgram}
          outcomes={outcomes}
          outputs={outputs}
          activities={activities}
          isOpen={Boolean(participantsModalProgram)}
          onClose={() => setParticipantsModalProgram(null)}
          onUpdated={() => {
            fetchBudgetAndFinancialRecords();
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
