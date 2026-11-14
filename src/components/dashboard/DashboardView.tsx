import React, { useState, useMemo, useEffect } from 'react';
import { Tor, Program, DashboardStats, Outcome, Output, Activity, SubActivity, CashAdvanceRecord, MeetingMinutesRecord, OutputRaciRecord } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { ActivityStatusBadge, SubmissionStatusBadge } from '../common/Badges.js';
import { formatPeriodRange, formatIndonesianDate, getNotulenReportingSchedule } from '../../lib/dateUtils.js';
import { getStatusDotInfo, getSmartPriorityRank, StatusDotInfo } from '../../lib/statusDot.js';
import { api } from '../../lib/api.js';
import {
  Plus,
  ChevronDown,
  Search,
  FileText,
  ArrowRight,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  X,
  Building,
  Check,
  Send,
  ExternalLink,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';

interface DashboardViewProps {
  tors: Tor[];
  stats: DashboardStats;
  loading: boolean;
  onSelectTor: (torId: string, initialStage?: number) => void;
  onCreateTor: () => void;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  programs?: Program[];
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  subActivities?: SubActivity[];
  onNavigateToPrograms?: () => void;
  onOpenCreateTorForActivity?: (outcomeId: string, outputId: string, activityId: string) => void;
  onRefreshData?: () => void;
}

type UrgencyGroupKey = 'ALL' | 'NEEDS_ATTENTION' | 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETED';

interface UrgencyInfo {
  group: UrgencyGroupKey;
  groupLabel: string;
  diffDays: number;
  nearestDueDate: string;
  formattedDateUpper: string;
  remainingText: string;
  urgencyLevel: 'overdue' | 'near' | 'normal' | 'completed';
  nearestMilestoneTitle: string;
  fulfilledCount: number;
  totalCount: number;
}

function calculateUrgency(tor: Tor, minutesList: MeetingMinutesRecord[] = []): UrgencyInfo {
  const schedule = getNotulenReportingSchedule(tor, minutesList);
  const effectiveDeadline = schedule.nearestDueDate || tor.reportingDeadline || '';
  const formattedDateUpper = effectiveDeadline
    ? formatIndonesianDate(effectiveDeadline).toUpperCase()
    : '-';

  if (tor.activityStatus === 'Selesai' || schedule.allFulfilled) {
    return {
      group: 'COMPLETED',
      groupLabel: 'Selesai',
      diffDays: 9999,
      nearestDueDate: effectiveDeadline,
      formattedDateUpper,
      remainingText: schedule.allFulfilled ? 'Notulen Terpenuhi' : 'Selesai',
      urgencyLevel: 'completed',
      nearestMilestoneTitle: schedule.nearestMilestoneTitle,
      fulfilledCount: schedule.fulfilledCount,
      totalCount: schedule.totalCount,
    };
  }

  if (!effectiveDeadline) {
    return {
      group: 'UPCOMING',
      groupLabel: 'Akan Jatuh Tempo',
      diffDays: 9999,
      nearestDueDate: '',
      formattedDateUpper: '-',
      remainingText: 'Tenggat belum diatur',
      urgencyLevel: 'normal',
      nearestMilestoneTitle: schedule.nearestMilestoneTitle,
      fulfilledCount: schedule.fulfilledCount,
      totalCount: schedule.totalCount,
    };
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr).getTime();
  const deadMs = new Date(effectiveDeadline).getTime();
  const diffDays = Math.ceil((deadMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      group: 'NEEDS_ATTENTION',
      groupLabel: 'Perlu Perhatian',
      diffDays,
      nearestDueDate: effectiveDeadline,
      formattedDateUpper,
      remainingText: `Terlambat ${Math.abs(diffDays)} hari`,
      urgencyLevel: 'overdue',
      nearestMilestoneTitle: schedule.nearestMilestoneTitle,
      fulfilledCount: schedule.fulfilledCount,
      totalCount: schedule.totalCount,
    };
  }

  if (diffDays === 0) {
    return {
      group: 'NEEDS_ATTENTION',
      groupLabel: 'Perlu Perhatian',
      diffDays,
      nearestDueDate: effectiveDeadline,
      formattedDateUpper,
      remainingText: 'Jatuh tempo hari ini',
      urgencyLevel: 'near',
      nearestMilestoneTitle: schedule.nearestMilestoneTitle,
      fulfilledCount: schedule.fulfilledCount,
      totalCount: schedule.totalCount,
    };
  }

  if (diffDays <= 3) {
    return {
      group: 'NEEDS_ATTENTION',
      groupLabel: 'Perlu Perhatian',
      diffDays,
      nearestDueDate: effectiveDeadline,
      formattedDateUpper,
      remainingText: `Sisa ${diffDays} hari`,
      urgencyLevel: 'near',
      nearestMilestoneTitle: schedule.nearestMilestoneTitle,
      fulfilledCount: schedule.fulfilledCount,
      totalCount: schedule.totalCount,
    };
  }

  if (tor.activityStatus === 'Sedang Berjalan') {
    return {
      group: 'IN_PROGRESS',
      groupLabel: 'Berjalan',
      diffDays,
      nearestDueDate: effectiveDeadline,
      formattedDateUpper,
      remainingText: `Sisa ${diffDays} hari`,
      urgencyLevel: 'normal',
      nearestMilestoneTitle: schedule.nearestMilestoneTitle,
      fulfilledCount: schedule.fulfilledCount,
      totalCount: schedule.totalCount,
    };
  }

  return {
    group: 'UPCOMING',
    groupLabel: 'Akan Jatuh Tempo',
    diffDays,
    nearestDueDate: effectiveDeadline,
    formattedDateUpper,
    remainingText: `Sisa ${diffDays} hari`,
    urgencyLevel: 'normal',
    nearestMilestoneTitle: schedule.nearestMilestoneTitle,
    fulfilledCount: schedule.fulfilledCount,
    totalCount: schedule.totalCount,
  };
}

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

function formatRupiahCompact(amount?: number | null): string {
  if (amount == null || isNaN(amount)) return 'Belum tersedia';
  if (amount >= 1000000000) {
    const val = (amount / 1000000000).toLocaleString('id-ID', { maximumFractionDigits: 1 });
    return `Rp${val} M`;
  }
  if (amount >= 1000000) {
    const val = (amount / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 });
    return `Rp${val} jt`;
  }
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  tors = [],
  stats,
  loading,
  onSelectTor,
  onCreateTor,
  searchTerm,
  setSearchTerm,
  programs = [],
  outcomes = [],
  outputs = [],
  activities = [],
  subActivities = [],
  onNavigateToPrograms,
  onRefreshData,
}) => {
  const { currentUser, isDirector: rawIsDirector, isSystemAdmin } = useAuth();
  const isDirector = rawIsDirector || isSystemAdmin;
  const [confirmDeleteTorId, setConfirmDeleteTorId] = useState<string | null>(null);
  const [deletingTorId, setDeletingTorId] = useState<string | null>(null);

  // Complete Filter States
  const [filterSubmissionStatus, setFilterSubmissionStatus] = useState<string>('all');
  const [filterActivityStatus, setFilterActivityStatus] = useState<string>('all');
  const [filterUrgency, setFilterUrgency] = useState<string>('all');
  const [filterPic, setFilterPic] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'deadline' | 'newest' | 'name'>('deadline');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 10;

  // Single active accordion at a time (default all closed)
  const [expandedTorId, setExpandedTorId] = useState<string | null>(null);

  // Toggle state for filter panel (tombol Filter di sebelah Cari)
  const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false);

  // Workflow stages accordion per TOR
  const [openWorkflowTorId, setOpenWorkflowTorId] = useState<string | null>(null);
  // Active workflow stage document preview
  const [activeStageNum, setActiveStageNum] = useState<string>('01');

  // Quick Submit Loading State for Creator
  const [quickSubmitLoadingTorId, setQuickSubmitLoadingTorId] = useState<string | null>(null);

  // Cash Advances, Meeting Minutes & Output RACI Records for accurate budget, nearest Notulen deadline & R/A1/C display per TOR
  const [allCashAdvances, setAllCashAdvances] = useState<CashAdvanceRecord[]>([]);
  const [allMeetingMinutes, setAllMeetingMinutes] = useState<MeetingMinutesRecord[]>([]);
  const [outputRaciMap, setOutputRaciMap] = useState<Record<string, OutputRaciRecord>>({});
  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.getCashAdvances().catch(() => []),
      api.getMeetingMinutes().catch(() => []),
      api.getMonitoringConnect().catch(() => null),
    ]).then(([caRes, momRes, mcRes]) => {
      if (!mounted) return;
      if (Array.isArray(caRes)) {
        setAllCashAdvances(caRes);
      }
      if (Array.isArray(momRes)) {
        setAllMeetingMinutes(momRes);
      }
      if (mcRes && mcRes.outputRaciRecords) {
        setOutputRaciMap(mcRes.outputRaciRecords);
      }
    });
    return () => {
      mounted = false;
    };
  }, [tors]);

  const toggleAccordion = (torId: string) => {
    setExpandedTorId((prev) => (prev === torId ? null : torId));
  };

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent, torId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleAccordion(torId);
    }
  };

  // Unique PICs for filter dropdown
  const uniquePics = useMemo(
    () => Array.from(new Set(tors.map((t) => t.picName))).filter(Boolean),
    [tors]
  );

  // Filter & Sort Logic (Comprehensive & Unified)
  const processedTors = useMemo(() => {
    let list = tors.filter((t) => {
      // 1. Search text (full-field match: judul, nomor TOR, kegiatan, PIC)
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          (t.title || '').toLowerCase().includes(q) ||
          (t.torNumber || '').toLowerCase().includes(q) ||
          (t.picName || '').toLowerCase().includes(q) ||
          (t.activityName || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      // 2. Filter PIC
      if (filterPic !== 'all' && t.picName !== filterPic) return false;

      // 3. Filter Status Pengajuan
      if (filterSubmissionStatus !== 'all') {
        if (filterSubmissionStatus === 'menunggu') {
          if (!(t.submissionStatus || '').includes('Menunggu Persetujuan')) return false;
        } else if (t.submissionStatus !== filterSubmissionStatus) {
          return false;
        }
      }

      // 4. Filter Status Kegiatan
      if (filterActivityStatus !== 'all' && t.activityStatus !== filterActivityStatus) {
        return false;
      }

      // 5. Filter Tenggat / Urgensi
      if (filterUrgency !== 'all') {
        const urg = calculateUrgency(t, allMeetingMinutes);
        if (filterUrgency === 'needs_attention') {
          if (urg.group !== 'NEEDS_ATTENTION') return false;
        } else if (filterUrgency === 'overdue') {
          if (urg.urgencyLevel !== 'overdue') return false;
        } else if (filterUrgency === 'near') {
          if (urg.urgencyLevel !== 'near') return false;
        }
      }

      return true;
    });

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'name') {
        return (a.title || '').localeCompare(b.title || '');
      }
      if (sortBy === 'newest') {
        return (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0);
      }

      // Default: Smart Deadline Priority (TOR dengan deadline paling dekat berada paling atas)
      const pA = getSmartPriorityRank(a, allMeetingMinutes);
      const pB = getSmartPriorityRank(b, allMeetingMinutes);

      if (pA.rank !== pB.rank) return pA.rank - pB.rank;
      if (pA.subOrder !== pB.subOrder) return pA.subOrder - pB.subOrder;

      // Urutan sekunder: tanggal pembuatan terbaru, lalu nomor TOR
      const dateDiff = (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0);
      if (dateDiff !== 0) return dateDiff;

      return (a.torNumber || '').localeCompare(b.torNumber || '');
    });

    return list;
  }, [tors, allMeetingMinutes, searchTerm, filterPic, filterSubmissionStatus, filterActivityStatus, filterUrgency, sortBy]);

  // Reset all filters
  const isFiltered =
    searchTerm.trim() !== '' ||
    filterPic !== 'all' ||
    filterSubmissionStatus !== 'all' ||
    filterActivityStatus !== 'all' ||
    filterUrgency !== 'all';

  // Jumlah filter aktif (di luar kata kunci pencarian)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterSubmissionStatus !== 'all') count++;
    if (filterActivityStatus !== 'all') count++;
    if (filterUrgency !== 'all') count++;
    if (filterPic !== 'all') count++;
    if (sortBy !== 'deadline') count++;
    return count;
  }, [filterSubmissionStatus, filterActivityStatus, filterUrgency, filterPic, sortBy]);

  const handleResetFilters = () => {
    setSearchTerm('');
    setFilterPic('all');
    setFilterSubmissionStatus('all');
    setFilterActivityStatus('all');
    setFilterUrgency('all');
    setSortBy('deadline');
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(processedTors.length / itemsPerPage) || 1;
  const paginatedTors = processedTors.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const canCreate = currentUser?.permissions?.canCreateTor && currentUser.role !== 'admin';

  return (
    <div className="space-y-3 max-w-6xl mx-auto pb-16">
      {/* ============================================================== */}
      {/* COMMAND CENTER: BARIS ATAS PROPORSIONAL (CARI + FILTER + BUAT TOR) */}
      {/* ============================================================== */}
      <section className="space-y-2.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full box-border">
          {/* Kolom Cari */}
          <div className="relative flex-1 min-w-0 box-border">
            <Search className="w-4 h-4 text-[#8C8C89] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari dokumen TOR, nomor dokumen, kegiatan, atau PIC..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full min-w-0 box-border h-[42px] pl-10 pr-9 text-[13.5px] bg-white border border-[#E5E5E3] hover:border-[#D4D4D0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/15 focus:border-[#1D4ED8] transition-all text-[#171717] placeholder:text-[#8C8C89]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C8C89] hover:text-[#171717] p-1 rounded cursor-pointer transition-colors"
                title="Hapus kata kunci pencarian"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Kanan: Tombol Filter & Tombol Biru (+ Buat TOR) Sejajar dan Proporsional */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              aria-expanded={isFilterOpen}
              className={`inline-flex items-center justify-center gap-2 h-[42px] px-4 bg-white hover:bg-[#F7F7F5] border rounded-xl text-[13.5px] font-medium transition-all cursor-pointer shrink-0 select-none ${
                isFilterOpen || activeFilterCount > 0
                  ? 'border-[#1D4ED8] text-[#1D4ED8] bg-blue-50/20 shadow-2xs'
                  : 'border-[#E5E5E3] hover:border-[#D4D4D0] text-[#2F3437]'
              }`}
              title="Buka / tutup filter"
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0 text-[#2F3437]" />
              <span className="text-[#2F3437]">Filter</span>
              {activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#1D4ED8] text-white text-[10.5px] font-bold leading-none shrink-0">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 text-[#5F5E5B] transition-transform duration-200 ${
                  isFilterOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {canCreate && (
              <button
                type="button"
                onClick={onCreateTor}
                className="h-[42px] px-4 inline-flex items-center justify-center gap-2 bg-[#1D4ED8] hover:bg-[#1E40AF] active:bg-[#1E3A8A] text-white text-[13.5px] font-medium rounded-xl shadow-2xs transition-colors shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:ring-offset-1 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Buat TOR</span>
              </button>
            )}
          </div>
        </div>

        {/* BARIS 3: 5 FILTER PROPORSIONAL FULL WIDTH (DIBUKA VIA TOMBOL FILTER) */}
        {isFilterOpen && (
          <div className="w-full box-border grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* 1. Filter Status Pengajuan */}
            <div className="relative w-full min-w-0 box-border">
              <select
                value={filterSubmissionStatus}
                onChange={(e) => {
                  setFilterSubmissionStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className={`w-full min-w-0 box-border h-[46px] text-[13px] bg-white border rounded-xl pl-3.5 pr-8 appearance-none text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/15 focus:border-[#1D4ED8] cursor-pointer transition-all truncate ${
                  filterSubmissionStatus !== 'all' ? 'border-[#1D4ED8] bg-blue-50/40 font-medium' : 'border-[#E5E5E3] hover:border-[#D4D4D0]'
                }`}
              >
                <option value="all">Semua Status Pengajuan</option>
                <option value="menunggu">Menunggu Persetujuan</option>
                <option value="Draft">Draft</option>
                <option value="Menunggu Persetujuan Director">Menunggu Director</option>
                <option value="Menunggu Persetujuan Finance">Menunggu Finance</option>
                <option value="Disetujui">Disetujui</option>
                <option value="Perlu Perbaikan">Perlu Perbaikan</option>
                <option value="Ditolak">Ditolak</option>
              </select>
              <ChevronDown className="w-4 h-4 text-[#8C8C89] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none shrink-0" />
            </div>

            {/* 2. Filter Status Kegiatan */}
            <div className="relative w-full min-w-0 box-border">
              <select
                value={filterActivityStatus}
                onChange={(e) => {
                  setFilterActivityStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className={`w-full min-w-0 box-border h-[46px] text-[13px] bg-white border rounded-xl pl-3.5 pr-8 appearance-none text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/15 focus:border-[#1D4ED8] cursor-pointer transition-all truncate ${
                  filterActivityStatus !== 'all' ? 'border-[#1D4ED8] bg-blue-50/40 font-medium' : 'border-[#E5E5E3] hover:border-[#D4D4D0]'
                }`}
              >
                <option value="all">Semua Status Kegiatan</option>
                <option value="Sedang Berjalan">Sedang Berjalan</option>
                <option value="Belum Dimulai">Belum Dimulai</option>
                <option value="Selesai">Selesai</option>
              </select>
              <ChevronDown className="w-4 h-4 text-[#8C8C89] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none shrink-0" />
            </div>

            {/* 3. Filter Tenggat / Urgensi */}
            <div className="relative w-full min-w-0 box-border">
              <select
                value={filterUrgency}
                onChange={(e) => {
                  setFilterUrgency(e.target.value);
                  setCurrentPage(1);
                }}
                className={`w-full min-w-0 box-border h-[46px] text-[13px] bg-white border rounded-xl pl-3.5 pr-8 appearance-none text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/15 focus:border-[#1D4ED8] cursor-pointer transition-all truncate ${
                  filterUrgency !== 'all' ? 'border-[#1D4ED8] bg-blue-50/40 font-medium' : 'border-[#E5E5E3] hover:border-[#D4D4D0]'
                }`}
              >
                <option value="all">Semua Tenggat / Urgensi</option>
                <option value="needs_attention">Perlu Perhatian</option>
                <option value="overdue">Terlambat</option>
                <option value="near">Mendekati Deadline (0–3 Hari)</option>
              </select>
              <ChevronDown className="w-4 h-4 text-[#8C8C89] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none shrink-0" />
            </div>

            {/* 4. Filter PIC */}
            <div className="relative w-full min-w-0 box-border">
              <select
                value={filterPic}
                onChange={(e) => {
                  setFilterPic(e.target.value);
                  setCurrentPage(1);
                }}
                className={`w-full min-w-0 box-border h-[46px] text-[13px] bg-white border rounded-xl pl-3.5 pr-8 appearance-none text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/15 focus:border-[#1D4ED8] cursor-pointer transition-all truncate ${
                  filterPic !== 'all' ? 'border-[#1D4ED8] bg-blue-50/40 font-medium' : 'border-[#E5E5E3] hover:border-[#D4D4D0]'
                }`}
              >
                <option value="all">Semua PIC</option>
                {uniquePics.map((pic) => (
                  <option key={pic} value={pic}>
                    PIC: {pic}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#8C8C89] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none shrink-0" />
            </div>

            {/* 5. Filter Urutkan */}
            <div className="relative w-full min-w-0 box-border">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full min-w-0 box-border h-[46px] text-[13px] bg-white border border-[#E5E5E3] hover:border-[#D4D4D0] rounded-xl pl-3.5 pr-8 appearance-none text-[#171717] font-medium focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/15 focus:border-[#1D4ED8] cursor-pointer transition-all truncate"
              >
                <option value="deadline">Urutkan: Deadline Terdekat</option>
                <option value="newest">Urutkan: Dokumen Terbaru</option>
                <option value="name">Urutkan: Nama TOR (A-Z)</option>
              </select>
              <ChevronDown className="w-4 h-4 text-[#8C8C89] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none shrink-0" />
            </div>
          </div>
        )}

        {/* BARIS 4: RINGKASAN HASIL & RESET FILTER */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs text-[#787774] px-0.5">
          <div className="select-none font-medium">
            {isFiltered ? (
              <span>
                Menampilkan <strong className="text-[#171717] font-semibold">{processedTors.length}</strong> dari {tors.length} TOR
              </span>
            ) : (
              <span>
                Total <strong className="text-[#171717] font-semibold">{tors.length}</strong> TOR
              </span>
            )}
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 text-xs text-[#DC2626] hover:text-[#B91C1C] hover:bg-red-50 border border-red-200/80 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer font-medium"
              title="Reset semua filter"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filter</span>
            </button>
          )}
        </div>
      </section>

      {/* ============================================================== */}
      {/* LAYER C: DOCUMENT INTELLIGENCE LIST (EDITORIAL COMPOSITION)    */}
      {/* ============================================================== */}
      <div className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-[#737373] text-[14px]">
            Memuat dokumen TOR...
          </div>
        ) : paginatedTors.length === 0 ? (
          <div className="py-20 text-center text-[#737373] space-y-2">
            <FileText className="w-8 h-8 text-[#A3A3A0] mx-auto" />
            <p className="font-medium text-[#171717] text-[15px]">
              Tidak ada dokumen TOR yang cocok
            </p>
            <p className="text-xs text-[#737373]">
              Coba sesuaikan kata kunci pencarian atau pilihan filter di atas.
            </p>
            {isFiltered && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F2F2EF] hover:bg-[#EAEAE6] text-[#171717] rounded-md text-[13px] font-medium transition-colors cursor-pointer mt-2"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#787774]" />
                <span>Reset Semua Filter</span>
              </button>
            )}
          </div>
        ) : (
          paginatedTors.map((tor) => {
            const isExpanded = expandedTorId === tor.id;
            const urgency = calculateUrgency(tor, allMeetingMinutes);
            const statusDot = getStatusDotInfo(tor, allMeetingMinutes);

            return (
              <div key={tor.id} className="transition-colors">
                {/* Main Editorial Row: 70% Document, 30% Deadline & Controls */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleAccordion(tor.id)}
                  onKeyDown={(e) => handleKeyDown(e, tor.id)}
                  className={`px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between gap-4 cursor-pointer select-none transition-colors duration-150 group outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] focus-visible:ring-inset ${
                    isExpanded ? 'bg-[#FAF9F7]' : 'bg-white hover:bg-[#F7F7F5]'
                  }`}
                >
                  {/* Left Column (~70%): Status Dot, Title, Metadata (No index numbers per user request) */}
                  <div className="flex-1 flex items-start gap-3 min-w-0 pr-3">
                    {/* Animated Status Dot (~8px, vertically aligned with title) */}
                    <div
                      className="pt-1.5 shrink-0"
                      title={`Status: ${statusDot.label} — ${statusDot.reason}`}
                    >
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${statusDot.dotColorClass} ${statusDot.pulseClass} ${statusDot.ringColorClass}`}
                      />
                    </div>

                    {/* Title & Metadata (Gambar 2: Judul TOR, Nomor TOR biru, Lokasi & Jadwal Pelaksanaan) */}
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[15.5px] md:text-[16.5px] font-semibold text-[#2F3437] group-hover:text-[#1D4ED8] transition-colors line-clamp-2 leading-snug">
                        {tor.title}
                      </h2>
                      <div className="font-mono text-[12px] text-[#1D4ED8] font-semibold mt-0.5">
                        {tor.torNumber}
                      </div>
                      <div className="text-[12px] text-[#787774] mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span>{tor.location || 'Lokasi belum ditentukan'}</span>
                        <span>·</span>
                        <span>{formatPeriodRange(tor.startDate, tor.endDate)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column (~30%): Urgency Bar, Deadline Timeline, Chevron */}
                  <div className="flex items-center gap-3.5 shrink-0 pl-2">
                    {/* Urgency Vertical Accent Line */}
                    <div
                      className={`w-[2px] h-7 rounded-full shrink-0 ${
                        urgency.urgencyLevel === 'overdue'
                          ? 'bg-[#DC2626]'
                          : urgency.urgencyLevel === 'near'
                          ? 'bg-[#D97706]'
                          : urgency.urgencyLevel === 'completed'
                          ? 'bg-[#16A34A]'
                          : 'bg-[#EDEDEC]'
                      }`}
                    />

                    {/* Deadline Typography Block (Date Upper + Remaining Status) */}
                    <div className="text-right leading-tight min-w-[105px] sm:min-w-[125px]">
                      <div className="text-[12.5px] font-semibold tracking-wider text-[#2F3437] uppercase font-sans">
                        {urgency.formattedDateUpper}
                      </div>
                      <div
                        className={`text-[11.5px] mt-0.5 ${
                          urgency.urgencyLevel === 'overdue'
                            ? 'text-[#DC2626] font-medium'
                            : urgency.urgencyLevel === 'near'
                            ? 'text-[#D97706] font-medium'
                            : urgency.urgencyLevel === 'completed'
                            ? 'text-[#16A34A] font-medium'
                            : 'text-[#787774]'
                        }`}
                      >
                        {urgency.remainingText}
                      </div>
                    </div>

                    {/* Chevron Icon */}
                    <div className="p-1 text-[#9A9996] group-hover:text-[#2F3437] transition-colors">
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          isExpanded ? 'rotate-180 text-[#1D4ED8]' : ''
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* ============================================================== */}
                {/* LIVING DOCUMENT ACCORDION: COMPACT, DENSE, PROFESSIONAL        */}
                {/* ============================================================== */}
                {isExpanded && (() => {
                  // 1. Relasi hierarki berjenjang: Activity -> Output -> Outcome -> Program
                  const resolvedActivity = activities.find((a) => a.id === tor.activityId);
                  const resolvedOutput = outputs.find((o) => o.id === (resolvedActivity?.outputId || tor.outputId));
                  const resolvedOutcome = outcomes.find((oc) => oc.id === (resolvedOutput?.outcomeId || tor.outcomeId));
                  const resolvedProgram = programs.find((p) => p.id === (resolvedOutcome?.programId || tor.programId));
                  const resolvedSubActivity = subActivities.find((s) => s.id === tor.subActivityId || s.activityId === tor.activityId);

                  // 2. Kalkulasi Anggaran
                  const hasRequested = tor.budgetRequested != null && !isNaN(tor.budgetRequested);
                  const hasApproved = tor.budgetApproved != null && !isNaN(tor.budgetApproved);
                  const hasActualSpent = tor.budgetActualSpent != null && !isNaN(tor.budgetActualSpent);

                  const diffRequestedApproved = hasRequested && hasApproved ? tor.budgetRequested! - tor.budgetApproved! : null;
                  const remainingBudget = hasApproved && hasActualSpent ? tor.budgetApproved! - tor.budgetActualSpent! : null;

                  // 3. Hak Akses Submit (Pembuat)
                  const isCreator = tor.createdById === currentUser?.id;
                  const canSubmit = isCreator && (tor.submissionStatus === 'Draft' || tor.submissionStatus === 'Perlu Perbaikan');

                  return (
                    <div className="px-4 sm:px-5 py-3.5 bg-white border-t border-[#EDEDEC] animate-in fade-in duration-150 space-y-3">
                      {/* 1. INTEGRATED COMPACT STATUS, PELAPORAN, KODE ACTIVITY & RANTAI TUJUAN KHUSUS */}
                      {(() => {
                        const activityCodeStr =
                          tor.activityCode ||
                          tor.hierarchyCode ||
                          resolvedActivity?.code ||
                          '1.2.1';
                        const objectivesList =
                          tor.specificObjectives && tor.specificObjectives.length > 0
                            ? tor.specificObjectives
                            : [
                                {
                                  id: 'fallback-obj-1',
                                  objective:
                                    tor.objectives ||
                                    tor.generalObjective ||
                                    'Meningkatkan kapasitas teknis dan tata kelola pelaksanaan kegiatan sesuai sasaran program.',
                                  expectedResult:
                                    tor.expectedResults ||
                                    'Terlaksananya kegiatan sesuai target indikator dan standar operasional prosedur.',
                                  expectedChange:
                                    tor.generalObjective ||
                                    'Terbangun keberlanjutan manfaat kegiatan secara mandiri dan akuntabel di tingkat sasaran.',
                                },
                              ];

                        const activityNameStr =
                          resolvedActivity?.name ||
                          tor.activityName ||
                          tor.title;

                        const torCas = allCashAdvances.filter(
                          (c) => c.torId === tor.id && c.status !== 'Ditolak'
                        );
                        const totalCaRequested = torCas.reduce(
                          (sum, c) => sum + (Number(c.totalAmount) || 0),
                          0
                        );
                        const activeUnreportedCaSum = torCas
                          .filter((c) => !c.isReported)
                          .reduce((sum, c) => sum + (Number(c.totalAmount) || 0), 0);

                        const totalDanaDiajukan =
                          totalCaRequested > 0
                            ? totalCaRequested
                            : tor.budgetRequested ?? tor.budgetApproved ?? 0;

                        const totalDanaSedangDipakai =
                          tor.budgetActualSpent != null && tor.budgetActualSpent > 0
                            ? tor.budgetActualSpent
                            : activeUnreportedCaSum > 0
                            ? activeUnreportedCaSum
                            : totalCaRequested;

                        return (
                          <div className="rounded-lg border border-[#EAEAEA] bg-white overflow-hidden">
                            {/* A. Executive 2-Row Metadata & Financial Strip (Proportional 3-Column Grid Aligned with Tujuan Khusus Below) */}
                            <div className="bg-[#FAF9F7] border-b border-[#EAEAEA] divide-y divide-[#EAEAEA] text-[12px]">
                              {/* Row 1: Activity (Kode + Nama Activity) | Total Dana Diajukan | Total Dana Sedang Dipakai */}
                              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#EAEAEA]">
                                {/* Col 1: Activity (Kode + Nama) */}
                                <div className="p-3 flex flex-col justify-between">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C8C89]">
                                      Activity
                                    </span>
                                    <span className="font-mono text-[10.5px] font-semibold text-[#1D4ED8] bg-blue-50/90 border border-blue-200/80 px-1.5 py-0.5 rounded leading-none">
                                      Activity {activityCodeStr}
                                    </span>
                                  </div>
                                  <div className="font-semibold text-[#171717] text-[12.5px] leading-snug">
                                    {activityNameStr}
                                  </div>
                                </div>

                                {/* Col 2: Total Dana Diajukan */}
                                <div className="p-3 flex flex-col justify-between">
                                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C8C89] mb-1">
                                    Total Dana Diajukan
                                  </span>
                                  <div>
                                    <div className="font-mono text-[14px] font-bold text-[#171717] tabular-nums leading-tight">
                                      {formatRupiah(totalDanaDiajukan)}
                                    </div>
                                    <div className="text-[11px] text-[#787774] mt-0.5">
                                      {torCas.length > 0
                                        ? `Terhubung ${torCas.length} pengajuan CA`
                                        : 'Sesuai anggaran pengajuan TOR'}
                                    </div>
                                  </div>
                                </div>

                                {/* Col 3: Total Dana Sedang Dipakai */}
                                <div className="p-3 flex flex-col justify-between">
                                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C8C89] mb-1">
                                    Total Dana Sedang Dipakai
                                  </span>
                                  <div>
                                    <div className="font-mono text-[14px] font-bold text-[#0F7B6C] tabular-nums leading-tight">
                                      {formatRupiah(totalDanaSedangDipakai)}
                                    </div>
                                    <div className="text-[11px] text-[#787774] mt-0.5">
                                      {totalDanaDiajukan > 0
                                        ? `${Math.min(100, Math.round((totalDanaSedangDipakai / totalDanaDiajukan) * 100))}% dari total dana diajukan`
                                        : 'Realisasi operasional berjalan'}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Row 2: Penugasan RACI (R · A1 · C) | Status Kegiatan + Aturan & Frekuensi Pelaporan | Tenggat Laporan Final */}
                              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#EAEAEA]">
                                {/* Col 1: Penugasan R · A1 · C */}
                                {(() => {
                                  const outId = resolvedOutput?.id || tor.outputId;
                                  const raci = outId ? outputRaciMap[outId] : undefined;
                                  const rName = raci?.responsibleUserName || tor.picName || tor.createdByName || '-';
                                  const a1Name = raci?.accountableUserName || 'Program Manager';
                                  const cNames =
                                    raci?.consultedUsers && raci.consultedUsers.length > 0
                                      ? raci.consultedUsers.join(', ')
                                      : '-';

                                  return (
                                    <div className="p-3 flex flex-col justify-between">
                                      <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C8C89] mb-1.5">
                                        Penugasan RACI (R · A1 · C)
                                      </span>
                                      <div className="space-y-1.5">
                                        <div className="grid grid-cols-[28px_1fr] items-center gap-2 text-[12px] leading-tight">
                                          <span className="inline-flex items-center justify-center h-5 font-mono text-[10px] font-bold rounded bg-blue-50 text-[#1D4ED8] border border-blue-200/80">
                                            R
                                          </span>
                                          <span className="font-semibold text-[#171717] truncate" title={rName}>
                                            {rName}
                                          </span>
                                        </div>
                                        <div className="grid grid-cols-[28px_1fr] items-center gap-2 text-[12px] leading-tight">
                                          <span className="inline-flex items-center justify-center h-5 font-mono text-[10px] font-bold rounded bg-amber-50 text-[#B45309] border border-amber-200/80">
                                            A1
                                          </span>
                                          <span className="font-medium text-[#2F3437] truncate" title={a1Name}>
                                            {a1Name}
                                          </span>
                                        </div>
                                        <div className="grid grid-cols-[28px_1fr] items-center gap-2 text-[12px] leading-tight">
                                          <span className="inline-flex items-center justify-center h-5 font-mono text-[10px] font-bold rounded bg-slate-100 text-[#475569] border border-slate-200">
                                            C
                                          </span>
                                          <span className="text-[#5F5E5B] truncate" title={cNames}>
                                            {cNames}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}

                                {/* Col 2: Status Kegiatan (Di Atas) + Aturan & Frekuensi Pelaporan (Di Bawah) */}
                                <div className="p-3 flex flex-col justify-between space-y-2">
                                  <div>
                                    <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C8C89] block mb-1">
                                      Status Kegiatan
                                    </span>
                                    <div className="font-semibold text-[#171717] text-[12.5px] flex items-center gap-1.5 leading-tight">
                                      <span
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          tor.activityStatus === 'Selesai'
                                            ? 'bg-emerald-500'
                                            : tor.activityStatus === 'Sedang Berjalan'
                                            ? 'bg-blue-500'
                                            : 'bg-slate-400'
                                        }`}
                                      />
                                      <span>{tor.activityStatus}</span>
                                    </div>
                                  </div>

                                  <div className="pt-2 border-t border-[#EAEAEA]">
                                    <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C8C89] block mb-0.5">
                                      Aturan &amp; Frekuensi Pelaporan
                                    </span>
                                    <div className="text-[12px] text-[#171717] leading-snug">
                                      <span className="font-semibold">
                                        {tor.reportingPeriodType || 'Sekali / Akhir Kegiatan'}
                                      </span>
                                      {tor.reportingFrequency && (
                                        <span className="text-[#5F5E5B] font-normal">
                                          {' '}· {tor.reportingFrequency}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Col 3: Tenggat Laporan Final 7 Hari (Executive Summary) */}
                                <div className="p-3 flex flex-col justify-between">
                                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#8C8C89] mb-1">
                                    Tenggat Laporan Final 7 Hari (Executive Summary)
                                  </span>
                                  <div>
                                    <div className="flex flex-wrap items-baseline gap-x-1.5 leading-tight">
                                      <span
                                        className={`font-semibold text-[12.5px] ${
                                          urgency.urgencyLevel === 'overdue'
                                            ? 'text-rose-600'
                                            : 'text-[#171717]'
                                        }`}
                                      >
                                        {formatIndonesianDate(urgency.nearestDueDate || tor.reportingDeadline)}
                                      </span>
                                      <span className="text-[11px] font-medium text-[#5F5E5B]">
                                        ({urgency.remainingText})
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-[#787774] mt-1 leading-snug">
                                      {urgency.nearestMilestoneTitle} · Sinkron: {formatPeriodRange(tor.startDate, tor.endDate)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* B. Rantai Tujuan Khusus, Hasil & Perubahan yang Diharapkan (Compact Structured Grid) */}
                            <div>
                              {/* Single Compact Column Header Row */}
                              <div className="hidden md:grid md:grid-cols-3 bg-[#F4F3EF] border-b border-[#EAEAEA] px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider">
                                <div className="flex items-center justify-between pr-3 text-[#404040]">
                                  <span>Tujuan Khusus</span>
                                  <span className="text-[#8C8C89] font-normal lowercase">
                                    {objectivesList.length} butir
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 pl-3 border-l border-[#E2E1DC] text-[#1D4ED8]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#1D4ED8] shrink-0" />
                                  <span>Hasil yang Diharapkan</span>
                                </div>
                                <div className="flex items-center gap-1.5 pl-3 border-l border-[#E2E1DC] text-[#0F7B6C]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#0F7B6C] shrink-0" />
                                  <span>Perubahan yang Diharapkan</span>
                                </div>
                              </div>

                              {/* Mobile Header */}
                              <div className="flex md:hidden items-center justify-between bg-[#F4F3EF] border-b border-[#EAEAEA] px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#5F5E5B]">
                                <span>Tujuan Khusus · Hasil &amp; Perubahan</span>
                                <span>{objectivesList.length} butir</span>
                              </div>

                              {/* Compact Objective Rows */}
                              <div className="divide-y divide-[#EAEAEA]">
                                {objectivesList.map((item, idx) => (
                                  <div
                                    key={item.id || idx}
                                    className="grid grid-cols-1 md:grid-cols-3 text-[12px] leading-snug hover:bg-[#FAF9F7]/60 transition-colors"
                                  >
                                    {/* Col 1: Tujuan Khusus */}
                                    <div className="p-2.5 flex items-start gap-2">
                                      <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-[#EFEFED] text-[#2F3437] font-mono text-[10px] font-semibold shrink-0 mt-0.5">
                                        {idx + 1}
                                      </span>
                                      <p className="text-[#171717] font-medium leading-snug">
                                        {item.objective}
                                      </p>
                                    </div>

                                    {/* Col 2: Hasil yang Diharapkan */}
                                    <div className="px-2.5 pb-2.5 md:py-2.5 md:pl-3 md:border-l md:border-[#EAEAEA] text-[#404040]">
                                      <div className="flex md:hidden items-center gap-1 text-[9.5px] font-mono font-semibold uppercase text-[#1D4ED8] mb-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#1D4ED8]" />
                                        <span>Hasil yang Diharapkan</span>
                                      </div>
                                      <p className="leading-snug">{item.expectedResult}</p>
                                    </div>

                                    {/* Col 3: Perubahan yang Diharapkan */}
                                    <div className="px-2.5 pb-2.5 md:py-2.5 md:pl-3 md:border-l md:border-[#EAEAEA] text-[#404040]">
                                      <div className="flex md:hidden items-center gap-1 text-[9.5px] font-mono font-semibold uppercase text-[#0F7B6C] mb-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#0F7B6C]" />
                                        <span>Perubahan yang Diharapkan</span>
                                      </div>
                                      <p className="leading-snug">{item.expectedChange}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* 2. DOKUMEN PROGRAM 8 TAHAPAN & TINDAKAN */}
                      <div className="pt-0.5">
                        {/* Notion-style minimal compact accordion */}
                        <div className="border border-[#EDEDEC] rounded-lg bg-white overflow-hidden transition-all duration-200">
                          <button
                            type="button"
                            onClick={() => setOpenWorkflowTorId(openWorkflowTorId === tor.id ? null : tor.id)}
                            className="w-full min-h-[36px] max-h-[38px] h-[36px] flex items-center justify-between px-3 bg-white hover:bg-[#F2F1EE] text-left transition-colors duration-150 cursor-pointer group"
                            aria-expanded={openWorkflowTorId === tor.id}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-3.5 h-3.5 text-[#5F5E5B] group-hover:text-[#2F3437] transition-colors shrink-0" />
                              <span className="text-[13px] font-medium text-[#2F3437]">Dokumen Program</span>
                              <span className="text-[11px] text-[#787774] bg-[#F1F0EC] px-1.5 py-0.5 rounded font-normal shrink-0">
                                8 tahapan
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[11px] text-[#9A9996] hidden sm:inline">
                                {openWorkflowTorId === tor.id ? 'Tutup' : 'Lihat alur'}
                              </span>
                              <ChevronDown
                                className={`w-3.5 h-3.5 text-[#787774] transition-transform duration-200 ${
                                  openWorkflowTorId === tor.id ? 'rotate-180 text-[#2F3437]' : ''
                                }`}
                              />
                            </div>
                          </button>

                          {openWorkflowTorId === tor.id && (
                            <div className="p-2 border-t border-[#EDEDEC] bg-[#FAFAF9] transition-all duration-200 animate-in fade-in duration-150">
                              {/* 8-stage compact document list grid: clicking any stage navigates directly to that tab */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
                                {WORKFLOW_STAGES.map((st, stageIdx) => {
                                  const isTor = st.available;
                                  const isSelected = activeStageNum === st.num;
                                  return (
                                    <button
                                      type="button"
                                      key={st.num}
                                      onMouseEnter={() => setActiveStageNum(st.num)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveStageNum(st.num);
                                        onSelectTor(tor.id, stageIdx + 1);
                                      }}
                                      title={`Klik untuk membuka Tahap ${st.num}: ${st.title} — ${st.desc}`}
                                      className={`group/item flex items-center justify-between px-2.5 py-1.5 min-h-[34px] rounded border text-left transition-colors duration-150 min-w-0 cursor-pointer ${
                                        isSelected
                                          ? 'border-[#1D4ED8]/40 bg-blue-50/30 ring-1 ring-[#1D4ED8]/20'
                                          : 'border-[#EDEDEC] bg-white hover:border-[#D3D3D0] hover:bg-[#F2F1EE]'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0 pr-1.5">
                                        <span className="text-[11px] font-mono font-medium text-[#787774] shrink-0">
                                          {st.num}
                                        </span>
                                        <span className="text-[12px] font-medium text-[#2F3437] truncate group-hover/item:text-[#1D4ED8]">
                                          {st.title}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-1 shrink-0">
                                        {isTor ? (
                                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0F7B6C]">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#0F7B6C] shrink-0" />
                                            Aktif
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 text-[11px] text-[#9A9996]">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#D3D3D0] shrink-0" />
                                            Terkunci
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Notion-style subtle context & description preview bar */}
                              {(() => {
                                const activeDocIdx = WORKFLOW_STAGES.findIndex((s) => s.num === activeStageNum);
                                const activeDoc = WORKFLOW_STAGES[activeDocIdx >= 0 ? activeDocIdx : 0];
                                const targetStageNumber = activeDocIdx >= 0 ? activeDocIdx + 1 : 1;
                                return (
                                  <div className="mt-1.5 px-2.5 py-1 bg-white border border-[#EDEDEC] rounded text-[11px] flex items-center justify-between gap-2 min-h-[26px]">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="font-mono text-[#5F5E5B] font-semibold shrink-0">
                                        {activeDoc.num}. {activeDoc.title}:
                                      </span>
                                      <span className="text-[#5F5E5B] truncate">
                                        {activeDoc.desc}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onSelectTor(tor.id, targetStageNumber);
                                      }}
                                      className="text-[10px] font-semibold text-[#1D4ED8] hover:underline shrink-0 cursor-pointer"
                                    >
                                      Buka {activeDoc.title} →
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>

                        {/* Bottom Actions Bar */}
                        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-3 border-t border-[#EDEDEC]">
                          <div className="text-[11px] text-[#9A9996]">
                            Terakhir diperbarui: {new Date(tor.updatedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Quick Submit for Creator */}
                            {canSubmit && (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    setQuickSubmitLoadingTorId(tor.id);
                                    await api.submitTor(tor.id, 'Diajukan melalui ringkasan dokumen.');
                                    onRefreshData?.();
                                  } catch (err: any) {
                                    alert(err.message || 'Gagal mengajukan TOR');
                                  } finally {
                                    setQuickSubmitLoadingTorId(null);
                                  }
                                }}
                                disabled={quickSubmitLoadingTorId === tor.id}
                                className="px-3 py-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold rounded-md transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                              >
                                {quickSubmitLoadingTorId === tor.id ? 'Mengajukan...' : 'Ajukan TOR'}
                              </button>
                            )}

                            {/* Hapus TOR (Khusus Direktur) */}
                            {isDirector && (
                              confirmDeleteTorId === tor.id ? (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 text-xs">
                                  <span className="text-rose-800 font-semibold text-[11px]">Yakin hapus TOR?</span>
                                  <button
                                    type="button"
                                    disabled={deletingTorId === tor.id}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        setDeletingTorId(tor.id);
                                        await api.deleteTor(tor.id);
                                        setConfirmDeleteTorId(null);
                                        onRefreshData?.();
                                      } catch {
                                        // ignore
                                      } finally {
                                        setDeletingTorId(null);
                                      }
                                    }}
                                    className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                                  >
                                    {deletingTorId === tor.id ? 'Menghapus...' : 'Ya, Hapus'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingTorId === tor.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteTorId(null);
                                    }}
                                    className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-medium text-[11px] cursor-pointer"
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteTorId(tor.id);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50/70 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold rounded-md transition-colors cursor-pointer"
                                  title="Hanya Direktur yang dapat menghapus dokumen ToR"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Hapus TOR</span>
                                </button>
                              )
                            )}

                            {/* Buka TOR Lengkap */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectTor(tor.id);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#F2F1EE] border border-[#EDEDEC] text-[#1D4ED8] text-xs font-semibold rounded-md transition-colors cursor-pointer"
                            >
                              <span>Buka TOR Lengkap</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-5 py-3 border border-[#EAEAEA] rounded-lg bg-white flex items-center justify-between text-xs text-[#737373]">
          <div>
            Halaman <span className="font-semibold text-[#171717]">{currentPage}</span> dari{' '}
            <span className="font-semibold text-[#171717]">{totalPages}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              disabled={currentPage === 1}
              onClick={() => {
                setCurrentPage((p) => Math.max(1, p - 1));
                setExpandedTorId(null);
              }}
              className="px-2.5 py-1 border border-[#EAEAEA] rounded text-[#171717] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F7F7F5] transition-colors cursor-pointer"
            >
              Sebelumnya
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  setCurrentPage(i + 1);
                  setExpandedTorId(null);
                }}
                className={`w-7 h-7 rounded text-xs font-medium transition-colors cursor-pointer ${
                  currentPage === i + 1
                    ? 'bg-[#171717] text-white'
                    : 'border border-[#EAEAEA] text-[#171717] hover:bg-[#F7F7F5]'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              disabled={currentPage === totalPages}
              onClick={() => {
                setCurrentPage((p) => Math.min(totalPages, p + 1));
                setExpandedTorId(null);
              }}
              className="px-2.5 py-1 border border-[#EAEAEA] rounded text-[#171717] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F7F7F5] transition-colors cursor-pointer"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
