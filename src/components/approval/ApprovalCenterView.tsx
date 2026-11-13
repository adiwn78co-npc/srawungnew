import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Tor,
  Program,
  Outcome,
  Output,
  Activity,
  ApprovalHubItem,
  ApprovalCategoryCode,
  ApprovalWorkflowStep,
  ApprovalAccessProfile,
  OutputRaciRecord,
} from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../lib/api.js';
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Wallet,
  Search,
  RotateCcw,
  AlertCircle,
  ArrowLeft,
  ArrowDown,
  Plus,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ExternalLink,
  UserCheck,
  MessageSquare,
  Layers,
  Check,
  ShieldAlert,
  Edit3,
  FolderTree,
  Ticket,
  Lock,
  Camera,
  BarChart3,
  FileCheck2,
  ClipboardList,
} from 'lucide-react';
import { OfficialDocumentPreviewPane } from './OfficialDocumentPreviewPane.js';

interface ApprovalCenterViewProps {
  tors: Tor[];
  programs?: Program[];
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  initialFilterActivityId?: string | null;
  onSelectTor: (
    torId: string,
    initialStage?: number,
    options?: {
      targetEntityId?: string;
      focusedSourceMode?: boolean;
      autoOpenEdit?: boolean;
    }
  ) => void;
  onCreateTor?: () => void;
  onNavigateToMonitoringTools?: () => void;
  onRefreshGlobalData?: () => void;
}

const DOCUMENT_TYPE_LABELS: Record<ApprovalCategoryCode, string> = {
  tor: 'ToR',
  notulen: 'Notulen',
  dokumentasi: 'Dokumentasi',
  executive_summary: 'Executive Summary',
  cash_advance: 'Cash Advance',
  laporan_keuangan_akhir: 'Final Financial Report',
};

const ALL_ACTIVITY_DOCUMENT_CATEGORIES: {
  code: ApprovalCategoryCode;
  label: string;
  subtitle: string;
  groupType: 'program_documents' | 'financial_documents';
  flowSummary: string;
  separationLabel: string;
  stage: number;
}[] = [
  {
    code: 'tor',
    label: 'ToR',
    subtitle: 'Terms of Reference Kegiatan',
    groupType: 'program_documents',
    flowSummary: 'R → A1 → Direktur',
    separationLabel: 'Validasi Program (A1) → Otorisasi Direktur',
    stage: 1,
  },
  {
    code: 'notulen',
    label: 'Notulen',
    subtitle: 'Minutes of Meeting (MoM)',
    groupType: 'program_documents',
    flowSummary: 'R → A1 → Direktur',
    separationLabel: 'Validasi Program (A1) → Otorisasi Direktur',
    stage: 4,
  },
  {
    code: 'dokumentasi',
    label: 'Dokumentasi',
    subtitle: 'Foto Terbaik & Human Interest Story',
    groupType: 'program_documents',
    flowSummary: 'R → A1 → Direktur',
    separationLabel: 'Validasi Program (A1) → Otorisasi Direktur',
    stage: 5,
  },
  {
    code: 'executive_summary',
    label: 'Executive Summary',
    subtitle: '7 Bagian Pembelajaran & Bukti MEAL',
    groupType: 'program_documents',
    flowSummary: 'R → A1 → Direktur',
    separationLabel: 'Validasi Program (A1) → Otorisasi Direktur',
    stage: 6,
  },
  {
    code: 'cash_advance',
    label: 'Cash Advance',
    subtitle: 'Pengajuan Uang Muka Operasional',
    groupType: 'financial_documents',
    flowSummary: 'R → A2 → Direktur',
    separationLabel: 'Verifikasi Keuangan (A2) → Otorisasi Direktur',
    stage: 2,
  },
  {
    code: 'laporan_keuangan_akhir',
    label: 'Final Financial Report',
    subtitle: 'Pertanggungjawaban & Bukti Expensify',
    groupType: 'financial_documents',
    flowSummary: 'R → A2 → Direktur',
    separationLabel: 'Verifikasi Keuangan (A2) → Otorisasi Direktur',
    stage: 8,
  },
];

const PROGRAM_DOCUMENT_TYPES = ALL_ACTIVITY_DOCUMENT_CATEGORIES.filter(
  (c) => c.groupType === 'program_documents'
);
const FINANCE_DOCUMENT_TYPES = ALL_ACTIVITY_DOCUMENT_CATEGORIES.filter(
  (c) => c.groupType === 'financial_documents'
);

/**
 * 5-State Ticket Distinction required by MEAL Connect Ticket-Based Approval System:
 * 1. awaiting_my_action: Documents awaiting action from the current user
 * 2. awaiting_subsequent_stage: Documents awaiting subsequent approval stages
 * 3. processed_by_others: Documents being processed by other approvers
 * 4. returned_for_revision: Documents returned for revision
 * 5. already_approved: Documents already approved
 */
export type TicketUserStateCode =
  | 'all'
  | 'awaiting_my_action'
  | 'awaiting_subsequent_stage'
  | 'processed_by_others'
  | 'returned_for_revision'
  | 'already_approved';

const TICKET_USER_STATE_FILTERS: {
  code: TicketUserStateCode;
  label: string;
  shortLabel: string;
  dotColor: string;
}[] = [
  {
    code: 'all',
    label: 'Semua Status Tiket',
    shortLabel: 'Semua',
    dotColor: 'bg-[#787774]',
  },
  {
    code: 'awaiting_my_action',
    label: 'Menunggu Tindakan Saya',
    shortLabel: 'Tindakan Saya',
    dotColor: 'bg-[#D45B55]',
  },
  {
    code: 'awaiting_subsequent_stage',
    label: 'Menunggu Tahap Berikutnya',
    shortLabel: 'Tahap Berikutnya',
    dotColor: 'bg-[#4E8EC4]',
  },
  {
    code: 'processed_by_others',
    label: 'Diproses Pejabat Lain',
    shortLabel: 'Pejabat Lain',
    dotColor: 'bg-[#5B97BD]',
  },
  {
    code: 'returned_for_revision',
    label: 'Dikembalikan untuk Revisi',
    shortLabel: 'Perlu Revisi',
    dotColor: 'bg-[#D49B35]',
  },
  {
    code: 'already_approved',
    label: 'Sudah Disetujui',
    shortLabel: 'Disetujui',
    dotColor: 'bg-[#4F946B]',
  },
];

function formatTwoDigits(num: number): string {
  return String(Math.max(0, num)).padStart(2, '0');
}

function formatCurrency(val?: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(val || 0);
}

function formatShortDate(dateStr?: string) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(dateStr?: string) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isItemOverdue(item: ApprovalHubItem): boolean {
  if (!item.dueDate) return false;
  const isFinance = item.groupType === 'financial_documents';
  if (
    item.status === 'Reported to Director' ||
    item.status === 'Rejected' ||
    item.status === 'Archived' ||
    (isFinance && item.status === 'Approved')
  ) {
    return false;
  }
  const today = new Date().toISOString().slice(0, 10);
  return item.dueDate.slice(0, 10) < today;
}

/**
 * Sistem Indikator Tone Notion Pastel Cerah (Soft & Airy Light Mode):
 * - 'red' (Perlu Tindakan): Soft Rose Pastel
 * - 'yellow' (Sedang Diproses / Revisi): Soft Amber Pastel
 * - 'green' (Sudah Disetujui): Soft Mint Pastel
 * - 'gray' (Belum Diajukan): Soft Slate Airy
 */
export type HierarchyIndicatorTone = 'red' | 'yellow' | 'green' | 'gray';

function getIndicatorClasses(tone: HierarchyIndicatorTone): {
  dot: string;
  badge: string;
} {
  switch (tone) {
    case 'red':
      return {
        dot: 'bg-[#D45B55]',
        badge: 'bg-[#FBE4E4] text-[#C4554D] border border-[#F3C6C6]',
      };
    case 'yellow':
      return {
        dot: 'bg-[#D49B35]',
        badge: 'bg-[#FBF3DB] text-[#B87D1E] border border-[#EAD6A3]',
      };
    case 'green':
      return {
        dot: 'bg-[#4F946B]',
        badge: 'bg-[#EDF3EC] text-[#3F7E59] border border-[#C7DFC5]',
      };
    case 'gray':
    default:
      return {
        dot: 'bg-[#9B9A97]',
        badge: 'bg-[#F4F3EF] text-[#787774] border border-[#E3E2E0]',
      };
  }
}

/**
 * Mengklasifikasikan setiap dokumen unik menjadi tepat 1 kategori perhitungan (tanpa duplikasi)
 */
function classifyDocumentBucket(
  item: ApprovalHubItem
): 'needsApproval' | 'inProgress' | 'approved' | 'notSubmitted' {
  const isFinance = item.groupType === 'financial_documents';

  if (item.categoryCode === 'tor' && item.previewData?.editRequestStatus === 'pending') {
    return 'needsApproval';
  }

  if (
    item.status === 'Reported to Director' ||
    (isFinance && item.status === 'Approved')
  ) {
    return 'approved';
  }

  if (item.status === 'Draft') {
    return 'notSubmitted';
  }

  if (
    item.status === 'Pending Verification' ||
    item.status === 'Submitted' ||
    item.status === 'Pending Approval' ||
    (!isFinance && item.status === 'Approved')
  ) {
    return 'needsApproval';
  }

  return 'inProgress';
}

function getSimpleStatusDisplay(item: ApprovalHubItem): {
  label: string;
  shortLabel: string;
  actorName: string;
  roleCode: string;
  tone: HierarchyIndicatorTone;
  dotColor: string;
  badgeStyle: string;
  isWaitingVerifierOrDirector: boolean;
} {
  const isFinance = item.groupType === 'financial_documents';
  const a1Name = item.accountableProgramUserName || 'A1 Program';
  const a2Name = item.accountableFinanceUserName || 'A2 Finance';
  const directorName = item.directorUserName || 'Direktur';
  const rName = item.responsibleUserName || 'R';

  if (item.categoryCode === 'tor' && item.previewData?.editRequestStatus === 'pending') {
    const cls = getIndicatorClasses('red');
    return {
      label: 'Request Edit (Menunggu Direktur)',
      shortLabel: 'Request Edit ToR',
      actorName: directorName,
      roleCode: 'Direktur',
      tone: 'red',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: true,
    };
  }

  if (
    item.categoryCode === 'tor' &&
    item.previewData?.editRequestStatus === 'approved' &&
    item.status === 'Reported to Director'
  ) {
    const cls = getIndicatorClasses('yellow');
    return {
      label: 'Edit Di-ACC Direktur',
      shortLabel: 'Edit Di-ACC',
      actorName: rName,
      roleCode: 'R',
      tone: 'yellow',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: false,
    };
  }

  if (item.status === 'Rejected') {
    const cls = getIndicatorClasses('red');
    return {
      label: 'Ditolak',
      shortLabel: 'Ditolak',
      actorName: rName,
      roleCode: 'R',
      tone: 'red',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: false,
    };
  }

  if (item.status === 'Revision Required') {
    const cls = getIndicatorClasses('yellow');
    return {
      label: 'Perlu Revisi',
      shortLabel: 'Perlu Revisi',
      actorName: rName,
      roleCode: 'R',
      tone: 'yellow',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: false,
    };
  }

  if (
    item.status === 'Reported to Director' ||
    (isFinance && item.status === 'Approved')
  ) {
    const cls = getIndicatorClasses('green');
    return {
      label: 'Disetujui',
      shortLabel: 'Disetujui',
      actorName: isFinance ? directorName : a1Name,
      roleCode: isFinance ? 'Direktur' : 'A1',
      tone: 'green',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: false,
    };
  }

  if (
    item.status === 'Pending Approval' ||
    (!isFinance && item.status === 'Approved')
  ) {
    const cls = getIndicatorClasses('red');
    return {
      label: 'Menunggu Direktur',
      shortLabel: 'Menunggu Direktur',
      actorName: directorName,
      roleCode: 'Direktur',
      tone: 'red',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: true,
    };
  }

  if (item.status === 'Pending Verification' || item.status === 'Submitted') {
    const cls = getIndicatorClasses('red');
    const targetName = isFinance ? a2Name : a1Name;
    const roleTag = isFinance ? 'A2' : 'A1';
    return {
      label: `Menunggu ${roleTag}`,
      shortLabel: `Menunggu ${roleTag}`,
      actorName: targetName,
      roleCode: roleTag,
      tone: 'red',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: true,
    };
  }

  if (item.status === 'Draft') {
    const cls = getIndicatorClasses('gray');
    return {
      label: 'Belum Diajukan',
      shortLabel: 'Belum Diajukan',
      actorName: rName,
      roleCode: 'R',
      tone: 'gray',
      dotColor: cls.dot,
      badgeStyle: cls.badge,
      isWaitingVerifierOrDirector: false,
    };
  }

  const cls = getIndicatorClasses('yellow');
  return {
    label: 'Sedang Diproses',
    shortLabel: 'Sedang Diproses',
    actorName: rName,
    roleCode: 'R',
    tone: 'yellow',
    dotColor: cls.dot,
    badgeStyle: cls.badge,
    isWaitingVerifierOrDirector: false,
  };
}

interface HierarchyStatsSummary {
  needsApprovalCount: number;
  inProgressCount: number;
  approvedCount: number;
  totalSubmittedCount: number;
  tone: HierarchyIndicatorTone;
}

function computeStatsFromUniqueItems(items: ApprovalHubItem[]): HierarchyStatsSummary {
  const seenIds = new Set<string>();
  let needsApprovalCount = 0;
  let inProgressCount = 0;
  let approvedCount = 0;

  for (const item of items) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    const bucket = classifyDocumentBucket(item);
    if (bucket === 'needsApproval') needsApprovalCount += 1;
    else if (bucket === 'inProgress') inProgressCount += 1;
    else if (bucket === 'approved') approvedCount += 1;
  }

  let tone: HierarchyIndicatorTone = 'gray';
  if (needsApprovalCount > 0) {
    tone = 'red';
  } else if (inProgressCount > 0) {
    tone = 'yellow';
  } else if (approvedCount > 0) {
    tone = 'green';
  }

  return {
    needsApprovalCount,
    inProgressCount,
    approvedCount,
    totalSubmittedCount: needsApprovalCount + inProgressCount + approvedCount,
    tone,
  };
}

export function ApprovalCenterView({
  tors,
  programs = [],
  outcomes = [],
  outputs = [],
  activities = [],
  initialFilterActivityId,
  onSelectTor,
  onCreateTor,
  onNavigateToMonitoringTools,
  onRefreshGlobalData,
}: ApprovalCenterViewProps) {
  const { currentUser } = useAuth();

  const [hubItems, setHubItems] = useState<ApprovalHubItem[]>([]);
  const [responsibleItems, setResponsibleItems] = useState<ApprovalHubItem[]>([]);
  const [accessProfile, setAccessProfile] = useState<ApprovalAccessProfile | null>(null);
  const [raciMap, setRaciMap] = useState<Record<string, OutputRaciRecord>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [roleViewMode, setRoleViewMode] = useState<'approver_inbox' | 'r_tracking'>('approver_inbox');

  // Pencarian, Filter Tiket Kategori, Filter 5 Status Tiket, dan Filter Program
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | ApprovalCategoryCode>('all');
  const [activeTicketStateFilter, setActiveTicketStateFilter] =
    useState<TicketUserStateCode>('all');
  const [selectedProgramFilterId, setSelectedProgramFilterId] = useState<string>('all');
  const [showHierarchySection, setShowHierarchySection] = useState<boolean>(true);

  // Navigasi Bertingkat:
  // 1. Expandable Program -> Outcome -> Output -> Activity
  // 2. Halaman Detail Activity (selectedActivityId)
  // 3. Pop-up Detail Dokumen & Persetujuan (selectedItemId)
  const [expandedProgramIds, setExpandedProgramIds] = useState<Record<string, boolean>>({});
  const [expandedOutcomeIds, setExpandedOutcomeIds] = useState<Record<string, boolean>>({});
  const [expandedOutputIds, setExpandedOutputIds] = useState<Record<string, boolean>>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    initialFilterActivityId || null
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showDocDetailMeta, setShowDocDetailMeta] = useState<boolean>(false);

  // Komentar pada pop-up dokumen & komentar langsung per baris di tabel menu
  const [commentInput, setCommentInput] = useState<string>('');
  const [inlineComments, setInlineComments] = useState<Record<string, string>>({});
  const [feedbackToast, setFeedbackToast] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Menu + Pengajuan Baru
  const [showNewMenu, setShowNewMenu] = useState<boolean>(false);
  const [pendingNewDocCategory, setPendingNewDocCategory] = useState<{
    code: ApprovalCategoryCode;
    label: string;
    stage: number;
  } | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const ticketContentsRef = useRef<HTMLDivElement | null>(null);
  const [showApprovalCenterPanel, setShowApprovalCenterPanel] = useState<boolean>(false);

  useEffect(() => {
    if (initialFilterActivityId) {
      setSelectedActivityId(initialFilterActivityId);
    }
  }, [initialFilterActivityId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadApprovalHub = useCallback(async (silent: boolean = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [apvData, monData] = await Promise.all([
        api.getApprovalHub(),
        api.getMonitoringConnect().catch(() => null),
      ]);
      setHubItems(apvData.items || []);
      setResponsibleItems(apvData.responsibleItems || []);
      setAccessProfile(apvData.accessProfile || null);
      if (monData && monData.outputRaciRecords) {
        setRaciMap(monData.outputRaciRecords);
      }
    } catch (err) {
      console.error('Failed to load approval hub:', err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadApprovalHub(false);
  }, [loadApprovalHub, tors, currentUser?.id]);

  // Sinkronisasi otomatis (Real-Time Tracking tanpa perlu refresh manual oleh R maupun Approver)
  useEffect(() => {
    const interval = setInterval(() => {
      loadApprovalHub(true);
    }, 8000);
    const handleFocus = () => loadApprovalHub(true);
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadApprovalHub]);

  // Deteksi peran Approver vs R (Responsible)
  const hasApproverAuthority = Boolean(
    accessProfile &&
      (accessProfile.isDirector ||
        accessProfile.isA1 ||
        accessProfile.isA2 ||
        accessProfile.isFinance)
  );
  const hasResponsibleTrackingItems = Boolean(
    accessProfile?.isR || responsibleItems.length > 0
  );

  // Jika pengguna adalah murni R (Responsible), otomatis tampilkan mode Tracking Ticket R
  useEffect(() => {
    if (!accessProfile) return;
    if (!hasApproverAuthority && hasResponsibleTrackingItems) {
      setRoleViewMode('r_tracking');
    } else if (hasApproverAuthority && !hasResponsibleTrackingItems) {
      setRoleViewMode('approver_inbox');
    }
  }, [accessProfile, hasApproverAuthority, hasResponsibleTrackingItems]);

  const isRTrackingMode =
    !hasApproverAuthority || (hasResponsibleTrackingItems && roleViewMode === 'r_tracking');

  // Reset selected document if user switches account and no longer has visibility on it
  useEffect(() => {
    const allAccessible = [...hubItems, ...responsibleItems];
    if (selectedItemId && !allAccessible.some((i) => i.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [hubItems, responsibleItems, selectedItemId]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedbackToast({ type, text });
    setTimeout(() => {
      setFeedbackToast((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  /**
   * Ketentuan 7, 8 & Approval Integrity:
   * - Pemisahan tegas antara Validasi Program (A1), Verifikasi Keuangan (A2), dan Otorisasi Akhir (Direktur)
   * - Self-Approval Prevention: Pengaju dokumen (R) tidak pernah diizinkan menyetujui pengajuannya sendiri pada tahap persetujuan yang sama.
   */
  const getUserDocumentAuthority = useCallback(
    (item: ApprovalHubItem) => {
      if (
        !currentUser ||
        !accessProfile ||
        !accessProfile.canAccessApprovalMenu ||
        accessProfile.isAdmin
      ) {
        return {
          canVerifyApproveA1: false,
          canVerifyA2: false,
          canDirectorFinalApprove: false,
          canDirectorReceiveReport: false,
          canApproveTorEditRequest: false,
          canRejectTorEditRequest: false,
          canReturnForRevision: false,
          canReject: false,
          canDisburseCashAdvance: false,
          isFinanceMonitorOnly: false,
          isSelfSubmitter: false,
          needsImmediateActionFromMe: false,
          authorityLabel: 'Tidak Memiliki Kewenangan Persetujuan',
        };
      }

      const isProgramDoc = item.groupType === 'program_documents';
      const isFinanceDoc = item.groupType === 'financial_documents';
      const isSelfSubmitter = item.responsibleUserId === currentUser.id;

      const isDesignatedA1 =
        isProgramDoc && accessProfile.isA1 && item.accountableProgramUserId === currentUser.id;
      const isDesignatedA2 =
        isFinanceDoc &&
        accessProfile.isA2 &&
        item.accountableFinanceUserId === currentUser.id &&
        currentUser.permissions?.canApproveTor !== false;
      const isDesignatedDirector =
        accessProfile.isDirector &&
        (currentUser.role === 'director' || item.directorUserId === currentUser.id);
      const isFinanceMonitorOnly =
        isFinanceDoc && accessProfile.isFinance && !isDesignatedA2 && !isDesignatedDirector;

      const isWaitingVerification =
        item.status === 'Pending Verification' || item.status === 'Submitted';
      const isWaitingDirectorFinance = isFinanceDoc && item.status === 'Pending Approval';
      const isWaitingDirectorProgramReport =
        isProgramDoc && (item.status === 'Approved' || item.status === 'Pending Approval');
      const isTorEditRequestPending =
        item.categoryCode === 'tor' && item.previewData?.editRequestStatus === 'pending';

      // Approval Integrity: Never allow a document submitter to approve their own submission at the same approval stage
      const canVerifyApproveA1 = !isSelfSubmitter && isDesignatedA1 && isWaitingVerification;
      const canVerifyA2 = !isSelfSubmitter && isDesignatedA2 && isWaitingVerification;
      const canDirectorFinalApprove =
        !isSelfSubmitter && isDesignatedDirector && isWaitingDirectorFinance;
      const canDirectorReceiveReport =
        !isSelfSubmitter &&
        (isDesignatedDirector || isDesignatedA1) &&
        isWaitingDirectorProgramReport;
      const canApproveTorEditRequest =
        !isSelfSubmitter && isDesignatedDirector && isTorEditRequestPending;
      const canRejectTorEditRequest =
        !isSelfSubmitter && isDesignatedDirector && isTorEditRequestPending;

      const canReturnForRevision =
        !isSelfSubmitter &&
        (canVerifyApproveA1 ||
          canVerifyA2 ||
          canDirectorFinalApprove ||
          (isDesignatedDirector && isWaitingDirectorProgramReport));

      const canReject =
        !isSelfSubmitter && (canVerifyApproveA1 || canVerifyA2 || canDirectorFinalApprove);

      const canDisburseCashAdvance = Boolean(
        item.categoryCode === 'cash_advance' &&
          item.status === 'Approved' &&
          !item.previewData?.isDisbursed &&
          (accessProfile.isFinance || accessProfile.isA2 || currentUser.role === 'finance')
      );

      const needsImmediateActionFromMe =
        canVerifyApproveA1 ||
        canVerifyA2 ||
        canDirectorFinalApprove ||
        canApproveTorEditRequest ||
        canDisburseCashAdvance ||
        (isDesignatedDirector && !isSelfSubmitter && isWaitingDirectorProgramReport);

      let authorityLabel = 'Pemantauan Sesuai Peran';
      if (canApproveTorEditRequest) {
        authorityLabel = 'Direktur · Keputusan ACC / Tolak Request Edit ToR';
      } else if (canDisburseCashAdvance) {
        authorityLabel = 'Finance / Kasir · Eksekusi Pencairan Dana ke Pengaju';
      } else if (isSelfSubmitter) {
        authorityLabel = 'R (Responsible) · Mode Tracking & Pengelolaan Dokumen Asli';
      } else if (isDesignatedDirector) {
        authorityLabel = isFinanceDoc
          ? 'Direktur · Otorisasi Akhir Keuangan'
          : 'Direktur · Otorisasi & Penerimaan Laporan Program';
      } else if (isDesignatedA1) {
        authorityLabel = 'A1 – Accountable Program · Validasi Dokumen Program';
      } else if (isDesignatedA2) {
        authorityLabel = 'A2 – Accountable Finance · Verifikasi Keuangan';
      } else if (isFinanceMonitorOnly) {
        authorityLabel = 'Finance · Pemantauan & Pencatatan Keuangan';
      }

      return {
        canVerifyApproveA1,
        canVerifyA2,
        canDirectorFinalApprove,
        canDirectorReceiveReport,
        canApproveTorEditRequest,
        canRejectTorEditRequest,
        canReturnForRevision,
        canReject,
        canDisburseCashAdvance,
        isFinanceMonitorOnly,
        isSelfSubmitter,
        needsImmediateActionFromMe,
        authorityLabel,
      };
    },
    [currentUser, accessProfile]
  );

  /**
   * Detail Perjalanan Persetujuan (Approval Journey Visibility) untuk R (Responsible) & Approver:
   * - Program Documents: R -> A1 -> Director (notification/reporting stage)
   * - Financial Documents: R -> A2 -> Director (authorization stage)
   * Mencakup:
   * - Siapa pemegang dokumen saat ini (Nama & Peran)
   * - Tanggal dokumen diterima oleh masing-masing pemeriksa (receivedAt)
   * - Tahap persetujuan saat ini & status akhir (finalApprovalStatus)
   * - Catatan revisi terbaru & riwayat versi dokumen (v1, v2, ...)
   */
  const getApprovalJourneyDetails = useCallback((item: ApprovalHubItem) => {
    const isProgramDoc = item.groupType === 'program_documents';
    const step1 = item.steps?.[0];
    const step2 = item.steps?.[1];
    const step3 = item.steps?.[2];

    const step1Received = step1?.receivedAt || item.submittedAt;
    const step2Received =
      step2?.receivedAt ||
      (item.status !== 'Draft' ? item.submittedAt : undefined);
    const step3Received =
      step3?.receivedAt ||
      (step2?.status === 'Selesai' ? step2?.actedAt || item.updatedAt : undefined);

    // 1. Tahap 1: Submitted by R
    const stage1Progress =
      item.status === 'Draft'
        ? 'Draft (Belum Diajukan)'
        : item.status === 'Revision Required'
        ? 'Perlu Revisi & Kirim Ulang oleh R'
        : 'Selesai (Completed)';

    // 2. Tahap 2: A1 Program Review / A2 Financial Verification
    let stage2Progress = 'Menunggu Pengajuan R';
    if (step2?.status === 'Selesai') {
      stage2Progress = 'Selesai (Completed)';
    } else if (step2?.status === 'Sedang Berjalan') {
      stage2Progress = isProgramDoc
        ? 'Sedang Ditinjau A1 (In Review)'
        : 'Sedang Diverifikasi A2 (In Verification)';
    } else if (step2?.status === 'Perlu Revisi') {
      stage2Progress = 'Meminta Revisi (Revision Requested)';
    } else if (step2?.status === 'Ditolak') {
      stage2Progress = 'Ditolak (Rejected)';
    }

    // 3. Director Notification/Reporting (Program) vs Director Authorization (Financial)
    let stage3Progress = isProgramDoc
      ? 'Menunggu Peninjauan A1'
      : 'Menunggu Verifikasi A2';
    if (step3?.status === 'Selesai') {
      stage3Progress = isProgramDoc
        ? 'Selesai Dilaporkan ke Direktur (Completed)'
        : 'Telah Diotorisasi Direktur (Completed)';
    } else if (step3?.status === 'Sedang Berjalan') {
      stage3Progress = isProgramDoc
        ? 'Menunggu Notifikasi / Tindakan Direktur'
        : 'Menunggu Otorisasi Direktur (Pending)';
    }

    // Identifikasi Pemegang Dokumen Saat Ini (Who Currently Holds the Document)
    let currentHolderName = item.responsibleUserName;
    let currentHolderRole = 'R – Responsible (Pelaksana / Pengaju)';
    let currentHolderReceivedAt = item.updatedAt || item.submittedAt;
    let currentStageLabel = 'Penyusunan & Pengajuan oleh R';
    let finalApprovalStatusLabel = 'Dalam Proses Persetujuan';
    let holderBadgeTone: 'amber' | 'blue' | 'green' | 'rose' = 'blue';

    if (item.status === 'Revision Required') {
      currentHolderName = item.responsibleUserName;
      currentHolderRole = 'R – Responsible (Menunggu Perbaikan & Pengajuan Ulang)';
      currentHolderReceivedAt = item.updatedAt || item.submittedAt;
      currentStageLabel = 'Dikembalikan ke R untuk Revisi';
      finalApprovalStatusLabel = 'Menunggu Revisi Dokumen oleh R';
      holderBadgeTone = 'amber';
    } else if (item.status === 'Rejected') {
      currentHolderName = item.responsibleUserName;
      currentHolderRole = 'R – Responsible (Pengajuan Ditolak – Perlu Tindak Lanjut)';
      currentHolderReceivedAt = item.updatedAt || item.submittedAt;
      currentStageLabel = 'Pengajuan Ditolak Pemeriksa';
      finalApprovalStatusLabel = 'Ditolak (Perlu Perbaikan / Pengajuan Ulang)';
      holderBadgeTone = 'rose';
    } else if (item.status === 'Draft') {
      currentHolderName = item.responsibleUserName;
      currentHolderRole = 'R – Responsible (Draft Dokumen)';
      currentHolderReceivedAt = item.submittedAt;
      currentStageLabel = 'Draft (Belum Diajukan)';
      finalApprovalStatusLabel = 'Draft – Belum Diajukan';
      holderBadgeTone = 'amber';
    } else if (item.status === 'Pending Verification' || item.status === 'Submitted') {
      currentHolderName = isProgramDoc
        ? item.accountableProgramUserName
        : item.accountableFinanceUserName;
      currentHolderRole = isProgramDoc
        ? 'A1 – Accountable Program (Pemeriksa Program)'
        : 'A2 – Accountable Finance (Verifikator Keuangan)';
      currentHolderReceivedAt = step2Received || item.submittedAt;
      currentStageLabel = isProgramDoc
        ? 'Peninjauan Program A1 (A1 Program Review)'
        : 'Verifikasi Keuangan A2 (A2 Financial Verification)';
      finalApprovalStatusLabel = isProgramDoc
        ? 'Menunggu Keputusan A1 & Pelaporan Direktur'
        : 'Menunggu Verifikasi A2 & Otorisasi Direktur';
      holderBadgeTone = 'blue';
    } else if (
      item.status === 'Pending Approval' ||
      (isProgramDoc && item.status === 'Approved')
    ) {
      currentHolderName = item.directorUserName;
      currentHolderRole = isProgramDoc
        ? 'Direktur Eksekutif (Notifikasi & Pelaporan)'
        : 'Direktur Eksekutif (Otorisasi Akhir Keuangan)';
      currentHolderReceivedAt = step3Received || item.updatedAt || item.submittedAt;
      currentStageLabel = isProgramDoc
        ? 'Direktur (Notifikasi / Pelaporan Program)'
        : 'Otorisasi Direktur (Director Authorization)';
      finalApprovalStatusLabel = isProgramDoc
        ? 'Disetujui A1 · Menunggu Penerimaan Laporan Direktur'
        : 'Terverifikasi A2 · Menunggu Otorisasi Akhir Direktur';
      holderBadgeTone = 'blue';
    } else if (
      item.status === 'Reported to Director' ||
      (!isProgramDoc && item.status === 'Approved')
    ) {
      currentHolderName = 'Selesai (Arsip Resmi Terotorisasi)';
      currentHolderRole = isProgramDoc
        ? `Telah Disetujui A1 (${item.accountableProgramUserName}) & Diterima Direktur (${item.directorUserName})`
        : `Telah Diverifikasi A2 (${item.accountableFinanceUserName}) & Diotorisasi Direktur (${item.directorUserName})`;
      currentHolderReceivedAt = item.completedAt || item.updatedAt;
      currentStageLabel = 'Selesai · Seluruh Persetujuan Tuntas';
      finalApprovalStatusLabel = isProgramDoc
        ? 'Disetujui Akhir & Dilaporkan ke Direktur (Final Completed)'
        : 'Disetujui & Diotorisasi Akhir oleh Direktur (Final Approved)';
      holderBadgeTone = 'green';
    }

    const sortedEvents = [...(item.timeline || [])].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const latestDiscussionEvent = sortedEvents[0] || null;
    const latestRevisionEvent =
      sortedEvents.find(
        (ev) =>
          ev.resultingStatus === 'Revision Required' || ev.resultingStatus === 'Rejected'
      ) || null;

    // Ekstrak riwayat versi dokumen (v1, v2, dst.)
    const versionMap = new Map<
      number,
      {
        version: number;
        submittedAt: string;
        actorName: string;
        comment: string;
        statusLabel: string;
      }
    >();
    for (const ev of [...sortedEvents].reverse()) {
      const v = ev.version || 1;
      if (!versionMap.has(v)) {
        versionMap.set(v, {
          version: v,
          submittedAt: ev.timestamp,
          actorName: ev.actorName,
          comment: ev.comment,
          statusLabel: ev.actionLabel,
        });
      }
    }
    if (!versionMap.has(item.version || 1)) {
      versionMap.set(item.version || 1, {
        version: item.version || 1,
        submittedAt: item.submittedAt,
        actorName: item.responsibleUserName,
        comment: 'Pengajuan dokumen awal oleh R.',
        statusLabel: 'Pengajuan Awal',
      });
    }
    const versionHistory = Array.from(versionMap.values()).sort(
      (a, b) => b.version - a.version
    );

    const journeyStages = [
      {
        stepNumber: 1,
        code: 'R',
        stageTitle: 'Diajukan oleh R (Submitted by R)',
        personName: item.responsibleUserName,
        personRole: 'R – Responsible (Pelaksana)',
        status: step1?.status || 'Selesai',
        progressText: stage1Progress,
        receivedAt: step1Received,
        actedAt: step1?.actedAt || item.submittedAt,
        notes: step1?.notes,
        isCurrentHolder:
          item.status === 'Revision Required' ||
          item.status === 'Rejected' ||
          item.status === 'Draft',
      },
      {
        stepNumber: 2,
        code: isProgramDoc ? 'A1' : 'A2',
        stageTitle: isProgramDoc
          ? 'Peninjauan Program A1 (A1 Program Review)'
          : 'Verifikasi Keuangan A2 (A2 Financial Verification)',
        personName: isProgramDoc
          ? item.accountableProgramUserName
          : item.accountableFinanceUserName,
        personRole: isProgramDoc
          ? 'A1 – Accountable Program'
          : 'A2 – Accountable Finance',
        status: step2?.status || 'Menunggu Tahap Sebelumnya',
        progressText: stage2Progress,
        receivedAt: step2Received,
        actedAt: step2?.actedAt,
        notes: step2?.notes,
        isCurrentHolder:
          item.status === 'Pending Verification' || item.status === 'Submitted',
      },
      {
        stepNumber: 3,
        code: 'Direktur',
        stageTitle: isProgramDoc
          ? 'Direktur (Tahap Notifikasi / Pelaporan)'
          : 'Otorisasi Direktur (Director Authorization)',
        personName: item.directorUserName,
        personRole: 'Direktur Eksekutif',
        status: step3?.status || 'Menunggu Tahap Sebelumnya',
        progressText: stage3Progress,
        receivedAt: step3Received,
        actedAt: step3?.actedAt,
        notes: step3?.notes,
        isCurrentHolder:
          item.status === 'Pending Approval' ||
          (isProgramDoc && item.status === 'Approved'),
      },
    ];

    return {
      isProgramDoc,
      flowFormula: isProgramDoc
        ? 'R → A1 → Direktur (Notifikasi / Pelaporan)'
        : 'R → A2 → Direktur (Otorisasi Akhir)',
      currentHolderName,
      currentHolderRole,
      currentHolderReceivedAt,
      currentStageLabel,
      finalApprovalStatusLabel,
      holderBadgeTone,
      latestDiscussionEvent,
      latestRevisionEvent,
      versionHistory,
      journeyStages,
    };
  }, []);

  /**
   * Klasifikasi 5 Status Tiket untuk setiap dokumen terhadap pengguna yang sedang login:
   * 1. awaiting_my_action: Menunggu tindakan langsung dari pengguna saat ini
   * 2. awaiting_subsequent_stage: Menunggu tahap persetujuan berikutnya (Tahap Direktur)
   * 3. processed_by_others: Sedang diproses oleh pejabat/pemeriksa lain (Tahap A1/A2)
   * 4. returned_for_revision: Dikembalikan untuk revisi / ditolak
   * 5. already_approved: Sudah disetujui tuntas
   */
  const classifyItemUserTicketState = useCallback(
    (item: ApprovalHubItem): Exclude<TicketUserStateCode, 'all'> => {
      const isFinance = item.groupType === 'financial_documents';
      const auth = getUserDocumentAuthority(item);

      if (item.categoryCode === 'tor' && item.previewData?.editRequestStatus === 'pending') {
        if (!isRTrackingMode && auth.canApproveTorEditRequest) {
          return 'awaiting_my_action';
        }
        return 'awaiting_subsequent_stage';
      }

      if (
        item.categoryCode === 'tor' &&
        item.previewData?.editRequestStatus === 'approved' &&
        (isRTrackingMode || item.responsibleUserId === currentUser?.id)
      ) {
        return 'awaiting_my_action';
      }

      if (auth.canDisburseCashAdvance && !isRTrackingMode) {
        return 'awaiting_my_action';
      }

      if (
        item.status === 'Reported to Director' ||
        (isFinance && item.status === 'Approved')
      ) {
        return 'already_approved';
      }

      if (item.status === 'Revision Required' || item.status === 'Rejected') {
        return 'returned_for_revision';
      }

      // Dalam mode R Tracking Ticket (atau jika pengguna adalah R pada dokumen ini):
      if (isRTrackingMode || item.responsibleUserId === currentUser?.id) {
        if (item.status === 'Draft') {
          return 'awaiting_my_action';
        }
        const isAtDirectorStage =
          item.status === 'Pending Approval' || (!isFinance && item.status === 'Approved');
        if (isAtDirectorStage) {
          return 'awaiting_subsequent_stage';
        }
        return 'processed_by_others';
      }

      if (auth.needsImmediateActionFromMe) {
        return 'awaiting_my_action';
      }

      const isAtDirectorStage =
        item.status === 'Pending Approval' || (!isFinance && item.status === 'Approved');
      const isAtVerifierStage =
        item.status === 'Pending Verification' || item.status === 'Submitted';

      if (
        (isAtDirectorStage && !accessProfile?.isDirector) ||
        (isAtVerifierStage && accessProfile?.isDirector)
      ) {
        return 'awaiting_subsequent_stage';
      }

      return 'processed_by_others';
    },
    [getUserDocumentAuthority, accessProfile, isRTrackingMode, currentUser?.id]
  );

  const getTicketUserStateBadge = useCallback(
    (item: ApprovalHubItem) => {
      const stateCode = classifyItemUserTicketState(item);
      const isFinance = item.groupType === 'financial_documents';
      const isRDoc = isRTrackingMode || item.responsibleUserId === currentUser?.id;

      switch (stateCode) {
        case 'awaiting_my_action':
          return {
            code: stateCode,
            label: isRDoc ? 'Perlu Diajukan R' : 'Menunggu Tindakan Anda',
            className: 'bg-[#FBE4E4] text-[#C4554D] border border-[#F3C6C6]',
          };
        case 'awaiting_subsequent_stage':
          return {
            code: stateCode,
            label: isRDoc
              ? isFinance
                ? 'Menunggu Otorisasi Direktur'
                : 'Menunggu Notifikasi Direktur'
              : 'Menunggu Direktur',
            className: 'bg-[#E7F3F8] text-[#2E75B6] border border-[#C5DFEE]',
          };
        case 'returned_for_revision':
          return {
            code: stateCode,
            label: isRDoc ? 'Perlu Revisi & Kirim Ulang (R)' : 'Dikembalikan untuk Revisi',
            className: 'bg-[#FBF3DB] text-[#B87D1E] border border-[#EAD6A3]',
          };
        case 'already_approved':
          return {
            code: stateCode,
            label: isRDoc ? 'Selesai Disetujui (Final)' : 'Sudah Disetujui',
            className: 'bg-[#EDF3EC] text-[#3F7E59] border border-[#C7DFC5]',
          };
        case 'processed_by_others':
        default:
          return {
            code: stateCode,
            label: isRDoc
              ? isFinance
                ? 'Sedang Diverifikasi A2'
                : 'Sedang Ditinjau A1'
              : 'Diproses Pejabat Lain',
            className: 'bg-[#F4F3EF] text-[#57564F] border border-[#E3E2E0]',
          };
      }
    },
    [classifyItemUserTicketState, isRTrackingMode, currentUser?.id]
  );

  // Filter daftar dokumen berdasarkan hak akses (Role-Based Visibility & Output RACI atau R Tracking Tickets)
  const roleVisibleItems = useMemo(() => {
    if (!currentUser || !accessProfile || !accessProfile.canAccessApprovalMenu) {
      return [];
    }

    const sourceList = isRTrackingMode ? responsibleItems : hubItems;

    return sourceList.filter((item) => {
      if (item.status === 'Archived') return false;

      if (isRTrackingMode) {
        if (item.responsibleUserId !== currentUser.id) return false;
      } else {
        const isProgramDoc = item.groupType === 'program_documents';
        const isFinanceDoc = item.groupType === 'financial_documents';
        const allowedByRole =
          accessProfile.isDirector ||
          (isProgramDoc &&
            accessProfile.isA1 &&
            item.accountableProgramUserId === currentUser.id) ||
          (isFinanceDoc &&
            accessProfile.isA2 &&
            item.accountableFinanceUserId === currentUser.id) ||
          (isFinanceDoc && accessProfile.isFinance);

        if (!allowedByRole) return false;
      }

      if (selectedProgramFilterId !== 'all' && item.programId !== selectedProgramFilterId) {
        return false;
      }

      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const docLabel = DOCUMENT_TYPE_LABELS[item.categoryCode].toLowerCase();
        const matchDoc = docLabel.includes(q) || item.categoryLabel.toLowerCase().includes(q);
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchRef = item.referenceNumber.toLowerCase().includes(q);
        const matchProg = item.programName.toLowerCase().includes(q);
        const matchOutc = item.outcomeName.toLowerCase().includes(q);
        const matchOutp = item.outputName.toLowerCase().includes(q);
        const matchAct =
          item.activityName.toLowerCase().includes(q) ||
          (item.activityCode || '').toLowerCase().includes(q);
        const matchSub = item.responsibleUserName.toLowerCase().includes(q);
        if (
          !matchDoc &&
          !matchTitle &&
          !matchRef &&
          !matchProg &&
          !matchOutc &&
          !matchOutp &&
          !matchAct &&
          !matchSub
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    hubItems,
    responsibleItems,
    isRTrackingMode,
    currentUser,
    accessProfile,
    selectedProgramFilterId,
    searchQuery,
  ]);

  // Kategori tiket dokumen yang relevan untuk pengguna aktif (Dalam mode R Tracking, R melihat seluruh 6 kategori tiket dokumen yang diajukannya)
  const visibleDocumentCategories = useMemo(() => {
    if (!accessProfile || isRTrackingMode) return ALL_ACTIVITY_DOCUMENT_CATEGORIES;
    const canSeeProgram = accessProfile.isDirector || accessProfile.isA1;
    const canSeeFinance =
      accessProfile.isDirector || accessProfile.isA2 || accessProfile.isFinance;
    return ALL_ACTIVITY_DOCUMENT_CATEGORIES.filter((cat) => {
      if (cat.groupType === 'program_documents') return canSeeProgram;
      if (cat.groupType === 'financial_documents') return canSeeFinance;
      return true;
    });
  }, [accessProfile, isRTrackingMode]);

  // Pastikan activeCategoryTab selalu valid untuk role yang sedang aktif
  useEffect(() => {
    if (
      activeCategoryTab !== 'all' &&
      !visibleDocumentCategories.some((c) => c.code === activeCategoryTab)
    ) {
      setActiveCategoryTab('all');
    }
  }, [visibleDocumentCategories, activeCategoryTab]);

  // Statistik per Ticket Card pada TICKET BOARD
  const ticketBoardStats = useMemo(() => {
    const map: Record<
      string,
      {
        total: number;
        awaitingMyAction: number;
        awaitingSubsequent: number;
        processedByOthers: number;
        returnedForRevision: number;
        alreadyApproved: number;
      }
    > = {
      all: {
        total: 0,
        awaitingMyAction: 0,
        awaitingSubsequent: 0,
        processedByOthers: 0,
        returnedForRevision: 0,
        alreadyApproved: 0,
      },
    };

    for (const cat of ALL_ACTIVITY_DOCUMENT_CATEGORIES) {
      map[cat.code] = {
        total: 0,
        awaitingMyAction: 0,
        awaitingSubsequent: 0,
        processedByOthers: 0,
        returnedForRevision: 0,
        alreadyApproved: 0,
      };
    }

    const seenIds = new Set<string>();
    for (const item of roleVisibleItems) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);

      const st = classifyItemUserTicketState(item);
      const bucket = map[item.categoryCode];
      map.all.total += 1;
      if (bucket) bucket.total += 1;

      if (st === 'awaiting_my_action') {
        map.all.awaitingMyAction += 1;
        if (bucket) bucket.awaitingMyAction += 1;
      } else if (st === 'awaiting_subsequent_stage') {
        map.all.awaitingSubsequent += 1;
        if (bucket) bucket.awaitingSubsequent += 1;
      } else if (st === 'processed_by_others') {
        map.all.processedByOthers += 1;
        if (bucket) bucket.processedByOthers += 1;
      } else if (st === 'returned_for_revision') {
        map.all.returnedForRevision += 1;
        if (bucket) bucket.returnedForRevision += 1;
      } else if (st === 'already_approved') {
        map.all.alreadyApproved += 1;
        if (bucket) bucket.alreadyApproved += 1;
      }
    }

    return map;
  }, [roleVisibleItems, classifyItemUserTicketState]);

  // Dokumen sesuai filter Ticket Category
  const categoryFilteredItems = useMemo(() => {
    if (activeCategoryTab === 'all') return roleVisibleItems;
    return roleVisibleItems.filter((item) => item.categoryCode === activeCategoryTab);
  }, [roleVisibleItems, activeCategoryTab]);

  // Dokumen di dalam TICKET CONTENTS sesuai Ticket Category + 5-State Filter
  const ticketContentsItems = useMemo(() => {
    const filtered =
      activeTicketStateFilter === 'all'
        ? categoryFilteredItems
        : categoryFilteredItems.filter(
            (item) => classifyItemUserTicketState(item) === activeTicketStateFilter
          );

    const priorityMap: Record<Exclude<TicketUserStateCode, 'all'>, number> = isRTrackingMode
      ? {
          returned_for_revision: 0,
          awaiting_my_action: 1,
          processed_by_others: 2,
          awaiting_subsequent_stage: 3,
          already_approved: 4,
        }
      : {
          awaiting_my_action: 0,
          returned_for_revision: 1,
          awaiting_subsequent_stage: 2,
          processed_by_others: 3,
          already_approved: 4,
        };

    return [...filtered].sort((a, b) => {
      const pA = priorityMap[classifyItemUserTicketState(a)];
      const pB = priorityMap[classifyItemUserTicketState(b)];
      if (pA !== pB) return pA - pB;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }, [
    categoryFilteredItems,
    activeTicketStateFilter,
    classifyItemUserTicketState,
    isRTrackingMode,
  ]);

  /**
   * Membangun Struktur Hierarki:
   * Program -> Outcome -> Output -> Activity -> Approval Documents
   */
  const hierarchyTree = useMemo(() => {
    if (!currentUser || !accessProfile || !accessProfile.canAccessApprovalMenu) {
      return [];
    }

    const isOutputVisibleToUser = (output: Output): boolean => {
      if (isRTrackingMode) {
        const raci = raciMap[output.id];
        if (raci && raci.responsibleUserId === currentUser.id) return true;
        if (
          roleVisibleItems.some(
            (item) => item.outputId === output.id && item.responsibleUserId === currentUser.id
          )
        ) {
          return true;
        }
        return false;
      }

      if (accessProfile.isDirector || accessProfile.isFinance || accessProfile.isA2) {
        return true;
      }
      const raci = raciMap[output.id];
      if (accessProfile.isA1) {
        if (raci && raci.accountableUserId === currentUser.id) return true;
        if (
          roleVisibleItems.some(
            (item) =>
              item.outputId === output.id && item.accountableProgramUserId === currentUser.id
          )
        ) {
          return true;
        }
      }
      return false;
    };

    const itemsByActivityId = new Map<string, ApprovalHubItem[]>();
    const seenDocIds = new Set<string>();
    for (const item of categoryFilteredItems) {
      if (seenDocIds.has(item.id)) continue;
      seenDocIds.add(item.id);
      const list = itemsByActivityId.get(item.activityId) || [];
      list.push(item);
      itemsByActivityId.set(item.activityId, list);
    }

    const q = searchQuery.trim().toLowerCase();

    return programs
      .filter((p) => selectedProgramFilterId === 'all' || p.id === selectedProgramFilterId)
      .map((program) => {
        const progOutcomes = outcomes.filter((oc) => oc.programId === program.id);

        const outcomeNodes = progOutcomes
          .map((outcome) => {
            const outcOutputs = outputs.filter(
              (op) => op.outcomeId === outcome.id && isOutputVisibleToUser(op)
            );

            const outputNodes = outcOutputs
              .map((output) => {
                const raci = raciMap[output.id];
                const outpActivities = activities.filter((act) => act.outputId === output.id);

                const activityNodes = outpActivities
                  .map((activity) => {
                    const actItems = itemsByActivityId.get(activity.id) || [];
                    const stats = computeStatsFromUniqueItems(actItems);

                    const responsibleName =
                      raci?.responsibleUserName ||
                      actItems[0]?.responsibleUserName ||
                      output.picName ||
                      'Belum Ditugaskan';

                    const sortedActItems = [...actItems].sort((a, b) => {
                      const bucketOrder = {
                        needsApproval: 0,
                        inProgress: 1,
                        approved: 2,
                        notSubmitted: 3,
                      };
                      const diff =
                        bucketOrder[classifyDocumentBucket(a)] -
                        bucketOrder[classifyDocumentBucket(b)];
                      if (diff !== 0) return diff;
                      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
                    });

                    const primaryItem = sortedActItems[0] || null;

                    if (q) {
                      const matchActName =
                        activity.name.toLowerCase().includes(q) ||
                        (activity.code || '').toLowerCase().includes(q) ||
                        output.name.toLowerCase().includes(q) ||
                        outcome.name.toLowerCase().includes(q) ||
                        program.name.toLowerCase().includes(q) ||
                        responsibleName.toLowerCase().includes(q);
                      if (!matchActName && actItems.length === 0) {
                        return null;
                      }
                    }

                    if (activeCategoryTab !== 'all' && actItems.length === 0 && q) {
                      return null;
                    }

                    return {
                      activity,
                      output,
                      outcome,
                      program,
                      responsibleName,
                      raci,
                      items: sortedActItems,
                      primaryItem,
                      stats,
                    };
                  })
                  .filter((n): n is NonNullable<typeof n> => n !== null);

                if (activityNodes.length === 0) return null;

                const allOutputItems = activityNodes.flatMap((an) => an.items);
                const outputStats = computeStatsFromUniqueItems(allOutputItems);

                return {
                  output,
                  outcome,
                  program,
                  raci,
                  activities: activityNodes,
                  items: allOutputItems,
                  stats: outputStats,
                };
              })
              .filter((n): n is NonNullable<typeof n> => n !== null);

            if (outputNodes.length === 0) return null;

            const allOutcomeItems = outputNodes.flatMap((on) => on.items);
            const outcomeStats = computeStatsFromUniqueItems(allOutcomeItems);

            return {
              outcome,
              program,
              outputs: outputNodes,
              items: allOutcomeItems,
              stats: outcomeStats,
            };
          })
          .filter((n): n is NonNullable<typeof n> => n !== null);

        if (outcomeNodes.length === 0) return null;

        const allProgramItems = outcomeNodes.flatMap((ocn) => ocn.items);
        const programStats = computeStatsFromUniqueItems(allProgramItems);
        const totalActivitiesCount = outcomeNodes.reduce(
          (sum, ocn) =>
            sum + ocn.outputs.reduce((s2, opn) => s2 + (opn.activities || []).length, 0),
          0
        );

        return {
          program,
          outcomes: outcomeNodes,
          items: allProgramItems,
          stats: programStats,
          totalActivitiesCount,
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);
  }, [
    currentUser,
    accessProfile,
    isRTrackingMode,
    programs,
    outcomes,
    outputs,
    activities,
    raciMap,
    roleVisibleItems,
    categoryFilteredItems,
    selectedProgramFilterId,
    searchQuery,
    activeCategoryTab,
  ]);

  // Auto-expand Program, Outcome, dan Output yang memiliki dokumen "Perlu Persetujuan" saat pertama kali dimuat
  useEffect(() => {
    if (hierarchyTree.length === 0) return;
    setExpandedProgramIds((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, boolean> = {};
      hierarchyTree.forEach((pNode, idx) => {
        if (pNode.stats.needsApprovalCount > 0 || idx === 0) {
          next[pNode.program.id] = true;
        }
      });
      return next;
    });

    setExpandedOutcomeIds((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, boolean> = {};
      hierarchyTree.forEach((pNode) => {
        pNode.outcomes.forEach((ocNode) => {
          if (ocNode.stats.needsApprovalCount > 0) {
            next[ocNode.outcome.id] = true;
          }
        });
      });
      return next;
    });

    setExpandedOutputIds((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, boolean> = {};
      hierarchyTree.forEach((pNode) => {
        pNode.outcomes.forEach((ocNode) => {
          ocNode.outputs.forEach((opNode) => {
            if (opNode.stats.needsApprovalCount > 0) {
              next[opNode.output.id] = true;
            }
          });
        });
      });
      return next;
    });
  }, [hierarchyTree]);

  const globalStats = useMemo(() => {
    const allItems = hierarchyTree.flatMap((p) => p.items);
    return computeStatsFromUniqueItems(allItems);
  }, [hierarchyTree]);

  // Temukan node Activity yang sedang dipilih (untuk Halaman Detail Activity — Bagian 6)
  const selectedActivityNode = useMemo(() => {
    if (!selectedActivityId) return null;
    for (const pNode of hierarchyTree) {
      for (const ocNode of pNode.outcomes) {
        for (const opNode of ocNode.outputs) {
          for (const actNode of opNode.activities) {
            if (actNode.activity.id === selectedActivityId) {
              return actNode;
            }
          }
        }
      }
    }
    return null;
  }, [hierarchyTree, selectedActivityId]);

  const selectedItem = useMemo(
    () =>
      roleVisibleItems.find((i) => i.id === selectedItemId) ||
      responsibleItems.find((i) => i.id === selectedItemId) ||
      hubItems.find((i) => i.id === selectedItemId) ||
      null,
    [roleVisibleItems, responsibleItems, hubItems, selectedItemId]
  );

  // Buka langsung sumber fungsi informasi dokumen (bukan tab tahapan penuh)
  const handleOpenSourceDocumentEditor = (
    item: ApprovalHubItem,
    autoOpenEdit: boolean = false
  ) => {
    const stageMap: Record<ApprovalCategoryCode, number> = {
      tor: 1,
      cash_advance: 2,
      notulen: 4,
      dokumentasi: 5,
      executive_summary: 6,
      laporan_keuangan_akhir: 8,
    };
    onSelectTor(item.sourceTorId, stageMap[item.categoryCode] || 1, {
      targetEntityId: item.sourceCashAdvanceId || item.sourceEntityId,
      focusedSourceMode: true,
      autoOpenEdit,
    });
  };

  const getSortedAuditTimeline = useCallback((item: ApprovalHubItem) => {
    return [...(item.timeline || [])]
      .map((ev, idx) => ({ ev, idx }))
      .sort((a, b) => {
        const timeDiff =
          new Date(b.ev.timestamp).getTime() - new Date(a.ev.timestamp).getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.idx - a.idx;
      })
      .map((entry) => entry.ev);
  }, []);

  // Eksekusi keputusan persetujuan atau tindakan R (memperbarui dokumen sumber & workflow secara otomatis)
  const handleExecuteAction = async (
    item: ApprovalHubItem,
    action:
      | 'submit'
      | 'create_new_version'
      | 'verify_approve'
      | 'report_to_director'
      | 'director_final_approve'
      | 'revision'
      | 'reject'
      | 'comment'
      | 'request_edit'
      | 'approve_edit_request'
      | 'reject_edit_request',
    openEditorAfterRevision: boolean = false,
    customComment?: string
  ) => {
    if (!currentUser) return;
    const effectiveComment = (
      customComment !== undefined
        ? customComment
        : selectedItemId === item.id && commentInput.trim()
        ? commentInput
        : inlineComments[item.id] || commentInput
    ).trim();

    if (
      (action === 'revision' || action === 'reject' || action === 'request_edit') &&
      !effectiveComment
    ) {
      showToast(
        'error',
        action === 'request_edit'
          ? 'Mohon tuliskan alasan permintaan edit dokumen ToR pada kolom komentar terlebih dahulu.'
          : 'Mohon tuliskan catatan alasan revisi atau penolakan pada kolom komentar terlebih dahulu.'
      );
      return;
    }

    setActionLoading(true);
    try {
      const res = await api.executeApprovalHubAction(item.id, {
        action,
        comment:
          effectiveComment ||
          (action === 'create_new_version'
            ? `R (${currentUser.name}) mengunggah & mengajukan ulang dokumen versi revisi v${
                (item.version || 1) + 1
              } melalui Tracking Ticket.`
            : action === 'submit'
            ? `R (${currentUser.name}) mengajukan dokumen melalui Tracking Ticket.`
            : undefined),
      });
      setCommentInput('');
      setInlineComments((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await loadApprovalHub(true);
      if (onRefreshGlobalData) {
        onRefreshGlobalData();
      }
      if (action === 'revision') {
        showToast(
          'success',
          'Permintaan revisi disimpan ke Audit Trail. Dokumen kini langsung terbuka untuk diedit oleh R.'
        );
        if (openEditorAfterRevision) {
          handleOpenSourceDocumentEditor(item, true);
        }
      } else if (action === 'create_new_version' || action === 'submit') {
        showToast(
          'success',
          res.message ||
            'Dokumen hasil revisi berhasil diajukan ulang dan otomatis masuk ke antrean pemeriksa.'
        );
      } else {
        showToast('success', res.message || 'Tindakan berhasil disimpan ke Audit Trail.');
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Gagal memproses tindakan persetujuan.');
    } finally {
      setActionLoading(false);
    }
  };

  // Eksekusi pencairan dana Cash Advance oleh Finance (setelah disetujui Direktur) & kirim notifikasi ke pengaju
  const handleDisburseCashAdvanceFromHub = async (
    item: ApprovalHubItem,
    customTransferRef?: string
  ) => {
    if (!currentUser) return;
    const caId = item.sourceCashAdvanceId || item.sourceEntityId;
    if (!caId) return;

    const rawNote = (
      customTransferRef !== undefined
        ? customTransferRef
        : selectedItemId === item.id && commentInput.trim()
        ? commentInput
        : inlineComments[item.id] || ''
    ).trim();

    setActionLoading(true);
    try {
      await api.disburseCashAdvance(
        caId,
        rawNote || `TRF-WIJNA-${Date.now().toString().slice(-6)}`,
        'Bank Mandiri Operasional Yayasan'
      );
      setCommentInput('');
      setInlineComments((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await loadApprovalHub(true);
      if (onRefreshGlobalData) {
        onRefreshGlobalData();
      }
      showToast(
        'success',
        `Dana Cash Advance ${item.referenceNumber} berhasil dicairkan ke rekening pengaju (${item.responsibleUserName}) dan notifikasi telah dikirim.`
      );
    } catch (err: any) {
      showToast('error', err?.message || 'Gagal mencairkan dana Cash Advance.');
    } finally {
      setActionLoading(false);
    }
  };

  // Pilih kategori dari tombol + Pengajuan Baru
  const handleSelectNewDocumentType = (
    code: ApprovalCategoryCode,
    label: string,
    stage: number
  ) => {
    setShowNewMenu(false);
    if (code === 'tor') {
      if (onCreateTor) {
        onCreateTor();
      }
      return;
    }
    setPendingNewDocCategory({ code, label, stage });
  };

  // ============================================================================
  // PEMBATASAN AKSES HALAMAN (KHUSUS ADMIN KONFIGURASI SISTEM)
  // ============================================================================
  if (!loading && (!accessProfile || !accessProfile.canAccessApprovalMenu)) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-[#2F3437]">
        <div className="p-6 rounded-lg border border-[#E3E2E0] bg-white space-y-4">
          <div className="flex items-center gap-2.5 text-[#2F3437]">
            <ShieldAlert className="w-5 h-5 text-[#D9730D]" />
            <h1 className="text-base font-bold">Hak Akses Approval &amp; Tracking Ticket Dibatasi</h1>
          </div>
          <p className="text-xs text-[#57564F] leading-relaxed">
            <strong>Approval Center &amp; Tracking Ticket</strong> dirancang untuk{' '}
            <strong>R – Responsible</strong> (melacak perjalanan tiket dokumen yang diajukan),{' '}
            <strong>A1 – Accountable Program</strong>, <strong>A2 – Accountable Finance</strong>,{' '}
            <strong>Direktur</strong>, dan <strong>Finance</strong> berdasarkan penugasan RACI
            Output yang aktif.
          </p>
          <div className="p-3 rounded bg-[#FAF9F6] border border-[#EAEAEA] text-xs text-[#57564F] space-y-1">
            <div>
              • <strong>Admin:</strong> Mengatur konfigurasi akun dan akses melalui menu{' '}
              <strong>Kelola Pengguna</strong> tanpa kewenangan persetujuan operasional.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // BLOCK 4: DOCUMENT DETAIL (POP-UP MODAL)
  // Mencakup 4 Komponen Utama:
  // 1. Document Preview
  // 2. Discussion Pop-up (Shared Discussion & Role-Based Actions: Approver vs R Tracking)
  // 3. Approval Workflow & Approval Journey Visibility (R → A1/A2 → Direktur)
  // 4. Audit Trail & Riwayat Versi Dokumen (Terbaru di Atas)
  // ============================================================================
  const renderDocumentPopupModal = () => {
    if (!selectedItem) return null;

    const statusInfo = getSimpleStatusDisplay(selectedItem);
    const userStateBadge = getTicketUserStateBadge(selectedItem);
    const overdue = isItemOverdue(selectedItem);
    const auth = getUserDocumentAuthority(selectedItem);
    const journey = getApprovalJourneyDetails(selectedItem);
    const isROwner = Boolean(
      currentUser && selectedItem.responsibleUserId === currentUser.id
    );
    const showRTrackingActions = isROwner || isRTrackingMode;
    const activeStep: ApprovalWorkflowStep | undefined = selectedItem.steps.find(
      (s) => s.status === 'Sedang Berjalan'
    );
    const isRevisionUnlocked =
      selectedItem.status === 'Revision Required' || selectedItem.status === 'Rejected';
    const canResubmitByR =
      isROwner &&
      (selectedItem.status === 'Revision Required' ||
        selectedItem.status === 'Rejected' ||
        selectedItem.status === 'Draft');
    const sortedTimeline = getSortedAuditTimeline(selectedItem);
    const matchedTor =
      tors.find(
        (t) => t.id === selectedItem.sourceTorId || t.activityId === selectedItem.activityId
      ) || null;

    return (
      <div
        className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150"
        onClick={() => {
          setSelectedItemId(null);
          setCommentInput('');
        }}
      >
        <div
          className="bg-white rounded-xl border border-[#DCDAD5] shadow-2xl w-full max-w-6xl h-[90vh] max-h-[92vh] flex flex-col overflow-hidden text-[#2F3437]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Notifikasi Toast di dalam Pop-up (Hanya muncul bila ada feedback aksi) */}
          {feedbackToast && (
            <div
              className={`px-4 py-2 border-b flex items-center justify-between text-xs font-medium shrink-0 ${
                feedbackToast.type === 'success'
                  ? 'bg-[#EDF3EC] border-[#C7DFC5] text-[#1C3829]'
                  : 'bg-[#FBE4E4] border-[#F3C6C6] text-[#9E2A2B]'
              }`}
            >
              <div className="flex items-center gap-2">
                {feedbackToast.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#3F7E59]" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#C4554D]" />
                )}
                <span>{feedbackToast.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackToast(null)}
                className="text-[11px] underline opacity-75 hover:opacity-100 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          )}

          {/* Body Pop-up 2 Kolom Penuh Sampai Atas:
              Kiri (7/12) = Compact Meta Bar + Document Preview + Approval Journey
              Kanan (5/12) = Kolom Chat & Audit Trail Penuh dari Atas sampai Bawah */}
          <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden">
            {/* ==============================================================
                KOLOM KIRI (7/12): BAR META RINGKAS (TANPA JUDUL PANJANG) & PREVIEW DOKUMEN
               ============================================================== */}
            <div className="lg:col-span-7 flex flex-col min-h-0 overflow-hidden border-b lg:border-b-0 lg:border-r border-[#E6E5E2] bg-white">
              {/* Header Ringkas & Proporsional Kolom Kiri (Gambar 5: Hide dulu supaya Preview mudah, dilengkapi tombol Show/Hide Detail) */}
              <div className="px-4 py-2 border-b border-[#E6E5E2] bg-[#FAF9F6] shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-[#787774] flex-wrap min-w-0">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#E7F3F8] border border-[#C5DFEE] text-[#2E75B6] text-[10px] font-bold uppercase tracking-wider">
                      <Ticket className="w-3 h-3" />
                      <span>
                        {showRTrackingActions ? 'R TRACKING TICKET' : 'DOCUMENT DETAIL'}
                      </span>
                    </span>
                    <span className="font-bold text-[#2F3437]">
                      {DOCUMENT_TYPE_LABELS[selectedItem.categoryCode]}
                    </span>
                    <span>·</span>
                    <span className="font-mono text-[#2E75B6] font-semibold">
                      {selectedItem.referenceNumber}
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-white border border-[#E3E2E0] font-mono text-[10px] font-semibold text-[#2F3437]">
                      v{selectedItem.version || 1}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${statusInfo.badgeStyle}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotColor}`} />
                      {statusInfo.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowDocDetailMeta((prev) => !prev)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F4F3EF] text-[11px] font-medium text-[#57564F] transition-colors cursor-pointer"
                      title="Tampilkan atau sembunyikan detail metadata dokumen agar area preview lebih lega"
                    >
                      <span>{showDocDetailMeta ? 'Hide Detail' : 'Show Detail'}</span>
                      {showDocDetailMeta ? (
                        <ChevronUp className="w-3 h-3 text-[#787774]" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-[#787774]" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenSourceDocumentEditor(selectedItem, isRevisionUnlocked)
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F4F3EF] text-[11px] font-medium text-[#2F3437] transition-colors cursor-pointer"
                      title="Buka halaman sumber fungsi informasi dokumen ini"
                    >
                      <ExternalLink className="w-3 h-3 text-[#787774]" />
                      <span>Buka Dokumen Asli</span>
                    </button>
                  </div>
                </div>

                {/* Detail Metadata Proporsional (Default tersembunyi agar Preview mudah dibaca) */}
                {showDocDetailMeta && (
                  <div className="mt-2 pt-2 border-t border-[#ECEBE8] grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#57564F]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${userStateBadge.className}`}
                      >
                        {userStateBadge.label}
                      </span>
                      {overdue && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#FBE4E4] text-[#C4554D] border border-[#F3C6C6]">
                          <AlertCircle className="w-3 h-3" />
                          Lewat Tenggat ({formatShortDate(selectedItem.dueDate)})
                        </span>
                      )}
                      <span className="text-[#787774]">
                        Diajukan {formatShortDate(selectedItem.submittedAt)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center sm:justify-end gap-1.5">
                      <span className="text-[#787774]">Pemegang:</span>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                          journey.holderBadgeTone === 'amber'
                            ? 'bg-[#FBF3DB] text-[#B87D1E] border border-[#EAD6A3]'
                            : journey.holderBadgeTone === 'rose'
                            ? 'bg-[#FBE4E4] text-[#C4554D] border border-[#F3C6C6]'
                            : journey.holderBadgeTone === 'green'
                            ? 'bg-[#EDF3EC] text-[#3F7E59] border border-[#C7DFC5]'
                            : 'bg-[#E7F3F8] text-[#2E75B6] border border-[#C5DFEE]'
                        }`}
                      >
                        <UserCheck className="w-3 h-3" />
                        <span>
                          {journey.currentHolderName} ({journey.currentHolderRole})
                        </span>
                      </span>
                      <span className="text-[#9B9A97]">·</span>
                      <span>
                        Diterima:{' '}
                        <strong className="text-[#2F3437]">
                          {formatShortDate(journey.currentHolderReceivedAt)}
                        </strong>
                      </span>
                    </div>

                    <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-1 border-t border-dashed border-[#E6E5E2]">
                      <span className="text-[#787774]">Status Akhir:</span>
                      <strong className="text-[#2F3437]">{journey.finalApprovalStatusLabel}</strong>
                    </div>
                  </div>
                )}
              </div>

              {/* Area Konten Dokumen & Journey (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Banner Permintaan Revisi (Jika Dokumen Diminta Revisi / Ditolak) */}
                {journey.latestRevisionEvent &&
                  (selectedItem.status === 'Revision Required' ||
                    selectedItem.status === 'Rejected') && (
                    <div className="p-3 rounded-xl border border-[#EAD6A3] bg-[#FCF8EC] space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#B87D1E]">
                          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Permintaan Revisi dari {journey.latestRevisionEvent.actorName} (
                            {journey.latestRevisionEvent.actorRoleCode})
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-[#B87D1E]">
                          {formatDateTime(journey.latestRevisionEvent.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-[#57564F] bg-white/90 p-2 rounded-lg border border-[#EAD6A3] italic">
                        &ldquo;{journey.latestRevisionEvent.comment}&rdquo;
                      </p>
                      {isROwner && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleOpenSourceDocumentEditor(selectedItem, true)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-[#FBF3DB] text-[#B87D1E] border border-[#EAD6A3] text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>1. Buka &amp; Perbaiki Dokumen Asli</span>
                          </button>
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() =>
                              handleExecuteAction(selectedItem, 'create_new_version')
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#2E75B6] hover:bg-[#235B8E] text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>
                              2. Ajukan Ulang Versi Revisi (v{(selectedItem.version || 1) + 1})
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                {/* Banner Request Edit Dokumen ToR (Terintegrasi di Approval ToR) */}
                {selectedItem.categoryCode === 'tor' &&
                  selectedItem.previewData?.editRequestStatus === 'pending' && (
                    <div className="p-3 rounded-xl border border-[#EAD6A3] bg-[#FCF8EC] space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#B87D1E]">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Request Edit Dokumen ToR — Menunggu Keputusan Direktur di Approval ToR
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-[#B87D1E]">
                          {formatDateTime(selectedItem.previewData?.editRequestedAt)}
                        </span>
                      </div>
                      <p className="text-xs text-[#57564F]">
                        Diajukan oleh{' '}
                        <strong>
                          {selectedItem.previewData?.editRequestedByName ||
                            selectedItem.responsibleUserName}
                        </strong>{' '}
                        ({selectedItem.previewData?.editRequestedByRole || 'R – Responsible'})
                      </p>
                      <p className="text-xs text-[#2F3437] bg-white/90 p-2 rounded-lg border border-[#EAD6A3] italic">
                        &ldquo;{selectedItem.previewData?.editRequestReason}&rdquo;
                      </p>
                      {auth.canApproveTorEditRequest && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() =>
                              handleExecuteAction(selectedItem, 'approve_edit_request')
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3F7E59] hover:bg-[#336849] text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>ACC Edit ToR (Buka Kunci Edit)</span>
                          </button>
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() =>
                              handleExecuteAction(
                                selectedItem,
                                'reject_edit_request',
                                false,
                                commentInput.trim() ||
                                  'Permintaan edit dokumen ToR ditolak oleh Direktur.'
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#F3C6C6] bg-[#FBE4E4] hover:bg-[#F7D4D4] text-[#C4554D] text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Tolak Request Edit</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                {selectedItem.categoryCode === 'tor' &&
                  selectedItem.previewData?.editRequestStatus === 'approved' && (
                    <div className="p-3 rounded-xl border border-[#C5DFEE] bg-[#F2F8FC] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5">
                        <div className="font-bold text-[#2E75B6]">
                          Akses Edit Dokumen ToR Telah Di-ACC oleh Direktur (
                          {selectedItem.previewData?.editReviewedByName ||
                            selectedItem.directorUserName}
                          )
                        </div>
                        <p className="text-[#57564F]">
                          {selectedItem.previewData?.editReviewComment ||
                            'Dokumen ToR kini terbuka untuk diperbarui oleh R.'}
                        </p>
                      </div>
                      {isROwner && (
                        <button
                          type="button"
                          onClick={() => handleOpenSourceDocumentEditor(selectedItem, true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2E75B6] hover:bg-[#235B8E] text-white text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Buka &amp; Edit Dokumen ToR</span>
                        </button>
                      )}
                    </div>
                  )}

                {/* 1. HALAMAN PREVIEW DOKUMEN RESMI */}
                <OfficialDocumentPreviewPane
                  item={selectedItem}
                  tor={matchedTor}
                  isRevisionUnlocked={isRevisionUnlocked}
                  onOpenSourcePage={(openEditor) =>
                    handleOpenSourceDocumentEditor(selectedItem, Boolean(openEditor))
                  }
                />

                {/* 2. APPROVAL JOURNEY VISIBILITY (R → A1/A2 → DIREKTUR) */}
                <div className="p-3.5 rounded-xl border border-[#E6E5E2] bg-[#FAF9F6] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E6E5E2]">
                    <div>
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#2F3437]">
                        Approval Journey ({journey.flowFormula})
                      </h3>
                      <p className="text-[11px] text-[#787774] mt-0.5">
                        Status Saat Ini:{' '}
                        <strong className="text-[#2F3437]">{journey.currentStageLabel}</strong>
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-white border border-[#E3E2E0] text-[10px] font-mono font-semibold text-[#2F3437]">
                      {selectedItem.groupType === 'program_documents'
                        ? 'Dokumen Program (R → A1 → Direktur)'
                        : 'Dokumen Keuangan (R → A2 → Direktur)'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {journey.journeyStages.map((stg) => {
                      const isDone = stg.status === 'Selesai';
                      const isActive = stg.status === 'Sedang Berjalan' || stg.isCurrentHolder;
                      const isRev = stg.status === 'Perlu Revisi' || stg.status === 'Ditolak';

                      return (
                        <div
                          key={stg.stepNumber}
                          className={`p-2.5 rounded-xl border text-xs flex flex-col justify-between gap-1.5 ${
                            isActive
                              ? 'border-[#C5DFEE] bg-[#F2F8FC] shadow-2xs'
                              : isDone
                              ? 'border-[#C7DFC5] bg-[#F4F9F3]'
                              : isRev
                              ? 'border-[#EAD6A3] bg-[#FCF8EC]'
                              : 'border-[#E6E5E2] bg-white'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white border border-[#E3E2E0] text-[#2F3437]">
                                {stg.stepNumber} · {stg.code}
                              </span>
                              {stg.isCurrentHolder && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#E7F3F8] text-[#2E75B6]">
                                  Pemegang Saat Ini
                                </span>
                              )}
                            </div>

                            <div className="font-bold text-[#2F3437] mt-1.5 leading-snug">
                              {stg.stageTitle}
                            </div>

                            <div className="text-[11px] font-semibold text-[#2F3437] mt-0.5">
                              {stg.personName}
                            </div>
                            <div className="text-[10px] text-[#787774]">{stg.personRole}</div>
                          </div>

                          <div className="pt-1.5 border-t border-[#E6E5E2] space-y-0.5 text-[10px]">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[#787774]">Progres:</span>
                              <span
                                className={`font-semibold ${
                                  isDone
                                    ? 'text-[#3F7E59]'
                                    : isRev
                                    ? 'text-[#B87D1E]'
                                    : isActive
                                    ? 'text-[#2E75B6]'
                                    : 'text-[#787774]'
                                }`}
                              >
                                {stg.progressText}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[#787774]">Diterima Pemeriksa:</span>
                              <span className="font-mono font-medium text-[#2F3437]">
                                {stg.receivedAt ? formatShortDate(stg.receivedAt) : 'Menunggu'}
                              </span>
                            </div>
                            {stg.actedAt && isDone && (
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[#787774]">Diselesaikan:</span>
                                <span className="font-mono font-medium text-[#3F7E59]">
                                  {formatShortDate(stg.actedAt)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Informasi Program / Outcome / Output / Activity & Penugasan RACI Output */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl border border-[#E6E5E2] bg-[#FAF9F6]">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#787774] mb-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Hierarki Program → Outcome → Output → Activity</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="text-[#787774] shrink-0">Program</span>
                        <span className="font-medium text-[#2F3437] text-right">
                          {selectedItem.programName}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-[#787774] shrink-0">Outcome</span>
                        <span className="font-medium text-[#2F3437] text-right">
                          {selectedItem.outcomeName}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-[#787774] shrink-0">Output</span>
                        <span className="font-medium text-[#2F3437] text-right">
                          {selectedItem.outputName}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 pt-1 border-t border-[#E6E5E2]">
                        <span className="text-[#787774] shrink-0">Activity</span>
                        <span className="font-semibold text-[#2F3437] text-right">
                          {selectedItem.activityCode ? `${selectedItem.activityCode} · ` : ''}
                          {selectedItem.activityName}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-[#E6E5E2] bg-[#FAF9F6]">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#787774] mb-1.5">
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Penugasan RACI &amp; Riwayat Versi Dokumen</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#787774]">R (Responsible / Pengaju)</span>
                        <span className="font-semibold text-[#2F3437]">
                          {selectedItem.responsibleUserName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#787774]">A1 (Program Review)</span>
                        <span className="font-medium text-[#2F3437]">
                          {selectedItem.accountableProgramUserName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#787774]">A2 (Financial Verification)</span>
                        <span className="font-medium text-[#2F3437]">
                          {selectedItem.accountableFinanceUserName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#787774]">Direktur</span>
                        <span className="font-semibold text-[#2F3437]">
                          {selectedItem.directorUserName}
                        </span>
                      </div>
                      <div className="pt-1 border-t border-[#E6E5E2] flex items-center justify-between gap-2">
                        <span className="text-[#787774]">Riwayat Versi</span>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {journey.versionHistory.map((vh) => (
                            <span
                              key={vh.version}
                              className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border ${
                                vh.version === (selectedItem.version || 1)
                                  ? 'bg-[#E7F3F8] text-[#2E75B6] border-[#C5DFEE]'
                                  : 'bg-white text-[#787774] border-[#E3E2E0]'
                              }`}
                              title={`Versi v${vh.version} · ${formatShortDate(vh.submittedAt)} — ${vh.statusLabel}`}
                            >
                              v{vh.version} ({formatShortDate(vh.submittedAt)})
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ==============================================================
                KOLOM KANAN (5/12): INTERACTIVE CHAT & COMPACT AUDIT TRAIL
                - Memanjang penuh sampai atas modal (tanpa ruang kosong di atas)
               ============================================================== */}
            <div className="lg:col-span-5 flex flex-col bg-[#FAF9F6] min-h-0 overflow-hidden">
              {/* 1. HEADER KOLOM CHAT & AUDIT TRAIL (BERADA DI PALING ATAS MODAL + TOMBOL TUTUP) */}
              <div className="px-4 py-2.5 bg-white border-b border-[#E6E5E2] flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-[#E7F3F8] border border-[#C5DFEE] text-[#2E75B6] flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#2F3437] truncate">
                        Diskusi &amp; Audit Trail
                      </h3>
                      <span className="px-1.5 py-0.2 rounded bg-[#F4F3EF] border border-[#E3E2E0] font-mono text-[10px] font-semibold text-[#57564F]">
                        {sortedTimeline.length}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#787774] truncate">
                      {activeStep
                        ? `Pemegang: ${activeStep.assignedUserName} (${activeStep.roleCode})`
                        : isRevisionUnlocked
                        ? 'Menunggu perbaikan & pengajuan ulang oleh R'
                        : 'Seluruh tahap persetujuan selesai'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#F4F3EF] border border-[#E3E2E0] text-[#57564F]">
                    {showRTrackingActions
                      ? 'R – Responsible'
                      : auth.authorityLabel.split('·')[0].trim()}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemId(null);
                      setCommentInput('');
                    }}
                    className="inline-flex items-center justify-center px-2 py-1 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#FBE4E4] hover:text-[#C4554D] hover:border-[#F3C6C6] text-[11px] font-semibold text-[#57564F] transition-colors cursor-pointer"
                    title="Tutup Pop-up"
                  >
                    ✕ Tutup
                  </button>
                </div>
              </div>

              {/* 2. BAR KEPUTUSAN CEPAT (Hanya muncul proporsional jika ada tindakan persetujuan / revisi / pencairan dana / request edit ToR) */}
              {(auth.canVerifyApproveA1 ||
                auth.canVerifyA2 ||
                auth.canDirectorFinalApprove ||
                auth.canDirectorReceiveReport ||
                auth.canApproveTorEditRequest ||
                auth.canRejectTorEditRequest ||
                auth.canReturnForRevision ||
                auth.canReject ||
                auth.canDisburseCashAdvance ||
                (showRTrackingActions &&
                  (canResubmitByR ||
                    (selectedItem.categoryCode === 'tor' &&
                      selectedItem.status === 'Reported to Director')))) && (
                <div className="px-3.5 py-2 bg-[#FCFCFA] border-b border-[#E6E5E2] flex flex-wrap items-center justify-between gap-1.5 shrink-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#787774]">
                    {auth.canApproveTorEditRequest
                      ? 'Keputusan Request Edit ToR (Direktur):'
                      : showRTrackingActions && canResubmitByR
                      ? 'Tindakan Revisi R:'
                      : showRTrackingActions &&
                        selectedItem.categoryCode === 'tor' &&
                        selectedItem.status === 'Reported to Director'
                      ? 'Akses Edit ToR (R):'
                      : auth.canDisburseCashAdvance
                      ? 'Tindak Lanjut Finance (Setelah Disetujui Direktur):'
                      : 'Keputusan Pemeriksa:'}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {showRTrackingActions && canResubmitByR ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenSourceDocumentEditor(selectedItem, true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#EAD6A3] bg-[#FBF3DB] hover:bg-[#F5E7C1] text-[#B87D1E] text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit Revisi</span>
                        </button>
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() =>
                            handleExecuteAction(
                              selectedItem,
                              selectedItem.status === 'Draft' ? 'submit' : 'create_new_version'
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#3F7E59] hover:bg-[#336849] text-white text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>
                            {selectedItem.status === 'Draft'
                              ? 'Ajukan'
                              : `Kirim Ulang (v${(selectedItem.version || 1) + 1})`}
                          </span>
                        </button>
                      </>
                    ) : showRTrackingActions &&
                      selectedItem.categoryCode === 'tor' &&
                      selectedItem.status === 'Reported to Director' ? (
                      selectedItem.previewData?.editRequestStatus === 'approved' ? (
                        <button
                          type="button"
                          onClick={() => handleOpenSourceDocumentEditor(selectedItem, true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2E75B6] hover:bg-[#235B8E] text-white text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Buka &amp; Edit ToR (Telah Di-ACC Direktur)</span>
                        </button>
                      ) : selectedItem.previewData?.editRequestStatus === 'pending' ? (
                        <span className="px-2 py-0.5 rounded bg-[#FBF3DB] border border-[#EAD6A3] text-[#B87D1E] text-[11px] font-semibold">
                          Menunggu ACC Edit Direktur
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={actionLoading}
                          onClick={() => handleExecuteAction(selectedItem, 'request_edit')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#EAD6A3] bg-[#FBF3DB] hover:bg-[#F5E7C1] text-[#B87D1E] text-[11px] font-semibold transition-colors cursor-pointer"
                          title="Tulis alasan edit di kolom chat bawah lalu klik tombol ini untuk mengajukan Request Edit ke Direktur"
                        >
                          <Lock className="w-3 h-3" />
                          <span>Ajukan Request Edit ke Direktur</span>
                        </button>
                      )
                    ) : (
                      <>
                        {auth.canApproveTorEditRequest && (
                          <>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() =>
                                handleExecuteAction(selectedItem, 'approve_edit_request')
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#3F7E59] hover:bg-[#336849] text-white text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                              title="Setujui (ACC) permintaan akses edit dokumen ToR"
                            >
                              <Check className="w-3 h-3" />
                              <span>ACC Edit ToR</span>
                            </button>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() =>
                                handleExecuteAction(
                                  selectedItem,
                                  'reject_edit_request',
                                  false,
                                  commentInput.trim() ||
                                    'Permintaan edit dokumen ToR ditolak oleh Direktur.'
                                )
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#F3C6C6] bg-[#FBE4E4] hover:bg-[#F7D4D4] text-[#C4554D] text-[11px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                              title="Tolak permintaan akses edit dokumen ToR"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>Tolak Request Edit</span>
                            </button>
                          </>
                        )}

                        {auth.canDisburseCashAdvance && (
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleDisburseCashAdvanceFromHub(selectedItem)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0F7B6C] hover:bg-[#0b6256] text-white text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                            title="Cairkan dana ke rekening pengaju & kirim notifikasi"
                          >
                            <Wallet className="w-3 h-3" />
                            <span>Cairkan Dana ke Pengaju &amp; Kirim Notifikasi</span>
                          </button>
                        )}

                        {(auth.canVerifyApproveA1 ||
                          auth.canVerifyA2 ||
                          auth.canDirectorFinalApprove ||
                          auth.canDirectorReceiveReport) && (
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => {
                              const actType = auth.canDirectorFinalApprove
                                ? 'director_final_approve'
                                : auth.canDirectorReceiveReport
                                ? 'report_to_director'
                                : 'verify_approve';
                              handleExecuteAction(selectedItem, actType);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#3F7E59] hover:bg-[#336849] text-white text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>
                              {auth.canVerifyApproveA1
                                ? 'ACC (A1)'
                                : auth.canVerifyA2
                                ? 'ACC (A2)'
                                : auth.canDirectorFinalApprove
                                ? 'ACC Direktur'
                                : accessProfile?.isDirector
                                ? 'Terima Laporan'
                                : 'Laporkan ke Direktur'}
                            </span>
                          </button>
                        )}

                        {auth.canReturnForRevision && (
                          <>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleExecuteAction(selectedItem, 'revision', false)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#EAD6A3] bg-[#FBF3DB] hover:bg-[#F5E7C1] text-[#B87D1E] text-[11px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                              title="Kembalikan untuk revisi beserta komentar di bawah"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Revisi</span>
                            </button>
                            <button
                              type="button"
                              disabled={actionLoading}
                              onClick={() => handleExecuteAction(selectedItem, 'revision', true)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#2F3437] hover:bg-[#1f2325] text-white text-[11px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Revisi &amp; Edit</span>
                            </button>
                          </>
                        )}

                        {auth.canReject && (
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => handleExecuteAction(selectedItem, 'reject')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#F3C6C6] bg-[#FBE4E4] hover:bg-[#F7D4D4] text-[#C4554D] text-[11px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <XCircle className="w-3 h-3" />
                            <span>Tolak</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* 3. STREAM FEED DISKUSI & AUDIT TRAIL (COMPACT CHAT BUBBLES) */}
              <div className="px-3.5 py-3 flex-1 overflow-y-auto space-y-2">
                {sortedTimeline.length > 0 ? (
                  sortedTimeline.map((ev, index) => {
                    const isMe = currentUser?.id === ev.actorId;
                    const isRevEvent =
                      ev.resultingStatus === 'Revision Required' ||
                      ev.resultingStatus === 'Rejected';
                    const isApproveEvent =
                      ev.actionLabel.toLowerCase().includes('menyetujui') ||
                      ev.actionLabel.toLowerCase().includes('memverifikasi') ||
                      ev.actionLabel.toLowerCase().includes('otorisasi') ||
                      ev.actionLabel.toLowerCase().includes('mencairkan') ||
                      ev.actionLabel.toLowerCase().includes('menerima laporan');

                    const initials = (ev.actorName || 'U')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase())
                      .join('');

                    const avatarTone =
                      ev.actorRoleCode === 'R'
                        ? 'bg-[#E7F3F8] text-[#2E75B6] border-[#C5DFEE]'
                        : ev.actorRoleCode === 'Direktur'
                        ? 'bg-[#F4F0F7] text-[#7D5BA6] border-[#DFD4E8]'
                        : 'bg-[#EDF3EC] text-[#3F7E59] border-[#C7DFC5]';

                    const bubbleStyle = isRevEvent
                      ? 'bg-[#FCF8EC] border-[#EAD6A3]'
                      : isApproveEvent
                      ? 'bg-[#F4F9F3] border-[#CEE3CC]'
                      : isMe
                      ? 'bg-[#F2F8FC] border-[#CDE3F0]'
                      : 'bg-white border-[#E6E5E2]';

                    return (
                      <div key={ev.id} className="flex items-start gap-2.5 group/msg">
                        {/* Avatar Inisial Ringkas */}
                        <div
                          className={`w-6 h-6 rounded-full border text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 ${avatarTone}`}
                          title={`${ev.actorName} (${ev.actorRoleCode})`}
                        >
                          {initials}
                        </div>

                        {/* Gelembung Chat & Audit Ringkas */}
                        <div
                          className={`flex-1 min-w-0 px-3 py-2 rounded-xl border text-xs transition-colors ${bubbleStyle}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                              <span className="font-bold text-[#2F3437] truncate">
                                {ev.actorName}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-white/80 border border-[#E3E2E0] text-[9px] font-mono font-semibold text-[#57564F]">
                                {ev.actorRoleCode}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-[#E7F3F8] border border-[#C5DFEE] text-[9px] font-mono font-semibold text-[#2E75B6]">
                                v{ev.version || 1}
                              </span>
                              {index === 0 && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-[#EDF3EC] text-[#3F7E59] border border-[#C7DFC5]">
                                  Terbaru
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setCommentInput((prev) =>
                                    prev.includes(`@${ev.actorName.split(',')[0]}`)
                                      ? prev
                                      : `@${ev.actorName.split(',')[0]} ${prev}`
                                  )
                                }
                                className="opacity-0 group-hover/msg:opacity-100 text-[10px] font-medium text-[#2E75B6] hover:underline transition-opacity cursor-pointer"
                                title="Balas pesan ini"
                              >
                                Balas
                              </button>
                              <span className="text-[10px] font-mono text-[#787774] whitespace-nowrap">
                                {formatDateTime(ev.timestamp)}
                              </span>
                            </div>
                          </div>

                          <div className="mt-1 text-[11px] leading-relaxed text-[#2F3437]">
                            <span
                              className={`inline-block font-semibold mr-1.5 ${
                                isRevEvent
                                  ? 'text-[#B87D1E]'
                                  : isApproveEvent
                                  ? 'text-[#3F7E59]'
                                  : 'text-[#57564F]'
                              }`}
                            >
                              [{ev.actionLabel}]
                            </span>
                            {ev.comment ? (
                              <span className="text-[#2F3437]">{ev.comment}</span>
                            ) : (
                              <span className="text-[#787774] italic">
                                Tercatat pada sistem audit trail.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-8 px-4 rounded-xl border border-dashed border-[#DCDAD5] bg-white text-xs text-[#787774] text-center">
                    Belum ada percakapan atau riwayat audit pada dokumen ini.
                  </div>
                )}
              </div>

              {/* 4. COMPOSER CHAT INTERAKTIF DI BAGIAN BAWAH (STICKY FOOTER TANPA SCROLLBAR HORIZONTAL) */}
              <div className="p-3 bg-white border-t border-[#E6E5E2] space-y-2 shrink-0">
                <div className="flex flex-wrap items-center gap-1">
                  {(showRTrackingActions
                    ? [
                        'Dokumen revisi telah diperbarui.',
                        'Lampiran pendukung telah dilengkapi.',
                        'Mohon konfirmasi arahan revisi.',
                      ]
                    : [
                        'Substansi & indikator sesuai, disetujui.',
                        'Mohon lengkapi rincian pendukung.',
                        'Perlu penyesuaian sebelum otorisasi.',
                      ]
                  ).map((chipText) => (
                    <button
                      key={chipText}
                      type="button"
                      onClick={() => setCommentInput(chipText)}
                      className="px-2 py-0.5 rounded-full bg-[#F4F3EF] hover:bg-[#E7F3F8] hover:text-[#2E75B6] hover:border-[#C5DFEE] border border-[#E3E2E0] text-[10px] text-[#57564F] transition-colors cursor-pointer"
                    >
                      + {chipText}
                    </button>
                  ))}
                </div>

                <div className="flex items-end gap-2 rounded-xl border border-[#DCDAD5] bg-[#FAF9F6] focus-within:bg-white focus-within:border-[#2E75B6] px-3 py-2 transition-colors">
                  <textarea
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (commentInput.trim() && !actionLoading) {
                          handleExecuteAction(selectedItem, 'comment');
                        }
                      }
                    }}
                    rows={1}
                    placeholder={
                      showRTrackingActions
                        ? 'Tulis pesan diskusi ke pemeriksa... (Tekan Enter untuk kirim)'
                        : 'Tulis pesan diskusi / catatan audit... (Tekan Enter untuk kirim)'
                    }
                    className="flex-1 bg-transparent text-xs text-[#2F3437] placeholder:text-[#9B9A97] focus:outline-none resize-none max-h-20 leading-relaxed"
                  />
                  <button
                    type="button"
                    disabled={actionLoading || !commentInput.trim()}
                    onClick={() => handleExecuteAction(selectedItem, 'comment')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2E75B6] hover:bg-[#235B8E] text-white text-[11px] font-semibold transition-colors disabled:opacity-40 cursor-pointer shrink-0"
                    title="Kirim pesan diskusi / audit (Enter)"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>Kirim</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Helper merender sel Kolom Komentar (Audit Trail) & ACC Langsung di Tabel Menu Ini
  const renderInlineAuditAndActionCell = (doc: ApprovalHubItem) => {
    const auth = getUserDocumentAuthority(doc);
    const canApproveNow =
      auth.canVerifyApproveA1 ||
      auth.canVerifyA2 ||
      auth.canDirectorFinalApprove ||
      auth.canDirectorReceiveReport;
    const sortedAudit = getSortedAuditTimeline(doc);
    const latestAudit = sortedAudit[0] || null;
    const inlineVal = inlineComments[doc.id] || '';
    const isRevisionUnlocked = doc.status === 'Revision Required';

    return (
      <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
        {/* Baris Atas: Entri Audit Trail Terbaru (Terbaru di atas) */}
        {latestAudit ? (
          <div
            onClick={() => setSelectedItemId(doc.id)}
            className="px-2.5 py-1.5 rounded bg-[#FAF9F6] hover:bg-[#F1F1EF] border border-[#EAEAEA] text-[11px] cursor-pointer transition-colors"
            title="Klik untuk membuka Pop-up DOCUMENT DETAIL & seluruh riwayat Audit Trail"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0">
                <span className="font-semibold text-[#2F3437] truncate">
                  {latestAudit.actorName}
                </span>
                <span className="text-[10px] text-[#787774] shrink-0">
                  · {latestAudit.actionLabel}
                </span>
              </div>
              <span className="text-[10px] text-[#787774] shrink-0">
                {formatShortDate(latestAudit.timestamp)}
                {sortedAudit.length > 1 ? ` (${sortedAudit.length} log)` : ''}
              </span>
            </div>
            {latestAudit.comment && (
              <div className="text-[#57564F] italic truncate mt-0.5">
                &ldquo;{latestAudit.comment}&rdquo;
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-[#9B9A97] italic">Belum ada catatan audit trail</div>
        )}

        {/* Baris Bawah: Input Komentar Audit Trail & Tombol ACC / Revisi / Cairkan Dana Langsung di Menu Ini */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={inlineVal}
            onChange={(e) =>
              setInlineComments((prev) => ({
                ...prev,
                [doc.id]: e.target.value,
              }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inlineVal.trim()) {
                e.preventDefault();
                handleExecuteAction(doc, 'comment', false, inlineVal);
              }
            }}
            placeholder={
              auth.canDisburseCashAdvance
                ? 'Nomor Referensi Transfer (opsional)...'
                : 'Tulis komentar diskusi / audit...'
            }
            className="flex-1 min-w-[140px] h-7 px-2.5 text-[11px] rounded border border-[#E3E2E0] bg-white focus:outline-none focus:border-[#2F3437]"
          />

          {auth.canApproveTorEditRequest && (
            <>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleExecuteAction(doc, 'approve_edit_request', false, inlineVal)}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-[#0F7B6C] hover:bg-[#0b6256] text-white text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                title="Setujui (ACC) Request Edit Dokumen ToR langsung dari Approval ToR"
              >
                <Check className="w-3 h-3 shrink-0" />
                <span>ACC Edit ToR</span>
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() =>
                  handleExecuteAction(
                    doc,
                    'reject_edit_request',
                    false,
                    inlineVal.trim() || 'Permintaan edit dokumen ToR ditolak oleh Direktur.'
                  )
                }
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-[#F3C6C6] bg-[#FBE4E4] hover:bg-[#F7D4D4] text-[#C4554D] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap"
                title="Tolak Request Edit Dokumen ToR"
              >
                <XCircle className="w-3 h-3 shrink-0" />
                <span>Tolak Edit</span>
              </button>
            </>
          )}

          {auth.canDisburseCashAdvance && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleDisburseCashAdvanceFromHub(doc, inlineVal)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-[#0F7B6C] hover:bg-[#0b6256] text-white text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
              title="Cairkan dana ke rekening pengaju & kirim notifikasi"
            >
              <Wallet className="w-3 h-3 shrink-0" />
              <span>Cairkan Dana ke Pengaju</span>
            </button>
          )}

          {canApproveNow && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => {
                const actType = auth.canDirectorFinalApprove
                  ? 'director_final_approve'
                  : auth.canDirectorReceiveReport
                  ? 'report_to_director'
                  : 'verify_approve';
                handleExecuteAction(doc, actType, false, inlineVal);
              }}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-[#0F7B6C] hover:bg-[#0b6256] text-white text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
              title="Setujui (ACC) langsung dari menu ini"
            >
              <Check className="w-3 h-3 shrink-0" />
              <span>ACC / Setujui</span>
            </button>
          )}

          {auth.canReturnForRevision && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleExecuteAction(doc, 'revision', false, inlineVal)}
              className="inline-flex items-center gap-1 h-7 px-2 rounded border border-[#D9730D]/40 bg-[#FAEBDD] hover:bg-[#f5dec6] text-[#9A5B13] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap"
              title="Kembalikan untuk revisi beserta komentar di samping"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span>Revisi</span>
            </button>
          )}

          {(isRevisionUnlocked ||
            (doc.categoryCode === 'tor' &&
              doc.previewData?.editRequestStatus === 'approved' &&
              doc.responsibleUserId === currentUser?.id)) && (
            <button
              type="button"
              onClick={() => handleOpenSourceDocumentEditor(doc, true)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-[#2F3437] hover:bg-[#1f2325] text-white text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              <Edit3 className="w-3 h-3 shrink-0" />
              <span>Edit</span>
            </button>
          )}

          {inlineVal.trim().length > 0 && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleExecuteAction(doc, 'comment', false, inlineVal)}
              className="inline-flex items-center gap-1 h-7 px-2 rounded border border-[#E3E2E0] bg-[#FAF9F6] hover:bg-[#F1F1EF] text-[11px] font-medium text-[#2F3437] transition-colors cursor-pointer whitespace-nowrap"
              title="Simpan komentar ke Audit Trail"
            >
              <MessageSquare className="w-3 h-3 text-[#787774]" />
              <span>Catat</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  // ============================================================================
  // BAGIAN 6: HALAMAN DETAIL ACTIVITY (MENAMPILKAN SELURUH DOKUMEN ACTIVITY)
  // ============================================================================
  if (selectedActivityNode) {
    const { activity, output, outcome, program, responsibleName, raci, items, stats } =
      selectedActivityNode;
    const actIndicator = getIndicatorClasses(stats.tone);
    const activityTors = tors.filter((t) => t.activityId === activity.id);
    const primaryTor = activityTors[0] || null;

    // Bangun baris untuk seluruh jenis dokumen yang relevan pada Activity ini
    const documentSlots = visibleDocumentCategories.flatMap((cat) => {
      const matchingItems = items.filter((i) => i.categoryCode === cat.code);
      if (matchingItems.length > 0) {
        return matchingItems.map((item) => ({
          key: item.id,
          category: cat,
          item,
        }));
      }
      return [
        {
          key: `empty-${activity.id}-${cat.code}`,
          category: cat,
          item: null as ApprovalHubItem | null,
        },
      ];
    });

    return (
      <div className="max-w-7xl mx-auto py-2 text-[#2F3437] animate-in fade-in duration-150">
        {renderDocumentPopupModal()}

        {feedbackToast && (
          <div
            className={`mb-4 px-4 py-3 rounded-md border flex items-center justify-between text-xs font-medium ${
              feedbackToast.type === 'success'
                ? 'bg-[#EAF3EC] border-[#B7D7BF] text-[#1C3829]'
                : 'bg-[#FBE4E4] border-[#F5B8B8] text-[#9E2A2B]'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedbackToast.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-[#0F7B6C]" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[#E03E3E]" />
              )}
              <span>{feedbackToast.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackToast(null)}
              className="text-[11px] underline opacity-75 hover:opacity-100"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Navigasi Kembali ke Approval Center */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-5 border-b border-[#EAEAEA]">
          <button
            type="button"
            onClick={() => setSelectedActivityId(null)}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#57564F] hover:text-[#2F3437] px-2.5 py-1.5 rounded hover:bg-[#F7F7F5] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Approval Center (Ticket Board &amp; Hierarki)</span>
          </button>

          <div className="flex items-center gap-2">
            {stats.needsApprovalCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-[#FBE4E4] text-[#9E2A2B] border border-[#F5B8B8]">
                <span className="w-2 h-2 rounded-full bg-[#E03E3E]" />
                {formatTwoDigits(stats.needsApprovalCount)} Perlu Persetujuan
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-[#DBEDDB] text-[#1C3829] border border-[#B7D7BF]">
              <span className="w-2 h-2 rounded-full bg-[#0F7B6C]" />
              {formatTwoDigits(stats.approvedCount)} Disetujui
            </span>
          </div>
        </div>

        {/* Breadcrumb & Header Activity */}
        <div className="mb-6 p-4 rounded-lg border border-[#EAEAEA] bg-[#FAF9F6]">
          <div className="flex items-center gap-1.5 text-[11px] text-[#787774] flex-wrap mb-2">
            <span className="font-medium text-[#37352F]">{program.name}</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
            <span>{outcome.name}</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
            <span>{output.name}</span>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${actIndicator.dot}`} />
              <div>
                <h1 className="text-lg font-bold text-[#2F3437] tracking-tight">
                  {activity.code ? `${activity.code} – ` : ''}
                  {activity.name}
                </h1>
                {activity.description && (
                  <p className="text-xs text-[#57564F] mt-0.5">{activity.description}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded bg-white border border-[#E3E2E0] text-[#37352F] whitespace-nowrap">
                <strong>R (Responsible):</strong> {responsibleName}
              </span>
              {raci?.accountableUserName && (
                <span className="px-2.5 py-1 rounded bg-white border border-[#E3E2E0] text-[#37352F] whitespace-nowrap">
                  <strong>A1:</strong> {raci.accountableUserName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tabel Seluruh Dokumen Berkaitan dengan Activity */}
        <div className="rounded-lg border border-[#E3E2E0] bg-white overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="px-5 py-3 border-b border-[#EAEAEA] bg-[#FAF9F6] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#2F3437]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#2F3437]">
                Daftar Dokumen Approval Activity
              </h2>
            </div>
            <span className="text-[11px] text-[#787774]">
              Klik kode dokumen atau tombol pratinjau untuk membuka Pop-up DOCUMENT DETAIL
            </span>
          </div>

          <div className="divide-y divide-[#EAEAEA]">
            {documentSlots.map(({ key, category, item }) => {
              const defaultAccountableLabel =
                category.groupType === 'program_documents'
                  ? raci?.accountableUserName
                    ? `A1: ${raci.accountableUserName}`
                    : 'A1: Accountable Program'
                  : raci?.accountableFinanceUserName
                  ? `A2: ${raci.accountableFinanceUserName}`
                  : 'A2: Accountable Finance';

              if (!item) {
                const grayCls = getIndicatorClasses('gray');
                return (
                  <div
                    key={key}
                    className="p-4 hover:bg-[#FAF9F6] transition-colors grid grid-cols-1 md:grid-cols-12 gap-4 items-center text-xs text-[#787774]"
                  >
                    <div className="md:col-span-5 flex items-start gap-2.5">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${grayCls.dot}`} />
                      <div>
                        <div className="font-semibold text-[#37352F]">{category.label}</div>
                        <div className="text-[11px] font-mono text-[#9B9A97] mt-0.5">
                          Belum ada kode ({category.flowSummary})
                        </div>
                      </div>
                    </div>
                    <div className="md:col-span-3">
                      <div className="font-medium text-[#57564F]">R: {responsibleName}</div>
                      <div className="text-[11px] text-[#9B9A97] mt-0.5">
                        {defaultAccountableLabel}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-medium ${grayCls.badge}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${grayCls.dot}`} />
                        <span>Belum Diajukan</span>
                      </span>
                    </div>
                    <div className="md:col-span-2 flex md:justify-end">
                      {primaryTor ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectTor(primaryTor.id, category.stage, {
                              focusedSourceMode: true,
                            })
                          }
                          className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[11px] font-medium text-[#57564F] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <span>Buka Sumber →</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#9B9A97]">Belum tersedia</span>
                      )}
                    </div>
                  </div>
                );
              }

              const statusInfo = getSimpleStatusDisplay(item);
              const stateBadge = getTicketUserStateBadge(item);

              return (
                <div
                  key={key}
                  onClick={() => setSelectedItemId(item.id)}
                  className="p-4 hover:bg-[#FAF9F6] transition-colors grid grid-cols-1 md:grid-cols-12 gap-4 items-center text-xs cursor-pointer group"
                >
                  <div className="md:col-span-5 flex items-start gap-2.5 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusInfo.dotColor}`}
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-[#2F3437] group-hover:text-[#2383E2]">
                        {category.label}
                      </div>
                      <div className="text-[11px] text-[#57564F] truncate mt-0.5">
                        {item.title}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItemId(item.id);
                        }}
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#2383E2] hover:text-[#1a65b0] hover:underline cursor-pointer"
                      >
                        <span>{item.referenceNumber}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </button>
                    </div>
                  </div>

                  <div className="md:col-span-3">
                    <div className="font-medium text-[#2F3437]">
                      R: {item.responsibleUserName}
                    </div>
                    <div className="text-[11px] text-[#787774] mt-0.5">
                      {item.groupType === 'program_documents'
                        ? `A1: ${item.accountableProgramUserName}`
                        : `A2: ${item.accountableFinanceUserName}`}
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <div>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${statusInfo.badgeStyle}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dotColor}`}
                        />
                        <span>{statusInfo.label}</span>
                      </span>
                    </div>
                    <div>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${stateBadge.className}`}
                      >
                        {stateBadge.label}
                      </span>
                    </div>
                  </div>

                  <div className="md:col-span-2 flex md:justify-end">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedItemId(item.id);
                      }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#2F3437] hover:bg-[#1f2325] text-white text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>Chat Box &amp; Preview →</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // TAMPILAN UTAMA: TICKET-BASED APPROVAL SYSTEM TERINTEGRASI MEAL CONNECT
  // Alur Visual:
  // 1. APPROVAL CENTER ("Semua pengajuan dalam satu pintu")
  // 2. TICKET BOARD (ToR, Notulen, Dokumentasi, Executive Summary, Cash Advance, Final Financial Report)
  // 3. TICKET CONTENTS ("Daftar dokumen dalam kategori tersebut" + Hierarki & Audit Trail Inline)
  // 4. DOCUMENT DETAIL (Document Preview, Discussion Pop-up, Approval Workflow, Audit Trail)
  // +  PROGRAM HIERARCHY OVERVIEW (Program → Outcome → Output → Activity)
  // ============================================================================
  const activeTicketLabel =
    activeCategoryTab === 'all'
      ? 'Semua Kategori Tiket Terotorisasi'
      : DOCUMENT_TYPE_LABELS[activeCategoryTab];

  return (
    <div className="max-w-7xl mx-auto py-2 text-[#2F3437] space-y-4">
      {/* Pop-up Modal DOCUMENT DETAIL (muncul ketika kode dokumen atau tombol detail diklik) */}
      {renderDocumentPopupModal()}

      {/* Notifikasi Toast di Menu Utama */}
      {feedbackToast && !selectedItem && (
        <div
          className={`px-4 py-3 rounded-md border flex items-center justify-between text-xs font-medium ${
            feedbackToast.type === 'success'
              ? 'bg-[#EAF3EC] border-[#B7D7BF] text-[#1C3829]'
              : 'bg-[#FBE4E4] border-[#F5B8B8] text-[#9E2A2B]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackToast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#0F7B6C]" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[#E03E3E]" />
            )}
            <span>{feedbackToast.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackToast(null)}
            className="text-[11px] underline opacity-75 hover:opacity-100"
          >
            Tutup
          </button>
        </div>
      )}

      {/* ======================================================================
          BLOCK 1 & 2 UNIFIED: APPROVAL CENTER & TICKET BOARD
          - Satu bar ringkas tanpa space waste (kondisi pertama Filter & Peran: HIDE)
          - Siluet tiket betulan dengan lekukan setengah lingkaran asli di sisi kiri & kanan
         ====================================================================== */}
      <div className="p-3.5 rounded-xl border border-[#E6E5E2] bg-[#FAF9F6] shadow-[0_1px_2px_rgba(15,15,15,0.03)] space-y-3">
        {/* Baris Utama Ringkas: Identitas Approval Center / Ticket Board & Tombol Aksi Cepat */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E6E5E2]">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#E7F3F8] border border-[#C5DFEE] text-[#2E75B6] flex items-center justify-center shrink-0">
              <Ticket className="w-3.5 h-3.5" />
            </div>
            <h1 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-[#2F3437]">
              {isRTrackingMode ? 'R TRACKING TICKET BOARD' : 'TICKET BOARD'}
            </h1>
            <span className="px-2 py-0.5 rounded bg-white border border-[#E3E2E0] text-[11px] font-mono font-semibold text-[#57564F]">
              {visibleDocumentCategories.length} Tiket Kategori
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FBE4E4] text-[#C4554D] border border-[#F3C6C6]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D45B55]" />
              <span>
                {formatTwoDigits(
                  isRTrackingMode
                    ? ticketBoardStats.all.returnedForRevision
                    : ticketBoardStats.all.awaitingMyAction
                )}{' '}
                {isRTrackingMode ? 'Perlu Revisi' : 'Perlu Tindakan'}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveCategoryTab('all');
                setActiveTicketStateFilter('all');
              }}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-all cursor-pointer ${
                activeCategoryTab === 'all'
                  ? 'bg-[#E7F3F8] text-[#2E75B6] border border-[#C5DFEE] shadow-2xs'
                  : 'bg-white text-[#2F3437] border border-[#E3E2E0] hover:bg-[#F4F3EF]'
              }`}
            >
              <Ticket className="w-3.5 h-3.5" />
              <span>
                {isRTrackingMode ? 'Semua Tracking Tiket R' : 'Semua Tiket Terotorisasi'}
              </span>
              <span
                className={`px-1.5 py-0.2 rounded font-mono text-[10.5px] font-bold ${
                  activeCategoryTab === 'all'
                    ? 'bg-white text-[#2E75B6] border border-[#C5DFEE]'
                    : 'bg-[#F4F3EF] border border-[#E3E2E0] text-[#2F3437]'
                }`}
              >
                {formatTwoDigits(ticketBoardStats.all.total)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowApprovalCenterPanel((prev) => !prev)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F1F0EC] text-[11.5px] font-semibold text-[#57564F] cursor-pointer transition-colors"
            >
              {showApprovalCenterPanel ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Filter &amp; Peran (Hide)</span>
                </>
              ) : (
                <>
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span>Filter &amp; Peran (Show)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Panel Filter & Peran (Default: HIDE) */}
        {showApprovalCenterPanel && (
          <div className="px-3 py-2 rounded-lg bg-white border border-[#E6E5E2] flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            {/* Kiri: Switcher Mode & Peran Aktif */}
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {hasApproverAuthority && hasResponsibleTrackingItems && (
                <div className="inline-flex items-center p-0.5 rounded-md bg-[#F4F3EF] border border-[#E3E2E0] shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setRoleViewMode('approver_inbox');
                      setActiveTicketStateFilter('all');
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                      !isRTrackingMode
                        ? 'bg-white text-[#2E75B6] shadow-2xs border border-[#C5DFEE]'
                        : 'text-[#787774] hover:text-[#2F3437]'
                    }`}
                  >
                    Kotak Masuk Approver ({hubItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRoleViewMode('r_tracking');
                      setActiveTicketStateFilter('all');
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                      isRTrackingMode
                        ? 'bg-white text-[#2E75B6] shadow-2xs border border-[#C5DFEE]'
                        : 'text-[#787774] hover:text-[#2F3437]'
                    }`}
                  >
                    Tracking Ticket R ({responsibleItems.length})
                  </button>
                </div>
              )}

              {accessProfile && Array.isArray(accessProfile.activeApprovalRoles) && accessProfile.activeApprovalRoles.length > 0 && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[#FAF9F6] border border-[#E3E2E0] text-[#57564F] whitespace-nowrap truncate max-w-[260px]"
                  title={accessProfile.activeApprovalRoles.join(' · ')}
                >
                  <span className="text-[#787774]">Peran:</span>
                  <strong className="font-semibold text-[#2F3437] truncate">
                    {isRTrackingMode
                      ? 'R – Responsible (Pelaksana)'
                      : accessProfile.activeApprovalRoles
                          .map((r) =>
                            r
                              .replace(' – Accountable Program', '')
                              .replace(' – Accountable Finance', '')
                          )
                          .join(' · ')}
                  </strong>
                </span>
              )}
            </div>

            {/* Kanan: Filter Program & Pencarian */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 shrink-0">
              <select
                value={selectedProgramFilterId}
                onChange={(e) => setSelectedProgramFilterId(e.target.value)}
                className="h-7 w-full sm:w-52 px-2.5 text-xs font-medium rounded-md border border-[#E3E2E0] bg-[#FAF9F6] text-[#2F3437] hover:border-[#C2C0B8] focus:outline-none focus:border-[#787774] transition-colors truncate cursor-pointer"
                title="Filter berdasarkan Program"
              >
                <option value="all">Semua Program ({programs.length})</option>
                {programs.map((prog) => (
                  <option key={prog.id} value={prog.id}>
                    {prog.name}
                  </option>
                ))}
              </select>

              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-[#9B9A97] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari kode dokumen, activity, R..."
                  className="pl-7 pr-2.5 h-7 w-full text-xs rounded-md border border-[#E3E2E0] bg-[#FAF9F6] focus:bg-white text-[#2F3437] hover:border-[#C2C0B8] focus:outline-none focus:border-[#787774] transition-colors"
                />
              </div>
            </div>
          </div>
        )}

        {/* Grid 2 Kolom Tiket Fisik dengan Tone Warna Notion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleDocumentCategories.map((cat, idx) => {
            const isSelected = activeCategoryTab === cat.code;
            const st = ticketBoardStats[cat.code] || {
              total: 0,
              awaitingMyAction: 0,
              awaitingSubsequent: 0,
              processedByOthers: 0,
              returnedForRevision: 0,
              alreadyApproved: 0,
            };

            const hasUrgentAction = isRTrackingMode
              ? st.returnedForRevision > 0 || st.awaitingMyAction > 0
              : st.awaitingMyAction > 0;
            const inProgressCount = st.awaitingSubsequent + st.processedByOthers;
            const isAllCompleted =
              cat.code === 'laporan_keuangan_akhir' &&
              st.total > 0 &&
              st.alreadyApproved === st.total;
            const ticketSerial = `TKT-0${idx + 1}`;

            const getCategoryVisual = (code: ApprovalCategoryCode) => {
              switch (code) {
                case 'tor':
                  return {
                    Icon: FileText,
                    iconBox: 'bg-[#E7F3F8] text-[#2E75B6] border-[#C5DFEE]',
                  };
                case 'notulen':
                  return {
                    Icon: ClipboardList,
                    iconBox: 'bg-[#EDF3EC] text-[#3F7E59] border-[#C7DFC5]',
                  };
                case 'dokumentasi':
                  return {
                    Icon: Camera,
                    iconBox: 'bg-[#FBF3DB] text-[#B87D1E] border-[#EAD6A3]',
                  };
                case 'executive_summary':
                  return {
                    Icon: BarChart3,
                    iconBox: 'bg-[#F4F0F7] text-[#7D5BA6] border-[#DFD4E8]',
                  };
                case 'cash_advance':
                  return {
                    Icon: Wallet,
                    iconBox: 'bg-[#E8F3F1] text-[#3B7A70] border-[#C2DDD8]',
                  };
                case 'laporan_keuangan_akhir':
                default:
                  return {
                    Icon: FileCheck2,
                    iconBox: 'bg-[#FBE4E4] text-[#C4554D] border-[#F3C6C6]',
                  };
              }
            };

            const { Icon: CatIcon, iconBox } = getCategoryVisual(cat.code);

            // Persentase bar visual dengan tone Notion
            const totalSafe = Math.max(1, st.total);
            const pctUrgent = Math.round((st.awaitingMyAction / totalSafe) * 100);
            const pctRevision = Math.round((st.returnedForRevision / totalSafe) * 100);
            const pctProgress = Math.round((inProgressCount / totalSafe) * 100);
            const pctApproved = Math.round((st.alreadyApproved / totalSafe) * 100);

            const borderColorHex = isAllCompleted
              ? isSelected
                ? '#9A6F05'
                : '#D4AF37'
              : isSelected
              ? '#2E75B6'
              : '#DCDAD5';
            const borderClass = isAllCompleted
              ? isSelected
                ? 'border-[#9A6F05]'
                : 'border-[#D4AF37] group-hover:border-[#B8860B]'
              : isSelected
              ? 'border-[#2E75B6]'
              : 'border-[#DCDAD5] group-hover:border-[#B8B5AD]';
            const strokeW = isSelected || isAllCompleted ? 1.5 : 1;
            const topFillHex = isAllCompleted ? '#F8E8B4' : '#FFFFFF';
            const bottomFillHex = isAllCompleted ? '#F4DF9E' : '#FCFCFA';

            return (
              <div
                key={cat.code}
                onClick={() => {
                  setActiveCategoryTab(cat.code);
                  setActiveTicketStateFilter('all');
                  ticketContentsRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                  });
                }}
                className={`group relative flex flex-col cursor-pointer select-none transition-transform duration-150 ${
                  isAllCompleted
                    ? 'drop-shadow-[0_3px_10px_rgba(212,175,55,0.20)]'
                    : ''
                }`}
              >
                {/* 1. BAGIAN ATAS TIKET (MAIN TICKET BODY — PUTIH BERSIH ATAU EMAS UNTUK LAPORAN KEUANGAN AKHIR YANG SELESAI) */}
                <div
                  className={`${
                    isAllCompleted
                      ? 'bg-gradient-to-br from-[#FFFDF5] via-[#FDF4D2] to-[#F7E5AE]'
                      : 'bg-white'
                  } rounded-t-xl border-t border-l border-r ${borderClass} px-4 pt-3.5 pb-2.5 transition-colors`}
                >
                  {/* Baris Header Tiket Cetak: Nomor Seri, Alur RACI & Status Tone Notion */}
                  <div
                    className={`flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b ${
                      isAllCompleted ? 'border-[#E6CB78]' : 'border-[#F1F0EC]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`font-mono text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border ${
                          isAllCompleted
                            ? 'bg-[#F6E29F] text-[#694B03] border-[#D9B650]'
                            : 'text-[#57564F] bg-[#F4F3EF] border-[#E3E2E0]'
                        }`}
                      >
                        {ticketSerial}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium border ${
                          isAllCompleted
                            ? 'bg-[#FBF0C9] text-[#7A5907] border-[#E2C56B]'
                            : 'text-[#57564F] bg-[#F4F3EF] border-[#E3E2E0]'
                        }`}
                      >
                        {cat.flowSummary}
                      </span>
                      {isSelected && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border ${
                            isAllCompleted
                              ? 'bg-[#694B03] text-[#FFFDF5] border-[#694B03]'
                              : 'bg-[#E7F3F8] text-[#2E75B6] border-[#C5DFEE]'
                          }`}
                        >
                          Aktif
                        </span>
                      )}
                    </div>

                    {isAllCompleted ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-gradient-to-r from-[#D4AF37] via-[#C59B27] to-[#AA8010] text-white border border-[#9A6F05] shadow-2xs">
                        <span>{formatTwoDigits(st.total)} Selesai</span>
                      </span>
                    ) : isRTrackingMode ? (
                      st.returnedForRevision > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-[#FBF3DB] text-[#B87D1E] border border-[#EAD6A3]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#D49B35]" />
                          <span>{formatTwoDigits(st.returnedForRevision)} Perlu Revisi R</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium bg-[#F4F3EF] text-[#57564F] border border-[#E3E2E0]">
                          <span className="font-bold text-[#2F3437]">
                            {formatTwoDigits(st.total)}
                          </span>
                          <span>Tiket R</span>
                        </span>
                      )
                    ) : hasUrgentAction ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-[#FBE4E4] text-[#C4554D] border border-[#F3C6C6]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D45B55]" />
                        <span>{formatTwoDigits(st.awaitingMyAction)} Perlu Tindakan</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium bg-[#F4F3EF] text-[#57564F] border border-[#E3E2E0]">
                        <span className="font-bold text-[#2F3437]">
                          {formatTwoDigits(st.total)}
                        </span>
                        <span>Dokumen</span>
                      </span>
                    )}
                  </div>

                  {/* Baris Utama Judul Tiket & Barcode Halus */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${
                          isAllCompleted
                            ? 'bg-gradient-to-br from-[#FFF6D6] to-[#EFC962] text-[#694B03] border-[#D4AF37] shadow-2xs'
                            : iconBox
                        }`}
                      >
                        <CatIcon className="w-5 h-5 stroke-[1.75]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3
                            className={`text-base font-bold leading-tight truncate ${
                              isAllCompleted ? 'text-[#4A3402]' : 'text-[#2F3437]'
                            }`}
                          >
                            {cat.label}
                          </h3>
                        </div>
                        <p
                          className={`text-[11px] mt-0.5 truncate ${
                            isAllCompleted ? 'text-[#7A5A10]' : 'text-[#787774]'
                          }`}
                        >
                          {cat.subtitle}
                        </p>
                      </div>
                    </div>

                    {/* Barcode Cetak Tiket Asli di Kanan */}
                    <div
                      className={`shrink-0 flex flex-col items-end gap-1 pl-2 border-l border-dashed ${
                        isAllCompleted ? 'border-[#D9B650]' : 'border-[#E3E2E0]'
                      }`}
                      aria-hidden="true"
                    >
                      <div className="flex items-center gap-[2px] opacity-45">
                        <span
                          className={`w-[2px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[1px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[3px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[1px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[2px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[1px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[3px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[1px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                        <span
                          className={`w-[2px] h-5 ${
                            isAllCompleted ? 'bg-[#7A5907]' : 'bg-[#57564F]'
                          }`}
                        />
                      </div>
                      <span
                        className={`font-mono text-[9px] tracking-widest ${
                          isAllCompleted ? 'text-[#8A6508] font-semibold' : 'text-[#9B9A97]'
                        }`}
                      >
                        *{ticketSerial}*
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. PINGGANG PERFORASI TIKET ASLI (LEKUKAN SETENGAH LINGKARAN MENYATU DENGAN #FAF9F6) */}
                <div className="relative h-5 flex items-center select-none" aria-hidden="true">
                  <div
                    className={`absolute inset-x-[10px] top-0 h-1/2 ${
                      isAllCompleted ? 'bg-[#F8E8B4]' : 'bg-white'
                    }`}
                  />
                  <div
                    className={`absolute inset-x-[10px] bottom-0 h-1/2 ${
                      isAllCompleted ? 'bg-[#F4DF9E]' : 'bg-[#FCFCFA]'
                    }`}
                  />

                  {/* Lekukan Kiri Asli */}
                  <svg
                    width="11"
                    height="20"
                    viewBox="0 0 11 20"
                    className="relative z-10 shrink-0 block"
                  >
                    <path d="M 0,0 L 11,0 L 11,10 L 0,10 Z" fill={topFillHex} />
                    <path d="M 0,10 L 11,10 L 11,20 L 0,20 Z" fill={bottomFillHex} />
                    <path d="M 0,0 A 10,10 0 0,1 0,20 Z" fill="#FAF9F6" />
                    <path
                      d="M 0.5,0 A 9.5,9.5 0 0,1 0.5,20"
                      fill="none"
                      stroke={borderColorHex}
                      strokeWidth={strokeW}
                    />
                  </svg>

                  {/* Garis Putus-putus Robekan Tiket */}
                  <div
                    className={`relative z-10 flex-1 border-t-[1.5px] border-dashed ${
                      isAllCompleted ? 'border-[#C9A227]' : 'border-[#DCDAD5]'
                    }`}
                  />

                  {/* Lekukan Kanan Asli */}
                  <svg
                    width="11"
                    height="20"
                    viewBox="0 0 11 20"
                    className="relative z-10 shrink-0 block"
                  >
                    <path d="M 0,0 L 11,0 L 11,10 L 0,10 Z" fill={topFillHex} />
                    <path d="M 0,10 L 11,10 L 11,20 L 0,20 Z" fill={bottomFillHex} />
                    <path d="M 11,0 A 10,10 0 0,0 11,20 Z" fill="#FAF9F6" />
                    <path
                      d="M 10.5,0 A 9.5,9.5 0 0,0 10.5,20"
                      fill="none"
                      stroke={borderColorHex}
                      strokeWidth={strokeW}
                    />
                  </svg>
                </div>

                {/* 3. BAGIAN KUPON BAWAH TIKET (TICKET STUB DENGAN TONE WARNA NOTION / EMAS) */}
                <div
                  className={`${
                    isAllCompleted
                      ? 'bg-gradient-to-br from-[#F7E5AC] via-[#F3DD98] to-[#EDD17E]'
                      : 'bg-[#FCFCFA]'
                  } rounded-b-xl border-b border-l border-r ${borderClass} px-4 pt-2 pb-3.5 space-y-2.5 transition-colors`}
                >
                  {/* Progress Bar dengan Tone Warna Notion (atau Emas Penuh jika Selesai Semua) */}
                  <div
                    className={`h-1.5 w-full rounded-full overflow-hidden flex ${
                      isAllCompleted ? 'bg-[#E5C665]' : 'bg-[#EFECE6]'
                    }`}
                  >
                    {isAllCompleted ? (
                      <div
                        style={{ width: '100%' }}
                        className="bg-gradient-to-r from-[#B8860B] via-[#D4AF37] to-[#8B6508] h-full"
                        title={`Selesai: ${st.alreadyApproved}`}
                      />
                    ) : (
                      st.total > 0 && (
                        <>
                          {st.awaitingMyAction > 0 && (
                            <div
                              style={{ width: `${pctUrgent}%` }}
                              className="bg-[#D45B55] h-full"
                              title={`Tindakan Saya: ${st.awaitingMyAction}`}
                            />
                          )}
                          {st.returnedForRevision > 0 && (
                            <div
                              style={{ width: `${pctRevision}%` }}
                              className="bg-[#D49B35] h-full"
                              title={`Revisi: ${st.returnedForRevision}`}
                            />
                          )}
                          {inProgressCount > 0 && (
                            <div
                              style={{ width: `${pctProgress}%` }}
                              className="bg-[#4E8EC4] h-full"
                              title={`Diproses: ${inProgressCount}`}
                            />
                          )}
                          {st.alreadyApproved > 0 && (
                            <div
                              style={{ width: `${pctApproved}%` }}
                              className="bg-[#4F946B] h-full"
                              title={`Selesai: ${st.alreadyApproved}`}
                            />
                          )}
                        </>
                      )
                    )}
                  </div>

                  {/* 4 Kolom Kupon Filter Cepat — Tone Warna Notion (Merah, Biru, Kuning, Hijau / Emas) */}
                  <div className="grid grid-cols-4 gap-2">
                    {/* 1. Tindakan Saya (Merah Notion) / Di Tahap A1-A2 (Biru Notion) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCategoryTab(cat.code);
                        setActiveTicketStateFilter(
                          isRTrackingMode && st.awaitingMyAction === 0 && st.processedByOthers > 0
                            ? 'processed_by_others'
                            : 'awaiting_my_action'
                        );
                        ticketContentsRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                        });
                      }}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        isAllCompleted
                          ? 'bg-[#FFFDF5]/75 border-[#DFBE5C] hover:bg-[#FFFDF5]'
                          : (isRTrackingMode ? st.processedByOthers : st.awaitingMyAction) > 0
                          ? isRTrackingMode
                            ? 'bg-[#F2F8FC] border-[#CDE3F0] hover:bg-[#E7F3F8]'
                            : 'bg-[#FDF3F2] border-[#F3CECD] hover:bg-[#FBE4E4]'
                          : 'bg-white border-[#E6E5E2] hover:border-[#C2C0B8]'
                      }`}
                      title={
                        isRTrackingMode
                          ? 'Klik untuk memfilter tiket yang sedang ditinjau A1 / diverifikasi A2'
                          : 'Klik untuk memfilter dokumen yang menunggu tindakan Anda'
                      }
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`text-[10px] font-medium truncate ${
                            isAllCompleted ? 'text-[#7A5A10]' : 'text-[#787774]'
                          }`}
                        >
                          {isRTrackingMode
                            ? cat.groupType === 'program_documents'
                              ? 'Di A1'
                              : 'Di A2'
                            : 'Tindakan Saya'}
                        </span>
                        {!isRTrackingMode && st.awaitingMyAction > 0 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#D45B55] shrink-0" />
                        )}
                      </div>
                      <div
                        className={`font-mono text-sm font-bold mt-0.5 ${
                          isAllCompleted
                            ? 'text-[#A68326]'
                            : isRTrackingMode
                            ? st.processedByOthers > 0
                              ? 'text-[#2E75B6]'
                              : 'text-[#9B9A97]'
                            : st.awaitingMyAction > 0
                            ? 'text-[#C4554D]'
                            : 'text-[#9B9A97]'
                        }`}
                      >
                        {formatTwoDigits(
                          isRTrackingMode ? st.processedByOthers : st.awaitingMyAction
                        )}
                      </div>
                    </button>

                    {/* 2. Diproses / Di Tahap Direktur (Biru Notion) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCategoryTab(cat.code);
                        setActiveTicketStateFilter(
                          isRTrackingMode
                            ? 'awaiting_subsequent_stage'
                            : st.awaitingSubsequent > 0
                            ? 'awaiting_subsequent_stage'
                            : 'processed_by_others'
                        );
                        ticketContentsRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                        });
                      }}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        isAllCompleted
                          ? 'bg-[#FFFDF5]/75 border-[#DFBE5C] hover:bg-[#FFFDF5]'
                          : (isRTrackingMode ? st.awaitingSubsequent : inProgressCount) > 0
                          ? 'bg-[#F2F8FC] border-[#CDE3F0] hover:bg-[#E7F3F8]'
                          : 'bg-white border-[#E6E5E2] hover:border-[#C2C0B8]'
                      }`}
                      title={
                        isRTrackingMode
                          ? 'Klik untuk memfilter tiket yang berada di tahap Direktur'
                          : 'Klik untuk memfilter dokumen yang sedang diproses'
                      }
                    >
                      <div
                        className={`text-[10px] font-medium truncate ${
                          isAllCompleted ? 'text-[#7A5A10]' : 'text-[#787774]'
                        }`}
                      >
                        {isRTrackingMode ? 'Di Direktur' : 'Diproses'}
                      </div>
                      <div
                        className={`font-mono text-sm font-bold mt-0.5 ${
                          isAllCompleted
                            ? 'text-[#A68326]'
                            : (isRTrackingMode ? st.awaitingSubsequent : inProgressCount) > 0
                            ? 'text-[#2E75B6]'
                            : 'text-[#9B9A97]'
                        }`}
                      >
                        {formatTwoDigits(
                          isRTrackingMode ? st.awaitingSubsequent : inProgressCount
                        )}
                      </div>
                    </button>

                    {/* 3. Revisi (Kuning/Ochre Notion) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCategoryTab(cat.code);
                        setActiveTicketStateFilter('returned_for_revision');
                        ticketContentsRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                        });
                      }}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        isAllCompleted
                          ? 'bg-[#FFFDF5]/75 border-[#DFBE5C] hover:bg-[#FFFDF5]'
                          : st.returnedForRevision > 0
                          ? 'bg-[#FCF8EC] border-[#EFE0B4] hover:bg-[#FBF3DB]'
                          : 'bg-white border-[#E6E5E2] hover:border-[#C2C0B8]'
                      }`}
                      title="Klik untuk memfilter dokumen yang dikembalikan untuk revisi"
                    >
                      <div
                        className={`text-[10px] font-medium truncate ${
                          isAllCompleted ? 'text-[#7A5A10]' : 'text-[#787774]'
                        }`}
                      >
                        {isRTrackingMode ? 'Perlu Revisi R' : 'Revisi'}
                      </div>
                      <div
                        className={`font-mono text-sm font-bold mt-0.5 ${
                          isAllCompleted
                            ? 'text-[#A68326]'
                            : st.returnedForRevision > 0
                            ? 'text-[#B87D1E]'
                            : 'text-[#9B9A97]'
                        }`}
                      >
                        {formatTwoDigits(st.returnedForRevision)}
                      </div>
                    </button>

                    {/* 4. Selesai (Hijau Sage Notion / Emas untuk Financial Report Akhir) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCategoryTab(cat.code);
                        setActiveTicketStateFilter('already_approved');
                        ticketContentsRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                        });
                      }}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        isAllCompleted
                          ? 'bg-gradient-to-br from-[#FFFDF2] to-[#F7DF8E] border-[#B8860B] shadow-2xs hover:brightness-98'
                          : st.alreadyApproved > 0
                          ? 'bg-[#F4F9F3] border-[#CEE3CC] hover:bg-[#EDF3EC]'
                          : 'bg-white border-[#E6E5E2] hover:border-[#C2C0B8]'
                      }`}
                      title="Klik untuk memfilter dokumen yang sudah selesai"
                    >
                      <div
                        className={`text-[10px] font-semibold truncate ${
                          isAllCompleted ? 'text-[#694B03]' : 'text-[#787774]'
                        }`}
                      >
                        Selesai
                      </div>
                      <div
                        className={`font-mono text-sm font-bold mt-0.5 ${
                          isAllCompleted
                            ? 'text-[#5C4002]'
                            : st.alreadyApproved > 0
                            ? 'text-[#3F7E59]'
                            : 'text-[#9B9A97]'
                        }`}
                      >
                        {formatTwoDigits(st.alreadyApproved)}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ======================================================================
          BLOCK 3: TICKET CONTENTS ("Daftar dokumen dalam kategori tersebut")
          Kupon tiket horizontal dengan tone warna Notion yang selaras dengan TICKET BOARD
         ====================================================================== */}
      <div
        ref={ticketContentsRef}
        className="p-5 rounded-xl border border-[#E6E5E2] bg-[#FAF9F6] shadow-[0_1px_2px_rgba(15,15,15,0.03)] space-y-4"
      >
        {/* Header TICKET CONTENTS */}
        <div className="flex flex-col gap-3 pb-3.5 border-b border-[#E6E5E2]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Ticket className="w-4 h-4 text-[#2E75B6]" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-[#2F3437]">
                  {isRTrackingMode ? 'R TRACKING TICKET CONTENTS' : 'TICKET CONTENTS'}
                </h2>
                <span className="px-2.5 py-0.5 rounded-md bg-[#E7F3F8] border border-[#C5DFEE] text-[#2E75B6] text-xs font-mono font-semibold">
                  {activeTicketLabel} ({ticketContentsItems.length})
                </span>
              </div>
              <p className="text-[11px] text-[#787774] mt-0.5">
                {isRTrackingMode ? (
                  <>
                    Menampilkan perjalanan persetujuan dokumen yang Anda ajukan sebagai{' '}
                    <strong className="text-[#2F3437]">R (Responsible)</strong> — Klik tiket untuk
                    membuka <strong className="text-[#2F3437]">DOCUMENT DETAIL</strong> (Preview
                    Dokumen Asli, Linimasa, Diskusi Bersama, &amp; Pengajuan Ulang Revisi)
                  </>
                ) : (
                  <>
                    Daftar dokumen dalam kategori tersebut — Klik tiket atau kode dokumen untuk
                    membuka <strong className="text-[#2F3437]">DOCUMENT DETAIL</strong> (Halaman
                    Preview Dokumen, Diskusi, &amp; Keputusan ACC)
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Filter 5 Status Tiket dengan Tone Notion */}
          <div className="flex flex-wrap items-center gap-1.5">
            {TICKET_USER_STATE_FILTERS.map((stFilter) => {
              const isActive = activeTicketStateFilter === stFilter.code;
              const currentCatStats =
                ticketBoardStats[activeCategoryTab] || ticketBoardStats.all;
              let count = currentCatStats.total;
              if (stFilter.code === 'awaiting_my_action')
                count = currentCatStats.awaitingMyAction;
              else if (stFilter.code === 'awaiting_subsequent_stage')
                count = currentCatStats.awaitingSubsequent;
              else if (stFilter.code === 'processed_by_others')
                count = currentCatStats.processedByOthers;
              else if (stFilter.code === 'returned_for_revision')
                count = currentCatStats.returnedForRevision;
              else if (stFilter.code === 'already_approved')
                count = currentCatStats.alreadyApproved;

              const filterLabel = isRTrackingMode
                ? stFilter.code === 'all'
                  ? 'Semua Tiket R'
                  : stFilter.code === 'awaiting_my_action'
                  ? 'Draft / Perlu Diajukan R'
                  : stFilter.code === 'processed_by_others'
                  ? 'Sedang Ditinjau A1 / A2'
                  : stFilter.code === 'awaiting_subsequent_stage'
                  ? 'Direktur (Pelaporan / Otorisasi)'
                  : stFilter.code === 'returned_for_revision'
                  ? 'Perlu Revisi & Kirim Ulang R'
                  : 'Selesai'
                : stFilter.label;

              return (
                <button
                  key={stFilter.code}
                  type="button"
                  onClick={() => setActiveTicketStateFilter(stFilter.code)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#E7F3F8] text-[#2E75B6] border border-[#C5DFEE] shadow-2xs'
                      : 'bg-white text-[#57564F] border border-[#E3E2E0] hover:bg-[#F4F3EF]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isActive ? 'bg-[#2E75B6]' : stFilter.dotColor
                    }`}
                  />
                  <span>{filterLabel}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-semibold ${
                      isActive
                        ? 'bg-white text-[#2E75B6] border border-[#C5DFEE]'
                        : 'bg-[#F4F3EF] border border-[#E3E2E0] text-[#787774]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Daftar Kupon Tiket Dokumen Horizontal */}
        {loading ? (
          <div className="py-10 text-center text-xs text-[#787774]">
            Memuat daftar dokumen tiket...
          </div>
        ) : ticketContentsItems.length === 0 ? (
          <div className="py-10 px-4 rounded-lg border border-dashed border-[#DCDAD5] bg-white text-center text-xs text-[#787774]">
            Tidak ada dokumen pada kategori tiket atau filter status ini yang sesuai dengan
            kewenangan RACI Anda.
          </div>
        ) : (
          <div className="space-y-3">
            {ticketContentsItems.map((doc) => {
              const docStatus = getSimpleStatusDisplay(doc);
              const stateBadge = getTicketUserStateBadge(doc);
              const docTypeLabel =
                DOCUMENT_TYPE_LABELS[doc.categoryCode] || doc.categoryLabel;
              const auth = getUserDocumentAuthority(doc);
              const journey = getApprovalJourneyDetails(doc);
              const isROwner = Boolean(
                currentUser && doc.responsibleUserId === currentUser.id
              );
              const isUrgentForMe = isRTrackingMode
                ? doc.status === 'Revision Required' || doc.status === 'Rejected'
                : auth.needsImmediateActionFromMe;
              const isGoldenCompleted =
                doc.categoryCode === 'laporan_keuangan_akhir' &&
                stateBadge.code === 'already_approved';

              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedItemId(doc.id)}
                  className={`relative rounded-xl border transition-all cursor-pointer group overflow-hidden ${
                    isGoldenCompleted
                      ? 'bg-gradient-to-r from-[#FFFDF6] via-[#FCF3D1] to-[#F8E7AE] border-[#D4AF37] hover:border-[#B8860B] shadow-[0_2px_8px_rgba(212,175,55,0.15)]'
                      : isUrgentForMe
                      ? isRTrackingMode
                        ? 'bg-white border-[#EAD6A3] hover:border-[#D49B35]'
                        : 'bg-white border-[#F3C6C6] hover:border-[#D45B55]'
                      : 'bg-white border-[#DCDAD5] hover:border-[#B8B5AD]'
                  }`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
                    {/* Kolom 1 (5/12): Identitas Dokumen, Judul, Kode Referensi & Hierarki Activity */}
                    <div className="lg:col-span-5 p-4 flex items-start gap-3 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                          isGoldenCompleted ? 'bg-[#B8860B]' : docStatus.dotColor
                        }`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase tracking-wider ${
                              isGoldenCompleted
                                ? 'bg-[#F6E29F] border-[#D4AF37] text-[#694B03]'
                                : 'bg-[#F4F3EF] border-[#E3E2E0] text-[#2F3437]'
                            }`}
                          >
                            <Ticket
                              className={`w-3 h-3 ${
                                isGoldenCompleted ? 'text-[#8A6508]' : 'text-[#787774]'
                              }`}
                            />
                            <span>{docTypeLabel}</span>
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                              isGoldenCompleted
                                ? 'bg-[#FFF9E4] border-[#DFBE5C] text-[#7A5907]'
                                : 'bg-[#E7F3F8] border-[#C5DFEE] text-[#2E75B6]'
                            }`}
                          >
                            v{doc.version || 1}
                          </span>
                          <span
                            className={`text-[10px] font-mono ${
                              isGoldenCompleted ? 'text-[#7A5A10]' : 'text-[#787774]'
                            }`}
                          >
                            {formatShortDate(doc.submittedAt)}
                          </span>
                        </div>

                        <div
                          className={`text-sm font-bold transition-colors leading-snug truncate ${
                            isGoldenCompleted
                              ? 'text-[#4A3402] group-hover:text-[#2B1E00]'
                              : 'text-[#2F3437] group-hover:text-black'
                          }`}
                        >
                          {doc.title}
                        </div>

                        <div className="pt-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemId(doc.id);
                            }}
                            className={`inline-flex items-center gap-1 font-mono text-xs font-semibold hover:underline cursor-pointer max-w-full ${
                              isGoldenCompleted
                                ? 'text-[#8A6508] hover:text-[#5C4002]'
                                : 'text-[#2E75B6] hover:text-[#1F5687]'
                            }`}
                            title="Klik kode dokumen untuk membuka Pop-up DOCUMENT DETAIL"
                          >
                            <span className="truncate">{doc.referenceNumber}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </button>
                        </div>

                        <div
                          className={`text-[11px] truncate pt-0.5 ${
                            isGoldenCompleted ? 'text-[#7A5A10]' : 'text-[#787774]'
                          }`}
                        >
                          <span>{doc.programName}</span>
                          <span className="mx-1.5 text-[#DCDAD5]">·</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedActivityId(doc.activityId);
                            }}
                            className={`font-medium hover:underline cursor-pointer ${
                              isGoldenCompleted
                                ? 'text-[#694B03] hover:text-[#4A3402]'
                                : 'text-[#57564F] hover:text-[#2F3437]'
                            }`}
                          >
                            {doc.activityCode ? `${doc.activityCode} – ` : ''}
                            {doc.activityName}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Kolom 2 (4/12): Alur RACI & Posisi Tahap Persetujuan (R → A1/A2 → Direktur) */}
                    <div
                      className={`lg:col-span-4 px-4 py-3.5 min-w-0 border-t lg:border-t-0 lg:border-l flex flex-col justify-center gap-1.5 ${
                        isGoldenCompleted ? 'border-[#E6C972]' : 'border-[#F1F0EC]'
                      }`}
                    >
                      {journey.journeyStages.map((stg) => {
                        const isStgDone = stg.status === 'Selesai';
                        const isStgRev =
                          stg.status === 'Perlu Revisi' || stg.status === 'Ditolak';
                        const isStgActive =
                          stg.status === 'Sedang Berjalan' || stg.isCurrentHolder;
                        const shortCode = stg.code === 'Direktur' ? 'Dir' : stg.code;

                        return (
                          <div
                            key={stg.stepNumber}
                            className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] ${
                              isStgActive
                                ? 'bg-[#F2F8FC] border border-[#CDE3F0]'
                                : 'bg-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`w-6 text-center px-1 py-0.2 rounded font-mono text-[10px] font-bold shrink-0 ${
                                  isGoldenCompleted && isStgDone
                                    ? 'bg-[#F5DE93] text-[#694B03] border border-[#D4AF37]'
                                    : isStgActive
                                    ? 'bg-[#2E75B6] text-white'
                                    : isStgDone
                                    ? 'bg-[#EDF3EC] text-[#3F7E59] border border-[#C7DFC5]'
                                    : 'bg-[#F4F3EF] text-[#787774] border border-[#E3E2E0]'
                                }`}
                              >
                                {shortCode}
                              </span>
                              <span
                                className={`truncate ${
                                  isGoldenCompleted
                                    ? 'font-medium text-[#5C4002]'
                                    : isStgActive
                                    ? 'font-semibold text-[#2F3437]'
                                    : 'text-[#57564F]'
                                }`}
                              >
                                {stg.personName}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {stg.receivedAt && stg.stepNumber > 1 && (
                                <span
                                  className={`text-[10px] font-mono hidden sm:inline ${
                                    isGoldenCompleted ? 'text-[#8A6508]' : 'text-[#9B9A97]'
                                  }`}
                                >
                                  {formatShortDate(stg.receivedAt)}
                                </span>
                              )}
                              <span
                                className={`text-[10px] font-semibold whitespace-nowrap ${
                                  isGoldenCompleted && isStgDone
                                    ? 'text-[#7A5907]'
                                    : isStgDone
                                    ? 'text-[#3F7E59]'
                                    : isStgRev
                                    ? 'text-[#B87D1E]'
                                    : isStgActive
                                    ? 'text-[#2E75B6]'
                                    : 'text-[#9B9A97]'
                                }`}
                              >
                                {isStgDone
                                  ? '✓ Selesai'
                                  : isStgRev
                                  ? 'Perlu Revisi'
                                  : isStgActive
                                  ? stg.code === 'Direktur' && journey.isProgramDoc
                                    ? '● Menunggu Laporan'
                                    : '● Sedang Ditinjau'
                                  : 'Menunggu'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Kolom 3 (3/12): Kupon Kanan Tiket dengan Garis Perforasi Vertikal */}
                    <div
                      className={`lg:col-span-3 relative border-t lg:border-t-0 lg:border-l border-dashed p-4 flex flex-wrap lg:flex-col lg:items-end justify-between gap-2.5 ${
                        isGoldenCompleted
                          ? 'bg-gradient-to-br from-[#F7E4A6] to-[#EED37E] border-[#C9A227]'
                          : 'bg-[#FCFCFA] border-[#DCDAD5]'
                      }`}
                    >
                      <div className="flex flex-wrap lg:flex-col lg:items-end gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold whitespace-nowrap ${
                            isGoldenCompleted
                              ? 'bg-[#FFFDF5] text-[#694B03] border border-[#D4AF37]'
                              : docStatus.badgeStyle
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              isGoldenCompleted ? 'bg-[#B8860B]' : docStatus.dotColor
                            }`}
                          />
                          <span>{docStatus.label}</span>
                        </span>

                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium whitespace-nowrap ${
                            isGoldenCompleted
                              ? 'bg-[#694B03] text-[#FFFDF5] border border-[#5C4002]'
                              : stateBadge.className
                          }`}
                        >
                          {isGoldenCompleted ? 'Selesai' : stateBadge.label}
                        </span>
                      </div>

                      <div
                        className="flex flex-wrap items-center justify-end gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isROwner &&
                          (doc.status === 'Revision Required' || doc.status === 'Rejected') && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenSourceDocumentEditor(doc, true)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FBF3DB] hover:bg-[#F5E7C1] text-[#B87D1E] border border-[#EAD6A3] text-[11px] font-semibold transition-colors cursor-pointer"
                                title="Unggah / perbaiki versi revisi dokumen asli"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Revisi</span>
                              </button>
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() =>
                                  handleExecuteAction(doc, 'create_new_version')
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#3F7E59] hover:bg-[#336849] text-white text-[11px] font-semibold transition-colors cursor-pointer"
                                title="Ajukan ulang dokumen revisi melalui alur persetujuan"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Ajukan Ulang</span>
                              </button>
                            </>
                          )}

                        <button
                          type="button"
                          onClick={() => setSelectedItemId(doc.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            isGoldenCompleted
                              ? 'bg-[#FFFDF5] hover:bg-[#FFF6D6] text-[#694B03] border border-[#B8860B] shadow-2xs'
                              : isUrgentForMe
                              ? 'bg-[#E7F3F8] hover:bg-[#D5E9F4] text-[#2E75B6] border border-[#C5DFEE]'
                              : 'bg-white hover:bg-[#F4F3EF] text-[#2F3437] border border-[#E3E2E0]'
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Chat Box &amp; Preview</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ======================================================================
          BLOCK 4 PANDUAN RINGKAS: DOCUMENT DETAIL (4 KOMPONEN INTEGRASI)
         ====================================================================== */}
      <div className="p-4 rounded-xl border border-[#E6E5E2] bg-[#FAF9F6] flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-wider text-[#2F3437]">
            DOCUMENT DETAIL (Klik Tiket atau Kode Dokumen di Atas untuk Membuka Pop-up)
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#57564F] mt-1">
            <span>• Document Preview</span>
            <span>• Shared Discussion Pop-up</span>
            <span>• Approval Journey (R → A1/A2 → Direktur)</span>
            <span>• Audit Trail &amp; Riwayat Versi (Terbaru di Atas)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
