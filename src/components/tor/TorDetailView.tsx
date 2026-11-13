import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Tor,
  TorApprovalRecord,
  ActivityStatus,
  Program,
  Outcome,
  Output,
  Activity,
  SubActivity,
  User,
  CashAdvanceRecord,
  TorSpecificObjectiveItem,
  TorTimelineItem,
  TorMonitoringItem,
  OutputRaciRecord,
} from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { ActivityStatusBadge, SubmissionStatusBadge, DeadlineBadge } from '../common/Badges.js';
import { formatPeriodRange, formatIndonesianDate } from '../../lib/dateUtils.js';
import { api } from '../../lib/api.js';
import { CashAdvanceFormModal } from '../finance/CashAdvanceFormModal.js';
import { CashAdvanceDetailModal } from '../finance/CashAdvanceDetailModal.js';
import { CashAdvanceSummaryStage } from '../finance/CashAdvanceSummaryStage.js';
import { formatRupiah as formatRupiahFull } from '../../lib/terbilang.js';
import {
  getProgramAgreedCustomPeriods,
  matchPeriodForDate,
} from '../../lib/programBudgetStorage.js';
import { formatTorTeamSummary } from './torTeamFormatter.js';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Send,
  Edit,
  Lock,
  History,
  Info,
  Check,
  X,
  Eye,
  Printer,
  ExternalLink,
  Unlock,
  KeyRound,
  Plus,
  Trash2,
} from 'lucide-react';
import { TorPdfExportModal } from './TorPdfExportModal.js';
import { TorFormModal } from './TorFormModal.js';
import { NotulenStage } from './NotulenStage.js';
import {
  MissingTorInfoBlock,
  SourceTraceabilityBanner,
  DownstreamStagesView,
} from './DownstreamSourceStages.js';

interface TorDetailViewProps {
  tor: Tor;
  approvalRecords: TorApprovalRecord[];
  initialStage?: number;
  targetEntityId?: string;
  focusedSourceMode?: boolean;
  autoOpenEdit?: boolean;
  onBack: () => void;
  onRefresh: () => void;
  programs?: Program[];
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  subActivities?: SubActivity[];
  users?: User[];
}

function formatRupiah(amount?: number | null): string {
  if (amount == null || isNaN(amount)) return 'Belum tersedia';
  return `Rp ${Number(amount).toLocaleString('id-ID')}`;
}

export const TorDetailView: React.FC<TorDetailViewProps> = ({
  tor,
  approvalRecords = [],
  initialStage = 1,
  targetEntityId,
  focusedSourceMode = false,
  autoOpenEdit = false,
  onBack,
  onRefresh,
  programs = [],
  outcomes = [],
  outputs = [],
  activities = [],
  subActivities = [],
  users = [],
}) => {
  const { currentUser, isDirector, isFinance, allUsers } = useAuth();
  const effectiveUsers = Array.isArray(users) && users.length > 0 ? users : allUsers || [];

  // Active stage tab (default stage 1: TOR, or initialStage if provided)
  const [activeWorkflowStage, setActiveWorkflowStage] = useState<number>(initialStage || 1);

  useEffect(() => {
    if (initialStage && initialStage >= 1 && initialStage <= 8) {
      setActiveWorkflowStage(initialStage);
    }
  }, [initialStage, tor?.id]);

  // Action Feedback State
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Request Edit to Director State
  const [showRequestEditModal, setShowRequestEditModal] = useState(false);
  const [editRequestReasonInput, setEditRequestReasonInput] = useState('');
  const [isRequestingEdit, setIsRequestingEdit] = useState(false);
  const [isReviewingEditRequest, setIsReviewingEditRequest] = useState(false);
  const [showEditTorModal, setShowEditTorModal] = useState(false);
  const [confirmDeleteTor, setConfirmDeleteTor] = useState(false);
  const [isDeletingTor, setIsDeletingTor] = useState(false);

  const handleDeleteTorByDirector = async () => {
    if (!isDirector) return;
    setActionError(null);
    setIsDeletingTor(true);
    try {
      await api.deleteTor(tor.id);
      onRefresh();
      onBack();
    } catch (err: any) {
      setActionError(err.message || 'Gagal menghapus dokumen TOR.');
      setIsDeletingTor(false);
      setConfirmDeleteTor(false);
    }
  };

  // Resubmit state for creator
  const [resubmitComment, setResubmitComment] = useState('');
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [showResubmitBox, setShowResubmitBox] = useState(false);

  // Activity Status update
  const [isUpdatingActivityStatus, setIsUpdatingActivityStatus] = useState(false);

  // PDF Export Modal
  const [showPdfExport, setShowPdfExport] = useState(false);

  // Resolved Hierarchy Objects
  const resolvedActivity = activities.find((a) => a.id === tor?.activityId);
  const resolvedOutput = outputs.find((o) => o.id === (resolvedActivity?.outputId || tor?.outputId));
  const resolvedOutcome = outcomes.find(
    (oc) => oc.id === (resolvedOutput?.outcomeId || tor?.outcomeId)
  );
  const resolvedProgram = programs.find(
    (p) => p.id === (resolvedOutcome?.programId || tor?.programId)
  );

  // Enriched TOR ensuring full Program -> Outcome -> Output -> Activity -> ToR -> Finance Code hierarchy consistency
  const enrichedTor: Tor = useMemo(
    () => ({
      ...tor,
      programId: tor.programId || resolvedProgram?.id || '',
      programName: tor.programName || resolvedProgram?.name || '',
      outcomeId: tor.outcomeId || resolvedOutcome?.id || '',
      outcomeName: tor.outcomeName || resolvedOutcome?.name || '',
      outputId: tor.outputId || resolvedOutput?.id || '',
      outputName: tor.outputName || resolvedOutput?.name || '',
      activityName: tor.activityName || resolvedActivity?.name || '',
      activityCode: tor.activityCode || resolvedActivity?.code || tor.hierarchyCode || '',
    }),
    [tor, resolvedProgram, resolvedOutcome, resolvedOutput, resolvedActivity]
  );

  // Exclusive Source Relationship: Only use data present in Stage 1 TOR (No Independent Data Creation)
  const complementaryObjectives: TorSpecificObjectiveItem[] = useMemo(() => {
    if (!tor) return [];
    const hasForeign =
      tor.specificObjectives?.some((s) => /PIPKA|GKMI|masker KN95/i.test(s.objective || ''));
    if (tor.specificObjectives && tor.specificObjectives.length > 0 && !hasForeign) {
      return tor.specificObjectives;
    }
    if (tor.goals && tor.goals.length > 0) {
      return tor.goals.map((g, i) => ({
        id: g.id || `so-${i + 1}`,
        objective: g.goal,
        expectedResult: g.indicator || g.mov || '',
        expectedChange: '',
      }));
    }
    return [];
  }, [tor]);

  const complementaryTimeline: TorTimelineItem[] = useMemo(() => {
    if (!tor) return [];
    const hasForeign =
      tor.timelineItems?.some((t) => /PIPKA|GKMI|masker KN95/i.test(t.activity || ''));
    if (tor.timelineItems && tor.timelineItems.length > 0 && !hasForeign) {
      return tor.timelineItems;
    }
    return [];
  }, [tor]);

  const complementaryMonitoring: TorMonitoringItem[] = useMemo(() => {
    if (!tor) return [];
    const hasForeign =
      tor.monitoringItems?.some((m) => /PIPKA|GKMI|masker KN95/i.test(m.method || ''));
    if (tor.monitoringItems && tor.monitoringItems.length > 0 && !hasForeign) {
      return tor.monitoringItems;
    }
    return [];
  }, [tor]);

  const complementaryScope: string[] = useMemo(() => {
    if (!tor) return [];
    const hasForeign =
      tor.scopeOfActivities?.some((s) => /PIPKA|GKMI|masker KN95/i.test(s || ''));
    if (tor.scopeOfActivities && tor.scopeOfActivities.length > 0 && !hasForeign) {
      return tor.scopeOfActivities;
    }
    return [];
  }, [tor]);

  const complementaryMechanisms: string[] = useMemo(() => {
    if (!tor) return [];
    const hasForeign =
      tor.implementationMechanisms?.some((m) => /PIPKA|GKMI|masker KN95/i.test(m || ''));
    if (tor.implementationMechanisms && tor.implementationMechanisms.length > 0 && !hasForeign) {
      return tor.implementationMechanisms;
    }
    return [];
  }, [tor]);

  // Daftar Tim Pelaksana langsung pada Project Information Table
  const complementaryOrganizerInfo = useMemo(() => {
    if (!tor) return '-';
    return formatTorTeamSummary(tor, '-');
  }, [tor]);

  // Cash Advance & Output RACI State for this TOR
  const [torCashAdvances, setTorCashAdvances] = useState<CashAdvanceRecord[]>([]);
  const [outputRaciMap, setOutputRaciMap] = useState<Record<string, OutputRaciRecord>>({});
  const [caModalOpen, setCaModalOpen] = useState(false);
  const [caEditingRecord, setCaEditingRecord] = useState<CashAdvanceRecord | null>(null);
  const [caDetailOpen, setCaDetailOpen] = useState<CashAdvanceRecord | null>(null);
  const [autoOpenedTargetKey, setAutoOpenedTargetKey] = useState<string | null>(null);
  const [torBudgetDraft, setTorBudgetDraft] = useState<string>(() =>
    String(tor?.budgetApproved ?? tor?.budgetRequested ?? 0)
  );
  const [localApprovedTorBudget, setLocalApprovedTorBudget] = useState<number>(() =>
    Number(tor?.budgetApproved ?? tor?.budgetRequested ?? 0)
  );
  const [isUpdatingTorBudget, setIsUpdatingTorBudget] = useState<boolean>(false);
  const [showTorBudgetAudit, setShowTorBudgetAudit] = useState<boolean>(false);

  useEffect(() => {
    const resolved = Number(tor?.budgetApproved ?? tor?.budgetRequested ?? 0);
    setTorBudgetDraft(String(resolved));
    setLocalApprovedTorBudget(resolved);
  }, [tor?.id, tor?.budgetApproved, tor?.budgetRequested]);

  const loadTorCashAdvances = useCallback(async () => {
    if (!tor?.id) return;
    try {
      const [res, mcRes] = await Promise.all([
        api.getCashAdvances({ torId: tor.id }).catch(() => []),
        api.getMonitoringConnect().catch(() => null),
      ]);
      setTorCashAdvances(Array.isArray(res) ? res : []);
      if (mcRes && mcRes.outputRaciRecords) {
        setOutputRaciMap(mcRes.outputRaciRecords);
      }
    } catch {
      // ignore
    }
  }, [tor?.id]);

  useEffect(() => {
    loadTorCashAdvances();
  }, [loadTorCashAdvances]);

  // Auto-open specific target document or editor when navigating from Approval
  useEffect(() => {
    const key = `${tor?.id}-${activeWorkflowStage}-${targetEntityId || ''}-${autoOpenEdit ? 'edit' : 'view'}`;
    if (autoOpenedTargetKey === key) return;

    if (activeWorkflowStage === 1 && autoOpenEdit) {
      setAutoOpenedTargetKey(key);
      setShowEditTorModal(true);
      return;
    }

    if (activeWorkflowStage === 2 && torCashAdvances.length > 0 && (targetEntityId || focusedSourceMode)) {
      const matchedCa =
        torCashAdvances.find((c) => c.id === targetEntityId) || torCashAdvances[0];
      if (matchedCa) {
        setAutoOpenedTargetKey(key);
        if (autoOpenEdit) {
          setCaEditingRecord(matchedCa);
          setCaModalOpen(true);
        } else {
          setCaDetailOpen(matchedCa);
        }
      }
    }
  }, [
    tor?.id,
    activeWorkflowStage,
    targetEntityId,
    focusedSourceMode,
    autoOpenEdit,
    torCashAdvances,
    autoOpenedTargetKey,
  ]);

  // Sort approvalRecords newest-first so latest audit trail is always at the top
  const sortedApprovalRecords = useMemo(() => {
    return [...approvalRecords]
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const timeDiff = new Date(b.r.timestamp).getTime() - new Date(a.r.timestamp).getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.idx - a.idx;
      })
      .map((entry) => entry.r);
  }, [approvalRecords]);

  if (!tor) {
    return null;
  }

  // 8 Workflow Stages (Seluruh Tahap 2-8 bersumber eksklusif dari Tahap 1 Master TOR)
  const WORKFLOW_STAGES = [
    { num: '01', title: 'TOR', shortTitle: 'TOR', available: true, desc: 'Master Source: Kerangka acuan kerja utama untuk seluruh tahapan 2–8' },
    { num: '02', title: 'Cash Advance', shortTitle: 'Cash Advance', available: true, desc: 'Pengajuan uang muka operasional berbasis Implementation Timeline TOR Tahap 1' },
    { num: '03', title: 'Ringkasan Cash Advance', shortTitle: 'Ringkasan CA', available: true, desc: 'Ringkasan akumulasi realisasi uang muka terhadap tahapan TOR Tahap 1' },
    { num: '04', title: 'Notulen', shortTitle: 'Notulen', available: true, desc: 'Notulen rapat berbasis Implementation Timeline TOR & Cash Advance aktif' },
    { num: '05', title: 'Dokumentasi Kegiatan', shortTitle: 'Dokumentasi', available: true, desc: 'Dokumentasi 3 komponen: Five Best Photos (5 slot link), Human Interest Story, dan General Photo Documentation' },
    { num: '06', title: 'Monitoring', shortTitle: 'Monitoring', available: true, desc: 'Monitoring kegiatan terintegrasi otomatis dengan ToR, Cash Advance, dan Monitoring Tools' },
    { num: '07', title: 'Laporan TOR', shortTitle: 'Laporan TOR', available: true, desc: 'Laporan Kontribusi terpadu yang menggabungkan ToR, Notulen, Dokumentasi, dan Monitoring dalam satu dokumen ukuran Legal (8.5 × 14 inci)' },
    { num: '08', title: 'Laporan Keuangan', shortTitle: 'Lap. Keuangan', available: true, desc: 'Rekonsiliasi keuangan akhir terhadap Pagu Anggaran TOR Tahap 1, Tahap 2 & Tahap 3' },
  ];

  // Eligibility for creator to submit/resubmit:
  const isCreator = tor.createdById === currentUser?.id;

  // Eligibility for creator to submit/resubmit:
  const canSubmitOrResubmit =
    (isCreator || tor.picId === currentUser?.id) &&
    (tor.submissionStatus === 'Draft' || tor.submissionStatus === 'Perlu Perbaikan');

  // Eligibility to update activity status:
  const canChangeActivityStatus =
    (tor.picId === currentUser?.id ||
      isCreator ||
      currentUser?.role === 'director' ||
      currentUser?.role === 'program_manager') &&
    tor.submissionStatus === 'Disetujui';

  // RACI Resolution for this TOR's Output:
  // - Yang bisa mengedit ToR langsung kapan saja: Direktur (isDirector)
  // - Yang bisa meminta izin mengedit ToR (Request Edit) & mengedit setelah di-ACC: R dan A1
  const currentOutputId = resolvedOutput?.id || tor.outputId;
  const outputRaci = currentOutputId ? outputRaciMap[currentOutputId] : undefined;
  const isRForTor =
    currentUser?.role !== 'admin' &&
    Boolean(
      currentUser?.id &&
        (outputRaci?.responsibleUserId === currentUser.id ||
          tor.picId === currentUser.id ||
          tor.createdById === currentUser.id)
    );
  const isA1ForTor =
    currentUser?.role !== 'admin' &&
    Boolean(
      currentUser?.id &&
        (outputRaci?.accountableUserId === currentUser.id ||
          (!outputRaci?.accountableUserId && currentUser.role === 'program_manager'))
    );
  const canRequestEditTor = (isRForTor || isA1ForTor) && !isDirector;

  const isRevisionOrDraft =
    tor.submissionStatus === 'Perlu Perbaikan' || tor.submissionStatus === 'Draft';
  const isEditApproved =
    isDirector ||
    ((isRForTor || isA1ForTor) && (tor.editRequestStatus === 'approved' || isRevisionOrDraft));
  const isEditPending = !isEditApproved && tor.editRequestStatus === 'pending';

  const handleRequestEditSubmit = async () => {
    if (!editRequestReasonInput.trim()) {
      setActionError('Alasan permintaan edit wajib diisi untuk ditinjau oleh Director.');
      return;
    }
    setActionError(null);
    setIsRequestingEdit(true);
    try {
      await api.requestTorEdit(tor.id, editRequestReasonInput.trim());
      setActionSuccess(
        'Permintaan akses edit dokumen TOR telah dikirim ke Director. Menunggu ACC Edit dari Director.'
      );
      setShowRequestEditModal(false);
      setEditRequestReasonInput('');
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Gagal mengirim permintaan edit ke Director');
    } finally {
      setIsRequestingEdit(false);
    }
  };

  const handleDirectorReviewEditRequest = async (decision: 'ACC Edit' | 'Tolak Edit') => {
    setActionError(null);
    setIsReviewingEditRequest(true);
    try {
      await api.reviewTorEditRequest(
        tor.id,
        decision === 'ACC Edit' ? 'approve' : 'reject',
        decision === 'ACC Edit'
          ? 'Director memberikan ACC Edit untuk pembaruan dokumen TOR.'
          : 'Permintaan edit dokumen TOR ditolak oleh Director.'
      );
      setActionSuccess(
        decision === 'ACC Edit'
          ? 'ACC Edit berhasil diberikan. Dokumen TOR kini dapat diedit melalui tombol Edit Dokumen TOR.'
          : 'Permintaan edit dokumen TOR telah ditolak.'
      );
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Gagal memproses keputusan permintaan edit');
    } finally {
      setIsReviewingEditRequest(false);
    }
  };

  const handleResubmit = async () => {
    setActionError(null);
    setIsResubmitting(true);
    try {
      await api.submitTor(tor.id, resubmitComment.trim());
      setActionSuccess('TOR berhasil diajukan untuk proses peninjauan persetujuan.');
      setShowResubmitBox(false);
      setResubmitComment('');
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Gagal mengajukan TOR');
    } finally {
      setIsResubmitting(false);
    }
  };

  const handleChangeActivityStatus = async (newStatus: ActivityStatus) => {
    setIsUpdatingActivityStatus(true);
    try {
      await api.updateActivityStatus(tor.id, newStatus);
      setActionSuccess(`Status kegiatan berhasil diubah menjadi '${newStatus}'.`);
      onRefresh();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsUpdatingActivityStatus(false);
    }
  };

  const currentStageMeta =
    WORKFLOW_STAGES[activeWorkflowStage - 1] || WORKFLOW_STAGES[0];

  return (
    <div className="space-y-3 pb-6 text-[#1E293B]">
      {/* Unified Compact Header Toolbar */}
      <section className="bg-white rounded-lg border border-slate-200/90 shadow-2xs overflow-hidden">
        {/* Top Row: Quick Actions & Inline Status Indicators */}
        <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200/90 px-2.5 py-1 rounded transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{focusedSourceMode ? 'Kembali ke Approval' : 'Daftar TOR'}</span>
            </button>

            {focusedSourceMode && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-[#F7F7F5] border border-[#E3E2E0] text-[#2F3437] font-semibold">
                <span>Sumber Fungsi: {currentStageMeta.title}</span>
              </span>
            )}

            <span className="h-4 w-px bg-slate-200 mx-0.5 hidden sm:inline-block" />

            {activeWorkflowStage === 1 && (
              <>
                {/* Ekspor dan Cetak Dokumen PDF Resmi */}
                <button
                  type="button"
                  onClick={() => setShowPdfExport(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 hover:text-[#0f2b5c] transition-colors font-semibold cursor-pointer"
                  title="Ekspor dan Unduh PDF Resmi WIJNA"
                >
                  <Printer className="w-3.5 h-3.5 text-[#0f2b5c]" />
                  <span>Ekspor PDF</span>
                </button>

                {/* Tombol Edit Dokumen TOR (Langsung terbuka bagi Direktur, atau bagi R & A1 saat Draft / Perlu Perbaikan / setelah di-ACC Direktur) */}
                {isEditApproved ? (
                  <button
                    type="button"
                    onClick={() => setShowEditTorModal(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white transition-colors font-semibold cursor-pointer"
                    title={
                      isDirector
                        ? 'Direktur dapat mengedit dokumen TOR secara langsung'
                        : 'Edit Dokumen TOR'
                    }
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Edit TOR</span>
                  </button>
                ) : isEditPending ? (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-amber-50 border border-amber-300 text-amber-900 font-medium">
                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Menunggu ACC Edit Direktur</span>
                  </div>
                ) : canRequestEditTor ? (
                  <button
                    type="button"
                    onClick={() => setShowRequestEditModal(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-amber-300 bg-amber-50/80 hover:bg-amber-100 text-amber-900 transition-colors font-semibold cursor-pointer"
                    title="Hanya R dan A1 yang dapat mengajukan izin Request Edit dokumen TOR ke Direktur"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                    <span>Request Edit ({isA1ForTor ? 'A1' : 'R'})</span>
                  </button>
                ) : (
                  <div
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-slate-100 border border-slate-200 text-slate-600 font-medium"
                    title="Hanya Direktur yang dapat mengedit langsung, dan hanya R serta A1 yang dapat meminta izin edit"
                  >
                    <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Terkunci (Read-Only)</span>
                  </div>
                )}
                {/* Tombol Hapus TOR (Hanya muncul untuk Direktur) */}
                {isDirector && (
                  confirmDeleteTor ? (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-300 text-xs">
                      <span className="text-rose-900 font-semibold text-[11px]">Hapus TOR ini?</span>
                      <button
                        type="button"
                        disabled={isDeletingTor}
                        onClick={handleDeleteTorByDirector}
                        className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                      >
                        {isDeletingTor ? 'Menghapus...' : 'Ya, Hapus'}
                      </button>
                      <button
                        type="button"
                        disabled={isDeletingTor}
                        onClick={() => setConfirmDeleteTor(false)}
                        className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium text-[11px] cursor-pointer"
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteTor(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 transition-colors font-semibold cursor-pointer"
                      title="Hanya Direktur yang memiliki kewenangan menghapus dokumen ToR"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus TOR</span>
                    </button>
                  )
                )}
              </>
            )}
          </div>

          {/* Inline Compact Status Badges */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Pengajuan:</span>
              <SubmissionStatusBadge status={tor.submissionStatus} />
            </div>
            <span className="h-3.5 w-px bg-slate-200 hidden sm:inline-block" />
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Pelaksanaan:</span>
              <ActivityStatusBadge status={tor.activityStatus} />
            </div>
          </div>
        </div>

        {/* Bottom Row: Compact 8-Stage Horizontal Stepper (Hidden when opened in focusedSourceMode from Approval) */}
        {!focusedSourceMode && (
          <div className="px-2 py-1.5 bg-slate-50/70">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1">
              {WORKFLOW_STAGES.map((stg, i) => {
                const isCurrent = activeWorkflowStage === i + 1;
                const isAvailable = stg.available;

                return (
                  <button
                    key={stg.num}
                    onClick={() => setActiveWorkflowStage(i + 1)}
                    title={`${stg.num}. ${stg.title} — ${stg.desc}`}
                    className={`px-2 py-1.5 rounded text-left transition-all duration-150 border flex items-center gap-1.5 min-w-0 cursor-pointer ${
                      isCurrent
                        ? 'bg-[#0f2b5c] border-[#0f2b5c] text-white shadow-2xs'
                        : isAvailable
                        ? 'bg-white border-slate-200/90 text-slate-700 hover:bg-slate-100/80 hover:border-slate-300'
                        : 'bg-slate-100/60 border-slate-200/60 text-slate-400'
                    }`}
                  >
                    <span
                      className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded leading-none shrink-0 ${
                        isCurrent
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {stg.num}
                    </span>
                    <span
                      className={`text-[11px] leading-tight truncate ${
                        isCurrent ? 'font-semibold text-white' : 'font-medium text-slate-800'
                      }`}
                    >
                      {stg.shortTitle}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ml-auto ${
                        isCurrent
                          ? 'bg-emerald-400'
                          : isAvailable
                          ? 'bg-emerald-500/80'
                          : 'bg-slate-300'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Action Messages */}
      {actionError && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {actionSuccess && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Banner Status Request Edit (Diproses Terpusat di Approval ToR) */}
      {isEditPending && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-amber-950">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>Permintaan Akses Edit Dokumen TOR Menunggu Keputusan Direktur di Approval ToR</span>
            </div>
            <p className="text-amber-800">
              Diajukan oleh <strong>{tor.editRequestedByName}</strong> ({tor.editRequestedByRole}) · Alasan:{' '}
              <span className="italic">&quot;{tor.editRequestReason}&quot;</span>
            </p>
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border border-amber-300 text-amber-900 font-semibold shrink-0">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Diproses di Menu Approval (Tiket ToR)</span>
          </span>
        </div>
      )}

      {tor.editRequestStatus === 'approved' && (isDirector || isRForTor || isA1ForTor) && (
        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-blue-950">
          <div className="flex items-center gap-2">
            <Unlock className="w-3.5 h-3.5 text-blue-700 shrink-0" />
            <div>
              <span className="font-bold">Akses Edit Dokumen Telah Di-ACC oleh Director</span>
              <span className="text-blue-800 ml-1.5">
                ({tor.editReviewedByName || 'Executive Director'}). Setelah perubahan disimpan oleh R / A1, dokumen akan otomatis dikunci kembali menjadi final.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowEditTorModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white font-semibold rounded transition-colors shrink-0 cursor-pointer"
          >
            <Edit className="w-3.5 h-3.5" />
            <span>Buka Form Edit TOR</span>
          </button>
        </div>
      )}

      {/* Main Content: Stage 01 (TOR), Stage 02 (Cash Advance), Stage 03, Stage 04, or Stages 05–08 */}
      {activeWorkflowStage === 2 ? (
        /* STAGE 02: CASH ADVANCE (INLINE FORMAL PREVIEW LIKE TOR & NOTULEN OR LIST) */
        caDetailOpen ? (
          <CashAdvanceDetailModal
            inline
            isOpen={true}
            onClose={() => setCaDetailOpen(null)}
            record={caDetailOpen}
            currentUser={currentUser}
            onRefresh={async () => {
              try {
                const refreshed = await api.getCashAdvance(caDetailOpen.id);
                setCaDetailOpen(refreshed);
              } catch {
                setCaDetailOpen(null);
              }
              loadTorCashAdvances();
            }}
            onEdit={() => {
              setCaDetailOpen(null);
              setCaModalOpen(true);
            }}
          />
        ) : (
        (() => {
          const unreportedCount = torCashAdvances.filter(
            (c) => !c.isReported && c.status !== 'Ditolak'
          ).length;
          const isBlockedNewCa = unreportedCount >= 2;

          return (
            <div className="space-y-3">
              {/* Compact Notion-style Header Bar */}
              <div className="bg-white rounded-lg border border-[#EAEAEA] px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#2F3437]">Cash Advance</h3>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#787774] mt-0.5">
                    <span>{torCashAdvances.length} pengajuan</span>
                    <span aria-hidden="true">·</span>
                    <span className={isBlockedNewCa ? 'text-amber-700 font-medium' : ''}>
                      {unreportedCount}/2 kasbon aktif belum dilaporkan
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Pelaporan maks. H+7</span>
                    <span aria-hidden="true">·</span>
                    {(() => {
                      const approvedPag = Number(tor.budgetApproved ?? tor.budgetRequested ?? 0);
                      const reportedCaSum = torCashAdvances
                        .filter((c) => Boolean(c.isReported) && c.status !== 'Ditolak')
                        .reduce(
                          (sum, c) => sum + (Number(c.realizedAmount ?? c.totalAmount) || 0),
                          0
                        );
                      const remainingPag = approvedPag - reportedCaSum;
                      return (
                        <>
                          <span>
                            Disetujui:{' '}
                            <strong className="font-mono text-[#2F3437]">
                              {formatRupiahFull(approvedPag)}
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Sisa Anggaran:{' '}
                            <strong className="font-mono text-[#16654E]">
                              {formatRupiahFull(remainingPag)}
                            </strong>
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {tor.submissionStatus === 'Disetujui' && (
                    <button
                      type="button"
                      onClick={() => setCaModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-[#2F3437] hover:bg-stone-800 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Buat Pengajuan Kasbon</span>
                    </button>
                  )}
                </div>
              </div>

              {isBlockedNewCa && (
                <div className="bg-[#FAF8F5] rounded-lg border border-amber-200/80 px-4 sm:px-5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-[#2F3437]">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      Terdapat <strong>{unreportedCount} Cash Advance belum dilaporkan</strong>. Tutup laporan kasbon sebelumnya dengan lampiran PDF Expensify pada tahap 03 sebelum mengajukan kasbon baru.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveWorkflowStage(3)}
                    className="px-2.5 py-1 rounded border border-amber-300/80 bg-white hover:bg-amber-50 text-amber-900 font-medium shrink-0 transition-colors cursor-pointer"
                  >
                    Tutup Laporan ({unreportedCount}/2) →
                  </button>
                </div>
              )}

              {/* Cash Advance List (Notion-toned Clean Rows) */}
              {torCashAdvances.length > 0 ? (
                <div className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
                  {torCashAdvances.map((ca) => {
                    const matchedTl =
                      ca.implementationTimelineIds &&
                      ca.implementationTimelineIds.length > 0 &&
                      tor.timelineItems
                        ? tor.timelineItems.filter((t) =>
                            ca.implementationTimelineIds!.includes(t.id)
                          )
                        : [];
                    const scopeTitle =
                      ca.implementationTimelineSummary ||
                      (matchedTl.length === 1
                        ? `${matchedTl[0].period}: ${matchedTl[0].activity}`
                        : matchedTl.length > 1
                        ? `${matchedTl.map((m) => m.period).join(' – ')}: ${matchedTl[0].activity}`
                        : ca.implementationMode === 'single'
                        ? 'Satu Tahap Implementasi TOR'
                        : 'Seluruh Tahapan Implementasi TOR');

                    return (
                      <div
                        key={ca.id}
                        onClick={() => setCaDetailOpen(ca)}
                        className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-[#F7F7F5] transition-colors cursor-pointer group"
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1 pr-2">
                          <div className="pt-1.5 shrink-0">
                            <span
                              className={`inline-block w-2 h-2 rounded-full ${
                                ca.isReported ? 'bg-emerald-500' : 'bg-amber-500'
                              }`}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-medium text-[#2F3437] leading-snug break-words">
                              {scopeTitle}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#787774] mt-1">
                              <span className="font-mono font-medium text-[#2F3437]">
                                {ca.advanceNumber}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{ca.requesterName}</span>
                              <span aria-hidden="true">·</span>
                              <span>{ca.status}</span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  ca.isReported ? 'text-emerald-700' : 'text-amber-700'
                                }
                              >
                                {ca.isReported
                                  ? 'Laporan Ditutup'
                                  : `Batas lapor ${ca.reportingDeadlineDate || ca.requestDate}`}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-[11px] text-[#787774]">
                                Sumber: {ca.torNumber || tor.torNumber}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div
                          className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pl-5 sm:pl-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-left sm:text-right">
                            <div className="text-xs font-mono font-semibold text-[#2F3437] tabular-nums">
                              {formatRupiahFull(ca.totalAmount)}
                            </div>
                            <div className="text-[11px] text-[#787774]">
                              {ca.bankName} · {ca.bankAccountNumber}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setCaDetailOpen(ca)}
                              className="px-2.5 py-1 rounded border border-[#EAEAEA] bg-white hover:bg-stone-100 text-[#2F3437] text-xs font-medium transition-colors cursor-pointer"
                            >
                              Lihat
                            </button>
                            {!ca.isReported && (
                              <button
                                type="button"
                                onClick={() => setActiveWorkflowStage(3)}
                                className="px-2.5 py-1 rounded border border-[#EAEAEA] bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#2F3437] text-xs font-medium transition-colors cursor-pointer"
                              >
                                Tutup Laporan
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-[#EAEAEA] py-12 px-6 text-center space-y-2.5">
                  {tor.submissionStatus === 'Disetujui' ? (
                    <>
                      <p className="text-sm font-medium text-[#2F3437]">
                        Belum ada pengajuan Cash Advance
                      </p>
                      <p className="text-xs text-[#787774] max-w-md mx-auto">
                        Anggaran TOR sebesar{' '}
                        <span className="font-mono font-medium text-[#2F3437]">
                          {formatRupiahFull(tor.budgetRequested || tor.budgetApproved || 0)}
                        </span>{' '}
                        telah disetujui.
                      </p>
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setCaModalOpen(true)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#2F3437] hover:bg-stone-800 text-white text-xs font-medium transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>+ Buat Cash Advance</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-[#2F3437]">
                        Menunggu Persetujuan TOR ({tor.submissionStatus})
                      </p>
                      <p className="text-xs text-[#787774] max-w-md mx-auto">
                        Cash Advance dapat diajukan setelah dokumen TOR disetujui.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })()
        )
      ) : activeWorkflowStage === 3 ? (
        /* STAGE 03: RINGKASAN CASH ADVANCE */
        <CashAdvanceSummaryStage
          tor={enrichedTor}
          cashAdvances={torCashAdvances}
          onOpenCreateCa={() => setCaModalOpen(true)}
          onNavigateStage={(stg) => setActiveWorkflowStage(stg)}
          currentUser={currentUser}
          onRefreshCashAdvances={() => {
            loadTorCashAdvances();
            onRefresh();
          }}
        />
      ) : activeWorkflowStage === 4 ? (
        /* STAGE 04: NOTULEN (MEETING MINUTES GENERATOR) */
        <NotulenStage
          tor={enrichedTor}
          programs={programs}
          cashAdvances={torCashAdvances}
          currentUser={currentUser}
          onNavigateStage={(stg) => setActiveWorkflowStage(stg)}
          initialRecordId={targetEntityId}
          initialViewMode={autoOpenEdit ? 'editor' : focusedSourceMode || targetEntityId ? 'preview' : undefined}
          onRefresh={() => {
            loadTorCashAdvances();
            onRefresh();
          }}
        />
      ) : activeWorkflowStage >= 5 && activeWorkflowStage <= 8 ? (
        /* STAGES 05-08: EXCLUSIVE DOWNSTREAM PROCESSES DERIVED FROM STAGE 1 TOR */
        <DownstreamStagesView
          stageNumber={activeWorkflowStage as 5 | 6 | 7 | 8}
          tor={enrichedTor}
          cashAdvances={torCashAdvances}
          onNavigateStage={(stg) => setActiveWorkflowStage(stg)}
          onRequestTorUpdate={() =>
            isEditApproved ? setShowEditTorModal(true) : setShowRequestEditModal(true)
          }
          initialTargetId={targetEntityId}
          initialViewMode={autoOpenEdit ? 'form' : focusedSourceMode || targetEntityId ? 'preview' : undefined}
          onRefresh={() => {
            loadTorCashAdvances();
            onRefresh();
          }}
        />
      ) : (
        <div className="space-y-6">
          {/* FULL-WIDTH COHESIVE READ-READY DOCUMENT SURFACE (FORMAL PRINT STYLE) */}
          <article
            className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-5 py-5 sm:px-7 sm:py-6 shadow-xs space-y-5 text-[14px] leading-[1.38] text-black"
            style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
          >
            {(() => {
              const requestTorUpdate = () =>
                isEditApproved ? setShowEditTorModal(true) : setShowRequestEditModal(true);

              const participantRowsData =
                tor.participantRows && tor.participantRows.length > 0
                  ? tor.participantRows
                  : [];

              const participantColumns =
                tor.participantCustomColumns && tor.participantCustomColumns.length > 0
                  ? tor.participantCustomColumns
                  : [
                      { id: 'col-target', label: 'Target Peserta', type: 'text' as const },
                      { id: 'col-male', label: 'Est. Laki-laki', type: 'number' as const },
                      { id: 'col-female', label: 'Est. Perempuan', type: 'number' as const },
                      { id: 'col-note', label: 'Keterangan', type: 'text' as const },
                    ];

              const rolesData =
                tor.rolesResponsibilities && tor.rolesResponsibilities.length > 0
                  ? tor.rolesResponsibilities
                  : [];

              const rundownData =
                tor.rundown && tor.rundown.length > 0 ? tor.rundown : [];

              const activityCodeDisplay = (() => {
                const codeStr = tor.activityCode || tor.hierarchyCode || '1.1.1';
                const firstNum = codeStr.split('.')[0] || '1';
                return `Outcome ${firstNum} ; Activity ${codeStr}`;
              })();

              // Gambar 2 (Budget request USD/IDR di dalam tabel ToR): berasal dari Cash Advance yang telah di-ACC (Disetujui / Dicairkan)
              const approvedCashAdvances = torCashAdvances.filter(
                (c) => c.status === 'Disetujui' || c.status === 'Dicairkan'
              );
              const totalApprovedCaRequested = approvedCashAdvances.reduce(
                (sum, c) => sum + (Number(c.totalAmount) || 0),
                0
              );

              const reportedCashAdvancesForTor = torCashAdvances.filter(
                (c) => Boolean(c.isReported) && c.status !== 'Ditolak'
              );
              const totalReportedCaForTor = reportedCashAdvancesForTor.reduce(
                (sum, c) => sum + (Number(c.realizedAmount ?? c.totalAmount) || 0),
                0
              );
              const approvedTorBudgetVal = Number(localApprovedTorBudget || 0);
              const remainingTorBudgetVal = approvedTorBudgetVal - totalReportedCaForTor;

              const compactBudget = `Rp${Number(totalApprovedCaRequested).toLocaleString('id-ID')}`;

              const isA2OrFinanceForTor =
                currentUser?.role === 'finance' ||
                (currentUser?.roleTitle || '').toLowerCase().includes('finance') ||
                outputRaci?.accountableFinanceUserId === currentUser?.id;

              const handleDetailBudgetAction = async (
                action: 'finance_determine' | 'a2_update' | 'director_acc'
              ) => {
                setActionError(null);
                setIsUpdatingTorBudget(true);
                try {
                  const numVal = Number(torBudgetDraft) || 0;
                  setLocalApprovedTorBudget(numVal);
                  await api.updateTorBudgetEstimate(tor.id, {
                    action,
                    budgetRequested: numVal,
                  });
                  setActionSuccess(
                    action === 'director_acc'
                      ? `Budget yang disetujui untuk ini adalah Rp ${numVal.toLocaleString('id-ID')} (Telah di-ACC oleh Direktur).`
                      : `Budget berhasil di-update oleh Finance / A2 menjadi Rp ${numVal.toLocaleString('id-ID')}.`
                  );
                  onRefresh();
                } catch (err: any) {
                  setActionError(err?.message || 'Gagal memperbarui Estimasi Budget ToR.');
                } finally {
                  setIsUpdatingTorBudget(false);
                }
              };

              return (
                <>
                  {/* Panel Ringkas & Proporsional: Budget yang disetujui & Sisa Budget untuk ToR ini */}
                  <div className="mb-3 px-3 py-2 rounded-lg border border-[#EAE8E1] bg-[#FAF9F6] text-xs font-sans print:hidden">
                    {tor.budgetApprovalStatus === 'Disetujui Direktur' && !isA2OrFinanceForTor ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[#0F4C3A]">
                            Budget yang disetujui untuk ini adalah :
                          </span>
                          <span className="font-mono text-sm font-bold text-[#16654E]">
                            Rp {approvedTorBudgetVal.toLocaleString('id-ID')}
                          </span>
                          <span className="text-[#CBD5E1]">·</span>
                          <span className="font-semibold text-[#0F4C3A]">
                            Sisa Budget :
                          </span>
                          <span className="font-mono text-sm font-bold text-[#0F7B6C]">
                            Rp {remainingTorBudgetVal.toLocaleString('id-ID')}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-[#F0FAF6] border border-[#B8E6D4] text-[#16654E]">
                          ✓ Di-ACC Direktur
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[#0F4C3A]">
                              Budget yang disetujui untuk ini adalah :
                            </span>
                            <span className="font-mono text-sm font-bold text-[#16654E]">
                              Rp {approvedTorBudgetVal.toLocaleString('id-ID')}
                            </span>
                            <span className="text-[#CBD5E1]">·</span>
                            <span className="font-semibold text-[#0F4C3A]">
                              Sisa Budget :
                            </span>
                            <span className="font-mono text-sm font-bold text-[#0F7B6C]">
                              Rp {remainingTorBudgetVal.toLocaleString('id-ID')}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                tor.budgetApprovalStatus === 'Disetujui Direktur'
                                  ? 'bg-[#F0FAF6] border-[#B8E6D4] text-[#16654E]'
                                  : 'bg-amber-50 border-amber-300 text-amber-900'
                              }`}
                            >
                              {tor.budgetApprovalStatus === 'Disetujui Direktur'
                                ? '✓ Di-ACC Direktur'
                                : 'Menunggu ACC Direktur'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {(isA2OrFinanceForTor ||
                              (isDirector && tor.budgetApprovalStatus !== 'Disetujui Direktur')) && (
                              <input
                                type="number"
                                min="0"
                                value={torBudgetDraft}
                                onChange={(e) => setTorBudgetDraft(e.target.value)}
                                className="h-7 px-2 w-36 rounded border border-[#CBD5E1] bg-white font-mono text-xs font-semibold text-[#0F172A] focus:outline-none focus:border-[#1F7A63]"
                              />
                            )}
                            {isA2OrFinanceForTor && (
                              <button
                                type="button"
                                disabled={isUpdatingTorBudget}
                                onClick={() => handleDetailBudgetAction('a2_update')}
                                className="h-7 px-2.5 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[11px] font-semibold cursor-pointer transition-colors"
                              >
                                Update Finance
                              </button>
                            )}
                            {isDirector && tor.budgetApprovalStatus !== 'Disetujui Direktur' && (
                              <button
                                type="button"
                                disabled={isUpdatingTorBudget}
                                onClick={() => handleDetailBudgetAction('director_acc')}
                                className="h-7 px-2.5 rounded bg-[#1F7A63] hover:bg-[#17614E] text-white text-[11px] font-semibold cursor-pointer transition-colors"
                              >
                                ACC Direktur
                              </button>
                            )}
                            {isA2OrFinanceForTor && (tor.budgetAuditLogs || []).length > 0 && (
                              <button
                                type="button"
                                onClick={() => setShowTorBudgetAudit((p) => !p)}
                                className="h-7 px-2 rounded border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#334155] text-[10.5px] font-medium cursor-pointer transition-colors"
                              >
                                Audit ({(tor.budgetAuditLogs || []).length})
                              </button>
                            )}
                          </div>
                        </div>

                        {showTorBudgetAudit && (tor.budgetAuditLogs || []).length > 0 && (
                          <div className="border border-[#E2E8F0] rounded bg-white divide-y divide-[#F1F5F9] max-h-28 overflow-y-auto text-[10.5px]">
                            {(tor.budgetAuditLogs || []).map((log) => (
                              <div
                                key={log.id}
                                className="px-2 py-1 flex items-center justify-between gap-2"
                              >
                                <span className="text-[#334155] truncate">
                                  <strong>{log.actorName}</strong>: {log.actionLabel}
                                </span>
                                <span className="font-mono text-[10px] text-[#64748B] shrink-0">
                                  {new Date(log.timestamp).toLocaleString('id-ID', {
                                    day: '2-digit',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <h1 className="text-center font-bold uppercase text-[15px] tracking-normal mb-4 text-black">
                    TERM OF REFERENCE
                  </h1>

                  {/* ================= PROJECT INFORMATION ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Project Information
                    </div>
                    <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                      <tbody>
                        <tr>
                          <td className="w-[26%] border border-black px-2.5 py-1 font-bold align-top">
                            Event Name
                          </td>
                          <td className="w-[74%] border border-black px-2.5 py-1 align-top">
                            {tor.title}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Activity Code
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {activityCodeDisplay}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            TOR Code
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {tor.torNumber}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Tim Pelaksana
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top whitespace-pre-wrap leading-[1.38]">
                            {complementaryOrganizerInfo}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Period
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top font-semibold">
                            {(() => {
                              if (tor.customPeriodCode) {
                                return tor.customPeriodCode.split('—')[0].trim();
                              }
                              const periods = getProgramAgreedCustomPeriods({
                                programId: tor.programId,
                                programName: tor.programName,
                              });
                              const matched = matchPeriodForDate(periods, tor.startDate);
                              if (matched && matched.code !== '-') {
                                return matched.code.split('—')[0].trim();
                              }
                              return 'P1';
                            })()}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Start date
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formatIndonesianDate(tor.startDate)}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            End date
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formatIndonesianDate(tor.endDate)}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Report date
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formatIndonesianDate(tor.reportingDeadline)}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Location
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {tor.location || (
                              <MissingTorInfoBlock
                                compact
                                fieldName="Location"
                                torSection="Project Information · Location"
                                onRequestTorUpdate={requestTorUpdate}
                              />
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Budget request USD/IDR
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {compactBudget}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </section>

                  {/* ================= BACKGROUND & OBJECTIVES ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Background
                    </div>
                    <div className="space-y-2.5 text-black">
                      {tor.background ? (
                        tor.background
                          .split(/\n\s*\n/)
                          .map((para, idx) => (
                            <p key={idx} className="whitespace-pre-line leading-[1.38]">
                              {para.trim()}
                            </p>
                          ))
                      ) : (
                        <MissingTorInfoBlock
                          compact
                          fieldName="Background"
                          torSection="Background"
                          onRequestTorUpdate={requestTorUpdate}
                        />
                      )}
                      {tor.rationale && (
                        <p className="whitespace-pre-line leading-[1.38]">{tor.rationale.trim()}</p>
                      )}
                    </div>

                    {/* Tujuan Umum */}
                    <div className="mt-3">
                      <div className="font-bold text-black">Tujuan Umum</div>
                      {tor.generalObjective || tor.objectives ? (
                        <p className="text-black leading-[1.38] whitespace-pre-line">
                          {tor.generalObjective || tor.objectives}
                        </p>
                      ) : (
                        <MissingTorInfoBlock
                          compact
                          fieldName="Tujuan Umum"
                          torSection="Tujuan Umum"
                          onRequestTorUpdate={requestTorUpdate}
                        />
                      )}
                    </div>

                    {/* Tujuan Khusus */}
                    <div className="mt-2.5">
                      <div className="font-bold text-black">Tujuan Khusus</div>
                      {complementaryObjectives.length === 0 ? (
                        <div className="mt-1">
                          <MissingTorInfoBlock
                            compact
                            fieldName="Tujuan Khusus, Hasil & Perubahan yang Diharapkan"
                            torSection="Tujuan Khusus"
                            onRequestTorUpdate={requestTorUpdate}
                          />
                        </div>
                      ) : (
                        <>
                          <ol className="list-decimal pl-8 space-y-1 text-black leading-[1.38] mt-0.5">
                            {complementaryObjectives.map((item) => (
                              <li key={item.id} className="pl-1">
                                {item.objective}
                              </li>
                            ))}
                          </ol>

                          {/* Tabel 3 Kolom: Tujuan Khusus | Hasil yang Diharapkan | Perubahan yang Diharapkan */}
                          <table className="w-full text-left border-collapse border border-black text-[14px] text-black mt-3">
                            <thead>
                              <tr>
                                <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                                  Tujuan Khusus
                                </th>
                                <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                                  Hasil yang Diharapkan
                                </th>
                                <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                                  Perubahan yang Diharapkan
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {complementaryObjectives.map((item, idx) => (
                                <tr key={item.id} className="align-top">
                                  <td className="border border-black px-2.5 py-1 leading-[1.38]">
                                    {idx + 1}. {item.objective}
                                  </td>
                                  <td className="border border-black px-2.5 py-1 leading-[1.38] whitespace-pre-line">
                                    {item.expectedResult || 'Not Available in Source TOR'}
                                  </td>
                                  <td className="border border-black px-2.5 py-1 leading-[1.38] whitespace-pre-line">
                                    {item.expectedChange || 'Not Available in Source TOR'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>
                  </section>

                  {/* ================= IMPLEMENTATION TIMELINE ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Implementation Timeline
                    </div>
                    {complementaryTimeline.length === 0 ? (
                      <MissingTorInfoBlock
                        compact
                        fieldName="Implementation Timeline"
                        torSection="Implementation Timeline"
                        onRequestTorUpdate={requestTorUpdate}
                      />
                    ) : (
                      <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                        <thead>
                          <tr>
                            <th className="w-[28%] border border-black px-2.5 py-1 font-bold">
                              Period
                            </th>
                            <th className="w-[72%] border border-black px-2.5 py-1 font-bold">
                              Activity
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {complementaryTimeline.map((item) => (
                            <tr key={item.id} className="align-top">
                              <td className="border border-black px-2.5 py-1">{item.period}</td>
                              <td className="border border-black px-2.5 py-1 leading-[1.38]">
                                {item.activity}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>

                  {/* ================= MONITORING MECHANISM ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Monitoring Mechanism
                    </div>
                    {complementaryMonitoring.length === 0 ? (
                      <MissingTorInfoBlock
                        compact
                        fieldName="Monitoring Mechanism"
                        torSection="Monitoring Mechanism"
                        onRequestTorUpdate={requestTorUpdate}
                      />
                    ) : (
                      <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                        <thead>
                          <tr>
                            <th className="w-[22%] border border-black px-2.5 py-1 font-bold">
                              Aspect
                            </th>
                            <th className="w-[40%] border border-black px-2.5 py-1 font-bold">
                              Method
                            </th>
                            <th className="w-[20%] border border-black px-2.5 py-1 font-bold">
                              Frequency
                            </th>
                            <th className="w-[18%] border border-black px-2.5 py-1 font-bold">
                              PIC
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {complementaryMonitoring.map((item) => (
                            <tr key={item.id} className="align-top">
                              <td className="border border-black px-2.5 py-1 leading-[1.38]">
                                {item.aspect}
                              </td>
                              <td className="border border-black px-2.5 py-1 leading-[1.38]">
                                {item.method}
                              </td>
                              <td className="border border-black px-2.5 py-1 leading-[1.38]">
                                {item.frequency}
                              </td>
                              <td className="border border-black px-2.5 py-1 leading-[1.38]">
                                {item.pic}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>

                  {/* ================= SCOPE OF ACTIVITIES ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Scope of Activities
                    </div>
                    {complementaryScope.length === 0 ? (
                      <MissingTorInfoBlock
                        compact
                        fieldName="Scope of Activities"
                        torSection="Scope of Activities"
                        onRequestTorUpdate={requestTorUpdate}
                      />
                    ) : (
                      <ul className="list-disc pl-8 space-y-1 text-black leading-[1.38]">
                        {complementaryScope.map((point, idx) => (
                          <li key={idx} className="pl-1">
                            {point}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* ================= MEKANISME PELAKSANAAN ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Mekanisme Pelaksanaan
                    </div>
                    {complementaryMechanisms.length === 0 ? (
                      <MissingTorInfoBlock
                        compact
                        fieldName="Mekanisme Pelaksanaan"
                        torSection="Mekanisme Pelaksanaan"
                        onRequestTorUpdate={requestTorUpdate}
                      />
                    ) : (
                      <ul className="list-disc pl-8 space-y-1 text-black leading-[1.38]">
                        {complementaryMechanisms.map((mech, idx) => {
                          const periodIdx = mech.indexOf('.');
                          const hasBoldPrefix = periodIdx > 0 && periodIdx < 45;
                          const prefix = hasBoldPrefix ? mech.substring(0, periodIdx + 1) : '';
                          const body = hasBoldPrefix ? mech.substring(periodIdx + 1) : mech;

                          return (
                            <li key={idx} className="pl-1">
                              {hasBoldPrefix ? (
                                <>
                                  <strong className="font-bold text-black">{prefix}</strong>
                                  {body}
                                </>
                              ) : (
                                mech
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  {/* ================= PESERTA KEGIATAN ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Peserta Kegiatan (
                      {tor.participantType ||
                        tor.participantsType ||
                        'Not Available in Source TOR'}
                      )
                    </div>

                    {participantRowsData.length === 0 ? (
                      <div className="space-y-1.5">
                        {tor.participantsTarget && (
                          <div>
                            <strong>Target Peserta:</strong> {tor.participantsTarget}{' '}
                            {tor.participantsCount != null ? `(${tor.participantsCount} Org)` : ''}
                          </div>
                        )}
                        <MissingTorInfoBlock
                          compact
                          fieldName="Tabel Rincian Peserta Kegiatan"
                          torSection="Peserta Kegiatan"
                          onRequestTorUpdate={requestTorUpdate}
                        />
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                        <thead>
                          <tr>
                            <th className="w-10 border border-black px-2 py-1 text-center font-bold">
                              No
                            </th>
                            {participantColumns.map((col) => (
                              <th
                                key={col.id}
                                className={`border border-black px-2.5 py-1 font-bold ${
                                  col.type === 'number' ? 'text-center w-32' : 'text-left'
                                }`}
                              >
                                {col.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {participantRowsData.map((row: any, idx: number) => (
                            <tr key={row.id || idx} className="align-top">
                              <td className="border border-black px-2 py-1 text-center">
                                {idx + 1}
                              </td>
                              {participantColumns.map((col) => {
                                let val = row.customValues?.[col.id];
                                if (val === undefined || val === '') {
                                  if (col.id === 'col-target') val = row.target;
                                  else if (col.id === 'col-male')
                                    val = row.maleCount != null ? String(row.maleCount) : '';
                                  else if (col.id === 'col-female')
                                    val = row.femaleCount != null ? String(row.femaleCount) : '';
                                  else if (col.id === 'col-note') val = row.note;
                                }
                                return (
                                  <td
                                    key={col.id}
                                    className={`border border-black px-2.5 py-1 ${
                                      col.type === 'number' ? 'text-center' : 'leading-[1.38]'
                                    }`}
                                  >
                                    {val !== undefined && val !== ''
                                      ? col.type === 'number'
                                        ? `${val} Org`
                                        : val
                                      : '—'}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                        {participantColumns.some((c) => c.type === 'number') && (
                          <tfoot>
                            <tr className="font-bold">
                              <td className="border border-black px-2 py-1 text-center">Σ</td>
                              {participantColumns.map((col, cIdx) => {
                                if (col.type === 'number') {
                                  const total = participantRowsData.reduce(
                                    (sum: number, r: any) => {
                                      const raw =
                                        r.customValues?.[col.id] ??
                                        (col.id === 'col-male'
                                          ? r.maleCount
                                          : col.id === 'col-female'
                                          ? r.femaleCount
                                          : 0);
                                      const n = Number(raw);
                                      return sum + (isNaN(n) ? 0 : n);
                                    },
                                    0
                                  );
                                  return (
                                    <td
                                      key={col.id}
                                      className="border border-black px-2.5 py-1 text-center font-bold"
                                    >
                                      {total} Org
                                    </td>
                                  );
                                }
                                return (
                                  <td key={col.id} className="border border-black px-2.5 py-1">
                                    {cIdx === 0 ? 'Total Estimasi Peserta:' : ''}
                                  </td>
                                );
                              })}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    )}
                    {tor.participantsCriteria && (
                      <div className="mt-1.5 text-black">
                        <strong>Kriteria Peserta:</strong> {tor.participantsCriteria}
                      </div>
                    )}
                  </section>

                  {/* ================= ROLE & RESPONSIBILITY ================= */}
                  <section>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      Role &amp; Responsibility
                    </div>
                    {rolesData.length === 0 ? (
                      <MissingTorInfoBlock
                        compact
                        fieldName="Role & Responsibility"
                        torSection="Role & Responsibility"
                        onRequestTorUpdate={requestTorUpdate}
                      />
                    ) : (
                      <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                        <thead>
                          <tr>
                            <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                              Nama - Lembaga
                            </th>
                            <th className="w-1/4 border border-black px-2.5 py-1 font-bold">
                              Role (Peran Kegiatan)
                            </th>
                            <th className="border border-black px-2.5 py-1 font-bold">
                              Responsibility (Tanggung Jawab &amp; Tugas)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rolesData.map((r: any, idx: number) => (
                            <tr key={r.id || idx} className="align-top">
                              <td className="border border-black px-2.5 py-1">
                                {r.nameInstitution ||
                                  (r.institution
                                    ? `${r.picName} — ${r.institution}`
                                    : r.picName)}
                              </td>
                              <td className="border border-black px-2.5 py-1">{r.role}</td>
                              <td className="border border-black px-2.5 py-1 leading-[1.38]">
                                {r.responsibilities}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {(tor.rolesNotes || tor.rolesAdditionalNotes) && (
                      <div className="mt-1.5 text-black">
                        <strong>Catatan Tim Pelaksana:</strong>{' '}
                        {tor.rolesNotes || tor.rolesAdditionalNotes}
                      </div>
                    )}
                  </section>

                  {/* ================= RUNDOWN KEGIATAN (OPSIONAL) ================= */}
                  {tor.isRundownVisible !== false && rundownData.length > 0 && (
                    <section>
                      <div
                        className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                      >
                        Rundown Kegiatan (Opsional)
                      </div>
                      <div className="space-y-3">
                        {(() => {
                          const timelineList = tor.timelineItems || [];
                          const groups: {
                            key: string;
                            timelineLabel: string;
                            items: { rd: any; originalIdx: number }[];
                          }[] = [];

                          rundownData.forEach((rd: any, idx: number) => {
                            const matchedTl = rd.timelineId
                              ? timelineList.find((t: any) => t.id === rd.timelineId)
                              : timelineList.find((t: any) => rd.date?.includes(t.period)) ||
                                timelineList[idx];
                            const resolvedKey =
                              rd.timelineId ||
                              rd.timelineLabel ||
                              matchedTl?.id ||
                              `group-${idx}`;
                            const resolvedLabel =
                              rd.timelineLabel ||
                              (matchedTl
                                ? `${matchedTl.period} — ${matchedTl.activity}`
                                : rd.date || `Bagian Rundown ${idx + 1}`);

                            const existing = groups.find((g) => g.key === resolvedKey);
                            if (existing) {
                              existing.items.push({ rd, originalIdx: idx });
                            } else {
                              groups.push({
                                key: resolvedKey,
                                timelineLabel: resolvedLabel,
                                items: [{ rd, originalIdx: idx }],
                              });
                            }
                          });

                          return groups.map((group) => (
                            <div key={group.key} className="border border-black break-inside-avoid">
                              <div
                                className="bg-[#EFEFEF] border-b border-black px-2.5 py-1.5 text-[13px] text-black"
                                style={{
                                  WebkitPrintColorAdjust: 'exact',
                                  printColorAdjust: 'exact',
                                }}
                              >
                                <span className="font-bold">{group.timelineLabel}</span>
                              </div>
                              <table className="w-full table-fixed text-left border-collapse text-[14px] text-black">
                                <thead>
                                  <tr>
                                    <th className="w-[15%] border-b border-r border-black px-2.5 py-1 font-bold">
                                      Tanggal / Hari
                                    </th>
                                    <th className="w-[12%] border-b border-r border-black px-2.5 py-1 font-bold">
                                      Waktu
                                    </th>
                                    <th className="w-[27%] border-b border-r border-black px-2.5 py-1 font-bold">
                                      Agenda Kegiatan
                                    </th>
                                    <th className="w-[20%] border-b border-r border-black px-2.5 py-1 font-bold">
                                      Target Peserta
                                    </th>
                                    <th className="w-[14%] border-b border-r border-black px-2.5 py-1 font-bold">
                                      Tempat
                                    </th>
                                    <th className="w-[12%] border-b border-black px-2.5 py-1 font-bold">
                                      PIC
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map(({ rd, originalIdx }, itemIdx) => {
                                    const isLastRow = itemIdx === group.items.length - 1;
                                    const rowBorder = isLastRow ? '' : 'border-b border-black';
                                    return (
                                      <tr key={rd.id || originalIdx} className="align-top">
                                        <td
                                          className={`${rowBorder} border-r border-black px-2.5 py-1`}
                                        >
                                          {rd.date}
                                        </td>
                                        <td
                                          className={`${rowBorder} border-r border-black px-2.5 py-1`}
                                        >
                                          {rd.time}
                                        </td>
                                        <td
                                          className={`${rowBorder} border-r border-black px-2.5 py-1 leading-[1.38]`}
                                        >
                                          {rd.agenda}
                                        </td>
                                        <td
                                          className={`${rowBorder} border-r border-black px-2.5 py-1 leading-[1.38]`}
                                        >
                                          {rd.targetParticipants ||
                                            participantRowsData[originalIdx]?.target ||
                                            tor.participantsTarget ||
                                            'Seluruh Peserta'}
                                        </td>
                                        <td
                                          className={`${rowBorder} border-r border-black px-2.5 py-1`}
                                        >
                                          {rd.location}
                                        </td>
                                        <td className={`${rowBorder} px-2.5 py-1`}>{rd.picName}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ));
                        })()}
                      </div>
                      {(tor.rundownNotes || tor.rundownAdditionalNotes) && (
                        <div className="mt-1.5 text-black">
                          <strong>Catatan Rundown:</strong>{' '}
                          {tor.rundownNotes || tor.rundownAdditionalNotes}
                        </div>
                      )}
                    </section>
                  )}

                  {/* ================= CATATAN TAMBAHAN & LOGISTIK ================= */}
                  {tor.additionalNotes && (
                    <section>
                      <div
                        className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                      >
                        Catatan Tambahan &amp; Logistik
                      </div>
                      <p className="text-black whitespace-pre-line leading-[1.38]">
                        {tor.additionalNotes}
                      </p>
                    </section>
                  )}
                </>
              );
            })()}
          </article>

          {/* ============================================================================ */}
          {/* BOTTOM GOVERNANCE, EDIT ACCESS, APPROVAL ACTIONS & AUDIT TRAIL (GAMBAR 1)    */}
          {/* ============================================================================ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Left Bottom Card: Status Dokumen & Hak Akses Edit */}
            <div className="space-y-4">
              {/* CREATOR ACTION PANEL (If Draft or Perlu Perbaikan) */}
              {canSubmitOrResubmit && (
                <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                    <Send className="w-4 h-4 text-[#0f2b5c]" />
                    <span>Tindakan Pembuat TOR</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {tor.submissionStatus === 'Perlu Perbaikan'
                      ? 'Pemeriksa telah meminta revisi pada dokumen ini. Akses edit telah otomatis dibuka — silakan langsung edit dokumen lalu ajukan kembali.'
                      : 'Dokumen ini masih berstatus Draft. Ajukan untuk memulai alur persetujuan berjenjang.'}
                  </p>

                  {!showResubmitBox ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setShowEditTorModal(true)}
                        className="py-2.5 px-3 bg-white hover:bg-slate-50 text-[#0f2b5c] border border-[#0f2b5c] rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Edit className="w-4 h-4" />
                        <span>Edit Dokumen TOR</span>
                      </button>
                      <button
                        onClick={() => setShowResubmitBox(true)}
                        className="py-2.5 px-3 bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                      >
                        <Send className="w-4 h-4" />
                        <span>
                          {tor.submissionStatus === 'Perlu Perbaikan'
                            ? 'Ajukan Ulang TOR'
                            : 'Ajukan untuk Persetujuan'}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-slate-200">
                      <label className="block text-xs font-medium text-slate-800">
                        Catatan / Tanggapan Perbaikan (Opsional)
                      </label>
                      <textarea
                        rows={2}
                        value={resubmitComment}
                        onChange={(e) => setResubmitComment(e.target.value)}
                        placeholder="Jelaskan perbaikan yang telah dilakukan..."
                        className="w-full p-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0f2b5c]"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowResubmitBox(false)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium"
                        >
                          Batal
                        </button>
                        <button
                          disabled={isResubmitting}
                          onClick={handleResubmit}
                          className="flex-1 py-1.5 bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white rounded text-xs font-medium disabled:opacity-50"
                        >
                          {isResubmitting ? 'Mengirim...' : 'Kirim Sekarang'}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* ACTIVITY STATUS CONTROLLER */}
              {canChangeActivityStatus && (
                <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs space-y-2.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Ubah Status Pelaksanaan Lapangan
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <button
                      disabled={isUpdatingActivityStatus || tor.activityStatus === 'Belum Dimulai'}
                      onClick={() => handleChangeActivityStatus('Belum Dimulai')}
                      className={`py-2 px-2 rounded font-semibold border text-center transition-colors cursor-pointer ${
                        tor.activityStatus === 'Belum Dimulai'
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Belum Dimulai
                    </button>
                    <button
                      disabled={isUpdatingActivityStatus || tor.activityStatus === 'Sedang Berjalan'}
                      onClick={() => handleChangeActivityStatus('Sedang Berjalan')}
                      className={`py-2 px-2 rounded font-semibold border text-center transition-colors cursor-pointer ${
                        tor.activityStatus === 'Sedang Berjalan'
                          ? 'bg-[#0f2b5c] text-white border-[#0f2b5c]'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Sedang Berjalan
                    </button>
                    <button
                      disabled={isUpdatingActivityStatus || tor.activityStatus === 'Selesai'}
                      onClick={() => handleChangeActivityStatus('Selesai')}
                      className={`py-2 px-2 rounded font-semibold border text-center transition-colors cursor-pointer ${
                        tor.activityStatus === 'Selesai'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Selesai
                    </button>
                  </div>
                </section>
              )}

              {/* PANEL MODE LIHAT SAJA (READ-ONLY) & REQUEST EDIT KE DIRECTOR */}
              <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                    <Eye className="w-4 h-4 text-[#0f2b5c]" />
                    <span>Mode Lihat Saja (Read-Only Final)</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                    {isEditApproved
                      ? 'Akses Edit Terbuka'
                      : isEditPending
                      ? 'Menunggu ACC Director'
                      : 'Terkunci Final'}
                  </span>
                </div>

                <p className="text-slate-600 leading-relaxed">
                  {tor.submissionStatus === 'Perlu Perbaikan'
                    ? 'Dokumen ini sedang dalam status Perlu Perbaikan (Revisi). Akses edit telah otomatis dibuka sehingga dapat langsung diedit tanpa perlu mengajukan Request Edit.'
                    : 'Detail dokumen TOR disajikan sebagai penampang dokumen final siap baca dan tidak dapat diubah secara langsung. Jika terdapat perubahan data yang mendesak, silakan ajukan Request Edit kepada User Director untuk mendapatkan ACC Edit.'}
                </p>

                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>
                      Pembuat: <strong>{tor.createdByName}</strong> · Otoritas ACC Edit: <strong>Executive Director</strong>
                    </span>
                  </div>

                  {isEditApproved ? (
                    <button
                      type="button"
                      onClick={() => setShowEditTorModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white font-semibold rounded transition-colors cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>Edit Dokumen TOR</span>
                    </button>
                  ) : isEditPending ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 border border-amber-300 text-amber-800 font-semibold">
                      <Clock className="w-3.5 h-3.5 text-amber-600" />
                      <span>Menunggu ACC Edit Direktur di Approval ToR</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRequestEditModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-semibold rounded transition-colors cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                      <span>Request Edit (Approval ToR)</span>
                    </button>
                  )}
                </div>
              </section>
            </div>

            {/* Right Bottom Card: Riwayat Persetujuan & Audit Trail (Terbaru di Atas) */}
            <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs space-y-3 h-fit">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <History className="w-4 h-4 text-[#0f2b5c]" />
                  <span>Riwayat Persetujuan & Audit</span>
                </div>
                <span className="text-[11px] text-slate-400">Terbaru di atas</span>
              </div>

              {sortedApprovalRecords.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  Belum ada riwayat persetujuan atau catatan pengajuan.
                </p>
              ) : (
                <div className="space-y-4 relative pl-1 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-slate-200">
                  {sortedApprovalRecords.map((rec) => {
                    const isApproved =
                      rec.action === 'Disetujui' || rec.action === 'ACC Edit';
                    const isRevision =
                      rec.action === 'Minta Perbaikan' || rec.action === 'Request Edit';
                    const isRejected =
                      rec.action === 'Ditolak' || rec.action === 'Tolak Edit';

                    return (
                      <div key={rec.id} className="relative pl-6 text-xs space-y-1">
                        <div
                          className={`absolute left-0 top-1 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 bg-white ${
                            isApproved
                              ? 'border-emerald-600'
                              : isRevision
                              ? 'border-amber-600'
                              : isRejected
                              ? 'border-rose-600'
                              : 'border-[#0f2b5c]'
                          }`}
                        />

                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {rec.actorName}{' '}
                            <span className="font-normal text-slate-500">({rec.actorRole})</span>
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {new Date(rec.timestamp).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11.5px]">
                          <span
                            className={`font-semibold ${
                              isApproved
                                ? 'text-emerald-700'
                                : isRevision
                                ? 'text-amber-700'
                                : isRejected
                                ? 'text-rose-700'
                                : 'text-[#0f2b5c]'
                            }`}
                          >
                            {rec.action}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">Tahap {rec.stage}</span>
                        </div>

                        {rec.comment && (
                          <div className="p-2.5 bg-slate-50 rounded border border-slate-200 text-slate-600 text-xs italic mt-1 leading-relaxed">
                            &quot;{rec.comment}&quot;
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Source Hierarchy & Traceability Banner at Bottom for Stages 2–8 (with Hide/Show toggle) */}
      {!focusedSourceMode && activeWorkflowStage >= 2 && activeWorkflowStage !== 6 && activeWorkflowStage !== 7 && (
        <SourceTraceabilityBanner
          stageNumber={activeWorkflowStage}
          tor={tor}
          cashAdvances={torCashAdvances}
          onNavigateToTor={() => setActiveWorkflowStage(1)}
          onRequestTorUpdate={() =>
            isEditApproved ? setShowEditTorModal(true) : setShowRequestEditModal(true)
          }
        />
      )}

      {/* Modal Request Edit (Ke Director) */}
      {showRequestEditModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-700" />
                <h4 className="font-bold text-slate-900 text-sm">
                  Request Edit Dokumen TOR (Masuk ke Approval ToR)
                </h4>
              </div>
              <button
                onClick={() => setShowRequestEditModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs sm:text-sm">
              <p className="text-slate-600 leading-relaxed">
                Dokumen <strong>{tor.torNumber}</strong> bersifat final (Read-Only). Pengajuan permintaan edit ini akan otomatis masuk ke tiket <strong>Approval ToR</strong> pada menu <strong>Approval</strong> untuk diputuskan (ACC / Tolak) oleh <strong>Executive Director</strong>.
              </p>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Alasan / Bagian yang Perlu Diedit <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={editRequestReasonInput}
                  onChange={(e) => setEditRequestReasonInput(e.target.value)}
                  placeholder="Contoh: Penyesuaian tanggal pelaksanaan dan penambahan rincian pada tabel tujuan khusus..."
                  className="w-full p-2.5 border border-slate-300 rounded text-xs sm:text-sm focus:border-[#0f2b5c] focus:outline-none"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRequestEditModal(false)}
                className="px-3.5 py-2 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isRequestingEdit || !editRequestReasonInput.trim()}
                onClick={handleRequestEditSubmit}
                className="px-4 py-2 bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white rounded text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {isRequestingEdit ? 'Mengirim ke Approval ToR...' : 'Kirim ke Approval ToR (Director)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit TOR */}
      {showEditTorModal && (
        <TorFormModal
          programs={programs}
          outcomes={outcomes}
          outputs={outputs}
          activities={activities}
          subActivities={subActivities}
          users={effectiveUsers}
          isOpen={showEditTorModal}
          onClose={() => setShowEditTorModal(false)}
          editingTor={tor}
          onSuccess={() => {
            setShowEditTorModal(false);
            setActionSuccess(
              tor.submissionStatus === 'Perlu Perbaikan'
                ? 'Perubahan dokumen TOR berhasil disimpan. Silakan ajukan ulang jika revisi telah selesai.'
                : 'Perubahan dokumen TOR berhasil disimpan.'
            );
            onRefresh();
          }}
        />
      )}

      {/* Official WIJNA PDF Export Modal */}
      <TorPdfExportModal
        tor={{
          ...tor,
          budgetRequested: torCashAdvances
            .filter((c) => c.status === 'Disetujui' || c.status === 'Dicairkan')
            .reduce((sum, c) => sum + (Number(c.totalAmount) || 0), 0),
        }}
        isOpen={showPdfExport}
        onClose={() => setShowPdfExport(false)}
        program={resolvedProgram}
        outcome={resolvedOutcome}
        output={resolvedOutput}
        activity={resolvedActivity}
      />

      {/* Cash Advance Creation / Edit Modal for this TOR */}
      {caModalOpen && (
        <CashAdvanceFormModal
          isOpen={caModalOpen}
          onClose={() => {
            setCaModalOpen(false);
            setCaEditingRecord(null);
          }}
          existingRecord={caEditingRecord}
          initialTorId={enrichedTor.id}
          tors={[enrichedTor]}
          programs={programs}
          outcomes={outcomes}
          outputs={outputs}
          activities={activities}
          currentUser={currentUser}
          sequenceNumber={torCashAdvances.length + 1}
          onSuccess={(newCa) => {
            setCaModalOpen(false);
            setCaEditingRecord(null);
            loadTorCashAdvances();
            onRefresh();
            setCaDetailOpen(newCa);
          }}
        />
      )}

      {/* Cash Advance Detail Modal (when opened outside Stage 02) */}
      {caDetailOpen && activeWorkflowStage !== 2 && (
        <CashAdvanceDetailModal
          isOpen={Boolean(caDetailOpen)}
          onClose={() => setCaDetailOpen(null)}
          record={caDetailOpen}
          currentUser={currentUser}
          onRefresh={async () => {
            if (caDetailOpen) {
              try {
                const refreshed = await api.getCashAdvance(caDetailOpen.id);
                setCaDetailOpen(refreshed);
              } catch {
                setCaDetailOpen(null);
              }
            }
            loadTorCashAdvances();
            onRefresh();
          }}
          onEdit={(rec) => {
            setCaEditingRecord(rec || caDetailOpen);
            setCaDetailOpen(null);
            setCaModalOpen(true);
          }}
        />
      )}
    </div>
  );
};
