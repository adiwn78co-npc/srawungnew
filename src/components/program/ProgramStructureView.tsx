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
  saveProgramBudgetDatasetAsync,
  saveAllProgramBudgetDatasets,
  loadAllProgramBudgetDatasets,
  getActivePeriods,
  calculateProgramBudgetMetrics,
  syncProgramFinancialDataFromMealConnect,
  downloadMasterBudgetExcelTemplate,
  parseMasterBudgetExcelFile,
  HierarchyExcelPreviewRow,
  downloadProgramHierarchyExcelTemplate,
  parseProgramHierarchyExcelFile,
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
  const canManage = true;
  // Hanya Director dan Finance yang dapat melihat dan mengelola kolom Pengaturan Finance Program
  const canEditFinance = isDirector || isFinance;

  // Active main section inside Program Detail: 'hierarchy', 'matrix' (Matriks Outcome & Output), 'activity_matrix' (Matriks Activity), 'participants' (Tracing Peserta), or 'finance'
  const [programDetailSection, setProgramDetailSection] = useState<'hierarchy' | 'matrix' | 'activity_matrix' | 'participants' | 'finance'>('hierarchy');

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

  // Hirarki Program: Template Excel Otomatis states
  const hierarchyFileInputRef = useRef<HTMLInputElement | null>(null);
  const [hierarchyExcelPreviewRows, setHierarchyExcelPreviewRows] = useState<
    HierarchyExcelPreviewRow[]
  >([]);
  const [hierarchyExcelFileName, setHierarchyExcelFileName] = useState('');
  const [pendingHierarchyExcelFile, setPendingHierarchyExcelFile] = useState<File | null>(null);
  const [showHierarchyExcelPreviewModal, setShowHierarchyExcelPreviewModal] = useState(false);
  const [importingHierarchyExcel, setImportingHierarchyExcel] = useState(false);

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

  // Persist helper: waits for authoritative server/MySQL commit before updating local cache & UI state
  const persistDatasetToServerAndLocal = async (
    updated: ProgramBudgetDataset,
    onModalError?: (msg: string) => void
  ): Promise<boolean> => {
    const key = `${updated.programId}__${updated.fiscalYear}`;
    try {
      const persisted = await saveProgramBudgetDatasetAsync({
        ...updated,
        id: key,
      });
      setDataset(persisted);
      return true;
    } catch (err: any) {
      const errMsg =
        err?.message ||
        'Gagal menyimpan perubahan anggaran ke database server. Perubahan dibatalkan.';
      if (onModalError) {
        onModalError(errMsg);
      } else {
        setErrorMessage(errMsg);
      }
      return false;
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
  const [expandedOutcomes, setExpandedOutcomes] = useState<Record<string, boolean>>({});
  const [expandedOutputs, setExpandedOutputs] = useState<Record<string, boolean>>({});

  // Modal / Detail drawer states
  const [selectedOutcomeDetail, setSelectedOutcomeDetail] = useState<Outcome | null>(null);
  const [isEditingOutcomeModal, setIsEditingOutcomeModal] = useState(false);
  const [editingOutcomeDraft, setEditingOutcomeDraft] = useState<{
    outcomeNumber: string;
    description: string;
    indicators: Indicator[];
  } | null>(null);
  const [savingOutcomeDetail, setSavingOutcomeDetail] = useState(false);
  const [selectedOutputDetail, setSelectedOutputDetail] = useState<Output | null>(null);
  const [isEditingOutputModal, setIsEditingOutputModal] = useState(false);
  const [editingOutputDraft, setEditingOutputDraft] = useState<{
    outputNumber: string;
    description: string;
    indicators: Indicator[];
  } | null>(null);
  const [savingOutputDetail, setSavingOutputDetail] = useState(false);
  const [selectedActivityDetail, setSelectedActivityDetail] = useState<Activity | null>(null);

  const handleOpenOutcomeDetailModal = (
    oc: Outcome,
    defaultIdx = 0,
    openInEditMode = false
  ) => {
    const derivedNum =
      oc.outcomeNumber ||
      (oc.name.match(/^(Outcome\s*\d+)/i)?.[1] ?? `Outcome ${defaultIdx + 1}`);
    const derivedDesc =
      oc.description ||
      oc.name.replace(/^Outcome\s*\d+\s*[:\-–]?\s*/i, '').trim() ||
      oc.name;
    const mappedIndicators: Indicator[] = (oc.indicators || []).map((ind) => ({
      ...ind,
      dataSource: ind.dataSource || ind.verificationMethod || '',
      cumulativeType: ind.cumulativeType || 'Non cumulative',
      plannedDataBreakdown: ind.plannedDataBreakdown || '',
      reportingFrequency: ind.reportingFrequency || 'Annual',
      baseline: ind.baseline || '',
      target: ind.endOfProjectGoal || ind.target || '',
      endOfProjectGoal: ind.endOfProjectGoal || ind.target || '',
    }));

    if (openInEditMode && mappedIndicators.length === 0) {
      mappedIndicators.push({
        id: `ind-oc-${Date.now()}-0`,
        name: '',
        description: '',
        dataSource: '',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target: '',
        endOfProjectGoal: '',
        unit: '',
        verificationMethod: '',
      });
    }

    setSelectedOutcomeDetail(oc);
    setIsEditingOutcomeModal(openInEditMode);
    setEditingOutcomeDraft({
      outcomeNumber: derivedNum,
      description: derivedDesc,
      indicators: mappedIndicators,
    });
  };

  const handleSaveOutcomeDetailChanges = async () => {
    if (!selectedOutcomeDetail || !editingOutcomeDraft) return;
    const cleanNum = editingOutcomeDraft.outcomeNumber.trim() || 'Outcome 1';
    const cleanDesc = editingOutcomeDraft.description.trim();
    if (!cleanDesc) {
      setErrorMessage('Description Outcome wajib diisi.');
      return;
    }
    const cleanedIndicators: Indicator[] = editingOutcomeDraft.indicators
      .filter((ind) => ind.name.trim())
      .map((ind, idx) => ({
        id: ind.id || `ind-oc-${Date.now()}-${idx}`,
        name: ind.name.trim(),
        description: ind.description || '',
        dataSource: (ind.dataSource || '').trim() || '-',
        cumulativeType: (ind.cumulativeType || 'Non cumulative').trim(),
        plannedDataBreakdown: (ind.plannedDataBreakdown || '').trim(),
        reportingFrequency: (ind.reportingFrequency || 'Annual').trim(),
        baseline: (ind.baseline || 'TBA').trim(),
        target: (ind.endOfProjectGoal || ind.target || '').trim(),
        endOfProjectGoal: (ind.endOfProjectGoal || ind.target || '').trim(),
        unit: ind.unit || '',
        verificationMethod: (ind.dataSource || ind.verificationMethod || '-').trim(),
      }));

    try {
      setSavingOutcomeDetail(true);
      const combinedName = cleanDesc.toLowerCase().startsWith(cleanNum.toLowerCase())
        ? cleanDesc
        : `${cleanNum}: ${cleanDesc}`;
      const updated = await api.updateOutcome(selectedOutcomeDetail.id, {
        outcomeNumber: cleanNum,
        name: combinedName,
        description: cleanDesc,
        indicators: cleanedIndicators,
      } as any);
      await Promise.resolve(onRefresh());
      setSelectedOutcomeDetail(updated);
      setIsEditingOutcomeModal(false);
      setErrorMessage(null);
      setSuccessMessage(
        `Outcome "${cleanNum}" beserta ${cleanedIndicators.length} Progress Indicator berhasil disimpan ke database.`
      );
    } catch (err: any) {
      setSuccessMessage(null);
      setErrorMessage(err?.message || 'Gagal menyimpan perubahan Outcome.');
    } finally {
      setSavingOutcomeDetail(false);
    }
  };

  const handleOpenOutputDetailModal = (
    op: Output,
    ocIdx = 0,
    opIdx = 0,
    openInEditMode = false
  ) => {
    const derivedNum =
      op.outputNumber ||
      (op.name.match(/^(Output\s*[\d.]+)/i)?.[1] ?? `Output ${ocIdx + 1}.${opIdx + 1}`);
    const derivedDesc =
      op.description ||
      op.name.replace(/^Output\s*[\d.]+\s*[:\-–]?\s*/i, '').trim() ||
      op.name;
    const mappedIndicators: Indicator[] = (op.indicators || []).map((ind) => ({
      ...ind,
      dataSource: ind.dataSource || ind.verificationMethod || '',
      cumulativeType: ind.cumulativeType || 'Non cumulative',
      plannedDataBreakdown: ind.plannedDataBreakdown || '',
      reportingFrequency: ind.reportingFrequency || 'Annual',
      baseline: ind.baseline || 'TBA',
      target: ind.endOfProjectGoal || ind.target || '',
      endOfProjectGoal: ind.endOfProjectGoal || ind.target || '',
    }));

    if (openInEditMode && mappedIndicators.length === 0) {
      mappedIndicators.push({
        id: `ind-op-${Date.now()}-0`,
        name: '',
        description: '',
        dataSource: '',
        cumulativeType: 'Non cumulative',
        plannedDataBreakdown: '',
        reportingFrequency: 'Annual',
        baseline: 'TBA',
        target: '',
        endOfProjectGoal: '',
        unit: '',
        verificationMethod: '',
      });
    }

    setSelectedOutputDetail(op);
    setIsEditingOutputModal(openInEditMode);
    setEditingOutputDraft({
      outputNumber: derivedNum,
      description: derivedDesc,
      indicators: mappedIndicators,
    });
  };

  const handleSaveOutputDetailChanges = async () => {
    if (!selectedOutputDetail || !editingOutputDraft) return;
    const cleanNum = editingOutputDraft.outputNumber.trim() || 'Output 1.1';
    const cleanDesc = editingOutputDraft.description.trim();
    if (!cleanDesc) {
      setErrorMessage('Description Output wajib diisi.');
      return;
    }
    const cleanedIndicators: Indicator[] = editingOutputDraft.indicators
      .filter((ind) => ind.name.trim())
      .map((ind, idx) => ({
        id: ind.id || `ind-op-${Date.now()}-${idx}`,
        name: ind.name.trim(),
        description: ind.description || '',
        dataSource: (ind.dataSource || '').trim() || '-',
        cumulativeType: (ind.cumulativeType || 'Non cumulative').trim(),
        plannedDataBreakdown: (ind.plannedDataBreakdown || '').trim(),
        reportingFrequency: (ind.reportingFrequency || 'Annual').trim(),
        baseline: (ind.baseline || 'TBA').trim(),
        target: (ind.endOfProjectGoal || ind.target || '').trim(),
        endOfProjectGoal: (ind.endOfProjectGoal || ind.target || '').trim(),
        unit: ind.unit || '',
        verificationMethod: (ind.dataSource || ind.verificationMethod || '-').trim(),
      }));

    try {
      setSavingOutputDetail(true);
      const combinedName = cleanDesc.toLowerCase().startsWith(cleanNum.toLowerCase())
        ? cleanDesc
        : `${cleanNum}: ${cleanDesc}`;
      const updated = await api.updateOutput(selectedOutputDetail.id, {
        outputNumber: cleanNum,
        name: combinedName,
        description: cleanDesc,
        indicators: cleanedIndicators,
      } as any);
      await Promise.resolve(onRefresh());
      setSelectedOutputDetail(updated);
      setIsEditingOutputModal(false);
      setErrorMessage(null);
      setSuccessMessage(
        `Output "${cleanNum}" beserta ${cleanedIndicators.length} Progress Indicator berhasil disimpan ke database.`
      );
    } catch (err: any) {
      setSuccessMessage(null);
      setErrorMessage(err?.message || 'Gagal menyimpan perubahan Output.');
    } finally {
      setSavingOutputDetail(false);
    }
  };

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
    activityNumber: '',
    name: '',
    code: '',
    description: '',
    anticipatedInputs: '',
    plannedParticipantsBreakdown: '',
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
    setExpandedOutcomes((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const toggleOutput = (id: string) => {
    setExpandedOutputs((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
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
  const [showPeriodAuditTrail, setShowPeriodAuditTrail] = useState(true);

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

  const normalizeSingleActivePeriodList = (
    periods: ProgramBudgetPeriod[]
  ): ProgramBudgetPeriod[] => {
    const firstActiveIdx = periods.findIndex((p) => p.isActiveForTor);
    const activeIdx = firstActiveIdx >= 0 ? firstActiveIdx : 0;
    return periods.map((p, idx) => ({
      ...p,
      code: (p.code || '').trim() || `P${idx + 1}`,
      label: (p.label || '').trim() || `Custom Period ${idx + 1}`,
      isActiveForTor: idx === activeIdx,
    }));
  };

  const handleDirectorUpdatePeriodsAndCodes = async () => {
    if (!isDirector) return;
    setErrorMessage(null);
    const normalizedPeriods = normalizeSingleActivePeriodList(draftCustom);
    const computedAnnualForYear = normalizedPeriods.reduce(
      (sum, p) => sum + (Number(p.allocatedAmount) || 0),
      0
    );
    if (computedAnnualForYear <= 0) {
      setErrorMessage(
        'Masukkan nominal anggaran pada periode anggaran (Custom Period) terlebih dahulu.'
      );
      return;
    }

    setDraftCustom(normalizedPeriods);
    const nowIso = new Date().toISOString();
    const prevAnnual = dataset.annualApprovedBudget;
    const activePeriod =
      normalizedPeriods.find((p) => p.isActiveForTor) || normalizedPeriods[0];
    const periodSummaryText = normalizedPeriods
      .map(
        (p) =>
          `${p.code} (${p.label}: ${formatRupiah(Number(p.allocatedAmount) || 0)}${
            p.isActiveForTor ? ' · Aktif TOR' : ''
          })`
      )
      .join(', ');

    const updated: ProgramBudgetDataset = {
      ...dataset,
      isBudgetConfigured: true,
      budgetApprovalStatus: 'Disetujui Direktur',
      budgetApprovedBy: currentUser?.name || 'Executive Director',
      budgetApprovedAt: nowIso,
      budgetRevisionNotes: undefined,
      periodUpdateStatus: 'Menunggu Konfirmasi Finance',
      periodUpdatedByDirectorName: currentUser?.name || 'Dr. Hendra Wijaya',
      periodUpdatedByDirectorAt: nowIso,
      totalProgramBudget: computedAnnualForYear,
      annualApprovedBudget: computedAnnualForYear,
      periodStructureType: 'custom',
      customPeriods: normalizedPeriods,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Dr. Hendra Wijaya',
          actorRole: currentUser?.roleTitle || 'Executive Director',
          actionType: 'PERIOD_CODE_UPDATED_BY_DIRECTOR',
          periodStructureType: 'custom',
          summary: `Direktur meng-update Kode & Custom Period Program ${dataset.programName}: [${periodSummaryText}]. Periode Aktif TOR: ${activePeriod?.code} — ${activePeriod?.label}. Status: Menunggu Konfirmasi Finance.`,
          previousAnnualBudget: prevAnnual,
          newAnnualBudget: computedAnnualForYear,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated))) return;
    setSuccessMessage(
      `Kode & Periode (${normalizedPeriods.map((p) => p.code).join(', ')}) berhasil di-update oleh Direktur dan langsung terhubung ke TOR (${activePeriod?.code}). Menunggu konfirmasi Finance.`
    );
  };

  const handleFinanceConfirmPeriodUpdate = async () => {
    if (!isFinance) return;
    setErrorMessage(null);
    const normalizedPeriods = normalizeSingleActivePeriodList(draftCustom);
    const computedAnnualForYear = normalizedPeriods.reduce(
      (sum, p) => sum + (Number(p.allocatedAmount) || 0),
      0
    );
    setDraftCustom(normalizedPeriods);

    const nowIso = new Date().toISOString();
    const activePeriod =
      normalizedPeriods.find((p) => p.isActiveForTor) || normalizedPeriods[0];
    const periodSummaryText = normalizedPeriods
      .map(
        (p) =>
          `${p.code} (${p.label}${p.isActiveForTor ? ' · Aktif TOR' : ''})`
      )
      .join(', ');

    const updated: ProgramBudgetDataset = {
      ...dataset,
      isBudgetConfigured: true,
      periodUpdateStatus: 'Terkonfirmasi Finance',
      periodConfirmedByFinanceName: currentUser?.name || 'Ratna Kusuma, S.E.',
      periodConfirmedByFinanceAt: nowIso,
      totalProgramBudget: computedAnnualForYear,
      annualApprovedBudget: computedAnnualForYear,
      customPeriods: normalizedPeriods,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Ratna Kusuma, S.E.',
          actorRole: currentUser?.roleTitle || 'Finance & Compliance',
          actionType: 'PERIOD_UPDATE_CONFIRMED_BY_FINANCE',
          periodStructureType: 'custom',
          summary: `Finance mengonfirmasi keputusan Update Kode & Custom Period dari Direktur: [${periodSummaryText}]. Periode Aktif TOR: ${activePeriod?.code} — ${activePeriod?.label}.`,
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: computedAnnualForYear,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated))) return;
    setSuccessMessage(
      `Finance berhasil mengonfirmasi perubahan Kode & Periode (${normalizedPeriods.map((p) => p.code).join(', ')}).`
    );
  };

  const handleSaveBudgetAndPeriods = async () => {
    setErrorMessage(null);
    const normalizedPeriods = normalizeSingleActivePeriodList(draftCustom);
    const computedAnnualForYear = draftTotalPeriodAllocated;
    if (computedAnnualForYear <= 0) {
      setErrorMessage(
        'Masukkan nominal anggaran pada periode anggaran (Custom Period) terlebih dahulu.'
      );
      return;
    }

    setDraftCustom(normalizedPeriods);
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
            periodUpdateStatus: 'Menunggu Konfirmasi Finance',
            periodUpdatedByDirectorName: currentUser?.name || 'Executive Director',
            periodUpdatedByDirectorAt: nowIso,
          }
        : {
            budgetRevisionNotes: undefined,
          }),
      totalProgramBudget: computedAnnualForYear,
      annualApprovedBudget: computedAnnualForYear,
      periodStructureType: draftStructureType,
      quarterlyPeriods: draftQuarterly,
      semesterPeriods: draftSemester,
      customPeriods: normalizedPeriods,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Finance Officer',
          actorRole: currentUser?.roleTitle || 'Finance',
          actionType: isDirector ? 'BUDGET_APPROVED_BY_DIRECTOR' : 'BUDGET_SUBMITTED_TO_DIRECTOR',
          periodStructureType: draftStructureType,
          summary: isDirector
            ? `Direktur menyimpan & meng-ACC Anggaran Program ${dataset.programName}: Total Annual Budget (${normalizedPeriods.length} Custom Period: ${normalizedPeriods.map((p) => p.code).join(', ')}) = ${formatRupiah(computedAnnualForYear)}.`
            : `${isRevisionSubmission ? 'Mengajukan Revisi Anggaran' : 'Mengajukan Anggaran'} Program ${
                dataset.programName
              } ke Direktur: Total Annual Budget (${normalizedPeriods.length} Custom Period: ${normalizedPeriods.map((p) => p.code).join(', ')}) = ${formatRupiah(computedAnnualForYear)}.`,
          previousAnnualBudget: prevAnnual,
          newAnnualBudget: computedAnnualForYear,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated))) return;
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
    const normalizedPeriods = normalizeSingleActivePeriodList(draftCustom);
    const computedAnnualForYear = draftTotalPeriodAllocated;
    if (computedAnnualForYear <= 0) {
      setErrorMessage('Nominal anggaran pada Custom Period belum diisi.');
      return;
    }

    setDraftCustom(normalizedPeriods);
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
      customPeriods: normalizedPeriods,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Executive Director',
          actorRole: currentUser?.roleTitle || 'Director',
          actionType: 'BUDGET_APPROVED_BY_DIRECTOR',
          periodStructureType: draftStructureType,
          summary: `Direktur menyetujui (ACC) Anggaran & Custom Period Program ${dataset.programName}: Total Annual Budget = ${formatRupiah(computedAnnualForYear)} (${normalizedPeriods.map((p) => p.code).join(', ')}). Finance kini dapat mengaktifkan Time Period Aktif (TOR).`,
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: computedAnnualForYear,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated))) return;
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

    if (!(await persistDatasetToServerAndLocal(updated))) return;
    setShowBudgetRevisionInput(false);
    setBudgetRevisionNotesInput('');
    setSuccessMessage(`Permintaan revisi anggaran berhasil dikirim ke Finance.`);
  };

  const handleFinanceActivateTorPeriod = async (periodId: string) => {
    setErrorMessage(null);
    if (!isFinance && !isDirector) {
      setErrorMessage(
        'Hanya Finance atau Direktur yang berhak mengatur Time Period Aktif (TOR).'
      );
      return;
    }
    if (!isBudgetApprovedByDirector && !isDirector) {
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
      ...(isDirector
        ? {
            periodUpdateStatus: 'Menunggu Konfirmasi Finance',
            periodUpdatedByDirectorName: currentUser?.name || 'Executive Director',
            periodUpdatedByDirectorAt: nowIso,
          }
        : {}),
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || (isDirector ? 'Executive Director' : 'Finance Officer'),
          actorRole: currentUser?.roleTitle || (isDirector ? 'Director' : 'Finance'),
          actionType: 'ACTIVE_TOR_PERIOD_CHANGED',
          periodStructureType: draftStructureType,
          summary: `${isDirector ? 'Direktur' : 'Finance'} menetapkan Time Period Aktif (TOR): ${
            targetPeriod?.code || ''
          } — ${targetPeriod?.label || ''}.`,
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated))) return;
    setSuccessMessage(
      `Time Period Aktif (TOR) berhasil diatur ke "${targetPeriod?.code} — ${targetPeriod?.label}".`
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
      masterCodeUpdateStatus: 'Menunggu Konfirmasi Update Master Kode',
      masterCodeUpdatedByName: currentUser?.name || 'Finance Officer',
      masterCodeUpdatedByRole: currentUser?.roleTitle || 'Finance',
      masterCodeUpdatedAt: nowIso,
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
          summary: `${actionLabel} (Menunggu Konfirmasi Update Master Kode).`,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated, setCodeFormError))) return;
    setShowAddCodeModal(false);
    setSuccessMessage(`${actionLabel} berhasil disimpan. Silakan klik Konfirmasi Update Master Kode untuk mengonfirmasi.`);
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

    const nowIso = new Date().toISOString();
    const nextCodes = dataset.masterBudgetCodes.filter((c) => c.id !== item.id);
    const updated: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: nextCodes,
      masterCodeUpdateStatus: 'Menunggu Konfirmasi Update Master Kode',
      masterCodeUpdatedByName: currentUser?.name || 'Finance Officer',
      masterCodeUpdatedByRole: currentUser?.roleTitle || 'Finance',
      masterCodeUpdatedAt: nowIso,
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
          summary: `Menghapus Master Budget Code ${item.code} (${item.budgetCategory}).`,
        },
        ...(dataset.revisions || []),
      ],
    };
    if (!(await persistDatasetToServerAndLocal(updated))) return;
    setSuccessMessage(`Master Budget Code ${item.code} berhasil dihapus.`);
  };

  const [showMasterCodeAuditTrail, setShowMasterCodeAuditTrail] = useState<boolean>(true);

  const handleConfirmMasterCodeUpdate = async () => {
    setErrorMessage(null);
    const nowIso = new Date().toISOString();
    const safeMasterCodes = dataset.masterBudgetCodes || [];
    const codePreviewList = safeMasterCodes
      .slice(0, 5)
      .map((c) => `${c.code} (${c.budgetCategory})`)
      .join(', ');
    const moreSuffix =
      safeMasterCodes.length > 5
        ? ` +${safeMasterCodes.length - 5} kode lainnya`
        : '';

    const updated: ProgramBudgetDataset = {
      ...dataset,
      masterBudgetCodes: safeMasterCodes,
      masterCodeUpdateStatus: 'Master Kode Terkonfirmasi',
      masterCodeConfirmedByName: currentUser?.name || 'Ratna Kusuma, S.E.',
      masterCodeConfirmedByRole: currentUser?.roleTitle || 'Finance & Compliance',
      masterCodeConfirmedAt: nowIso,
      updatedAt: nowIso,
      updatedBy: currentUser?.name || 'Ratna Kusuma, S.E.',
      revisions: [
        {
          id: `rev-mc-conf-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser?.name || 'Ratna Kusuma, S.E.',
          actorRole: currentUser?.roleTitle || 'Finance & Compliance',
          actionType: 'MASTER_CODE_CONFIRMED',
          previousAnnualBudget: dataset.annualApprovedBudget,
          newAnnualBudget: dataset.annualApprovedBudget,
          periodStructureType: dataset.periodStructureType,
          summary: `Konfirmasi Update Master Budget Code berhasil disahkan (${safeMasterCodes.length} Master Kode Aktif: ${codePreviewList}${moreSuffix}).`,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated))) return;
    setSuccessMessage(
      `Konfirmasi Update Master Kode (${safeMasterCodes.length} kode aktif) berhasil disahkan dan tercatat di Track Audit.`
    );
  };

  const executeDirectMasterCodeImport = async (
    rowsToImport: ExcelImportPreviewRow[],
    fileNameLabel: string
  ) => {
    const validRows = rowsToImport.filter((r) => r.status === 'valid');
    if (validRows.length === 0) {
      setShowExcelPreviewModal(false);
      setSuccessMessage(
        `Seluruh Master Budget Code pada file "${fileNameLabel}" sudah terdaftar di Program "${dataset.programName}".`
      );
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
      masterCodeUpdateStatus: 'Menunggu Konfirmasi Update Master Kode',
      masterCodeUpdatedByName: currentUser?.name || 'Finance Officer',
      masterCodeUpdatedByRole: currentUser?.roleTitle || 'Finance',
      masterCodeUpdatedAt: nowIso,
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
          summary: `Import Excel Finance (${fileNameLabel}): berhasil menambahkan ${importedCodes.length} Master Budget Code secara langsung ke "${dataset.programName}" (Menunggu Konfirmasi Update Master Kode).`,
        },
        ...(dataset.revisions || []),
      ],
    };

    if (!(await persistDatasetToServerAndLocal(updated))) return;
    setShowExcelPreviewModal(false);
    setExcelPreviewRows([]);
    setSuccessMessage(
      `Finance berhasil menambahkan ${importedCodes.length} Master Budget Code secara langsung dari Excel "${fileNameLabel}". Silakan klik Konfirmasi Update Master Kode.`
    );
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setErrorMessage(null);
      setExcelFileName(file.name);
      const preview = await parseMasterBudgetExcelFile(file, dataset.masterBudgetCodes);
      if (preview.length === 0) {
        setErrorMessage('File Excel tidak berisi baris Master Budget Code (Code | Budget Category) yang dapat dibaca.');
        return;
      }
      setExcelPreviewRows(preview);
      // Langsung tambahkan Master Budget Code dari Excel Finance secara otomatis tanpa perlu lewat Activity
      await executeDirectMasterCodeImport(preview, file.name);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membaca file Excel Master Budget Code.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmExcelImport = async () => {
    await executeDirectMasterCodeImport(excelPreviewRows, excelFileName);
  };

  // Hirarki Program (Outcome -> Output -> Activity -> Sub-Activity) Atomic Server Transaction Import Handler
  const executeHierarchyExcelImport = async (
    fileToUpload: File,
    rowsToPreview: HierarchyExcelPreviewRow[],
    targetProg: Program,
    fileNameLabel: string
  ) => {
    const invalidRows = rowsToPreview.filter((r) => r.status === 'invalid');
    if (invalidRows.length > 0) {
      const firstErrors = invalidRows
        .slice(0, 4)
        .map((r) => `Baris ${r.rowNumber}: ${r.statusMessage}`)
        .join('; ');
      setHierarchyExcelPreviewRows(rowsToPreview);
      setShowHierarchyExcelPreviewModal(true);
      setSuccessMessage(null);
      setErrorMessage(
        `[VALIDATION ERROR] Ditemukan ${invalidRows.length} baris tidak valid pada file "${fileNameLabel}" (${firstErrors}). Perbaiki file Excel terlebih dahulu — tidak ada data yang disimpan ke database.`
      );
      return;
    }

    setImportingHierarchyExcel(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await api.importProgramHierarchyExcel(targetProg.id, fileToUpload);

      // Muat ulang data aktual dari database MySQL sebelum menampilkan status berhasil
      await Promise.resolve(onRefresh());

      if (Array.isArray(result.expandedOutcomeIds) && result.expandedOutcomeIds.length > 0) {
        const expOc: Record<string, boolean> = {};
        result.expandedOutcomeIds.forEach((id) => {
          expOc[id] = true;
        });
        setExpandedOutcomes((prev) => ({ ...prev, ...expOc }));
      }
      if (Array.isArray(result.expandedOutputIds) && result.expandedOutputIds.length > 0) {
        const expOp: Record<string, boolean> = {};
        result.expandedOutputIds.forEach((id) => {
          expOp[id] = true;
        });
        setExpandedOutputs((prev) => ({ ...prev, ...expOp }));
      }

      setShowHierarchyExcelPreviewModal(false);
      setHierarchyExcelPreviewRows([]);
      setPendingHierarchyExcelFile(null);
      setSuccessMessage(result.message);
    } catch (err: any) {
      setSuccessMessage(null);
      const rawMsg = String(err?.message || 'Gagal mengimpor Hirarki Program dari Excel.');
      const categoryPrefix =
        err?.errorCategory === 'UPLOAD_ERROR' && !rawMsg.startsWith('[UPLOAD')
          ? '[UPLOAD ERROR] '
          : err?.errorCategory === 'EXCEL_PARSING_ERROR' && !rawMsg.startsWith('[EXCEL')
          ? '[EXCEL PARSING ERROR] '
          : err?.errorCategory === 'VALIDATION_ERROR' && !rawMsg.startsWith('[VALIDATION')
          ? '[VALIDATION ERROR] '
          : err?.errorCategory === 'DATABASE_WRITE_ERROR' && !rawMsg.startsWith('[DATABASE')
          ? '[DATABASE WRITE ERROR] '
          : '';
      setErrorMessage(`${categoryPrefix}${rawMsg}`);
    } finally {
      setImportingHierarchyExcel(false);
    }
  };

  const handleHierarchyExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetProg = currentSelectedProgram || activeBudgetProgram;
    if (!targetProg) {
      setSuccessMessage(null);
      setErrorMessage('[VALIDATION ERROR] Pilih Program terlebih dahulu untuk mengimpor Hirarki Program.');
      return;
    }
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      setHierarchyExcelFileName(file.name);
      setPendingHierarchyExcelFile(file);

      let preview: HierarchyExcelPreviewRow[] = [];
      try {
        preview = await parseProgramHierarchyExcelFile({
          file,
          program: targetProg,
          existingOutcomes: outcomes,
          existingOutputs: outputs,
          existingActivities: activities,
          existingSubActivities: subActivities,
        });
      } catch (parseErr: any) {
        const msg = String(parseErr?.message || 'Gagal membaca file Excel Hirarki Program.');
        setErrorMessage(
          msg.startsWith('[') ? msg : `[EXCEL PARSING ERROR] ${msg}`
        );
        return;
      }

      if (preview.length === 0) {
        setErrorMessage(
          `[VALIDATION ERROR] File Excel "${file.name}" kosong atau tidak memiliki baris data Hirarki Program yang dapat dibaca.`
        );
        return;
      }

      // Jalankan validasi & transaksi atomik ke backend MySQL
      await executeHierarchyExcelImport(file, preview, targetProg, file.name);
    } catch (err: any) {
      setSuccessMessage(null);
      setErrorMessage(err?.message || 'Gagal membaca file Excel Hirarki Program.');
    } finally {
      if (hierarchyFileInputRef.current) {
        hierarchyFileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmHierarchyExcelImport = async () => {
    const targetProg = currentSelectedProgram || activeBudgetProgram;
    if (!targetProg || !pendingHierarchyExcelFile) return;
    await executeHierarchyExcelImport(
      pendingHierarchyExcelFile,
      hierarchyExcelPreviewRows,
      targetProg,
      hierarchyExcelFileName
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
        await Promise.resolve(onRefresh());
        setErrorMessage(null);
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
        await Promise.resolve(onRefresh());
        setErrorMessage(null);
        setSuccessMessage('Program baru berhasil dibuat.');
        setSelectedProgramId(created.id);
        handleSelectBudgetProgram(created.id);
      }
      setShowProgramModal(false);
    } catch (err: any) {
      setSuccessMessage(null);
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
      await Promise.resolve(onRefresh());
      setErrorMessage(null);
      setSuccessMessage(`Program "${targetProg.name}" berhasil dihapus.`);
      if (selectedProgramId === progId) {
        setSelectedProgramId(null);
      }
    } catch (err: any) {
      setSuccessMessage(null);
      setErrorMessage(err.message || 'Gagal menghapus program.');
    }
  };

  // Delete handlers with relational checks
  const handleDeleteOutcome = async (id: string) => {
    try {
      await api.deleteOutcome(id);
      await Promise.resolve(onRefresh());
      setErrorMessage(null);
      setSuccessMessage('Outcome berhasil dihapus');
    } catch (err: any) {
      setSuccessMessage(null);
      setErrorMessage(err.message);
    }
  };

  const handleDeleteOutput = async (id: string) => {
    try {
      await api.deleteOutput(id);
      await Promise.resolve(onRefresh());
      setErrorMessage(null);
      setSuccessMessage('Output berhasil dihapus');
    } catch (err: any) {
      setSuccessMessage(null);
      setErrorMessage(err.message);
    }
  };

  const handleDeleteActivity = async (id: string) => {
    try {
      await api.deleteActivity(id);
      await Promise.resolve(onRefresh());
      setErrorMessage(null);
      setSuccessMessage('Activity berhasil dihapus');
    } catch (err: any) {
      setSuccessMessage(null);
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
      await Promise.resolve(onRefresh());
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
      setErrorMessage(null);
      setSuccessMessage('Outcome baru berhasil ditambahkan dan tersimpan ke database.');
    } catch (err: any) {
      setSuccessMessage(null);
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
      await Promise.resolve(onRefresh());
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
      setErrorMessage(null);
      setSuccessMessage('Output baru berhasil ditambahkan dan tersimpan ke database.');
    } catch (err: any) {
      setSuccessMessage(null);
      setErrorMessage(err.message);
    }
  };

  const handleCreateOrUpdateActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddActivity && !editingActivity) return;
    const wasEditing = Boolean(editingActivity);
    try {
      const cleanActNum = (activityForm.activityNumber || '').trim();
      const rawName = activityForm.name.trim();
      const cleanName =
        cleanActNum && !rawName.toLowerCase().startsWith(cleanActNum.toLowerCase())
          ? `${cleanActNum} ${rawName}`
          : rawName;

      if (editingActivity) {
        await api.updateActivity(editingActivity.id, {
          activityNumber: cleanActNum || undefined,
          name: cleanName,
          description: activityForm.description,
          anticipatedInputs: activityForm.anticipatedInputs || '',
          plannedParticipantsBreakdown: activityForm.plannedParticipantsBreakdown || '',
          startDate: activityForm.startDate,
          endDate: activityForm.endDate,
        } as any);
      } else if (showAddActivity) {
        await api.createActivity({
          outputId: showAddActivity.outputId,
          activityNumber: cleanActNum || undefined,
          name: cleanName,
          description: activityForm.description,
          anticipatedInputs: activityForm.anticipatedInputs || '',
          plannedParticipantsBreakdown: activityForm.plannedParticipantsBreakdown || '',
          startDate: activityForm.startDate,
          endDate: activityForm.endDate,
          status: 'Belum Dimulai',
        } as any);
      }

      await Promise.resolve(onRefresh());
      setShowAddActivity(null);
      setEditingActivity(null);
      setActivityForm({
        activityNumber: '',
        name: '',
        code: '',
        description: '',
        anticipatedInputs: '',
        plannedParticipantsBreakdown: '',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
      });
      setErrorMessage(null);
      setSuccessMessage(
        wasEditing
          ? 'Activity berhasil diperbarui dan tersimpan ke database.'
          : 'Activity baru berhasil ditambahkan dan tersimpan ke database.'
      );
    } catch (err: any) {
      setSuccessMessage(null);
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
      await Promise.resolve(onRefresh());
      setShowAddSubActivity(null);
      setSubActivityForm({ name: '', description: '', picName: '' });
      setErrorMessage(null);
      setSuccessMessage('Sub-Activity berhasil ditambahkan dan tersimpan ke database.');
    } catch (err: any) {
      setSuccessMessage(null);
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

      {/* Hidden file input for Hirarki Program Excel import */}
      <input
        ref={hierarchyFileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleHierarchyExcelFileChange}
        className="hidden"
      />

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
                                  {(finSummary.dataset.masterBudgetCodes || []).length} Budget Code
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
                    {programDetailSection === 'hierarchy' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            downloadProgramHierarchyExcelTemplate({
                              program: currentProg,
                              outcomes,
                              outputs,
                              activities,
                              subActivities,
                            })
                          }
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#166534] bg-[#F0FDF4] border border-[#BBF7D0] hover:bg-[#DCFCE7] px-2.5 py-1 rounded transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-[#15803D]" />
                          <span>Template Excel Hirarki</span>
                        </button>
                        <button
                          type="button"
                          disabled={importingHierarchyExcel}
                          onClick={() => hierarchyFileInputRef.current?.click()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#0F7B6C] hover:bg-[#0B5E52] px-3 py-1 rounded transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>
                            {importingHierarchyExcel
                              ? 'Memasukkan dari Excel...'
                              : 'Import Excel Hirarki'}
                          </span>
                        </button>
                      </>
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
                      onClick={() => setProgramDetailSection('matrix')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        programDetailSection === 'matrix'
                          ? 'bg-white text-[#1D4ED8] shadow-2xs border border-[#E5E5E3]'
                          : 'text-[#5F5E5B] hover:text-[#171717]'
                      }`}
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span>Matriks Outcome &amp; Output</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setProgramDetailSection('activity_matrix')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        programDetailSection === 'activity_matrix'
                          ? 'bg-white text-[#1D4ED8] shadow-2xs border border-[#E5E5E3]'
                          : 'text-[#5F5E5B] hover:text-[#171717]'
                      }`}
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span>Matriks Activity</span>
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
                        <span>Finance ({(dataset.masterBudgetCodes || []).length} Kode)</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* =================================================================== */}
              {/* MATRIKS OUTCOME & OUTPUT — SATU & MULTI-INDIKATOR                   */}
              {/* =================================================================== */}
              {programDetailSection === 'matrix' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  {programOutcomes.length === 0 ? (
                    <div className="bg-white rounded-md border border-dashed border-[#CBD5E1] p-8 text-center space-y-2.5">
                      <div className="w-9 h-9 rounded-full bg-[#F8FAFC] text-[#64748B] flex items-center justify-center mx-auto border border-[#E2E8F0]">
                        <BarChart3 className="w-4 h-4 text-[#1D4ED8]" />
                      </div>
                      <h4 className="text-[13.5px] font-semibold text-[#0F172A]">
                        Belum ada Hirarki Outcome, Output &amp; Activity pada Program ini
                      </h4>
                      <p className="text-[12px] text-[#64748B] max-w-md mx-auto">
                        Tabel Matriks otomatis terkoneksi dengan nama-nama <strong>Outcome</strong>, <strong>Output</strong>, dan <strong>Activity</strong> dari Hirarki Program. Tambahkan Hirarki terlebih dahulu untuk menginput indikator dan deskripsi secara manual.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setProgramDetailSection('hierarchy')}
                          className="inline-flex items-center gap-1.5 h-[32px] px-3.5 bg-white hover:bg-[#F8FAFC] text-[#0F172A] border border-[#CBD5E1] text-[12px] font-medium rounded transition-colors cursor-pointer"
                        >
                          <FolderTree className="w-3.5 h-3.5 text-[#1D4ED8]" />
                          <span>Buka Tab Hierarki &amp; ToR</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddOutcome(true)}
                          className="inline-flex items-center gap-1.5 h-[32px] px-3.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[12px] font-semibold rounded transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Tambah Outcome Manual</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* 1. TABEL MATRIKS OUTCOME & OUTPUT (Nada Profesional, Rapi & Tombol Input Manual Jelas) */}
                      <div className="rounded-md border border-[#CBD5E1] bg-white overflow-hidden shadow-2xs">
                        <div className="px-3.5 py-2.5 bg-[#F8FAFC] border-b border-[#CBD5E1] flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-[#1D4ED8]" />
                            <div>
                              <span className="text-[11.5px] font-bold text-[#0F172A] uppercase tracking-wider">
                                Matriks Outcome &amp; Output — Satu &amp; Multi-Indikator
                              </span>
                              <span className="ml-2 text-[11px] font-medium text-[#64748B]">
                                ({programOutcomes.length} Outcome ·{' '}
                                {
                                  outputs.filter((op) =>
                                    programOutcomes.some((oc) => oc.id === op.outcomeId)
                                  ).length
                                }{' '}
                                Output terkoneksi Hirarki)
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="overflow-x-auto bg-white">
                          <table className="w-full text-left border-collapse text-[11.5px] text-[#0F172A]">
                            <thead>
                              <tr className="border-b border-[#CBD5E1] bg-[#F1F5F9] text-[11px] font-bold text-[#0F172A]">
                                <th className="py-2.5 px-2.5 w-[105px] text-center align-middle border-r border-[#CBD5E1] bg-[#E5E7EB]/80">
                                  Nomor outcome &amp; output
                                </th>
                                <th className="py-2.5 px-3 w-[18%] align-middle border-r border-[#CBD5E1]">
                                  Description
                                </th>
                                <th className="py-2.5 px-3 w-[17%] align-middle border-r border-[#CBD5E1]">
                                  Progress indicator
                                </th>
                                <th className="py-2.5 px-3 w-[14%] align-middle border-r border-[#CBD5E1]">
                                  Data source
                                </th>
                                <th className="py-2.5 px-2 w-[96px] text-center align-middle border-r border-[#CBD5E1]">
                                  Cumulative or non-cumulative
                                </th>
                                <th className="py-2.5 px-3 w-[13%] align-middle border-r border-[#CBD5E1]">
                                  Planned data breakdown
                                </th>
                                <th className="py-2.5 px-2 w-[84px] text-center align-middle border-r border-[#CBD5E1]">
                                  Reporting frequency
                                </th>
                                <th className="py-2.5 px-2 w-[68px] text-center align-middle border-r border-[#CBD5E1]">
                                  Baseline
                                </th>
                                <th className="py-2.5 px-3 w-[14%] align-middle border-r border-[#CBD5E1]">
                                  End of project goal
                                </th>
                                <th className="py-2.5 px-2.5 w-[108px] text-center align-middle bg-[#F8FAFC]">
                                  Input Manual
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {programOutcomes.map((outcome, ocIdx) => {
                                const relatedOutputs = outputs.filter(
                                  (op) => op.outcomeId === outcome.id
                                );
                                const displayOutcomeNumber =
                                  outcome.outcomeNumber ||
                                  (outcome.name.match(/^(Outcome\s*\d+)/i)?.[1] ??
                                    `Outcome ${ocIdx + 1}`);
                                const displayOutcomeDescription =
                                  outcome.description ||
                                  outcome.name.replace(/^Outcome\s*\d+\s*[:\-–]?\s*/i, '').trim() ||
                                  outcome.name;
                                const hasOutcomeIndicators =
                                  outcome.indicators && outcome.indicators.length > 0;
                                const ocIndArr = hasOutcomeIndicators
                                  ? outcome.indicators
                                  : [
                                      {
                                        id: `empty-oc-${outcome.id}`,
                                        name: '',
                                        description: '',
                                        dataSource: '-',
                                        cumulativeType: 'Non cumulative',
                                        plannedDataBreakdown: '-',
                                        reportingFrequency: '-',
                                        baseline: 'TBA',
                                        target: '-',
                                        endOfProjectGoal: '-',
                                        unit: '',
                                        verificationMethod: '-',
                                      },
                                    ];

                                return (
                                  <React.Fragment key={`unified-matrix-oc-${outcome.id}`}>
                                    {/* BARIS OUTCOME */}
                                    {ocIndArr.map((ind, indIdx) => (
                                      <tr
                                        key={`oc-row-${outcome.id}-${ind.id || indIdx}`}
                                        onClick={() =>
                                          handleOpenOutcomeDetailModal(outcome, ocIdx, true)
                                        }
                                        className="border-b border-[#CBD5E1] hover:bg-[#F8FAFC] transition-colors cursor-pointer group"
                                      >
                                        {indIdx === 0 && (
                                          <>
                                            <td
                                              rowSpan={ocIndArr.length}
                                              className="py-3 px-2.5 text-center align-middle font-bold text-[#0F172A] bg-[#E5E7EB]/70 border-r border-[#CBD5E1] whitespace-nowrap"
                                            >
                                              {displayOutcomeNumber}
                                            </td>
                                            <td
                                              rowSpan={ocIndArr.length}
                                              className="py-3 px-3 align-middle font-bold text-[#0F172A] bg-white border-r border-[#CBD5E1] leading-relaxed"
                                            >
                                              {displayOutcomeDescription}
                                            </td>
                                          </>
                                        )}
                                        <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                          {ind.name ? (
                                            ind.name
                                          ) : (
                                            <span className="text-[#64748B] italic text-[11px]">
                                              Belum ada indikator — klik tombol Input Manual
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                          {ind.dataSource || ind.verificationMethod || '-'}
                                        </td>
                                        <td className="py-2.5 px-2 text-center text-[#0F172A] border-r border-[#CBD5E1] align-middle whitespace-nowrap">
                                          {ind.cumulativeType || 'Non cumulative'}
                                        </td>
                                        <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                          {ind.plannedDataBreakdown || '-'}
                                        </td>
                                        <td className="py-2.5 px-2 text-center text-[#0F172A] border-r border-[#CBD5E1] align-middle whitespace-nowrap">
                                          {ind.reportingFrequency || '-'}
                                        </td>
                                        <td className="py-2.5 px-2 text-center text-[#0F172A] border-r border-[#CBD5E1] align-middle whitespace-nowrap">
                                          {ind.baseline || '-'}
                                        </td>
                                        <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                          {ind.endOfProjectGoal || ind.target || '-'}
                                        </td>
                                        {indIdx === 0 && (
                                          <td
                                            rowSpan={ocIndArr.length}
                                            onClick={(e) => e.stopPropagation()}
                                            className="py-2.5 px-2 text-center align-middle bg-[#F8FAFC]/60"
                                          >
                                            <div className="flex flex-col items-center gap-1">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleOpenOutcomeDetailModal(outcome, ocIdx, true)
                                                }
                                                className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[10.5px] font-semibold text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] transition-colors cursor-pointer"
                                              >
                                                <Edit3 className="w-3 h-3 shrink-0" />
                                                <span>
                                                  {hasOutcomeIndicators
                                                    ? `Edit (${outcome.indicators.length})`
                                                    : '+ Indikator'}
                                                </span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setShowAddOutput({ outcomeId: outcome.id })
                                                }
                                                className="w-full inline-flex items-center justify-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium text-[#475569] bg-white hover:bg-[#F1F5F9] border border-[#CBD5E1] transition-colors cursor-pointer"
                                              >
                                                <Plus className="w-2.5 h-2.5 shrink-0" />
                                                <span>Output</span>
                                              </button>
                                            </div>
                                          </td>
                                        )}
                                      </tr>
                                    ))}

                                    {/* BARIS OUTPUT DI BAWAH OUTCOME INI */}
                                    {relatedOutputs.map((opItem, opIdx) => {
                                      const opNumLabel =
                                        opItem.outputNumber ||
                                        (opItem.name.match(/^(Output\s*[\d.]+)/i)?.[1] ??
                                          `Output ${ocIdx + 1}.${opIdx + 1}`);
                                      const opDescLabel =
                                        opItem.description ||
                                        opItem.name
                                          .replace(/^Output\s*[\d.]+\s*[:\-–]?\s*/i, '')
                                          .trim() ||
                                        opItem.name;
                                      const hasOutputIndicators =
                                        opItem.indicators && opItem.indicators.length > 0;
                                      const opInds = hasOutputIndicators
                                        ? opItem.indicators
                                        : [
                                            {
                                              id: `empty-${opItem.id}`,
                                              name: '',
                                              description: '',
                                              dataSource: '-',
                                              cumulativeType: 'Non cumulative',
                                              plannedDataBreakdown: '-',
                                              reportingFrequency: '-',
                                              baseline: 'TBA',
                                              target: '-',
                                              endOfProjectGoal: '-',
                                              unit: '',
                                              verificationMethod: '-',
                                            },
                                          ];

                                      return opInds.map((ind, indIdx) => (
                                        <tr
                                          key={`op-row-${opItem.id}-${ind.id || indIdx}`}
                                          onClick={() =>
                                            handleOpenOutputDetailModal(opItem, ocIdx, opIdx, true)
                                          }
                                          className="border-b border-[#CBD5E1] last:border-b-0 hover:bg-[#F8FAFC] transition-colors cursor-pointer group"
                                        >
                                          {indIdx === 0 && (
                                            <>
                                              <td
                                                rowSpan={opInds.length}
                                                className="py-3 px-2.5 text-center align-middle font-bold text-[#0F172A] bg-[#F1F5F9] border-r border-[#CBD5E1] whitespace-nowrap"
                                              >
                                                {opNumLabel}
                                              </td>
                                              <td
                                                rowSpan={opInds.length}
                                                className="py-3 px-3 align-middle font-normal text-[#0F172A] bg-white border-r border-[#CBD5E1] leading-relaxed"
                                              >
                                                {opDescLabel}
                                              </td>
                                            </>
                                          )}
                                          <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                            {ind.name ? (
                                              ind.name
                                            ) : (
                                              <span className="text-[#64748B] italic text-[11px]">
                                                Belum ada indikator — klik tombol Input Manual
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                            {ind.dataSource || ind.verificationMethod || '-'}
                                          </td>
                                          <td className="py-2.5 px-2 text-center text-[#0F172A] border-r border-[#CBD5E1] align-middle whitespace-nowrap">
                                            {ind.cumulativeType || 'Non cumulative'}
                                          </td>
                                          <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                            {ind.plannedDataBreakdown || '-'}
                                          </td>
                                          <td className="py-2.5 px-2 text-center text-[#0F172A] border-r border-[#CBD5E1] align-middle whitespace-nowrap">
                                            {ind.reportingFrequency || '-'}
                                          </td>
                                          <td className="py-2.5 px-2 text-center text-[#0F172A] border-r border-[#CBD5E1] align-middle whitespace-nowrap">
                                            {ind.baseline || '-'}
                                          </td>
                                          <td className="py-2.5 px-3 text-[#0F172A] border-r border-[#CBD5E1] align-middle leading-relaxed">
                                            {ind.endOfProjectGoal || ind.target || '-'}
                                          </td>
                                          {indIdx === 0 && (
                                            <td
                                              rowSpan={opInds.length}
                                              onClick={(e) => e.stopPropagation()}
                                              className="py-2.5 px-2 text-center align-middle bg-[#F8FAFC]/60"
                                            >
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleOpenOutputDetailModal(
                                                    opItem,
                                                    ocIdx,
                                                    opIdx,
                                                    true
                                                  )
                                                }
                                                className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[10.5px] font-semibold text-[#0F7B6C] bg-[#ECFDF5] hover:bg-[#D1FAE5] border border-[#A7F3D0] transition-colors cursor-pointer"
                                              >
                                                <Edit3 className="w-3 h-3 shrink-0" />
                                                <span>
                                                  {hasOutputIndicators
                                                    ? `Edit (${opItem.indicators.length})`
                                                    : '+ Indikator'}
                                                </span>
                                              </button>
                                            </td>
                                          )}
                                        </tr>
                                      ));
                                    })}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* =================================================================== */}
              {/* MATRIKS ACTIVITY — DESCRIPTION, ANTICIPATED INPUTS & PARTICIPANTS   */}
              {/* =================================================================== */}
              {programDetailSection === 'activity_matrix' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  {programOutcomes.length === 0 ? (
                    <div className="bg-white rounded-md border border-dashed border-[#CBD5E1] p-8 text-center space-y-2.5">
                      <div className="w-9 h-9 rounded-full bg-[#F8FAFC] text-[#64748B] flex items-center justify-center mx-auto border border-[#E2E8F0]">
                        <BarChart3 className="w-4 h-4 text-[#0F7B6C]" />
                      </div>
                      <h4 className="text-[13.5px] font-semibold text-[#0F172A]">
                        Belum ada Hirarki Outcome, Output &amp; Activity pada Program ini
                      </h4>
                      <p className="text-[12px] text-[#64748B] max-w-md mx-auto">
                        Tabel Matriks Activity otomatis terkoneksi dengan nama-nama <strong>Outcome</strong>, <strong>Output</strong>, dan <strong>Activity</strong> dari Hirarki Program. Tambahkan Hirarki terlebih dahulu untuk menginput deskripsi activity, anticipated inputs, dan planned participants secara manual.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setProgramDetailSection('hierarchy')}
                          className="inline-flex items-center gap-1.5 h-[32px] px-3.5 bg-white hover:bg-[#F8FAFC] text-[#0F172A] border border-[#CBD5E1] text-[12px] font-medium rounded transition-colors cursor-pointer"
                        >
                          <FolderTree className="w-3.5 h-3.5 text-[#1D4ED8]" />
                          <span>Buka Tab Hierarki &amp; ToR</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddOutcome(true)}
                          className="inline-flex items-center gap-1.5 h-[32px] px-3.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[12px] font-semibold rounded transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Tambah Outcome Manual</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* TABEL MATRIKS ACTIVITY (Nada Profesional Selaras & Tombol Input Manual Jelas) */}
                      <div className="rounded-md border border-[#CBD5E1] bg-white overflow-hidden shadow-2xs">
                        <div className="px-3.5 py-2.5 bg-[#F8FAFC] border-b border-[#CBD5E1] flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-[#0F7B6C]" />
                            <div>
                              <span className="text-[11.5px] font-bold text-[#0F172A] uppercase tracking-wider">
                                Matriks Activity — Activity Description, Anticipated Inputs &amp; Planned Participants
                              </span>
                              <span className="ml-2 text-[11px] font-medium text-[#64748B]">
                                (Terkoneksi Hirarki · Input Manual)
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="overflow-x-auto bg-white">
                          <table className="w-full text-left border-collapse text-[11.5px] text-[#0F172A]">
                            <thead>
                              <tr className="border-b border-[#CBD5E1] bg-[#F1F5F9] text-[11px] font-bold text-[#0F172A]">
                                <th className="py-2.5 px-3 w-[23%] border-r border-[#CBD5E1] bg-[#E5E7EB]/80">
                                  Nomor &amp; Nama Activity (Hirarki)
                                </th>
                                <th className="py-2.5 px-3 w-[33%] border-r border-[#CBD5E1]">
                                  Activity description
                                </th>
                                <th className="py-2.5 px-3 w-[18%] border-r border-[#CBD5E1]">
                                  Anticipated inputs
                                </th>
                                <th className="py-2.5 px-3 w-[18%] border-r border-[#CBD5E1]">
                                  Planned participants (by gender &amp; age)
                                </th>
                                <th className="py-2.5 px-2.5 w-[108px] text-center bg-[#F8FAFC]">
                                  Input Manual
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {programOutcomes.map((outcome, ocIdx) => {
                                const relatedOutputs = outputs.filter(
                                  (op) => op.outcomeId === outcome.id
                                );
                                const displayOutcomeNumber =
                                  outcome.outcomeNumber ||
                                  (outcome.name.match(/^(Outcome\s*\d+)/i)?.[1] ??
                                    `Outcome ${ocIdx + 1}`);
                                const displayOutcomeDescription =
                                  outcome.description ||
                                  outcome.name.replace(/^Outcome\s*\d+\s*[:\-–]?\s*/i, '').trim() ||
                                  outcome.name;

                                return (
                                  <React.Fragment key={`unified-act-matrix-oc-${outcome.id}`}>
                                    {/* Baris Header Outcome */}
                                    <tr className="border-b border-t border-[#CBD5E1] bg-[#E5E7EB]/70 text-[#0F172A]">
                                      <td
                                        colSpan={5}
                                        className="py-2 px-3 font-bold text-[11.5px] text-[#0F172A]"
                                      >
                                        <span className="text-[#1D4ED8] mr-1.5">
                                          {displayOutcomeNumber}:
                                        </span>
                                        <span>{displayOutcomeDescription}</span>
                                      </td>
                                    </tr>

                                    {relatedOutputs.map((opItem, opIdx) => {
                                      const opNumLabel =
                                        opItem.outputNumber ||
                                        (opItem.name.match(/^(Output\s*[\d.]+)/i)?.[1] ??
                                          `Output ${ocIdx + 1}.${opIdx + 1}`);
                                      const opDescLabel =
                                        opItem.description ||
                                        opItem.name
                                          .replace(/^Output\s*[\d.]+\s*[:\-–]?\s*/i, '')
                                          .trim() ||
                                        opItem.name;
                                      const opActs = activities.filter(
                                        (a) => a.outputId === opItem.id
                                      );

                                      return (
                                        <React.Fragment key={`act-matrix-op-${opItem.id}`}>
                                          {/* Baris Subheader Output */}
                                          <tr className="border-b border-[#CBD5E1] bg-[#F8FAFC] text-[#0F172A]">
                                            <td
                                              colSpan={4}
                                              className="py-2 px-3 text-[11px] font-semibold text-[#1E293B] border-r border-[#CBD5E1]"
                                            >
                                              <span className="text-[#0F7B6C] font-bold mr-1.5">
                                                {opNumLabel}:
                                              </span>
                                              <span>{opDescLabel}</span>
                                            </td>
                                            <td className="py-1.5 px-2 text-center">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setShowAddActivity({
                                                    outputId: opItem.id,
                                                  });
                                                  setActivityForm({
                                                    activityNumber: `Activity ${ocIdx + 1}.${opIdx + 1}`,
                                                    name: '',
                                                    code: `${ocIdx + 1}.${opIdx + 1}.${opActs.length + 1}`,
                                                    description: '',
                                                    anticipatedInputs: '',
                                                    plannedParticipantsBreakdown: '',
                                                    startDate: currentProg.startDate,
                                                    endDate: currentProg.endDate,
                                                  });
                                                }}
                                                className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-[#0F7B6C] bg-white hover:bg-[#ECFDF5] border border-[#A7F3D0] transition-colors cursor-pointer"
                                              >
                                                <Plus className="w-2.5 h-2.5 shrink-0" />
                                                <span>Activity</span>
                                              </button>
                                            </td>
                                          </tr>

                                          {opActs.length === 0 ? (
                                            <tr className="border-b border-[#CBD5E1] bg-white text-[#64748B] italic">
                                              <td className="py-2.5 px-3 border-r border-[#CBD5E1]">
                                                Belum ada Activity pada {opNumLabel}
                                              </td>
                                              <td className="py-2.5 px-3 border-r border-[#CBD5E1]">
                                                -
                                              </td>
                                              <td className="py-2.5 px-3 border-r border-[#CBD5E1]">
                                                -
                                              </td>
                                              <td className="py-2.5 px-3 border-r border-[#CBD5E1]">
                                                -
                                              </td>
                                              <td className="py-2.5 px-2 text-center">-</td>
                                            </tr>
                                          ) : (
                                            opActs.map((actItem, actIdx) => {
                                              const actPrefix =
                                                actItem.activityNumber ||
                                                (actItem.name.match(/^(Activity\s*[\d.]+)/i)?.[1] ??
                                                  `Activity ${ocIdx + 1}.${opIdx + 1}`);
                                              const cleanActName =
                                                actItem.name
                                                  .replace(/^Activity\s*[\d.]+\s*[:\-–]?\s*/i, '')
                                                  .trim() || actItem.name;

                                              const openActivityManualEdit = () => {
                                                setEditingActivity(actItem);
                                                setActivityForm({
                                                  activityNumber: actPrefix,
                                                  name: cleanActName,
                                                  code: actItem.code || '',
                                                  description: actItem.description || '',
                                                  anticipatedInputs:
                                                    actItem.anticipatedInputs || '',
                                                  plannedParticipantsBreakdown:
                                                    actItem.plannedParticipantsBreakdown || '',
                                                  startDate: actItem.startDate,
                                                  endDate: actItem.endDate,
                                                });
                                              };

                                              return (
                                                <tr
                                                  key={actItem.id || actIdx}
                                                  onClick={openActivityManualEdit}
                                                  className="border-b border-[#CBD5E1] last:border-b-0 bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer text-[#0F172A]"
                                                >
                                                  <td className="py-3 px-3 align-top border-r border-[#CBD5E1] leading-relaxed">
                                                    <span className="font-bold text-[#0F172A] block">
                                                      {actPrefix}
                                                    </span>
                                                    <span className="text-[#334155]">
                                                      {cleanActName}
                                                    </span>
                                                  </td>
                                                  <td className="py-3 px-3 align-top border-r border-[#CBD5E1] leading-relaxed">
                                                    {actItem.description ? (
                                                      actItem.description
                                                    ) : (
                                                      <span className="text-[#64748B] italic text-[11px]">
                                                        Belum diisi — klik Input Manual
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-3 px-3 align-top border-r border-[#CBD5E1] leading-relaxed">
                                                    {actItem.anticipatedInputs || '-'}
                                                  </td>
                                                  <td className="py-3 px-3 align-top border-r border-[#CBD5E1] leading-relaxed">
                                                    {actItem.plannedParticipantsBreakdown || '-'}
                                                  </td>
                                                  <td
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="py-2.5 px-2 text-center align-middle bg-[#F8FAFC]/60"
                                                  >
                                                    <button
                                                      type="button"
                                                      onClick={openActivityManualEdit}
                                                      className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[10.5px] font-semibold text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] transition-colors cursor-pointer"
                                                    >
                                                      <Edit3 className="w-3 h-3 shrink-0" />
                                                      <span>
                                                        {actItem.description ? 'Edit' : '+ Input'}
                                                      </span>
                                                    </button>
                                                  </td>
                                                </tr>
                                              );
                                            })
                                          )}
                                        </React.Fragment>
                                      );
                                    })}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                          {(dataset.masterBudgetCodes || []).length} Kode Aktif
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 w-full text-[11px]">
                        <span className="text-[#787774] truncate">
                          Tabel 2 Kolom (Code | Category)
                        </span>
                        <span className="font-mono font-semibold text-[#1D4ED8] whitespace-nowrap shrink-0">
                          Terdaftar: {(dataset.masterBudgetCodes || []).length}
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

                              {/* Status Persetujuan Direktur & Konfirmasi Finance Badge */}
                              <div className="inline-flex flex-wrap items-center gap-1.5">
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
                                {dataset.periodUpdateStatus && (
                                  <span
                                    className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold whitespace-nowrap ${
                                      dataset.periodUpdateStatus === 'Terkonfirmasi Finance'
                                        ? 'bg-blue-50 text-[#1D4ED8] border-blue-200'
                                        : 'bg-amber-50 text-amber-900 border-amber-200'
                                    }`}
                                  >
                                    {dataset.periodUpdateStatus === 'Terkonfirmasi Finance'
                                      ? `✓ Dikonfirmasi Finance (${dataset.periodConfirmedByFinanceName || 'Finance'})`
                                      : `⏳ Menunggu Konfirmasi Finance (Update Direktur: ${
                                          dataset.periodUpdatedByDirectorName || 'Direktur'
                                        })`}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Action Buttons: Direktur selalu memiliki tombol Update Kode & Periode, Finance memiliki tombol Konfirmasi */}
                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                              {/* Finance dapat menambah periode, mengonfirmasi update kode/periode dari Direktur & mengajukan anggaran/revisi */}
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
                                    onClick={handleFinanceConfirmPeriodUpdate}
                                    className={`inline-flex items-center gap-1 h-7 px-3 rounded text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                                      dataset.periodUpdateStatus === 'Menunggu Konfirmasi Finance'
                                        ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-2xs'
                                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    }`}
                                    title="Konfirmasi oleh Finance atas keputusan Kode & Custom Period dari Direktur"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>Konfirmasi Kode &amp; Periode (Finance)</span>
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

                              {/* Direktur: Selalu tampilkan tombol Tambah Periode & Update Kode & Periode (Direktur), plus ACC/Revisi jika belum di-ACC */}
                              {isDirector && (
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
                                    onClick={handleDirectorUpdatePeriodsAndCodes}
                                    className="inline-flex items-center gap-1 h-7 px-3 rounded text-[11px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] cursor-pointer whitespace-nowrap shadow-2xs"
                                    title="Simpan & Update Kode Periode (P1, q1, P2, dsb.) oleh Direktur untuk dikonfirmasi Finance & disinkronkan ke TOR"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>Update Kode &amp; Periode (Direktur)</span>
                                  </button>
                                  {currentBudgetApprovalStatus !== 'Disetujui Direktur' && (
                                    <>
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
                                <th className="py-1.5 px-3 text-center w-24">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EAEAEA]">
                              {(() => {
                                const firstActiveIdx = activeDraftPeriods.findIndex(
                                  (p) => p.isActiveForTor
                                );
                                const effectiveActiveIdx =
                                  firstActiveIdx >= 0 ? firstActiveIdx : 0;

                                return activeDraftPeriods.map((period, idx) => {
                                  const isTorActive = idx === effectiveActiveIdx;
                                  return (
                                    <tr key={period.id} className="hover:bg-[#FAFAF9]">
                                      <td className="py-1.5 px-3 font-mono font-bold text-[#252525]">
                                        <div className="flex items-center gap-1.5">
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
                                            className="w-20 px-2 py-1 text-xs font-mono font-bold border border-[#D4D4D0] rounded focus:outline-none focus:border-[#1D4ED8]"
                                          />
                                          {isDirector && (
                                            <button
                                              type="button"
                                              onClick={handleDirectorUpdatePeriodsAndCodes}
                                              className="px-2 py-1 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[10px] font-semibold cursor-pointer whitespace-nowrap"
                                              title="Update Kode & Periode ini (Direktur)"
                                            >
                                              Update
                                            </button>
                                          )}
                                          {isFinance &&
                                            dataset.periodUpdateStatus ===
                                              'Menunggu Konfirmasi Finance' && (
                                              <button
                                                type="button"
                                                onClick={handleFinanceConfirmPeriodUpdate}
                                                className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-semibold cursor-pointer whitespace-nowrap"
                                                title="Konfirmasi Kode & Periode ini (Finance)"
                                              >
                                                Konfirmasi
                                              </button>
                                            )}
                                        </div>
                                      </td>
                                      <td className="py-1.5 px-3 font-medium text-[#252525]">
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
                                          className="w-full px-2 py-1 text-xs border border-[#D4D4D0] rounded focus:outline-none focus:border-[#1D4ED8]"
                                        />
                                      </td>
                                      <td className="py-1.5 px-3 font-mono text-[11px] text-[#5A5A58]">
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
                                            className="px-2 py-1 text-xs font-mono border border-[#D4D4D0] rounded"
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
                                            handleUpdateDraftPeriodAmount(
                                              period.id,
                                              Number(e.target.value)
                                            )
                                          }
                                          className="w-40 text-right px-2.5 py-1 text-xs font-mono font-bold text-[#252525] bg-white border border-[#D4D4D0] rounded focus:outline-none focus:border-[#1D4ED8]"
                                        />
                                      </td>
                                      <td className="py-1.5 px-3 text-center whitespace-nowrap">
                                        {!isBudgetApprovedByDirector && !isDirector ? (
                                          <span
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F4F3EF] border border-[#E3E2E0] text-[#787774] text-[10.5px] font-medium cursor-not-allowed"
                                            title="Time Period Aktif (TOR) hanya dapat diaktifkan setelah Anggaran di-ACC oleh Direktur"
                                          >
                                            <Lock className="w-3 h-3 text-[#9B9A97]" />
                                            <span>Menunggu ACC Direktur</span>
                                          </span>
                                        ) : isFinance || isDirector ? (
                                          <button
                                            type="button"
                                            onClick={() => handleFinanceActivateTorPeriod(period.id)}
                                            className={`px-2.5 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                                              isTorActive
                                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                                                : 'bg-white border border-[#D4D4D0] text-[#5A5A58] hover:bg-[#F4F4F2]'
                                            }`}
                                            title="Klik untuk menetapkan periode ini sebagai Time Period Aktif (TOR)"
                                          >
                                            {isTorActive ? 'Aktif (TOR)' : 'Pilih Aktif'}
                                          </button>
                                        ) : (
                                          <span
                                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10.5px] font-semibold ${
                                              isTorActive
                                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                                : 'bg-[#F7F7F5] text-[#787774] border border-[#E5E5E3]'
                                            }`}
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
                                });
                              })()}
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

                        {/* Track Audit Perubahan Kode, Periode & Konfirmasi Finance */}
                        <div className="border border-[#E5E5E3] rounded bg-[#FAFAF9] overflow-hidden">
                          <div className="px-3 py-2 bg-[#F4F4F2] border-b border-[#E5E5E3] flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-[#252525]">
                                Track Audit Kode Periode, Update Direktur &amp; Konfirmasi Finance
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-white border border-[#D4D4D0] text-[10px] font-mono font-semibold text-[#5F5E5B]">
                                {(dataset.revisions || []).length} Riwayat
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowPeriodAuditTrail((prev) => !prev)}
                              className="text-[11px] font-semibold text-[#1D4ED8] hover:underline cursor-pointer"
                            >
                              {showPeriodAuditTrail ? 'Sembunyikan Audit' : 'Tampilkan Audit'}
                            </button>
                          </div>

                          {showPeriodAuditTrail && (
                            <div className="divide-y divide-[#EAEAEA] max-h-56 overflow-y-auto">
                              {(dataset.revisions || []).length === 0 ? (
                                <div className="px-3 py-3 text-[11px] text-[#787774]">
                                  Belum ada riwayat perubahan kode periode atau anggaran.
                                </div>
                              ) : (
                                (dataset.revisions || []).map((rev) => {
                                  const badgeStyle =
                                    rev.actionType === 'PERIOD_CODE_UPDATED_BY_DIRECTOR'
                                      ? 'bg-blue-50 text-[#1D4ED8] border-blue-200'
                                      : rev.actionType === 'PERIOD_UPDATE_CONFIRMED_BY_FINANCE'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : rev.actionType === 'BUDGET_APPROVED_BY_DIRECTOR'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : rev.actionType === 'ACTIVE_TOR_PERIOD_CHANGED'
                                      ? 'bg-purple-50 text-purple-800 border-purple-200'
                                      : rev.actionType === 'BUDGET_REVISION_REQUESTED'
                                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                                      : 'bg-amber-50 text-amber-800 border-amber-200';

                                  const badgeLabel =
                                    rev.actionType === 'PERIOD_CODE_UPDATED_BY_DIRECTOR'
                                      ? 'Update Kode & Periode (Direktur)'
                                      : rev.actionType === 'PERIOD_UPDATE_CONFIRMED_BY_FINANCE'
                                      ? 'Dikonfirmasi Finance'
                                      : rev.actionType === 'BUDGET_APPROVED_BY_DIRECTOR'
                                      ? 'ACC Anggaran Direktur'
                                      : rev.actionType === 'ACTIVE_TOR_PERIOD_CHANGED'
                                      ? 'Time Period Aktif (TOR)'
                                      : rev.actionType === 'BUDGET_REVISION_REQUESTED'
                                      ? 'Revisi Diminta Direktur'
                                      : 'Pengajuan Finance';

                                  const formattedTime = (() => {
                                    try {
                                      return new Date(rev.timestamp).toLocaleString('id-ID', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      });
                                    } catch {
                                      return rev.timestamp;
                                    }
                                  })();

                                  return (
                                    <div
                                      key={rev.id}
                                      className="px-3 py-2 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 bg-white hover:bg-[#FAFAF9]"
                                    >
                                      <div className="space-y-0.5 min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span
                                            className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold ${badgeStyle}`}
                                          >
                                            {badgeLabel}
                                          </span>
                                          <span className="font-semibold text-[#171717]">
                                            {rev.actorName}
                                          </span>
                                          <span className="text-[#787774]">
                                            ({rev.actorRole})
                                          </span>
                                        </div>
                                        <p className="text-[#3F3E3B] leading-snug">
                                          {rev.summary}
                                        </p>
                                      </div>
                                      <span className="text-[10.5px] font-mono text-[#787774] shrink-0">
                                        {formattedTime}
                                      </span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* SUB-TAB 2: MASTER BUDGET CODE (2 KOLOM: CODE | BUDGET CATEGORY) */}
                    {financeSectionTab === 'codes' && (
                      <div className="p-3 space-y-2.5">
                        {/* Panel Input Master Budget Code Langsung oleh Finance via Excel (Mandiri Tanpa Lewat Activity) */}
                        <div className="bg-[#FAF9F6] border border-[#E5E5E3] rounded-md px-3.5 py-2.5 flex flex-col gap-2.5">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded bg-blue-50 border border-blue-200 text-[#1D4ED8] flex items-center justify-center shrink-0">
                              <FileSpreadsheet className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-[#171717]">
                                  Input Master Budget Code Langsung oleh Finance via Excel (Tanpa Perlu Lewat Activity)
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                    dataset.masterCodeUpdateStatus === 'Menunggu Konfirmasi Update Master Kode'
                                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                                      : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                  }`}
                                >
                                  {dataset.masterCodeUpdateStatus === 'Menunggu Konfirmasi Update Master Kode'
                                    ? 'Menunggu Konfirmasi Update Master Kode'
                                    : '✓ Master Kode Terkonfirmasi'}
                                </span>
                              </div>
                              <p className="text-[11px] text-[#6B6B68] leading-snug mt-0.5">
                                Finance dapat langsung mengunduh <strong>Template Excel Master Kode</strong>, mengisi kolom <strong>Code</strong> &amp; <strong>Budget Category</strong>, lalu klik <strong>Masukkan Master Kode via Excel</strong> dan <strong>Konfirmasi Update Master Kode</strong>.
                              </p>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-[#ECEAE4] flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                downloadMasterBudgetExcelTemplate(
                                  dataset.programName,
                                  dataset.masterBudgetCodes
                                )
                              }
                              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded border border-[#D4D4D0] bg-white hover:bg-[#F2F1EE] text-[11.5px] font-medium text-[#252525] transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5 text-[#15803D]" />
                              <span>Unduh Template Excel Kode (.xlsx)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="inline-flex items-center gap-1.5 h-7 px-3 rounded border border-[#2B6E3F] bg-[#2B6E3F] hover:bg-[#235A33] text-[11.5px] font-semibold text-white transition-colors cursor-pointer"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>Masukkan Master Kode via Excel</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleOpenAddCode}
                              className="inline-flex items-center gap-1 h-7 px-3 rounded text-[11.5px] font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add Code Manual</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleConfirmMasterCodeUpdate}
                              className="inline-flex items-center gap-1.5 h-7 px-3 rounded border border-emerald-700 bg-emerald-600 hover:bg-emerald-700 text-[11.5px] font-semibold text-white transition-colors cursor-pointer"
                              title="Konfirmasi perubahan / penambahan Master Budget Code dan simpan ke Track Audit"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Konfirmasi Update Master Kode</span>
                            </button>
                          </div>
                        </div>

                        {/* Single-Row Toolbar: Search + Count + Confirmation Info */}
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
                              <strong>{(dataset.masterBudgetCodes || []).length}</strong> Master Kode Aktif (Dikelola Finance)
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#5F5E5B]">
                            {dataset.masterCodeConfirmedByName && (
                              <span>
                                Dikonfirmasi oleh: <strong>{dataset.masterCodeConfirmedByName}</strong>
                              </span>
                            )}
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
                              {(dataset.masterBudgetCodes || [])
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
                                            Update Kode
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
                              {(dataset.masterBudgetCodes || []).length === 0 && (
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

                        {/* Track Audit Update & Konfirmasi Master Budget Code */}
                        <div className="border border-[#E5E5E3] rounded bg-[#FAF9F6] overflow-hidden">
                          <div className="px-3 py-2 bg-[#F2F1EE] border-b border-[#E5E5E3] flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-[#1D4ED8]" />
                              <span className="text-[11.5px] font-bold text-[#171717]">
                                Track Audit Update &amp; Konfirmasi Master Budget Code
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-white border border-[#D4D4D0] text-[10px] font-mono font-semibold text-[#5F5E5B]">
                                {
                                  (dataset.revisions || []).filter(
                                    (r) =>
                                      r.actionType === 'MASTER_CODE_UPDATE' ||
                                      r.actionType === 'MASTER_CODE_CONFIRMED'
                                  ).length
                                }{' '}
                                Riwayat Master Kode
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowMasterCodeAuditTrail((prev) => !prev)}
                              className="text-[11px] font-semibold text-[#1D4ED8] hover:underline cursor-pointer"
                            >
                              {showMasterCodeAuditTrail ? 'Sembunyikan Audit' : 'Tampilkan Audit'}
                            </button>
                          </div>

                          {showMasterCodeAuditTrail && (
                            <div className="divide-y divide-[#EAEAEA] max-h-56 overflow-y-auto">
                              {(() => {
                                const masterCodeLogs = (dataset.revisions || []).filter(
                                  (r) =>
                                    r.actionType === 'MASTER_CODE_UPDATE' ||
                                    r.actionType === 'MASTER_CODE_CONFIRMED'
                                );
                                if (masterCodeLogs.length === 0) {
                                  return (
                                    <div className="px-3 py-3 text-[11px] text-[#787774]">
                                      Belum ada riwayat perubahan atau konfirmasi Master Budget Code. Klik{' '}
                                      <strong>Konfirmasi Update Master Kode</strong> untuk mencatat pengesahan Master Kode aktif.
                                    </div>
                                  );
                                }
                                return masterCodeLogs.map((rev) => {
                                  const isConfirmed = rev.actionType === 'MASTER_CODE_CONFIRMED';
                                  const badgeStyle = isConfirmed
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-blue-50 text-[#1D4ED8] border-blue-200';
                                  const badgeLabel = isConfirmed
                                    ? 'Konfirmasi Update Master Kode'
                                    : 'Update Master Budget Code';
                                  const formattedTime = (() => {
                                    try {
                                      return new Date(rev.timestamp).toLocaleString('id-ID', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      });
                                    } catch {
                                      return rev.timestamp;
                                    }
                                  })();

                                  return (
                                    <div
                                      key={rev.id}
                                      className="px-3 py-2 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 bg-white hover:bg-[#FAFAF9]"
                                    >
                                      <div className="space-y-0.5 min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span
                                            className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold ${badgeStyle}`}
                                          >
                                            {badgeLabel}
                                          </span>
                                          <span className="font-semibold text-[#171717]">
                                            {rev.actorName}
                                          </span>
                                          <span className="text-[#787774]">
                                            ({rev.actorRole})
                                          </span>
                                        </div>
                                        <p className="text-[#3F3E3B] leading-snug">
                                          {rev.summary}
                                        </p>
                                      </div>
                                      <span className="text-[10.5px] font-mono text-[#787774] shrink-0">
                                        {formattedTime}
                                      </span>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          )}
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
                    <div className="animate-in fade-in duration-150">
                      {/* HIERARKI 3 LEVEL RINGKAS: OUTCOME -> OUTPUT -> ACTIVITY (+ TOR) */}
                      {programOutcomes.length === 0 ? (
                        <div className="bg-white rounded-md border border-dashed border-[#EAEAEA] p-6 text-center space-y-2">
                          <h4 className="text-[13px] font-semibold text-[#171717]">
                            Belum ada Hirarki pada Program ini
                          </h4>
                          <p className="text-[11.5px] text-[#787774] max-w-md mx-auto">
                            Gunakan tombol <strong>Template Excel Hirarki</strong> dan{' '}
                            <strong>Masukkan Otomatis via Excel</strong> di atas untuk mengimpor Outcome, Output, dan Activity.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-white rounded-md border border-[#E2E8F0] divide-y divide-[#E2E8F0]">
                          {programOutcomes.map((outcome, ocIdx) => {
                            const isOutExpanded = expandedOutcomes[outcome.id] ?? true;
                            const relatedOutputs = outputs.filter(
                              (op) => op.outcomeId === outcome.id
                            );
                            const displayOutcomeNumber =
                              outcome.outcomeNumber ||
                              (outcome.name.match(/^(Outcome\s*\d+)/i)?.[1] ??
                                `Outcome ${ocIdx + 1}`);
                            const displayOutcomeTitle =
                              outcome.name
                                .replace(/^Outcome\s*[\d.]+\s*[:\-–]?\s*/i, '')
                                .trim() ||
                              outcome.description ||
                              outcome.name;

                            return (
                              <div key={outcome.id} className="px-3 py-2 space-y-1">
                                {/* 1. OUTCOME (1 Baris Ringkas: Nomor Outcome + Nama Outcome) */}
                                <div className="flex items-center justify-between gap-2 group py-0.5">
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    <button
                                      type="button"
                                      onClick={() => toggleOutcome(outcome.id)}
                                      className="p-0.5 text-[#64748B] hover:text-[#0F172A] rounded hover:bg-[#F1F5F9] cursor-pointer shrink-0"
                                    >
                                      {isOutExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      )}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleOpenOutcomeDetailModal(outcome, ocIdx)}
                                      className="flex-1 min-w-0 text-left flex items-baseline gap-2 py-0.5 px-1.5 -mx-1.5 rounded hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                                    >
                                      <span className="text-[12px] font-bold text-[#1D4ED8] shrink-0">
                                        {displayOutcomeNumber}
                                      </span>
                                      <span className="text-[13px] font-semibold text-[#0F172A] group-hover:text-[#1D4ED8] transition-colors truncate">
                                        {displayOutcomeTitle}
                                      </span>
                                    </button>
                                  </div>
                                </div>

                                {/* 2. OUTPUT (1 Baris Ringkas di bawah Outcome) */}
                                {isOutExpanded && relatedOutputs.length > 0 && (
                                  <div className="pl-4 ml-2 border-l border-[#E2E8F0] space-y-1">
                                    {relatedOutputs.map((output, opIdx) => {
                                      const isOpExpanded = expandedOutputs[output.id] ?? true;
                                      const relatedActivities = activities.filter(
                                        (a) => a.outputId === output.id
                                      );
                                      const displayOutputNumber =
                                        output.outputNumber ||
                                        (output.name.match(/^(Output\s*[\d.]+)/i)?.[1] ??
                                          `Output ${ocIdx + 1}.${opIdx + 1}`);
                                      const displayOutputTitle =
                                        output.name
                                          .replace(/^Output\s*[\d.]+\s*[:\-–]?\s*/i, '')
                                          .trim() ||
                                        output.description ||
                                        output.name;

                                      return (
                                        <div key={output.id} className="space-y-0.5">
                                          <div className="flex items-center justify-between gap-2 group/op py-0.5">
                                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                              <button
                                                type="button"
                                                onClick={() => toggleOutput(output.id)}
                                                className="p-0.5 text-[#94A3B8] hover:text-[#0F172A] rounded hover:bg-[#F1F5F9] cursor-pointer shrink-0"
                                              >
                                                {isOpExpanded ? (
                                                  <ChevronDown className="w-3.5 h-3.5" />
                                                ) : (
                                                  <ChevronRight className="w-3.5 h-3.5" />
                                                )}
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleOpenOutputDetailModal(output, ocIdx, opIdx)
                                                }
                                                className="flex-1 min-w-0 text-left flex items-baseline gap-2 py-0.5 px-1.5 -mx-1.5 rounded hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                                              >
                                                <span className="text-[11.5px] font-bold text-[#0F7B6C] shrink-0">
                                                  {displayOutputNumber}
                                                </span>
                                                <span className="text-[12.5px] font-medium text-[#1E293B] group-hover/op:text-[#0F7B6C] transition-colors truncate">
                                                  {displayOutputTitle}
                                                </span>
                                              </button>
                                            </div>
                                          </div>

                                          {/* 3. ACTIVITY (1 Baris Ringkas di bawah Output) */}
                                          {isOpExpanded && relatedActivities.length > 0 && (
                                            <div className="pl-4 ml-2 border-l border-[#F1F5F9] space-y-0.5">
                                              {relatedActivities.map((act, actIdx) => {
                                                const relatedTors = tors.filter(
                                                  (t) =>
                                                    t.activityId === act.id ||
                                                    (t.activityId || '').startsWith(`${act.id}-`)
                                                );
                                                const isActExpanded =
                                                  expandedActivities[act.id] ?? true;
                                                const canCreate =
                                                  currentUser?.permissions?.canCreateTor &&
                                                  currentUser.role !== 'admin';

                                                const effectivePeriodsForTor =
                                                  activeDraftPeriods.length > 0
                                                    ? activeDraftPeriods
                                                    : activeSavedPeriods;
                                                const firstActiveTorIdx =
                                                  effectivePeriodsForTor.findIndex(
                                                    (p) => p.isActiveForTor
                                                  );
                                                const activePeriodObj =
                                                  effectivePeriodsForTor[
                                                    firstActiveTorIdx >= 0 ? firstActiveTorIdx : 0
                                                  ] || effectivePeriodsForTor[0];
                                                const activeTorPeriodCode =
                                                  (activePeriodObj?.code
                                                    ? activePeriodObj.code.split('—')[0].trim()
                                                    : '') || 'P1';
                                                const activeTorPeriodLabel =
                                                  (activePeriodObj?.label || '').trim();

                                                const resolveTorPeriodCode = (t: Tor): string => {
                                                  // Prioritaskan kecocokan ID periode di Gambar 2 agar perubahan Kode (misal P1 -> q1) langsung sinkron
                                                  if (t.customPeriodId) {
                                                    const byId = effectivePeriodsForTor.find(
                                                      (p) => p.id === t.customPeriodId
                                                    );
                                                    if (byId?.code) {
                                                      return byId.code.split('—')[0].trim();
                                                    }
                                                  }
                                                  // Cocokkan berdasarkan rentang tanggal periode di Gambar 2
                                                  if (t.startDate) {
                                                    const byDate = effectivePeriodsForTor.find(
                                                      (p) =>
                                                        p.startDate &&
                                                        p.endDate &&
                                                        t.startDate >= p.startDate &&
                                                        t.startDate <= p.endDate
                                                    );
                                                    if (byDate?.code) {
                                                      return byDate.code.split('—')[0].trim();
                                                    }
                                                  }
                                                  if (
                                                    t.customPeriodCode &&
                                                    t.customPeriodCode.trim()
                                                  ) {
                                                    const rawCode = t.customPeriodCode
                                                      .split('—')[0]
                                                      .trim();
                                                    const matchedByCode =
                                                      effectivePeriodsForTor.find(
                                                        (p) =>
                                                          p.code.trim().toLowerCase() ===
                                                          rawCode.toLowerCase()
                                                      );
                                                    if (matchedByCode?.code) {
                                                      return matchedByCode.code
                                                        .split('—')[0]
                                                        .trim();
                                                    }
                                                    // Jika TOR dibuat pada periode pertama (P1) dan kode periode pertama di Gambar 2 diubah (mis. ke q1)
                                                    if (
                                                      rawCode.toUpperCase() === 'P1' &&
                                                      effectivePeriodsForTor[0]?.code
                                                    ) {
                                                      return effectivePeriodsForTor[0].code
                                                        .split('—')[0]
                                                        .trim();
                                                    }
                                                    return rawCode;
                                                  }
                                                  return activeTorPeriodCode;
                                                };

                                                const torPeriodCounts = new Map<string, number>();
                                                relatedTors.forEach((t) => {
                                                  const pCode = resolveTorPeriodCode(t);
                                                  torPeriodCounts.set(
                                                    pCode,
                                                    (torPeriodCounts.get(pCode) || 0) + 1
                                                  );
                                                });

                                                const activityTorSummaryLabel =
                                                  relatedTors.length === 0
                                                    ? `TOR ${activeTorPeriodCode} (0)`
                                                    : Array.from(torPeriodCounts.entries())
                                                        .map(
                                                          ([pCode, count]) =>
                                                            `TOR ${pCode} (${count})`
                                                        )
                                                        .join(' · ');

                                                const displayActivityNumber =
                                                  act.activityNumber ||
                                                  (act.name.match(/^(Activity\s*[\d.]+)/i)?.[1] ??
                                                    `Activity ${ocIdx + 1}.${opIdx + 1}.${actIdx + 1}`);
                                                const displayActivityTitle =
                                                  act.name
                                                    .replace(/^Activity\s*[\d.]+\s*[:\-–]?\s*/i, '')
                                                    .trim() || act.name;

                                                return (
                                                  <div key={act.id} className="space-y-0.5">
                                                    <div className="flex items-center justify-between gap-2 group/act py-0.5">
                                                      <button
                                                        type="button"
                                                        onClick={() => toggleActivity(act.id)}
                                                        className="flex items-center gap-1.5 flex-1 min-w-0 text-left py-0.5 px-1.5 -mx-1.5 rounded hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                                                      >
                                                        <span className="text-[#94A3B8] group-hover/act:text-[#0F172A] shrink-0">
                                                          {isActExpanded ? (
                                                            <ChevronDown className="w-3 h-3" />
                                                          ) : (
                                                            <ChevronRight className="w-3 h-3" />
                                                          )}
                                                        </span>
                                                        <span className="text-[11px] font-bold text-[#475569] shrink-0">
                                                          {displayActivityNumber}
                                                        </span>
                                                        <span className="text-[12px] text-[#334155] group-hover/act:text-[#0F172A] truncate">
                                                          {displayActivityTitle}
                                                        </span>
                                                      </button>

                                                      <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            setSelectedActivityDetail(act)
                                                          }
                                                          className="opacity-0 group-hover/act:opacity-100 focus:opacity-100 text-[10.5px] font-medium text-[#64748B] hover:text-[#1D4ED8] px-1.5 py-0.5 rounded hover:bg-[#F1F5F9] transition-all cursor-pointer"
                                                        >
                                                          Detail
                                                        </button>
                                                      </div>
                                                    </div>

                                                    {/* 4. TOR LIST RINGKAS: • Nomor TOR | Judul TOR | Status */}
                                                    {isActExpanded && (
                                                      <div className="pl-5 ml-1.5 border-l border-[#E2E8F0] py-1 space-y-0.5">
                                                        <div className="flex items-center justify-between gap-2 text-[11px]">
                                                          <div className="flex flex-wrap items-center gap-1.5">
                                                            <span className="font-semibold text-[#475569]">
                                                              {activityTorSummaryLabel}
                                                            </span>
                                                            {activeTorPeriodLabel && (
                                                              <span className="text-[10px] text-[#64748B] font-normal">
                                                                ({activeTorPeriodLabel})
                                                              </span>
                                                            )}
                                                          </div>
                                                          {onOpenCreateTorForActivity &&
                                                            canCreate && (
                                                              <button
                                                                type="button"
                                                                onClick={() =>
                                                                  onOpenCreateTorForActivity(
                                                                    outcome.id,
                                                                    output.id,
                                                                    act.id
                                                                  )
                                                                }
                                                                className="text-[10.5px] font-semibold text-[#1D4ED8] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                                                title={
                                                                  activeTorPeriodLabel
                                                                    ? `Buat TOR pada periode ${activeTorPeriodCode} — ${activeTorPeriodLabel}`
                                                                    : `Buat TOR ${activeTorPeriodCode}`
                                                                }
                                                              >
                                                                <Plus className="w-2.5 h-2.5" />
                                                                <span>
                                                                  Buat TOR {activeTorPeriodCode}
                                                                </span>
                                                              </button>
                                                            )}
                                                        </div>

                                                        {relatedTors.length === 0 ? (
                                                          <div className="text-[11px] text-[#94A3B8]">
                                                            • Belum ada TOR {activeTorPeriodCode}
                                                          </div>
                                                        ) : (
                                                          <ul className="space-y-0.5">
                                                            {relatedTors.map((tor, torIdx) => {
                                                              const torStatusLabel =
                                                                tor.activityStatus === 'Selesai'
                                                                  ? 'Completed'
                                                                  : tor.submissionStatus === 'Draft'
                                                                  ? 'Draft'
                                                                  : tor.activityStatus ===
                                                                      'Sedang Berjalan' ||
                                                                    tor.submissionStatus ===
                                                                      'Disetujui'
                                                                  ? 'In Progress'
                                                                  : tor.submissionStatus ||
                                                                    tor.activityStatus ||
                                                                    'Draft';

                                                              const shortTorNumber =
                                                                tor.torNumber ||
                                                                `TOR-${String(torIdx + 1).padStart(
                                                                  3,
                                                                  '0'
                                                                )}`;

                                                              return (
                                                                <li
                                                                  key={tor.id}
                                                                  className="flex items-center justify-between gap-2 group/toritem"
                                                                >
                                                                  <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                      onSelectTor?.(tor.id)
                                                                    }
                                                                    className="flex-1 min-w-0 text-left py-0.5 px-1.5 -mx-1.5 rounded hover:bg-[#F8FAFC] text-[11.5px] text-[#334155] hover:text-[#1D4ED8] transition-colors flex items-center gap-1.5 cursor-pointer"
                                                                  >
                                                                    <span className="text-[#94A3B8] shrink-0">
                                                                      •
                                                                    </span>
                                                                    <span className="font-mono font-semibold text-[#0F172A] shrink-0">
                                                                      {shortTorNumber}
                                                                    </span>
                                                                    <span className="text-[#CBD5E1] shrink-0">
                                                                      |
                                                                    </span>
                                                                    <span className="truncate text-[#1E293B]">
                                                                      {tor.title}
                                                                    </span>
                                                                    <span className="text-[#CBD5E1] shrink-0">
                                                                      |
                                                                    </span>
                                                                    <span
                                                                      className={`text-[11px] font-semibold shrink-0 ${
                                                                        torStatusLabel ===
                                                                        'Completed'
                                                                          ? 'text-[#0F7B6C]'
                                                                          : torStatusLabel ===
                                                                            'In Progress'
                                                                          ? 'text-[#1D4ED8]'
                                                                          : 'text-[#64748B]'
                                                                      }`}
                                                                    >
                                                                      {torStatusLabel}
                                                                    </span>
                                                                  </button>
                                                                  {isDirector && (
                                                                    <button
                                                                      type="button"
                                                                      onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        try {
                                                                          await api.deleteTor(tor.id);
                                                                          onRefresh();
                                                                        } catch {
                                                                          // ignore
                                                                        }
                                                                      }}
                                                                      title="Hapus TOR (Khusus Direktur)"
                                                                      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                                                                    >
                                                                      <Trash2 className="w-3 h-3" />
                                                                      <span>Hapus</span>
                                                                    </button>
                                                                  )}
                                                                </li>
                                                              );
                                                            })}
                                                          </ul>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
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

      {showHierarchyExcelPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-md shadow-xl max-w-4xl w-full p-5 space-y-4 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#EAEAEA]">
              <div>
                <h3 className="text-sm font-bold text-[#171717]">
                  Preview Import Excel Otomatis — Hirarki Program
                </h3>
                <p className="text-[11px] text-[#787774]">
                  File: <strong>{hierarchyExcelFileName}</strong> • Program:{' '}
                  <strong>
                    {currentSelectedProgram?.name || activeBudgetProgram?.name || '-'}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                disabled={importingHierarchyExcel}
                onClick={() => setShowHierarchyExcelPreviewModal(false)}
                className="text-[#787774] hover:text-[#171717] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 rounded bg-blue-50/70 border border-blue-200">
                <span className="text-[10.5px] text-[#5F5E5B] block">Outcome Baru</span>
                <strong className="text-sm font-bold text-[#1D4ED8]">
                  {hierarchyExcelPreviewRows.filter((r) => r.isNewOutcome).length}
                </strong>
              </div>
              <div className="p-2.5 rounded bg-[#EBF7F5] border border-[#C0E8DF]">
                <span className="text-[10.5px] text-[#5F5E5B] block">Output Baru</span>
                <strong className="text-sm font-bold text-[#0F7B6C]">
                  {hierarchyExcelPreviewRows.filter((r) => r.isNewOutput).length}
                </strong>
              </div>
              <div className="p-2.5 rounded bg-amber-50/80 border border-amber-200">
                <span className="text-[10.5px] text-[#5F5E5B] block">Activity Baru</span>
                <strong className="text-sm font-bold text-amber-800">
                  {hierarchyExcelPreviewRows.filter((r) => r.isNewActivity).length}
                </strong>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 border border-[#0F172A] rounded-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#0F172A] bg-white text-[12px] font-bold text-[#0F172A]">
                    <th className="py-2.5 px-3 text-center border-r border-[#0F172A] w-[30%]">
                      Outcome
                    </th>
                    <th className="py-2.5 px-3 text-center border-r border-[#0F172A] w-[30%]">
                      Output
                    </th>
                    <th className="py-2.5 px-3 text-center border-r border-[#0F172A] w-[30%]">
                      Activity
                    </th>
                    <th className="py-2.5 px-2.5 text-center w-[10%]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hierarchyExcelPreviewRows.map((row) => (
                    <tr
                      key={row.rowNumber}
                      className="border-b border-[#0F172A] last:border-b-0 hover:bg-[#F8FAFC]"
                    >
                      <td className="py-2 px-3 align-top text-[#0F172A] border-r border-[#0F172A] leading-snug">
                        {row.outcomeName || '-'}
                      </td>
                      <td className="py-2 px-3 align-top text-[#0F172A] border-r border-[#0F172A] leading-snug">
                        {row.outputName || '-'}
                      </td>
                      <td className="py-2 px-3 align-top text-[#0F172A] border-r border-[#0F172A] leading-snug">
                        {row.activityName || '-'}
                      </td>
                      <td className="py-2 px-2.5 align-top text-center">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            row.status === 'valid'
                              ? 'bg-[#EAF3EC] text-[#2B6E3F]'
                              : row.status === 'duplicate'
                              ? 'bg-[#F4F4F2] text-[#6B6B68]'
                              : 'bg-[#FDECEC] text-[#C93B3B]'
                          }`}
                        >
                          {row.status === 'valid'
                            ? 'Siap'
                            : row.status === 'duplicate'
                            ? 'Terdaftar'
                            : `Baris ${row.rowNumber}: ${row.statusMessage}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#EAEAEA] text-xs">
              <div className="text-[#787774]">
                {hierarchyExcelPreviewRows.some((r) => r.status === 'invalid') ? (
                  <span className="text-[#C93B3B] font-medium">
                    Perbaiki{' '}
                    <strong>
                      {hierarchyExcelPreviewRows.filter((r) => r.status === 'invalid').length} baris
                      invalid
                    </strong>{' '}
                    pada file Excel lalu unggah ulang.
                  </span>
                ) : (
                  <>
                    Siap diimpor otomatis:{' '}
                    <strong className="text-[#0F7B6C]">
                      {hierarchyExcelPreviewRows.filter((r) => r.status === 'valid').length} baris
                      hirarki baru
                    </strong>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={importingHierarchyExcel}
                  onClick={() => setShowHierarchyExcelPreviewModal(false)}
                  className="px-3 py-1.5 rounded border border-[#D4D4D0] text-[#5A5A58] hover:bg-[#F4F4F2] cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={
                    importingHierarchyExcel ||
                    hierarchyExcelPreviewRows.some((r) => r.status === 'invalid') ||
                    hierarchyExcelPreviewRows.filter((r) => r.status === 'valid').length === 0
                  }
                  onClick={handleConfirmHierarchyExcelImport}
                  className="px-4 py-1.5 rounded font-semibold bg-[#0F7B6C] text-white hover:bg-[#0B5E52] disabled:opacity-50 cursor-pointer"
                >
                  {importingHierarchyExcel
                    ? 'Mengimpor Hirarki...'
                    : 'Konfirmasi Import Hirarki'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL MODALS (For Outcome Indicators, Output Indicators, Activity Details) */}
      {/* DETAIL & MANUAL INPUT MODAL FOR OUTCOME (1 Kolom Mendatar Penuh & Menurun Urut Kolom Tabel) */}
      {selectedOutcomeDetail && editingOutcomeDraft && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3">
          <div className="bg-white rounded-md shadow-xl max-w-4xl w-full flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 border border-[#CBD5E1]">
            <div className="px-3.5 py-2 border-b border-[#CBD5E1] flex flex-wrap items-center justify-between gap-2 bg-[#F8FAFC]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#E5E7EB] text-[#0F172A] shrink-0">
                  {editingOutcomeDraft.outcomeNumber || 'Outcome'}
                </span>
                <h4 className="text-xs font-semibold text-[#0F172A] truncate">
                  {editingOutcomeDraft.description}
                </h4>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingOutcomeModal(true);
                    setEditingOutcomeDraft({
                      ...editingOutcomeDraft,
                      indicators: [
                        ...editingOutcomeDraft.indicators,
                        {
                          id: `ind-oc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                          name: '',
                          description: '',
                          dataSource: '',
                          cumulativeType: 'Non cumulative',
                          plannedDataBreakdown: '',
                          reportingFrequency: 'Annual',
                          baseline: 'TBA',
                          target: '',
                          endOfProjectGoal: '',
                          unit: '',
                          verificationMethod: '',
                        },
                      ],
                    });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Tambah Indikator</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingOutcomeModal((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] rounded transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingOutcomeModal ? 'Tutup Form Edit' : 'Input / Edit Manual'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idToDel = selectedOutcomeDetail.id;
                    setSelectedOutcomeDetail(null);
                    setEditingOutcomeDraft(null);
                    setIsEditingOutcomeModal(false);
                    handleDeleteOutcome(idToDel);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 rounded transition-colors cursor-pointer"
                  title="Hapus Outcome"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOutcomeDetail(null);
                    setEditingOutcomeDraft(null);
                    setIsEditingOutcomeModal(false);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3 max-h-[80vh] overflow-y-auto">
              {/* TABEL PREVIEW MATRIKS OUTCOME */}
              <div className="overflow-x-auto border border-[#CBD5E1] rounded bg-white">
                <table className="w-full text-left border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-[#CBD5E1] bg-[#F1F5F9] text-[11px] font-bold text-[#0F172A]">
                      <th className="py-2 px-2.5 w-[100px] text-center border-r border-[#CBD5E1] bg-[#E5E7EB]">
                        Nomor outcome
                      </th>
                      <th className="py-2 px-2.5 min-w-[180px] border-r border-[#CBD5E1]">
                        Description
                      </th>
                      <th className="py-2 px-2.5 min-w-[200px] border-r border-[#CBD5E1]">
                        Progress indicator
                      </th>
                      <th className="py-2 px-2.5 min-w-[160px] border-r border-[#CBD5E1]">
                        Data source
                      </th>
                      <th className="py-2 px-2 w-[110px] text-center border-r border-[#CBD5E1]">
                        Cumulative or non-cumulative
                      </th>
                      <th className="py-2 px-2.5 min-w-[170px] border-r border-[#CBD5E1]">
                        Planned data breakdown
                      </th>
                      <th className="py-2 px-2 w-[90px] text-center border-r border-[#CBD5E1]">
                        Reporting frequency
                      </th>
                      <th className="py-2 px-2 w-[80px] text-center border-r border-[#CBD5E1]">
                        Baseline
                      </th>
                      <th className="py-2 px-2.5 min-w-[180px]">End of project goal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((editingOutcomeDraft.indicators || []).length > 0
                      ? editingOutcomeDraft.indicators || []
                      : [
                          {
                            id: 'empty-oc-ind',
                            name: '-',
                            description: '',
                            dataSource: '-',
                            cumulativeType: 'Non cumulative',
                            plannedDataBreakdown: '-',
                            reportingFrequency: '-',
                            baseline: '-',
                            target: '-',
                            endOfProjectGoal: '-',
                            unit: '',
                            verificationMethod: '-',
                          },
                        ]
                    ).map((ind, idx, arr) => (
                      <tr
                        key={ind.id || idx}
                        className="border-b border-[#CBD5E1] last:border-b-0 align-top"
                      >
                        {idx === 0 && (
                          <>
                            <td
                              rowSpan={arr.length}
                              className="py-2.5 px-2.5 text-center align-middle font-bold text-[#0F172A] bg-[#E5E7EB] border-r border-[#CBD5E1] whitespace-nowrap"
                            >
                              {editingOutcomeDraft.outcomeNumber || 'Outcome'}
                            </td>
                            <td
                              rowSpan={arr.length}
                              className="py-2.5 px-2.5 align-middle font-semibold text-[#0F172A] bg-white border-r border-[#CBD5E1] leading-snug"
                            >
                              {editingOutcomeDraft.description || '-'}
                            </td>
                          </>
                        )}
                        <td className="py-2 px-2.5 border-r border-[#CBD5E1] text-[#0F172A] leading-snug">
                          {ind.name || '-'}
                        </td>
                        <td className="py-2 px-2.5 border-r border-[#CBD5E1] text-[#0F172A] leading-snug">
                          {ind.dataSource || ind.verificationMethod || '-'}
                        </td>
                        <td className="py-2 px-2 text-center border-r border-[#CBD5E1] text-[#0F172A] whitespace-nowrap">
                          {ind.cumulativeType || 'Non cumulative'}
                        </td>
                        <td className="py-2 px-2.5 border-r border-[#CBD5E1] text-[#0F172A] leading-snug">
                          {ind.plannedDataBreakdown || '-'}
                        </td>
                        <td className="py-2 px-2 text-center border-r border-[#CBD5E1] text-[#0F172A] whitespace-nowrap">
                          {ind.reportingFrequency || '-'}
                        </td>
                        <td className="py-2 px-2 text-center border-r border-[#CBD5E1] text-[#0F172A] whitespace-nowrap">
                          {ind.baseline || '-'}
                        </td>
                        <td className="py-2 px-2.5 text-[#0F172A] leading-snug">
                          {ind.endOfProjectGoal || ind.target || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* FORM INPUT MANUAL OUTCOME: SATU KOLOM MENDATAR PENUH & MENURUN URUT TABEL TANPA WASTE */}
              {isEditingOutcomeModal && (
                <div className="border border-[#CBD5E1] rounded bg-[#F8FAFC] p-2.5 space-y-2">
                  <div className="grid grid-cols-1 gap-1.5 bg-white p-2.5 rounded border border-[#CBD5E1]">
                    {/* 1. Nomor outcome (1 kolom penuh) */}
                    <div>
                      <label className="block text-[11px] font-bold text-[#0F172A] mb-0.5">
                        1. Nomor outcome
                      </label>
                      <input
                        type="text"
                        value={editingOutcomeDraft.outcomeNumber}
                        onChange={(e) =>
                          setEditingOutcomeDraft({
                            ...editingOutcomeDraft,
                            outcomeNumber: e.target.value,
                          })
                        }
                        placeholder="Contoh: Outcome 1"
                        className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs font-mono font-bold text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>

                    {/* 2. Description (1 kolom penuh) */}
                    <div>
                      <label className="block text-[11px] font-bold text-[#0F172A] mb-0.5">
                        2. Description
                      </label>
                      <textarea
                        rows={2}
                        value={editingOutcomeDraft.description}
                        onChange={(e) =>
                          setEditingOutcomeDraft({
                            ...editingOutcomeDraft,
                            description: e.target.value,
                          })
                        }
                        placeholder="Deskripsi / Nama Outcome..."
                        className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] leading-snug focus:outline-none focus:border-[#1D4ED8]"
                      />
                    </div>
                  </div>

                  {/* Daftar Indikator: Masing-masing field 1 kolom penuh menurun urut tabel */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-0.5">
                      <span className="text-[11px] font-bold text-[#0F172A]">
                        Daftar Progress Indicator ({(editingOutcomeDraft.indicators || []).length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingOutcomeDraft({
                            ...editingOutcomeDraft,
                            indicators: [
                              ...(editingOutcomeDraft.indicators || []),
                              {
                                id: `ind-oc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                                name: '',
                                description: '',
                                dataSource: '',
                                cumulativeType: 'Non cumulative',
                                plannedDataBreakdown: '',
                                reportingFrequency: 'Annual',
                                baseline: 'TBA',
                                target: '',
                                endOfProjectGoal: '',
                                unit: '',
                                verificationMethod: '',
                              },
                            ],
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Tambah Indikator</span>
                      </button>
                    </div>

                    {(editingOutcomeDraft.indicators || []).map((ind, idx) => {
                      const updateInd = (field: keyof Indicator, val: string) => {
                        const nextList = editingOutcomeDraft.indicators.map((item, i) =>
                          i === idx
                            ? {
                                ...item,
                                [field]: val,
                                ...(field === 'dataSource' ? { verificationMethod: val } : {}),
                                ...(field === 'endOfProjectGoal' ? { target: val } : {}),
                              }
                            : item
                        );
                        setEditingOutcomeDraft({
                          ...editingOutcomeDraft,
                          indicators: nextList,
                        });
                      };

                      return (
                        <div
                          key={ind.id || idx}
                          className="bg-white border border-[#CBD5E1] rounded p-2.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-1 mb-1">
                            <span className="text-[11px] font-bold text-[#1D4ED8]">
                              Indikator Outcome #{idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingOutcomeDraft({
                                  ...editingOutcomeDraft,
                                  indicators: editingOutcomeDraft.indicators.filter(
                                    (_, i) => i !== idx
                                  ),
                                })
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Hapus</span>
                            </button>
                          </div>

                          {/* Satu kolom mendatar penuh, urut menurun sesuai tabel */}
                          <div className="grid grid-cols-1 gap-1.5">
                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                3. Progress indicator
                              </label>
                              <textarea
                                rows={2}
                                value={ind.name}
                                onChange={(e) => updateInd('name', e.target.value)}
                                placeholder="Progress indicator..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] leading-snug focus:outline-none focus:border-[#1D4ED8]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                4. Data source
                              </label>
                              <input
                                type="text"
                                value={ind.dataSource || ''}
                                onChange={(e) => updateInd('dataSource', e.target.value)}
                                placeholder="Data source..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                5. Cumulative or non-cumulative
                              </label>
                              <select
                                value={ind.cumulativeType || 'Non cumulative'}
                                onChange={(e) => updateInd('cumulativeType', e.target.value)}
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                              >
                                <option value="Non cumulative">Non cumulative</option>
                                <option value="Non-cumulative">Non-cumulative</option>
                                <option value="Cumulative">Cumulative</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                6. Planned data breakdown
                              </label>
                              <input
                                type="text"
                                value={ind.plannedDataBreakdown || ''}
                                onChange={(e) => updateInd('plannedDataBreakdown', e.target.value)}
                                placeholder="Planned data breakdown..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                7. Reporting frequency
                              </label>
                              <input
                                type="text"
                                value={ind.reportingFrequency || ''}
                                onChange={(e) => updateInd('reportingFrequency', e.target.value)}
                                placeholder="Annual / Semi-Annual / Quarterly..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                8. Baseline
                              </label>
                              <input
                                type="text"
                                value={ind.baseline}
                                onChange={(e) => updateInd('baseline', e.target.value)}
                                placeholder="TBA / 0..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                9. End of project goal
                              </label>
                              <textarea
                                rows={2}
                                value={ind.endOfProjectGoal || ind.target}
                                onChange={(e) => updateInd('endOfProjectGoal', e.target.value)}
                                placeholder="End of project goal..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] leading-snug focus:outline-none focus:border-[#1D4ED8]"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-3.5 py-2.5 bg-[#F8FAFC] border-t border-[#CBD5E1] flex items-center justify-between gap-2">
              <div className="text-[11px] text-[#64748B]">
                Urutan 1 kolom menurun sesuai kolom tabel Matriks Outcome
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOutcomeDetail(null);
                    setEditingOutcomeDraft(null);
                    setIsEditingOutcomeModal(false);
                  }}
                  className="px-3 py-1.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#334155] text-xs font-semibold rounded cursor-pointer"
                >
                  Tutup
                </button>
                {!isEditingOutcomeModal ? (
                  <button
                    type="button"
                    onClick={() => setIsEditingOutcomeModal(true)}
                    className="px-3.5 py-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold rounded cursor-pointer"
                  >
                    Input / Edit Manual
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={savingOutcomeDetail}
                    onClick={handleSaveOutcomeDetailChanges}
                    className="px-3.5 py-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold rounded cursor-pointer disabled:opacity-50"
                  >
                    {savingOutcomeDetail ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL & MANUAL INPUT MODAL FOR OUTPUT (1 Kolom Mendatar Penuh & Menurun Urut Kolom Tabel) */}
      {selectedOutputDetail && editingOutputDraft && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3">
          <div className="bg-white rounded-md shadow-xl max-w-4xl w-full flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 border border-[#CBD5E1]">
            <div className="px-3.5 py-2 border-b border-[#CBD5E1] flex flex-wrap items-center justify-between gap-2 bg-[#F8FAFC]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#E5E7EB] text-[#0F172A] shrink-0">
                  {editingOutputDraft.outputNumber || 'Output'}
                </span>
                <h4 className="text-xs font-semibold text-[#0F172A] truncate">
                  {editingOutputDraft.description}
                </h4>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingOutputModal(true);
                    setEditingOutputDraft({
                      ...editingOutputDraft,
                      indicators: [
                        ...editingOutputDraft.indicators,
                        {
                          id: `ind-op-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                          name: '',
                          description: '',
                          dataSource: '',
                          cumulativeType: 'Non cumulative',
                          plannedDataBreakdown: '',
                          reportingFrequency: 'Annual',
                          baseline: 'TBA',
                          target: '',
                          endOfProjectGoal: '',
                          unit: '',
                          verificationMethod: '',
                        },
                      ],
                    });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#0F7B6C] hover:bg-[#0B5E52] rounded transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Tambah Indikator</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetOp = selectedOutputDetail;
                    setSelectedOutputDetail(null);
                    setEditingOutputDraft(null);
                    setIsEditingOutputModal(false);
                    setShowAddActivity({ outputId: targetOp.id });
                    setActivityForm({
                      activityNumber: editingOutputDraft.outputNumber.replace(
                        /^Output/i,
                        'Activity'
                      ),
                      name: '',
                      code: '',
                      description: '',
                      anticipatedInputs: '',
                      plannedParticipantsBreakdown: '',
                      startDate:
                        currentSelectedProgram?.startDate ||
                        new Date().toISOString().slice(0, 10),
                      endDate:
                        currentSelectedProgram?.endDate ||
                        new Date().toISOString().slice(0, 10),
                    });
                  }}
                  className="px-2.5 py-1 text-[11px] font-medium text-[#0F7B6C] bg-[#ECFDF5] hover:bg-[#D1FAE5] border border-[#A7F3D0] rounded transition-colors cursor-pointer"
                >
                  + Activity
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingOutputModal((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] rounded transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>{isEditingOutputModal ? 'Tutup Form Edit' : 'Input / Edit Manual'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idToDel = selectedOutputDetail.id;
                    setSelectedOutputDetail(null);
                    setEditingOutputDraft(null);
                    setIsEditingOutputModal(false);
                    handleDeleteOutput(idToDel);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 rounded transition-colors cursor-pointer"
                  title="Hapus Output"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOutputDetail(null);
                    setEditingOutputDraft(null);
                    setIsEditingOutputModal(false);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3 max-h-[80vh] overflow-y-auto">
              {/* TABEL PREVIEW MATRIKS OUTPUT */}
              <div className="overflow-x-auto border border-[#CBD5E1] rounded bg-white">
                <table className="w-full text-left border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-[#CBD5E1] bg-[#F1F5F9] text-[11px] font-bold text-[#0F172A]">
                      <th className="py-2 px-2.5 w-[100px] text-center border-r border-[#CBD5E1] bg-[#E5E7EB]">
                        Nomor output
                      </th>
                      <th className="py-2 px-2.5 min-w-[180px] border-r border-[#CBD5E1]">
                        Description
                      </th>
                      <th className="py-2 px-2.5 min-w-[200px] border-r border-[#CBD5E1]">
                        Progress indicator
                      </th>
                      <th className="py-2 px-2.5 min-w-[160px] border-r border-[#CBD5E1]">
                        Data source
                      </th>
                      <th className="py-2 px-2 w-[110px] text-center border-r border-[#CBD5E1]">
                        Cumulative or non-cumulative
                      </th>
                      <th className="py-2 px-2.5 min-w-[170px] border-r border-[#CBD5E1]">
                        Planned data breakdown
                      </th>
                      <th className="py-2 px-2 w-[90px] text-center border-r border-[#CBD5E1]">
                        Reporting frequency
                      </th>
                      <th className="py-2 px-2 w-[80px] text-center border-r border-[#CBD5E1]">
                        Baseline
                      </th>
                      <th className="py-2 px-2.5 min-w-[180px]">End of project goal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((editingOutputDraft.indicators || []).length > 0
                      ? editingOutputDraft.indicators || []
                      : [
                          {
                            id: 'empty-op-ind',
                            name: '-',
                            description: '',
                            dataSource: '-',
                            cumulativeType: 'Non cumulative',
                            plannedDataBreakdown: '-',
                            reportingFrequency: '-',
                            baseline: '-',
                            target: '-',
                            endOfProjectGoal: '-',
                            unit: '',
                            verificationMethod: '-',
                          },
                        ]
                    ).map((ind, idx, arr) => (
                      <tr
                        key={ind.id || idx}
                        className="border-b border-[#CBD5E1] last:border-b-0 align-top"
                      >
                        {idx === 0 && (
                          <>
                            <td
                              rowSpan={arr.length}
                              className="py-2.5 px-2.5 text-center align-middle font-bold text-[#0F172A] bg-[#E5E7EB] border-r border-[#CBD5E1] whitespace-nowrap"
                            >
                              {editingOutputDraft.outputNumber || 'Output'}
                            </td>
                            <td
                              rowSpan={arr.length}
                              className="py-2.5 px-2.5 align-middle font-medium text-[#0F172A] bg-white border-r border-[#CBD5E1] leading-snug"
                            >
                              {editingOutputDraft.description || '-'}
                            </td>
                          </>
                        )}
                        <td className="py-2 px-2.5 border-r border-[#CBD5E1] text-[#0F172A] leading-snug">
                          {ind.name || '-'}
                        </td>
                        <td className="py-2 px-2.5 border-r border-[#CBD5E1] text-[#0F172A] leading-snug">
                          {ind.dataSource || ind.verificationMethod || '-'}
                        </td>
                        <td className="py-2 px-2 text-center border-r border-[#CBD5E1] text-[#0F172A] whitespace-nowrap">
                          {ind.cumulativeType || 'Non cumulative'}
                        </td>
                        <td className="py-2 px-2.5 border-r border-[#CBD5E1] text-[#0F172A] leading-snug">
                          {ind.plannedDataBreakdown || '-'}
                        </td>
                        <td className="py-2 px-2 text-center border-r border-[#CBD5E1] text-[#0F172A] whitespace-nowrap">
                          {ind.reportingFrequency || '-'}
                        </td>
                        <td className="py-2 px-2 text-center border-r border-[#CBD5E1] text-[#0F172A] whitespace-nowrap">
                          {ind.baseline || '-'}
                        </td>
                        <td className="py-2 px-2.5 text-[#0F172A] leading-snug">
                          {ind.endOfProjectGoal || ind.target || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* FORM INPUT MANUAL OUTPUT: SATU KOLOM MENDATAR PENUH & MENURUN URUT TABEL TANPA WASTE */}
              {isEditingOutputModal && (
                <div className="border border-[#CBD5E1] rounded bg-[#F8FAFC] p-2.5 space-y-2">
                  <div className="grid grid-cols-1 gap-1.5 bg-white p-2.5 rounded border border-[#CBD5E1]">
                    {/* 1. Nomor output (1 kolom penuh) */}
                    <div>
                      <label className="block text-[11px] font-bold text-[#0F172A] mb-0.5">
                        1. Nomor output
                      </label>
                      <input
                        type="text"
                        value={editingOutputDraft.outputNumber}
                        onChange={(e) =>
                          setEditingOutputDraft({
                            ...editingOutputDraft,
                            outputNumber: e.target.value,
                          })
                        }
                        placeholder="Contoh: Output 1.1"
                        className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs font-mono font-bold text-[#0F172A] focus:outline-none focus:border-[#0F7B6C]"
                      />
                    </div>

                    {/* 2. Description (1 kolom penuh) */}
                    <div>
                      <label className="block text-[11px] font-bold text-[#0F172A] mb-0.5">
                        2. Description
                      </label>
                      <textarea
                        rows={2}
                        value={editingOutputDraft.description}
                        onChange={(e) =>
                          setEditingOutputDraft({
                            ...editingOutputDraft,
                            description: e.target.value,
                          })
                        }
                        placeholder="Deskripsi / Nama Output..."
                        className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] leading-snug focus:outline-none focus:border-[#0F7B6C]"
                      />
                    </div>
                  </div>

                  {/* Daftar Indikator: Masing-masing field 1 kolom penuh menurun urut tabel */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-0.5">
                      <span className="text-[11px] font-bold text-[#0F172A]">
                        Daftar Progress Indicator ({(editingOutputDraft.indicators || []).length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingOutputDraft({
                            ...editingOutputDraft,
                            indicators: [
                              ...(editingOutputDraft.indicators || []),
                              {
                                id: `ind-op-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                                name: '',
                                description: '',
                                dataSource: '',
                                cumulativeType: 'Non cumulative',
                                plannedDataBreakdown: '',
                                reportingFrequency: 'Annual',
                                baseline: 'TBA',
                                target: '',
                                endOfProjectGoal: '',
                                unit: '',
                                verificationMethod: '',
                              },
                            ],
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#0F7B6C] hover:bg-[#0B5E52] rounded cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Tambah Indikator</span>
                      </button>
                    </div>

                    {editingOutputDraft.indicators.map((ind, idx) => {
                      const updateInd = (field: keyof Indicator, val: string) => {
                        const nextList = editingOutputDraft.indicators.map((item, i) =>
                          i === idx
                            ? {
                                ...item,
                                [field]: val,
                                ...(field === 'dataSource' ? { verificationMethod: val } : {}),
                                ...(field === 'endOfProjectGoal' ? { target: val } : {}),
                              }
                            : item
                        );
                        setEditingOutputDraft({
                          ...editingOutputDraft,
                          indicators: nextList,
                        });
                      };

                      return (
                        <div
                          key={ind.id || idx}
                          className="bg-white border border-[#CBD5E1] rounded p-2.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-1 mb-1">
                            <span className="text-[11px] font-bold text-[#0F7B6C]">
                              Indikator Output #{idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingOutputDraft({
                                  ...editingOutputDraft,
                                  indicators: editingOutputDraft.indicators.filter(
                                    (_, i) => i !== idx
                                  ),
                                })
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Hapus</span>
                            </button>
                          </div>

                          {/* Satu kolom mendatar penuh, urut menurun sesuai tabel */}
                          <div className="grid grid-cols-1 gap-1.5">
                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                3. Progress indicator
                              </label>
                              <textarea
                                rows={2}
                                value={ind.name}
                                onChange={(e) => updateInd('name', e.target.value)}
                                placeholder="Progress indicator..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] leading-snug focus:outline-none focus:border-[#0F7B6C]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                4. Data source
                              </label>
                              <input
                                type="text"
                                value={ind.dataSource || ''}
                                onChange={(e) => updateInd('dataSource', e.target.value)}
                                placeholder="Data source..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#0F7B6C]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                5. Cumulative or non-cumulative
                              </label>
                              <select
                                value={ind.cumulativeType || 'Non cumulative'}
                                onChange={(e) => updateInd('cumulativeType', e.target.value)}
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#0F7B6C]"
                              >
                                <option value="Non cumulative">Non cumulative</option>
                                <option value="Non-cumulative">Non-cumulative</option>
                                <option value="Cumulative">Cumulative</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                6. Planned data breakdown
                              </label>
                              <input
                                type="text"
                                value={ind.plannedDataBreakdown || ''}
                                onChange={(e) => updateInd('plannedDataBreakdown', e.target.value)}
                                placeholder="Planned data breakdown..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#0F7B6C]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                7. Reporting frequency
                              </label>
                              <input
                                type="text"
                                value={ind.reportingFrequency || ''}
                                onChange={(e) => updateInd('reportingFrequency', e.target.value)}
                                placeholder="Annual / Semi-Annual / Quarterly..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#0F7B6C]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                8. Baseline
                              </label>
                              <input
                                type="text"
                                value={ind.baseline}
                                onChange={(e) => updateInd('baseline', e.target.value)}
                                placeholder="TBA / 0..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#0F7B6C]"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                                9. End of project goal
                              </label>
                              <textarea
                                rows={2}
                                value={ind.endOfProjectGoal || ind.target}
                                onChange={(e) => updateInd('endOfProjectGoal', e.target.value)}
                                placeholder="End of project goal..."
                                className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] leading-snug focus:outline-none focus:border-[#0F7B6C]"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-3.5 py-2.5 bg-[#F8FAFC] border-t border-[#CBD5E1] flex items-center justify-between gap-2">
              <div className="text-[11px] text-[#64748B]">
                Urutan 1 kolom menurun sesuai kolom tabel Matriks Output
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOutputDetail(null);
                    setEditingOutputDraft(null);
                    setIsEditingOutputModal(false);
                  }}
                  className="px-3 py-1.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#334155] text-xs font-semibold rounded cursor-pointer"
                >
                  Tutup
                </button>
                {!isEditingOutputModal ? (
                  <button
                    type="button"
                    onClick={() => setIsEditingOutputModal(true)}
                    className="px-3.5 py-1.5 bg-[#0F7B6C] hover:bg-[#0B5E52] text-white text-xs font-semibold rounded cursor-pointer"
                  >
                    Input / Edit Manual
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={savingOutputDetail}
                    onClick={handleSaveOutputDetailChanges}
                    className="px-3.5 py-1.5 bg-[#0F7B6C] hover:bg-[#0B5E52] text-white text-xs font-semibold rounded cursor-pointer disabled:opacity-50"
                  >
                    {savingOutputDetail ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL MODAL FOR ACTIVITY (Tampil dalam format tabel matriks bersih saat diklik) */}
      {selectedActivityDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-[#E5E7EB] text-[#0F172A] shrink-0">
                  {selectedActivityDetail.activityNumber ||
                    (selectedActivityDetail.name.match(/^(Activity\s*[\d.]+)/i)?.[1] ??
                      'Activity')}
                </span>
                <h4 className="text-sm font-semibold text-slate-900 truncate">
                  {selectedActivityDetail.name
                    .replace(/^Activity\s*[\d.]+\s*[:\-–]?\s*/i, '')
                    .trim() || selectedActivityDetail.name}
                </h4>
              </div>
              <button
                onClick={() => setSelectedActivityDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs md:text-sm max-h-[75vh] overflow-y-auto">
              <div className="overflow-x-auto border border-[#CBD5E1] rounded-md bg-white shadow-2xs">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-[#CBD5E1] bg-[#F1F5F9] text-[11.5px] font-bold text-[#0F172A]">
                      <th className="py-2.5 px-3 w-[120px] text-center border-r border-[#CBD5E1] bg-[#E5E7EB]">
                        Nomor activity
                      </th>
                      <th className="py-2.5 px-3.5 min-w-[200px] border-r border-[#CBD5E1]">
                        Nama activity
                      </th>
                      <th className="py-2.5 px-3.5 min-w-[260px] border-r border-[#CBD5E1]">
                        Activity description
                      </th>
                      <th className="py-2.5 px-3.5 min-w-[180px] border-r border-[#CBD5E1]">
                        Anticipated inputs
                      </th>
                      <th className="py-2.5 px-3.5 min-w-[180px]">
                        Planned participants (by gender &amp; age)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-4 px-3 text-center align-middle font-bold text-[#0F172A] bg-[#E5E7EB] border-r border-[#CBD5E1] whitespace-nowrap">
                        {selectedActivityDetail.activityNumber ||
                          (selectedActivityDetail.name.match(/^(Activity\s*[\d.]+)/i)?.[1] ??
                            'Activity')}
                      </td>
                      <td className="py-4 px-3.5 align-middle font-medium text-[#0F172A] border-r border-[#CBD5E1] leading-relaxed">
                        {selectedActivityDetail.name
                          .replace(/^Activity\s*[\d.]+\s*[:\-–]?\s*/i, '')
                          .trim() || selectedActivityDetail.name}
                      </td>
                      <td className="py-4 px-3.5 align-middle text-[#0F172A] border-r border-[#CBD5E1] leading-relaxed">
                        {selectedActivityDetail.description || '-'}
                      </td>
                      <td className="py-4 px-3.5 align-middle text-[#0F172A] border-r border-[#CBD5E1] leading-relaxed">
                        {selectedActivityDetail.anticipatedInputs || '-'}
                      </td>
                      <td className="py-4 px-3.5 align-middle text-[#0F172A] leading-relaxed">
                        {selectedActivityDetail.plannedParticipantsBreakdown || '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
              <div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      const idToDel = selectedActivityDetail.id;
                      setSelectedActivityDetail(null);
                      handleDeleteActivity(idToDel);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus Activity</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      const actToEdit = selectedActivityDetail;
                      setSelectedActivityDetail(null);
                      setEditingActivity(actToEdit);
                      setActivityForm({
                        activityNumber:
                          actToEdit.activityNumber ||
                          (actToEdit.name.match(/^(Activity\s*[\d.]+)/i)?.[1] ?? ''),
                        name: actToEdit.name,
                        code: '',
                        description: actToEdit.description || '',
                        anticipatedInputs: actToEdit.anticipatedInputs || '',
                        plannedParticipantsBreakdown:
                          actToEdit.plannedParticipantsBreakdown || '',
                        startDate: actToEdit.startDate,
                        endDate: actToEdit.endDate,
                      });
                    }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded cursor-pointer"
                  >
                    Edit Activity
                  </button>
                )}
                <button
                  onClick={() => setSelectedActivityDetail(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded cursor-pointer"
                >
                  Tutup
                </button>
              </div>
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

      {/* Add / Edit Activity Modal (1 Kolom Mendatar Penuh & Menurun Urut Kolom Tabel Tanpa Waste) */}
      {(showAddActivity || editingActivity) && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3">
          <form
            onSubmit={handleCreateOrUpdateActivitySubmit}
            className="bg-white rounded-md shadow-xl max-w-2xl w-full overflow-hidden border border-[#CBD5E1]"
          >
            <div className="px-3.5 py-2 border-b border-[#CBD5E1] flex items-center justify-between bg-[#F8FAFC]">
              <h4 className="text-xs font-bold text-[#0F172A]">
                {editingActivity
                  ? 'Input / Edit Manual Activity (1 Kolom Menurun Urut Tabel)'
                  : 'Tambah Activity Baru'}
              </h4>
              <button
                type="button"
                onClick={() => {
                  setShowAddActivity(null);
                  setEditingActivity(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-[#F8FAFC] max-h-[78vh] overflow-y-auto">
              <div className="bg-white border border-[#CBD5E1] rounded p-2.5 grid grid-cols-1 gap-1.5">
                <div>
                  <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                    1. Nomor activity
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Activity 1.1"
                    value={activityForm.activityNumber}
                    onChange={(e) =>
                      setActivityForm({ ...activityForm, activityNumber: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs font-mono font-bold text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                    2. Nama activity <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Nama / judul Activity..."
                    value={activityForm.name}
                    onChange={(e) =>
                      setActivityForm({ ...activityForm, name: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs font-medium text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                    3. Activity description
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Activity description..."
                    value={activityForm.description}
                    onChange={(e) =>
                      setActivityForm({ ...activityForm, description: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] leading-snug focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                    4. Anticipated inputs
                  </label>
                  <input
                    type="text"
                    placeholder="Anticipated inputs..."
                    value={activityForm.anticipatedInputs}
                    onChange={(e) =>
                      setActivityForm({ ...activityForm, anticipatedInputs: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#334155] mb-0.5">
                    5. Planned participants (by gender &amp; age)
                  </label>
                  <input
                    type="text"
                    placeholder="Breakdown planned participants by gender & age..."
                    value={activityForm.plannedParticipantsBreakdown}
                    onChange={(e) =>
                      setActivityForm({
                        ...activityForm,
                        plannedParticipantsBreakdown: e.target.value,
                      })
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded text-xs text-[#0F172A] focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>
              </div>
            </div>

            <div className="px-3.5 py-2.5 bg-[#F8FAFC] border-t border-[#CBD5E1] flex items-center justify-between gap-2">
              <div className="text-[11px] text-[#64748B]">
                Urutan 1 kolom menurun sesuai kolom tabel Matriks Activity
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddActivity(null);
                    setEditingActivity(null);
                  }}
                  className="px-3 py-1.5 border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] rounded text-xs font-semibold text-[#334155] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white rounded text-xs font-semibold cursor-pointer"
                >
                  {editingActivity ? 'Simpan Perubahan' : 'Simpan Activity'}
                </button>
              </div>
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
