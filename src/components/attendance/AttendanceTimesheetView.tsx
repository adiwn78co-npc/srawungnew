import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Plus,
  Trash2,
  History,
  Settings,
  Home,
  FileText,
  ChevronDown,
  ChevronRight,
  X,
  LogIn,
  LogOut,
  Sparkles,
  Award,
  HeartHandshake,
  Palmtree,
  UserCheck,
  BookOpen,
  HelpCircle,
  Printer,
  Download,
  ShieldCheck,
  Eye,
  Users as UsersIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../lib/api.js';
import {
  User,
  Tor,
  TorImplementationOption,
  AttendanceSystemBundle,
  WijnaWorkCategory,
  LeaveCategoryGroup,
} from '../../types/index.js';
import {
  getFinanceReportingPeriods,
  FinanceReportingPeriod,
} from '../../lib/programBudgetStorage.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';
import { InteractiveTeamCalendar } from './InteractiveTeamCalendar.js';
import { EmployeeProfileView } from './EmployeeProfileView.js';

export const WORK_CATEGORIES_SPEC: {
  category: WijnaWorkCategory;
  scope: string;
  examples: string[];
}[] = [
  {
    category: 'Rapat & Koordinasi',
    scope: 'Rapat internal, koordinasi tim, diskusi pekerjaan, dan pertemuan dengan pihak terkait',
    examples: [
      'Menyelaraskan langkah kerja lintas divisi dalam rapat koordinasi tim',
      'Memfasilitasi diskusi pemecahan kendala teknis bersama rekan kerja',
    ],
  },
  {
    category: 'Perencanaan & Pengembangan',
    scope: 'Menyusun rencana kerja, strategi, konsep, atau pengembangan sistem',
    examples: [
      'Merancang kerangka konsep kerja & strategi pengembangan organisasi',
      'Menyusun instrumen dan perbaikan alur kerja internal',
    ],
  },
  {
    category: 'Administrasi & Pelaporan',
    scope: 'Dokumen, email, administrasi, penginputan data, dan laporan',
    examples: [
      'Menyelesaikan penyusunan laporan berkala dan perapian dokumen kerja',
      'Memastikan kelengkapan penginputan data & korespondensi resmi',
    ],
  },
  {
    category: 'Pendampingan & Supervisi',
    scope: 'Pendampingan staf atau mitra, mentoring, arahan, dan supervisi',
    examples: [
      'Memberikan pendampingan langsung dan arahan solusi bagi mitra/staf',
      'Melakukan supervisi kualitas pelaksanaan kerja di lapangan',
    ],
  },
  {
    category: 'Komunikasi & Hubungan Eksternal',
    scope: 'Komunikasi dengan mitra, donor, pemerintah, jaringan, atau pihak eksternal',
    examples: [
      'Membangun komunikasi strategis bersama mitra daerah & pemangku kepentingan',
      'Menindaklanjuti kolaborasi jaringan eksternal untuk penguatan kelembagaan',
    ],
  },
  {
    category: 'Pelatihan & Pengembangan Kapasitas',
    scope: 'Mengikuti atau memberikan pelatihan dan kegiatan pengembangan kapasitas',
    examples: [
      'Memfasilitasi sesi berbagi pengetahuan dan penguatan kapasitas komunitas',
      'Mengikuti pelatihan peningkatan kompetensi profesional staf',
    ],
  },
];

/**
 * Menyusun daftar Opsi Implementasi Kegiatan WFA / Kalender secara dinamis
 * berdasarkan jenis kegiatan dalam Terms of Reference (ToR) yang telah diajukan oleh pengguna
 * dan memperoleh persetujuan dari pihak yang berwenang.
 * Setiap pengguna memiliki daftar opsi yang berbeda sesuai ToR miliknya.
 */
export function buildApprovedTorImplementationOptionsForUser(
  targetUser: User | null | undefined,
  allTors: Tor[]
): TorImplementationOption[] {
  if (!targetUser || !Array.isArray(allTors) || allTors.length === 0) return [];

  const cleanUserName = (targetUser.name || '').split(',')[0].trim().toLowerCase();
  const firstName = cleanUserName.split(/\s+/)[0] || cleanUserName;

  const isTorApproved = (t: Tor): boolean =>
    t.submissionStatus === 'Disetujui' ||
    (t.budgetApproved != null &&
      Number(t.budgetApproved) > 0 &&
      t.submissionStatus !== 'Draft' &&
      t.submissionStatus !== 'Perlu Perbaikan' &&
      t.submissionStatus !== 'Ditolak');

  const approvedTors = allTors.filter(isTorApproved);
  const options: TorImplementationOption[] = [];
  const seenKeys = new Set<string>();

  const pushOption = (opt: TorImplementationOption) => {
    const dedupeKey = `${opt.torId}__${opt.shortActivity.toLowerCase().trim()}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    options.push(opt);
  };

  // 1. ToR yang diajukan langsung oleh pengguna (createdById / picId) dan telah disetujui
  const ownedApprovedTors = approvedTors.filter(
    (t) =>
      t.createdById === targetUser.id ||
      t.picId === targetUser.id ||
      (t.createdByName || '').toLowerCase().includes(cleanUserName) ||
      (t.picName || '').toLowerCase().includes(cleanUserName)
  );

  for (const tor of ownedApprovedTors) {
    const timelineList = Array.isArray(tor.timelineItems) ? tor.timelineItems : [];
    const scopeList = Array.isArray(tor.scopeOfActivities) ? tor.scopeOfActivities : [];

    // Opsi tahapan implementasi dari timelineItems ToR
    timelineList.forEach((tl, idx) => {
      const actText = (tl.activity || '').trim();
      if (!actText) return;
      const periodSuffix = tl.period ? ` (${tl.period})` : '';
      pushOption({
        value: `${tor.id}::tl-${tl.id || idx}`,
        label: `[${tor.torNumber}] ${actText}${periodSuffix}`,
        shortActivity: `${actText}${periodSuffix} — ${tor.torNumber}`,
        torId: tor.id,
        torNumber: tor.torNumber,
        torTitle: tor.title,
        periodLabel: tl.period,
        startDate: tor.startDate,
        endDate: tor.endDate,
        ownershipLabel: 'ToR Diajukan Pengguna & Disetujui',
      });
    });

    // Opsi jenis ruang lingkup kegiatan dari scopeOfActivities ToR
    scopeList.forEach((scopeText, idx) => {
      const cleanScope = (scopeText || '').trim().replace(/\.$/, '');
      if (!cleanScope) return;
      pushOption({
        value: `${tor.id}::scope-${idx}`,
        label: `[${tor.torNumber}] Ruang Lingkup: ${cleanScope}`,
        shortActivity: `${cleanScope} — ${tor.torNumber}`,
        torId: tor.id,
        torNumber: tor.torNumber,
        torTitle: tor.title,
        startDate: tor.startDate,
        endDate: tor.endDate,
        ownershipLabel: 'ToR Diajukan Pengguna & Disetujui',
      });
    });

    // Jika ToR belum memiliki timeline/scope rinci, gunakan judul kegiatan ToR
    if (timelineList.length === 0 && scopeList.length === 0) {
      pushOption({
        value: `${tor.id}::main`,
        label: `[${tor.torNumber}] Implementasi Kegiatan: ${tor.title}`,
        shortActivity: `Implementasi Kegiatan: ${tor.title} (${tor.torNumber})`,
        torId: tor.id,
        torNumber: tor.torNumber,
        torTitle: tor.title,
        startDate: tor.startDate,
        endDate: tor.endDate,
        ownershipLabel: 'ToR Diajukan Pengguna & Disetujui',
      });
    }
  }

  // 2. Jenis kegiatan spesifik pengguna dalam ToR yang telah disetujui (berdasarkan penugasan peran / rundown / monitoring di ToR)
  for (const tor of approvedTors) {
    // Cek Roles & Responsibilities milik pengguna ini
    for (const roleItem of tor.rolesResponsibilities || []) {
      const rolePic = `${roleItem.picName || ''} ${roleItem.nameInstitution || ''}`.toLowerCase();
      if (rolePic.includes(cleanUserName) || (firstName.length >= 4 && rolePic.includes(firstName))) {
        const respText = (roleItem.responsibilities || '').trim().replace(/\.$/, '');
        if (respText) {
          pushOption({
            value: `${tor.id}::role-${roleItem.id}`,
            label: `[${tor.torNumber}] ${roleItem.role}: ${respText}`,
            shortActivity: `${roleItem.role} — ${respText} (${tor.torNumber})`,
            torId: tor.id,
            torNumber: tor.torNumber,
            torTitle: tor.title,
            startDate: tor.startDate,
            endDate: tor.endDate,
            ownershipLabel: `Peran di ToR Disetujui (${roleItem.role})`,
          });
        }
      }
    }

    // Cek Rundown kegiatan yang dipimpin oleh pengguna ini
    for (const rd of tor.rundown || []) {
      const rdPic = (rd.picName || '').toLowerCase();
      if (rdPic.includes(cleanUserName) || (firstName.length >= 4 && rdPic.includes(firstName))) {
        const agendaText = (rd.agenda || '').trim();
        if (agendaText) {
          const dateSuffix = rd.date ? ` (${rd.date})` : '';
          pushOption({
            value: `${tor.id}::rd-${rd.id}`,
            label: `[${tor.torNumber}] Agenda Implementasi: ${agendaText}${dateSuffix}`,
            shortActivity: `${agendaText}${dateSuffix} — ${tor.torNumber}`,
            torId: tor.id,
            torNumber: tor.torNumber,
            torTitle: tor.title,
            periodLabel: rd.date,
            startDate: tor.startDate,
            endDate: tor.endDate,
            ownershipLabel: 'Agenda Implementasi ToR Disetujui',
          });
        }
      }
    }

    // Cek Monitoring Items yang ditugaskan ke pengguna ini
    for (const mon of tor.monitoringItems || []) {
      const monPic = (mon.pic || '').toLowerCase();
      if (monPic.includes(cleanUserName) || (firstName.length >= 4 && monPic.includes(firstName))) {
        const methodText = (mon.method || '').trim().replace(/\.$/, '');
        if (methodText) {
          pushOption({
            value: `${tor.id}::mon-${mon.id}`,
            label: `[${tor.torNumber}] Supervisi & Evaluasi: ${methodText}`,
            shortActivity: `${methodText} (${tor.torNumber})`,
            torId: tor.id,
            torNumber: tor.torNumber,
            torTitle: tor.title,
            startDate: tor.startDate,
            endDate: tor.endDate,
            ownershipLabel: 'Evaluasi Implementasi ToR Disetujui',
          });
        }
      }
    }
  }

  return options;
}

function formatTimeWithSeconds(isoOrTime?: string): string {
  if (!isoOrTime) return '--:--:--';
  if (/^\d{2}:\d{2}:\d{2}/.test(isoOrTime)) return isoOrTime;
  const d = new Date(isoOrTime);
  if (isNaN(d.getTime())) return isoOrTime;
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDurationHMS(startIso?: string, endIso?: string, nowMs?: number): {
  hms: string;
  label: string;
} {
  if (!startIso) {
    return { hms: '00:00:00', label: '0 Jam 0 Menit 0 Detik' };
  }
  const startMs = new Date(startIso).getTime();
  const targetEndMs = endIso ? new Date(endIso).getTime() : nowMs || Date.now();
  if (isNaN(startMs) || isNaN(targetEndMs) || targetEndMs <= startMs) {
    return { hms: '00:00:00', label: '0 Jam 0 Menit 0 Detik' };
  }
  const totalSeconds = Math.floor((targetEndMs - startMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    hms: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    label: `${hours} Jam ${minutes} Menit ${seconds} Detik`,
  };
}

function formatDateIndonesianLocked(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  if (isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTimeShort(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDecimalId(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return rounded.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export type ActiveSubTab =
  | 'calendar'
  | 'daily'
  | 'employee_profile'
  | 'work_recap'
  | 'staff_attendance_detail'
  | 'wfa'
  | 'leave'
  | 'holiday'
  | 'leave_quota'
  | 'flextime'
  | 'audit';

interface ContributionDraft {
  id?: string;
  category: WijnaWorkCategory;
  shortDescription: string;
}

interface AttendanceTimesheetViewProps {
  initialSubTab?: ActiveSubTab;
  pureCalendarMode?: boolean;
  isMobileQuickMode?: boolean;
  onOpenFullWebVersion?: () => void;
}

export const AttendanceTimesheetView: React.FC<AttendanceTimesheetViewProps> = ({
  initialSubTab = 'daily',
  pureCalendarMode = false,
  isMobileQuickMode = false,
  onOpenFullWebVersion,
}) => {
  const { currentUser, allUsers } = useAuth();

  // Finance merangkap HR: memiliki otoritas HR penuh
  const isHR =
    currentUser?.role === 'finance' ||
    currentUser?.role === 'hr' ||
    currentUser?.role === 'admin';
  const isDirector = currentUser?.role === 'director' || currentUser?.role === 'admin';
  // Detail lintas staf hanya dapat dilihat oleh Finance (HR) dan Director
  const canViewDetails = isHR || isDirector;
  // Rekap Kerja HANYA bisa dilihat oleh HR/Finance dan Director
  const canViewWorkRecap =
    currentUser?.role === 'finance' ||
    currentUser?.role === 'hr' ||
    currentUser?.role === 'director';

  const [bundle, setBundle] = useState<AttendanceSystemBundle | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [subTab, setSubTab] = useState<ActiveSubTab>(
    initialSubTab === 'staff_attendance_detail' || initialSubTab === 'work_recap'
      ? canViewWorkRecap
        ? 'work_recap'
        : 'daily'
      : initialSubTab
  );

  // When entering Mobile Quick-Access mode, ensure active subTab is one of the 3 prioritized features
  // Also redirect away from work_recap if the current user is not HR/Finance or Director
  useEffect(() => {
    if (isMobileQuickMode && subTab !== 'daily' && subTab !== 'wfa' && subTab !== 'leave') {
      setSubTab('daily');
      return;
    }
    if (!canViewWorkRecap && (subTab === 'work_recap' || subTab === 'staff_attendance_detail')) {
      setSubTab('daily');
    }
  }, [isMobileQuickMode, subTab, canViewWorkRecap]);

  const [showQuickClockIn, setShowQuickClockIn] = useState<boolean>(true);
  const [showInteractiveCalendar, setShowInteractiveCalendar] = useState<boolean>(false);
  const [showFocusGuideModal, setShowFocusGuideModal] = useState<boolean>(false);
  const [showWorkRecapPreviewModal, setShowWorkRecapPreviewModal] = useState<boolean>(false);
  const [downloadingRecapPdf, setDownloadingRecapPdf] = useState<boolean>(false);
  const workRecapSheetRef = useRef<HTMLElement | null>(null);
  const modalWorkRecapSheetRef = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live timer (1 detik) hanya untuk tampilan durasi Jam : Menit : Detik (TIDAK PERNAH memicu auto Clock Out)
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Tanggal kerja hari berjalan TERKUNCI otomatis (sementara sesi Clock In yang masih aktif tetap diprioritaskan lintas tanggal)
  const lockedTodayDate = new Date(nowMs).toISOString().slice(0, 10);

  // Otomatis berada dalam radius 5 meter area WIJNA kecuali staf menandai sedang dinas di luar area
  const [isWorkingOutsideArea, setIsWorkingOutsideArea] = useState<boolean>(false);
  const [outsideReasonInput, setOutsideReasonInput] = useState<string>('');

  // Maksimal 2 Kontribusi Pekerjaan untuk Timesheet Harian (dipilih sebelum Clock In)
  const [contributions, setContributions] = useState<ContributionDraft[]>([
    {
      category: 'Rapat & Koordinasi',
      shortDescription: '',
    },
  ]);
  const [submittingAction, setSubmittingAction] = useState<boolean>(false);
  const clockActionLockRef = useRef<boolean>(false);

  // Filter untuk Daftar Detail Harian (Khusus Finance/HR & Director)
  const [filterStaffId, setFilterStaffId] = useState<string>('ALL');
  const [filterOutsideOnly, setFilterOutsideOnly] = useState<boolean>(false);
  const [reviewNoteMap, setReviewNoteMap] = useState<Record<string, string>>({});

  // Daftar ToR untuk menyusun Opsi Implementasi WFA berdasarkan ToR yang diajukan & disetujui
  const [allTors, setAllTors] = useState<Tor[]>([]);

  // WFA Form States (Mendukung Single-Day, Multi-Day, Opsi Implementasi ToR Disetujui + Lainnya, & Ajak Staf Lain)
  const [wfaDate, setWfaDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [wfaEndDate, setWfaEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [wfaSelectedOptionValue, setWfaSelectedOptionValue] = useState<string>('');
  const [wfaReasonPlan, setWfaReasonPlan] = useState<string>('');
  const [wfaInvitedUserIds, setWfaInvitedUserIds] = useState<string[]>([]);
  const [hrManualWfaUserId, setHrManualWfaUserId] = useState<string>('');
  const [hrManualWfaDate, setHrManualWfaDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [hrManualWfaEndDate, setHrManualWfaEndDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [hrManualWfaSelectedOptionValue, setHrManualWfaSelectedOptionValue] =
    useState<string>('');
  const [hrManualWfaReason, setHrManualWfaReason] = useState<string>('');
  const [hrManualWfaNotes, setHrManualWfaNotes] = useState<string>('');
  const [hrManualWfaInvitedUserIds, setHrManualWfaInvitedUserIds] = useState<string[]>([]);

  // Hari Libur Bersama / Nasional Form States
  const [holidayTitle, setHolidayTitle] = useState<string>(
    'Hari Libur Bersama — Libur Nasional / Kelembagaan'
  );
  const [holidayStartDate, setHolidayStartDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [holidayEndDate, setHolidayEndDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [holidayReason, setHolidayReason] = useState<string>('');

  // Leave Request & Policy Form States
  const [leaveCategoryId, setLeaveCategoryId] = useState<string>('');
  const [leaveStartDate, setLeaveStartDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [leaveEndDate, setLeaveEndDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [leaveReason, setLeaveReason] = useState<string>('');
  const [leaveDecisionNotesMap, setLeaveDecisionNotesMap] = useState<Record<string, string>>({});
  const [wfaDecisionNotesMap, setWfaDecisionNotesMap] = useState<Record<string, string>>({});
  const [flexDecisionNotesMap, setFlexDecisionNotesMap] = useState<Record<string, string>>({});
  const [holidayDecisionNotesMap, setHolidayDecisionNotesMap] = useState<Record<string, string>>({});

  // Finance/HR Leave Category Policy Editor
  const [showLeavePolicyModal, setShowLeavePolicyModal] = useState<boolean>(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | undefined>(undefined);
  const [polCode, setPolCode] = useState<string>('');
  const [polName, setPolName] = useState<string>('');
  const [polGroup, setPolGroup] = useState<LeaveCategoryGroup>('CUTI_SAKIT');
  const [polAllocation, setPolAllocation] = useState<number>(12);
  const [polTerms, setPolTerms] = useState<string>('');

  // Finance/HR Flextime Form State
  const [flexUserId, setFlexUserId] = useState<string>('');
  const [flexStartDate, setFlexStartDate] = useState<string>('2026-11-01');
  const [flexEndDate, setFlexEndDate] = useState<string>('2026-11-30');
  const [flexSchedule, setFlexSchedule] = useState<string>(
    'Jam Masuk Fleksibel 07:30–10:00 WIB (8 Jam Kerja/Hari)'
  );
  const [flexNotes, setFlexNotes] = useState<string>('');

  // Finance/HR Office Location Config Modal (Default Radius 5 meter)
  const [showLocationConfigModal, setShowLocationConfigModal] = useState<boolean>(false);
  const [cfgOfficeName, setCfgOfficeName] = useState<string>('');
  const [cfgAddress, setCfgAddress] = useState<string>('');
  const [cfgLat, setCfgLat] = useState<number>(-7.342604);
  const [cfgLon, setCfgLon] = useState<number>(110.489848);
  const [cfgRadius, setCfgRadius] = useState<number>(5);
  const [cfgStandardHours, setCfgStandardHours] = useState<number>(8);

  // Periode Pelaporan yang terhubung otomatis dengan Periode yang ditetapkan oleh Finance (Period 1, Period 2, dst.)
  const [financePeriods, setFinancePeriods] = useState<FinanceReportingPeriod[]>(() =>
    getFinanceReportingPeriods(2026)
  );
  const [recapPeriodFilter, setRecapPeriodFilter] = useState<string>(() => {
    const periods = getFinanceReportingPeriods(2026);
    // Default ke periode yang mencakup bulan berjalan / November 2026 (Period 2), atau Period 1
    const novMatch = periods.find(
      (p) => '2026-11-03' >= p.startDate && '2026-11-03' <= p.endDate
    );
    return novMatch ? novMatch.id : periods[0]?.id || 'ALL';
  });
  const [selectedRecapUserId, setSelectedRecapUserId] = useState<string>('');
  const [expandedRecapUserId, setExpandedRecapUserId] = useState<string | null>(null);
  const [showMyRecapDailyLogs, setShowMyRecapDailyLogs] = useState<boolean>(true);

  //Sinkronisasi otomatis jika Finance memperbarui Periode Anggaran / Pelaporan
  useEffect(() => {
    const syncPeriods = () => {
      const updated = getFinanceReportingPeriods(2026);
      setFinancePeriods(updated);
      setRecapPeriodFilter((prev) => {
        if (prev === 'ALL') return 'ALL';
        if (updated.some((p) => p.id === prev)) return prev;
        const novMatch = updated.find(
          (p) => '2026-11-03' >= p.startDate && '2026-11-03' <= p.endDate
        );
        return novMatch ? novMatch.id : updated[0]?.id || 'ALL';
      });
    };
    window.addEventListener('program-budget-updated', syncPeriods);
    window.addEventListener('program-budget-dataset-updated', syncPeriods);
    return () => {
      window.removeEventListener('program-budget-updated', syncPeriods);
      window.removeEventListener('program-budget-dataset-updated', syncPeriods);
    };
  }, []);

  // State Verifikasi Digital Rekap Kerja Resmi oleh Finance/HR & Director (Tersimpan di Database Server)
  interface RecapVerificationEntry {
    financeVerified: boolean;
    financeVerifierName: string;
    financeVerifierRole: string;
    financeVerifiedAt: string;
    financeRefCode: string;
    financeNotes: string;
    directorVerified: boolean;
    directorVerifierName: string;
    directorVerifierRole: string;
    directorVerifiedAt: string;
    directorRefCode: string;
    directorNotes: string;
  }
  const [recapVerifications, setRecapVerifications] = useState<
    Record<string, RecapVerificationEntry>
  >({});

  useEffect(() => {
    if (bundle?.workRecapVerifications && typeof bundle.workRecapVerifications === 'object') {
      setRecapVerifications(bundle.workRecapVerifications as Record<string, RecapVerificationEntry>);
    }
  }, [bundle?.workRecapVerifications]);

  // Inline quota edit state for Leave Quota Management tab (only editable after clicking Edit)
  const [inlineQuotaMap, setInlineQuotaMap] = useState<Record<string, number>>({});
  const [editingQuotaRowId, setEditingQuotaRowId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Jika pengguna berganti ke staf biasa saat berada di tab khusus Finance/Director, kembalikan ke 'daily'
  useEffect(() => {
    if (
      !canViewDetails &&
      (subTab === 'flextime' || subTab === 'leave_quota' || subTab === 'audit')
    ) {
      setSubTab('daily');
    }
  }, [canViewDetails, subTab]);

  const loadAttendanceBundle = useCallback(async () => {
    try {
      setLoading(true);
      const [data, torsData] = await Promise.all([
        api.getAttendanceSystem(),
        api.getTors().catch(() => [] as Tor[]),
      ]);
      if (data && typeof data === 'object') {
        setBundle(data);
        setErrorMsg(null);
        if (data.locationConfig) {
          setCfgOfficeName(data.locationConfig.officeName);
          setCfgAddress(data.locationConfig.address);
          setCfgLat(data.locationConfig.latitude);
          setCfgLon(data.locationConfig.longitude);
          setCfgRadius(data.locationConfig.radiusMeters || 5);
          setCfgStandardHours(data.locationConfig.standardDailyHours);
        }
        if (Array.isArray(data.leavePolicies) && data.leavePolicies.length > 0) {
          const firstPolId = data.leavePolicies[0].id;
          setLeaveCategoryId((prev) => prev || firstPolId);
        }
      }
      setAllTors(Array.isArray(torsData) ? torsData : []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat sistem Attendance & Timesheet.');
    } finally {
      setLoading(false);
    }
  }, []);

  const syncAttendanceFromServerSilently = useCallback(async () => {
    try {
      const latest = await api.getAttendanceSystem();
      if (latest && typeof latest === 'object') {
        setBundle(latest);
      }
    } catch {
      // Abaikan gangguan jaringan sementara; sesi aktif di server tetap aman
    }
  }, []);

  useEffect(() => {
    loadAttendanceBundle();
  }, [loadAttendanceBundle]);

  // Sinkronkan ulang dari sumber kebenaran backend saat tab kembali aktif, koneksi pulih, atau berpindah sub-tab
  useEffect(() => {
    const handleResume = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        syncAttendanceFromServerSilently();
      }
    };
    window.addEventListener('online', handleResume);
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    return () => {
      window.removeEventListener('online', handleResume);
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [syncAttendanceFromServerSilently]);

  useEffect(() => {
    if (subTab === 'daily') {
      syncAttendanceFromServerSilently();
    }
  }, [subTab, syncAttendanceFromServerSilently]);

  // Opsi Implementasi ToR yang telah diajukan oleh pengguna aktif & memperoleh persetujuan
  const myApprovedTorOptions = useMemo(
    () => buildApprovedTorImplementationOptionsForUser(currentUser, allTors),
    [currentUser, allTors]
  );

  // Sinkronkan pilihan default dropdown WFA saat pengguna berganti atau daftar ToR dimuat
  useEffect(() => {
    if (myApprovedTorOptions.length > 0) {
      setWfaSelectedOptionValue((prev) => {
        if (prev === '__LAINNYA__') return prev;
        if (myApprovedTorOptions.some((o) => o.value === prev)) return prev;
        return myApprovedTorOptions[0].value;
      });
    } else {
      setWfaSelectedOptionValue('__LAINNYA__');
    }
    setWfaInvitedUserIds([]);
  }, [currentUser?.id, myApprovedTorOptions]);

  // Opsi Implementasi ToR untuk staf yang dipilih pada Penetapan WFA oleh Finance
  const hrTargetStaffUser = useMemo(
    () => allUsers.find((u) => u.id === hrManualWfaUserId) || null,
    [allUsers, hrManualWfaUserId]
  );
  const hrTargetApprovedTorOptions = useMemo(
    () => buildApprovedTorImplementationOptionsForUser(hrTargetStaffUser, allTors),
    [hrTargetStaffUser, allTors]
  );

  useEffect(() => {
    if (hrTargetApprovedTorOptions.length > 0) {
      setHrManualWfaSelectedOptionValue((prev) => {
        if (prev === '__LAINNYA__') return prev;
        if (hrTargetApprovedTorOptions.some((o) => o.value === prev)) return prev;
        return hrTargetApprovedTorOptions[0].value;
      });
    } else {
      setHrManualWfaSelectedOptionValue('__LAINNYA__');
    }
    setHrManualWfaInvitedUserIds([]);
  }, [hrManualWfaUserId, hrTargetApprovedTorOptions]);

  // Sinkronkan status kehadiran real-time dengan Sidebar Your Contribution
  useEffect(() => {
    if (bundle && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('wijna-attendance-bundle-updated', { detail: bundle })
      );
    }
  }, [bundle]);

  useEffect(() => {
    if (allUsers.length > 0 && !hrManualWfaUserId) {
      const firstStaff = allUsers.find((u) => u.role !== 'admin') || allUsers[0];
      setHrManualWfaUserId(firstStaff.id);
      setFlexUserId(firstStaff.id);
    }
  }, [allUsers, hrManualWfaUserId]);

  // CRITICAL CLOCK LOGIC: Prioritaskan sesi Clock In yang masih AKTIF (belum Clock Out) milik user saat ini
  // lintas tanggal/midnight sehingga refresh, navigasi, maupun pergantian hari tidak pernah memutus sesi aktif.
  const myActiveClockSession = useMemo(() => {
    if (!bundle || !Array.isArray(bundle.records) || !currentUser) return undefined;
    const openSessions = bundle.records.filter(
      (r) =>
        r &&
        r.userId === currentUser.id &&
        Boolean(r.clockInTime) &&
        !String(r.clockInTime).startsWith('0000-00-00') &&
        (!r.clockOutTime || String(r.clockOutTime).startsWith('0000-00-00'))
    );
    if (openSessions.length === 0) return undefined;
    return [...openSessions].sort((a, b) =>
      String(b.clockInTime || '').localeCompare(String(a.clockInTime || ''))
    )[0];
  }, [bundle, currentUser]);

  // Catatan kehadiran efektif staf: utamakan sesi Clock In aktif dari backend, lalu catatan pada tanggal hari ini
  const myTodayRecord = useMemo(() => {
    if (myActiveClockSession) return myActiveClockSession;
    if (!bundle || !Array.isArray(bundle.records) || !currentUser) return undefined;
    return bundle.records.find(
      (r) => r.userId === currentUser.id && r.date === lockedTodayDate
    );
  }, [myActiveClockSession, bundle, currentUser, lockedTodayDate]);

  const myActiveWfaToday = useMemo(() => {
    if (!bundle || !Array.isArray(bundle.wfaRequests) || !currentUser) return undefined;
    const activeStatuses = new Set([
      'Approved',
      'Submitted for Review',
      'Reviewed by Director',
      'Notified to Finance',
      'Acknowledged by Finance',
      'Disetujui HR',
    ]);
    return bundle.wfaRequests.find((w) => {
      const sDate = w.startDate || w.date;
      const eDate = w.endDate || sDate;
      const isParticipant =
        w.userId === currentUser.id ||
        (Array.isArray(w.invitedUserIds) && w.invitedUserIds.includes(currentUser.id));
      return (
        isParticipant &&
        activeStatuses.has(w.status) &&
        sDate <= lockedTodayDate &&
        eDate >= lockedTodayDate
      );
    });
  }, [bundle, currentUser, lockedTodayDate]);

  const myActiveFlextimeToday = useMemo(() => {
    if (!bundle || !Array.isArray(bundle.flextimeAssignments) || !currentUser) return undefined;
    return bundle.flextimeAssignments.find(
      (f) =>
        f.userId === currentUser.id &&
        f.isActive &&
        f.startDate <= lockedTodayDate &&
        f.endDate >= lockedTodayDate
    );
  }, [bundle, currentUser, lockedTodayDate]);

  const [userCoordLat, setUserCoordLat] = useState<number>(-7.342604);
  const [userCoordLon, setUserCoordLon] = useState<number>(110.489848);
  const [userCoordAccuracy, setUserCoordAccuracy] = useState<number>(0);
  const [gpsStatusNote, setGpsStatusNote] = useState<string | null>(null);
  const [customCoordTouched, setCustomCoordTouched] = useState<boolean>(false);
  const [hasCheckedLocation, setHasCheckedLocation] = useState<boolean>(false);
  const [isCheckingLocation, setIsCheckingLocation] = useState<boolean>(false);
  const [outsideClockInChoice, setOutsideClockInChoice] = useState<
    'none' | 'cancel' | 'clock_in_with_hr'
  >('none');
  const [showLocationCheckPanel, setShowLocationCheckPanel] = useState<boolean>(false);

  // Sinkronkan titik koordinat default staf dengan titik kantor saat bundle dimuat (jika belum diubah manual)
  useEffect(() => {
    if (bundle?.locationConfig && !customCoordTouched && !isWorkingOutsideArea) {
      setUserCoordLat(bundle.locationConfig.latitude);
      setUserCoordLon(bundle.locationConfig.longitude);
    }
  }, [
    bundle?.locationConfig?.latitude,
    bundle?.locationConfig?.longitude,
    customCoordTouched,
    isWorkingOutsideArea,
  ]);

  // Sinkronkan maksimal 2 kontribusi pekerjaan harian saat staf berubah atau record dimuat
  useEffect(() => {
    if (
      myTodayRecord &&
      Array.isArray(myTodayRecord.timesheetItems) &&
      myTodayRecord.timesheetItems.length > 0
    ) {
      setContributions(
        myTodayRecord.timesheetItems.slice(0, 2).map((t) => ({
          id: t.id,
          category: t.category,
          shortDescription:
            t.shortDescription === t.category ? '' : t.shortDescription,
        }))
      );
      setIsWorkingOutsideArea(Boolean(myTodayRecord.isOutsideWorkLocation));
      setOutsideReasonInput(myTodayRecord.outsideLocationReason || '');
      if (myTodayRecord.clockInLocation) {
        setUserCoordLat(myTodayRecord.clockInLocation.latitude);
        setUserCoordLon(myTodayRecord.clockInLocation.longitude);
      }
    } else {
      setContributions([
        {
          category: 'Rapat & Koordinasi',
          shortDescription: '',
        },
      ]);
      setIsWorkingOutsideArea(false);
      setOutsideReasonInput('');
      setCustomCoordTouched(false);
      setHasCheckedLocation(false);
      setOutsideClockInChoice('none');
      if (bundle?.locationConfig) {
        setUserCoordLat(bundle.locationConfig.latitude);
        setUserCoordLon(bundle.locationConfig.longitude);
      }
    }
  }, [myTodayRecord?.id, lockedTodayDate, currentUser?.id]);

  // Hitung jarak Haversine (meter) antara posisi pengguna dan titik koordinat kantor
  const calculateClientDistanceMeters = useCallback(
    (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371000;
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c);
    },
    []
  );

  // Koordinat aktif yang akan dicek bersamaan saat tombol Clock In ditekan
  const resolvedCoords = useMemo(() => {
    const officeLat = bundle?.locationConfig?.latitude ?? -7.342604;
    const officeLon = bundle?.locationConfig?.longitude ?? 110.489848;
    if (customCoordTouched) {
      return {
        lat: Number.isFinite(userCoordLat) ? userCoordLat : officeLat,
        lon: Number.isFinite(userCoordLon) ? userCoordLon : officeLon,
      };
    }
    return { lat: officeLat, lon: officeLon };
  }, [bundle?.locationConfig, customCoordTouched, userCoordLat, userCoordLon]);

  // Simpan otomatis saat mengubah kontribusi di tengah jam kerja atau saat WFA (tanpa pernah menyentuh clockInTime/clockOutTime)
  const syncActiveContributions = async (nextList: ContributionDraft[]) => {
    if (!myTodayRecord && !myActiveWfaToday) return;
    try {
      const res = await api.updateDailyTimesheet({
        date: myTodayRecord?.date || lockedTodayDate,
        timesheetItems: nextList.slice(0, 2).map((c) => ({
          id: c.id,
          category: c.category,
          shortDescription: c.shortDescription.trim() || c.category,
        })),
      });
      setBundle(res.bundle);
    } catch {
      // silent auto-sync
    }
  };

  // Toggle kategori kontribusi (Minimal 1, Maksimal 2 kategori)
  const handleToggleCategory = (cat: WijnaWorkCategory) => {
    const existsIdx = contributions.findIndex((c) => c.category === cat);
    let next: ContributionDraft[];

    if (existsIdx !== -1) {
      // Jika sudah dipilih dan ada > 1 kontribusi, hapus dari pilihan
      if (contributions.length === 1) {
        return; // Minimal 1 kontribusi tetap terpilih
      }
      next = contributions.filter((c) => c.category !== cat);
    } else {
      // Jika belum dipilih: tambahkan jika < 2, atau ganti kontribusi ke-2 jika sudah penuh 2
      if (contributions.length < 2) {
        next = [...contributions, { category: cat, shortDescription: '' }];
      } else {
        next = [contributions[0], { category: cat, shortDescription: '' }];
        showToast('Maksimal 2 fokus kontribusi per hari. Kontribusi #2 diperbarui.');
      }
    }

    setContributions(next);
    syncActiveContributions(next);
  };

  const handleUpdateContributionDesc = (cat: WijnaWorkCategory, desc: string) => {
    setContributions((prev) =>
      prev.map((c) => (c.category === cat ? { ...c, shortDescription: desc } : c))
    );
  };

  const officeLatVal = bundle?.locationConfig?.latitude ?? -7.342604;
  const officeLonVal = bundle?.locationConfig?.longitude ?? 110.489848;
  const allowedRadiusVal = bundle?.locationConfig?.radiusMeters || 5;
  const rawDistanceMeters = useMemo(
    () =>
      calculateClientDistanceMeters(
        officeLatVal,
        officeLonVal,
        resolvedCoords.lat,
        resolvedCoords.lon
      ),
    [calculateClientDistanceMeters, officeLatVal, officeLonVal, resolvedCoords.lat, resolvedCoords.lon]
  );
  const effectiveAccuracyMargin = useMemo(
    () => Math.min(200, Math.max(0, Math.round(userCoordAccuracy || 0))),
    [userCoordAccuracy]
  );
  const currentDistanceMeters = useMemo(
    () => Math.max(0, rawDistanceMeters - effectiveAccuracyMargin),
    [rawDistanceMeters, effectiveAccuracyMargin]
  );
  const isMatchedWithOffice = hasCheckedLocation && currentDistanceMeters <= allowedRadiusVal;

  // Deteksi koordinat GPS murni hanya membaca posisi browser (DILARANG KERAS mereset/menghentikan sesi Clock In aktif)
  const handleCheckLocationNow = useCallback(
    async () => {
      setErrorMsg(null);
      setGpsStatusNote(null);
      setShowLocationCheckPanel(true);
      setIsCheckingLocation(true);

      const finalizeGpsCheck = (lat: number, lon: number, accuracyMeters: number = 0, note?: string) => {
        const rawDist = calculateClientDistanceMeters(officeLatVal, officeLonVal, lat, lon);
        const accMargin = Math.min(200, Math.max(0, Math.round(accuracyMeters || 0)));
        const effectiveDist = Math.max(0, rawDist - accMargin);
        const isOutsideFlag = effectiveDist > allowedRadiusVal;
        setUserCoordLat(lat);
        setUserCoordLon(lon);
        setUserCoordAccuracy(Math.round(accuracyMeters || 0));
        setGpsStatusNote(note || null);
        setIsWorkingOutsideArea(isOutsideFlag);
        setCustomCoordTouched(true);
        setHasCheckedLocation(true);
        setIsCheckingLocation(false);
        setOutsideClockInChoice('none');
      };

      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        let settled = false;
        let bestPos: GeolocationPosition | null = null;
        let watchId: number | null = null;
        let finishTimer: ReturnType<typeof setTimeout> | null = null;

        const clearWatchAndTimer = () => {
          if (watchId !== null && navigator.geolocation) {
            try {
              navigator.geolocation.clearWatch(watchId);
            } catch {
              // ignore
            }
            watchId = null;
          }
          if (finishTimer !== null) {
            clearTimeout(finishTimer);
            finishTimer = null;
          }
        };

        const commitPosition = (pos: GeolocationPosition, note?: string) => {
          if (settled) return;
          settled = true;
          clearWatchAndTimer();
          finalizeGpsCheck(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy || 0,
            note
          );
        };

        const evaluateCandidate = (pos: GeolocationPosition) => {
          if (settled) return;
          if (!bestPos || (pos.coords.accuracy || 9999) < (bestPos.coords.accuracy || 9999)) {
            bestPos = pos;
          }
          const rawDist = calculateClientDistanceMeters(
            officeLatVal,
            officeLonVal,
            pos.coords.latitude,
            pos.coords.longitude
          );
          const accMargin = Math.min(200, Math.max(0, Math.round(pos.coords.accuracy || 0)));
          const effectiveDist = Math.max(0, rawDist - accMargin);

          // Jika sudah berada di dalam titik koordinat kantor atau akurasi GPS sudah sangat presisi (<= 20m), langsung gunakan
          if (effectiveDist <= allowedRadiusVal || (pos.coords.accuracy && pos.coords.accuracy <= 20)) {
            commitPosition(pos);
          }
        };

        try {
          watchId = navigator.geolocation.watchPosition(
            (pos) => {
              evaluateCandidate(pos);
            },
            () => {
              // Ditangani oleh fallback getCurrentPosition di bawah apabila belum ada bestPos
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
          );
        } catch {
          // ignore watchPosition error
        }

        // Beri waktu hingga 2.5 detik bagi sensor GPS untuk mengunci titik paling akurat
        finishTimer = setTimeout(() => {
          if (settled) return;
          if (bestPos) {
            commitPosition(bestPos);
            return;
          }
          clearWatchAndTimer();
          // Fallback ke pembacaan jaringan/Wi-Fi jika high-accuracy lambat merespons
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              commitPosition(pos);
            },
            (err) => {
              if (settled) return;
              settled = true;
              const isDenied = err?.code === 1;
              finalizeGpsCheck(
                officeLatVal,
                officeLonVal,
                0,
                isDenied
                  ? 'Izin akses lokasi browser belum diaktifkan pada perangkat/tab ini. Menggunakan titik koordinat Kantor WIJNA.'
                  : 'Sensor GPS perangkat sedang tidak merespons tepat waktu. Menggunakan titik koordinat Kantor WIJNA.'
              );
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
          );
        }, 2500);

        return;
      }

      finalizeGpsCheck(
        officeLatVal,
        officeLonVal,
        0,
        'Perangkat/browser tidak mendukung API Geolocation. Menggunakan titik koordinat Kantor WIJNA.'
      );
    },
    [
      allowedRadiusVal,
      calculateClientDistanceMeters,
      officeLatVal,
      officeLonVal,
    ]
  );

  // Deteksi lokasi otomatis saat halaman presensi dimuat (tanpa pernah mengganggu sesi Clock In aktif)
  useEffect(() => {
    if (bundle?.locationConfig && !hasCheckedLocation && !isCheckingLocation) {
      handleCheckLocationNow();
    }
  }, [bundle?.locationConfig, hasCheckedLocation, isCheckingLocation, handleCheckLocationNow]);

  // TOMBOL 1: CLOCK IN (Menciptakan sesi aktif berkelanjutan di backend/MySQL; tahan klik ganda)
  const handleClockIn = async () => {
    if (
      clockActionLockRef.current ||
      submittingAction ||
      Boolean(myTodayRecord?.clockInTime)
    ) {
      return;
    }

    setErrorMsg(null);

    if (contributions.length === 0) {
      setErrorMsg('Pilih minimal 1 fokus kontribusi sebelum melakukan Clock In.');
      return;
    }

    if (!hasCheckedLocation) {
      setShowLocationCheckPanel(true);
      setErrorMsg(
        'Silakan Deteksi Kantor terlebih dahulu. Jika sesuai titik koordinat Kantor WIJNA, tombol Clock In akan dibuka.'
      );
      return;
    }

    if (!isMatchedWithOffice && outsideClockInChoice !== 'clock_in_with_hr') {
      setShowLocationCheckPanel(true);
      setErrorMsg(
        'Lokasi tidak sesuai titik koordinat Kantor WIJNA. Pilih opsi "Tetap Clock In dengan Izin HR" di bawah agar Clock In dapat dilakukan dan sah setelah di-ACC HR.'
      );
      return;
    }

    const targetLat = resolvedCoords.lat;
    const targetLon = resolvedCoords.lon;

    clockActionLockRef.current = true;
    setSubmittingAction(true);
    try {
      const res = await api.clockInAttendance({
        date: lockedTodayDate,
        latitude: targetLat,
        longitude: targetLon,
        gpsAccuracy: userCoordAccuracy,
        allowOutsideWithHrApproval: !isMatchedWithOffice && outsideClockInChoice === 'clock_in_with_hr',
        outsideReason: !isMatchedWithOffice
          ? outsideReasonInput.trim() || 'Izin HR: Clock In di luar titik koordinat Kantor WIJNA'
          : undefined,
        workItems: contributions.slice(0, 2).map((c) => ({
          category: c.category,
          shortDescription: c.shortDescription.trim() || c.category,
        })),
      });
      setBundle(res.bundle);
      setNowMs(Date.now());
      window.dispatchEvent(
        new CustomEvent('wijna-attendance-bundle-updated', { detail: res.bundle })
      );
      if (res.alreadyActive) {
        showToast('Sesi Clock In aktif Anda tetap berjalan tanpa perubahan.');
      } else if (isMatchedWithOffice) {
        showToast('Clock In berhasil dan SAH! Lokasi sesuai titik koordinat Kantor WIJNA.');
      } else {
        showToast(
          'Clock In dengan Izin HR tercatat! Status Clock In akan SAH setelah di-ACC oleh HR.'
        );
      }
    } catch (err: any) {
      const failMsg = err.message || 'Gagal melakukan Clock In.';
      setErrorMsg(failMsg);
      syncAttendanceFromServerSilently();
    } finally {
      clockActionLockRef.current = false;
      setSubmittingAction(false);
    }
  };

  // TOMBOL 2: CLOCK OUT (Satu-satunya cara mengakhiri sesi Clock In aktif oleh user terautentikasi yang sama)
  const handleClockOut = async () => {
    if (
      clockActionLockRef.current ||
      submittingAction ||
      !myTodayRecord?.clockInTime ||
      Boolean(myTodayRecord?.clockOutTime)
    ) {
      return;
    }

    setErrorMsg(null);
    if (
      isWorkingOutsideArea &&
      !outsideReasonInput.trim() &&
      !myTodayRecord?.outsideLocationReason
    ) {
      setErrorMsg(
        'Clock Out di luar area WIJNA memerlukan keterangan singkat lokasi/tugas.'
      );
      return;
    }

    clockActionLockRef.current = true;
    setSubmittingAction(true);
    try {
      const res = await api.clockOutAttendance({
        recordId: myTodayRecord.id,
        date: myTodayRecord.date || lockedTodayDate,
        latitude: resolvedCoords.lat,
        longitude: resolvedCoords.lon,
        gpsAccuracy: userCoordAccuracy,
        outsideReason: isWorkingOutsideArea ? outsideReasonInput.trim() : undefined,
        workItems: contributions.slice(0, 2).map((c) => ({
          id: c.id,
          category: c.category,
          shortDescription: c.shortDescription.trim() || c.category,
        })),
      });
      setBundle(res.bundle);
      setNowMs(Date.now());
      window.dispatchEvent(
        new CustomEvent('wijna-attendance-bundle-updated', { detail: res.bundle })
      );
      showToast('Clock Out berhasil! Kontribusi & durasi kerja telah tersimpan.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal melakukan Clock Out.');
      syncAttendanceFromServerSilently();
    } finally {
      clockActionLockRef.current = false;
      setSubmittingAction(false);
    }
  };

  // REVIEW OUTSIDE LOCATION BERDASARKAN ROLE WORKFLOW
  const handleReviewOutsideLocation = async (
    recordId: string,
    stage: 'hr' | 'director',
    decision: 'approve' | 'return' | 'review' | 'acknowledge' = 'approve'
  ) => {
    setErrorMsg(null);
    const noteText = (reviewNoteMap[recordId] || '').trim();
    if (decision === 'return' && !noteText) {
      setErrorMsg('Alasan pengembalian (Return) wajib diisi oleh Finance agar staf dapat memperbaiki/mengklarifikasi.');
      return;
    }
    try {
      const res = await api.reviewOutsideLocation({
        recordId,
        stage,
        decision,
        notes: noteText || undefined,
      });
      setBundle(res.bundle);
      showToast(
        decision === 'return'
          ? 'Catatan lokasi di luar kantor dikembalikan ke staf beserta alasan dari Finance.'
          : decision === 'review'
          ? 'Catatan review strategis Direktur atas lokasi kerja Finance berhasil disimpan.'
          : decision === 'acknowledge'
          ? 'Informasi lokasi kerja Direktur telah dicatat (acknowledged) oleh Finance.'
          : 'Outside Work Location berhasil disetujui oleh Finance.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan review lokasi.');
    }
  };

  // FLEXTIME OLEH FINANCE (HR) / DIRECTOR
  const handleSaveFlextime = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await api.saveFlextimeAssignment({
        userId: flexUserId,
        startDate: flexStartDate,
        endDate: flexEndDate,
        scheduleArrangement: flexSchedule,
        policyNotes: flexNotes,
        isActive: true,
      });
      setBundle(res.bundle);
      setFlexNotes('');
      showToast(
        isDirector
          ? 'Pengaturan Flextime Direktur diberitahukan ke Finance sebagai informasi.'
          : 'Pengaturan Flextime berhasil disimpan.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan pengaturan Flextime.');
    }
  };

  const handleToggleFlextimeActive = async (item: any) => {
    try {
      const res = await api.saveFlextimeAssignment({
        id: item.id,
        userId: item.userId,
        startDate: item.startDate,
        endDate: item.endDate,
        scheduleArrangement: item.scheduleArrangement,
        policyNotes: item.policyNotes,
        isActive: !item.isActive,
      });
      setBundle(res.bundle);
      showToast(`Status Flextime ${item.userName} diperbarui.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengubah status Flextime.');
    }
  };

  const handleDeleteFlextime = async (id: string) => {
    try {
      const res = await api.deleteFlextimeAssignment(id);
      setBundle(res.bundle);
      showToast('Periode Flextime dihapus oleh Finance.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menghapus periode Flextime.');
    }
  };

  // CUTI & IZIN BERDASARKAN ROLE WORKFLOW
  const handleSubmitLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await api.submitLeaveRequest({
        categoryId: leaveCategoryId,
        startDate: leaveStartDate,
        endDate: leaveEndDate,
        reason: leaveReason.trim() || undefined,
      });
      setBundle(res.bundle);
      setLeaveReason('');
      showToast(
        isDirector
          ? 'Informasi cuti/izin Direktur otomatis dikirim ke Finance (Notify for Information) & sinkron ke kalender.'
          : isHR
          ? 'Pengajuan cuti/izin Finance dikirim ke Direktur untuk direview (Submit for Review) & sinkron ke kalender.'
          : 'Pengajuan cuti/izin berhasil dikirim ke Finance untuk persetujuan (Submit for Approval).'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengajukan cuti/izin.');
    }
  };

  const handleLeaveDecision = async (
    id: string,
    stage: 'hr' | 'director',
    decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge'
  ) => {
    setErrorMsg(null);
    const noteText = (leaveDecisionNotesMap[id] || '').trim();
    if (decision === 'return' && !noteText) {
      setErrorMsg('Alasan pengembalian (Return) wajib diisi oleh Finance sebelum mengembalikan pengajuan staf.');
      return;
    }
    try {
      const res = await api.decideLeaveRequest(id, {
        stage,
        decision,
        notes: noteText || undefined,
      });
      setBundle(res.bundle);
      showToast(
        decision === 'approve'
          ? 'Pengajuan cuti/izin disetujui oleh Finance & otomatis disinkronkan ke kalender.'
          : decision === 'return'
          ? 'Pengajuan cuti/izin dikembalikan (Returned) ke staf beserta catatan dari Finance.'
          : decision === 'review'
          ? 'Catatan review & masukan strategis Direktur berhasil dikirim ke Finance.'
          : 'Informasi cuti/izin Direktur telah dicatat (acknowledged) oleh Finance.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses tindak lanjut cuti/izin.');
    }
  };

  const handleSaveLeavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await api.saveLeaveCategoryPolicy({
        id: editingPolicyId,
        code: polCode,
        name: polName,
        group: polGroup,
        allocationDaysPerYear: polAllocation,
        termsAndProvisions: polTerms,
      });
      setBundle(res.bundle);
      setShowLeavePolicyModal(false);
      setEditingPolicyId(undefined);
      showToast('Kebijakan & kuota kategori cuti berhasil diperbarui oleh Finance/HR.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan kebijakan cuti.');
    }
  };

  const handleQuickUpdatePolicyQuota = async (pol: any, newDays: number) => {
    setErrorMsg(null);
    try {
      const res = await api.saveLeaveCategoryPolicy({
        id: pol.id,
        code: pol.code,
        name: pol.name,
        group: pol.group,
        allocationDaysPerYear: Math.max(0, newDays),
        termsAndProvisions: pol.termsAndProvisions,
        isActive: pol.isActive,
      });
      setBundle(res.bundle);
      setEditingQuotaRowId(null);
      showToast(`Jumlah alokasi "${pol.name}" diperbarui menjadi ${Math.max(0, newDays)} hari/tahun.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memperbarui kuota cuti.');
    }
  };

  const handleDeleteLeavePolicy = async (id: string) => {
    setErrorMsg(null);
    try {
      const res = await api.deleteLeaveCategoryPolicy(id);
      setBundle(res.bundle);
      showToast('Kategori cuti berhasil dihapus.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menghapus kategori cuti.');
    }
  };

  // WFA (Mendukung Single-Day & Multi-Day, Opsi Implementasi ToR Disetujui + Lainnya, dan Mengajak Staf Lain)
  const handleStaffSubmitWfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const isCustom = wfaSelectedOptionValue === '__LAINNYA__' || !wfaSelectedOptionValue;
    const matchedTorOpt = !isCustom
      ? myApprovedTorOptions.find((o) => o.value === wfaSelectedOptionValue)
      : undefined;

    if (isCustom && !wfaReasonPlan.trim()) {
      setErrorMsg('Tuliskan rincian rencana kontribusi pekerjaan WFA pada kolom Opsi Lainnya.');
      return;
    }

    const composedPlan = matchedTorOpt
      ? wfaReasonPlan.trim()
        ? `${matchedTorOpt.shortActivity} — Catatan: ${wfaReasonPlan.trim()}`
        : matchedTorOpt.shortActivity
      : wfaReasonPlan.trim();

    try {
      const validEnd = wfaEndDate && wfaEndDate >= wfaDate ? wfaEndDate : wfaDate;
      const res = await api.submitOrAssignWfa({
        mode: 'staff_request',
        date: wfaDate,
        startDate: wfaDate,
        endDate: validEnd,
        reasonAndPlan: composedPlan,
        torId: matchedTorOpt?.torId,
        torNumber: matchedTorOpt?.torNumber,
        torTitle: matchedTorOpt?.torTitle,
        implementationOption: matchedTorOpt ? matchedTorOpt.label : 'Lainnya (Di Luar Daftar ToR)',
        isCustomImplementation: isCustom,
        invitedUserIds: wfaInvitedUserIds,
      });
      setBundle(res.bundle);
      setWfaReasonPlan('');
      setWfaInvitedUserIds([]);
      const invitedCount = wfaInvitedUserIds.length;
      const invitedNote =
        invitedCount > 0 ? ` (mengajak ${invitedCount} rekan staf)` : '';
      showToast(
        isDirector
          ? `Jadwal WFA Direktur${invitedNote} diberitahukan ke Finance sebagai informasi (Notify for Information) & sinkron ke kalender.`
          : isHR
          ? `Jadwal WFA Finance${invitedNote} dikirim ke Direktur untuk direview (Submit for Review) & sinkron ke kalender.`
          : `Permintaan WFA${invitedNote} diajukan ke Finance untuk persetujuan (Submit for Approval).`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengajukan WFA.');
    }
  };

  const handleHrManualWfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const isCustom =
      hrManualWfaSelectedOptionValue === '__LAINNYA__' || !hrManualWfaSelectedOptionValue;
    const matchedTorOpt = !isCustom
      ? hrTargetApprovedTorOptions.find((o) => o.value === hrManualWfaSelectedOptionValue)
      : undefined;

    if (isCustom && !hrManualWfaReason.trim()) {
      setErrorMsg('Tuliskan keterangan penugasan WFA pada kolom Opsi Lainnya.');
      return;
    }

    const composedPlan = matchedTorOpt
      ? hrManualWfaReason.trim()
        ? `${matchedTorOpt.shortActivity} — Catatan: ${hrManualWfaReason.trim()}`
        : matchedTorOpt.shortActivity
      : hrManualWfaReason.trim();

    try {
      const validEnd =
        hrManualWfaEndDate && hrManualWfaEndDate >= hrManualWfaDate
          ? hrManualWfaEndDate
          : hrManualWfaDate;
      const res = await api.submitOrAssignWfa({
        mode: 'hr_manual',
        userId: hrManualWfaUserId,
        date: hrManualWfaDate,
        startDate: hrManualWfaDate,
        endDate: validEnd,
        reasonAndPlan: composedPlan,
        hrNotes: hrManualWfaNotes,
        torId: matchedTorOpt?.torId,
        torNumber: matchedTorOpt?.torNumber,
        torTitle: matchedTorOpt?.torTitle,
        implementationOption: matchedTorOpt ? matchedTorOpt.label : 'Lainnya (Penugasan WFA)',
        isCustomImplementation: isCustom,
        invitedUserIds: hrManualWfaInvitedUserIds,
      });
      setBundle(res.bundle);
      setHrManualWfaReason('');
      setHrManualWfaNotes('');
      setHrManualWfaInvitedUserIds([]);
      showToast('Status WFA berhasil dimasukkan oleh Finance & disinkronkan ke kalender.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memasukkan status WFA manual.');
    }
  };

  const handleWfaDecision = async (
    id: string,
    stage: 'hr' | 'director',
    decision: 'approve' | 'return' | 'review' | 'acknowledge'
  ) => {
    setErrorMsg(null);
    const noteText = (wfaDecisionNotesMap[id] || '').trim();
    if (decision === 'return' && !noteText) {
      setErrorMsg('Alasan pengembalian (Return) wajib diisi oleh Finance agar staf mengetahui catatan revisi.');
      return;
    }
    try {
      const res = await api.decideWfaRequest(id, {
        stage,
        decision,
        notes: noteText || undefined,
      });
      setBundle(res.bundle);
      showToast(
        decision === 'approve'
          ? 'Permintaan WFA disetujui oleh Finance & otomatis disinkronkan ke kalender.'
          : decision === 'return'
          ? 'Permintaan WFA dikembalikan (Returned) ke staf beserta alasan dari Finance.'
          : decision === 'review'
          ? 'Catatan review & masukan strategis Direktur atas WFA Finance berhasil disimpan.'
          : 'Informasi WFA Direktur telah dicatat (acknowledged) oleh Finance.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memperbarui status WFA.');
    }
  };

  const handleFlextimeDecision = async (
    id: string,
    decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge'
  ) => {
    setErrorMsg(null);
    const noteText = (flexDecisionNotesMap[id] || '').trim();
    if (decision === 'return' && !noteText) {
      setErrorMsg('Alasan pengembalian (Return) wajib diisi oleh Finance.');
      return;
    }
    try {
      const res = await api.decideFlextimeRequest(id, {
        decision,
        notes: noteText || undefined,
      });
      setBundle(res.bundle);
      showToast(
        decision === 'approve'
          ? 'Pengajuan Flextime disetujui oleh Finance & kalender otomatis diperbarui.'
          : decision === 'return'
          ? 'Pengajuan Flextime dikembalikan (Returned) ke staf beserta alasan dari Finance.'
          : decision === 'review'
          ? 'Catatan review Direktur atas Flextime Finance berhasil disimpan.'
          : 'Informasi Flextime Direktur telah dicatat oleh Finance.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses tindak lanjut Flextime.');
    }
  };

  const handleSubmitHolidayRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const validEnd =
        holidayEndDate && holidayEndDate >= holidayStartDate
          ? holidayEndDate
          : holidayStartDate;
      const res = await api.submitHolidayRequest({
        userId: 'ALL_TEAM',
        title: holidayTitle,
        startDate: holidayStartDate,
        endDate: validEnd,
        reason: holidayReason,
        autoApproveByHr: isHR,
      });
      setBundle(res.bundle);
      setHolidayReason('');
      showToast(
        isDirector
          ? 'Hari Libur Bersama dari Direktur otomatis diberitahukan ke Finance & sinkron ke Kalender Tim.'
          : isHR
          ? 'Hari Libur Bersama diajukan oleh Finance ke Direktur untuk direview & sinkron ke Kalender Tim.'
          : 'Usulan Hari Libur Bersama dikirim ke Finance untuk persetujuan.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengajukan Hari Libur Bersama.');
    }
  };

  const handleHolidayDecision = async (
    id: string,
    stage: 'hr' | 'director',
    decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge'
  ) => {
    setErrorMsg(null);
    const noteText = (holidayDecisionNotesMap[id] || '').trim();
    if (decision === 'return' && !noteText) {
      setErrorMsg('Alasan pengembalian (Return) wajib diisi oleh Finance.');
      return;
    }
    try {
      const res = await api.decideHolidayRequest(id, {
        stage,
        decision,
        notes: noteText || undefined,
      });
      setBundle(res.bundle);
      showToast(
        decision === 'approve'
          ? 'Hari Libur Bersama disetujui oleh Finance & kalender diperbarui.'
          : decision === 'return'
          ? 'Usulan Hari Libur Bersama dikembalikan (Returned) beserta catatan Finance.'
          : decision === 'review'
          ? 'Catatan review Direktur atas Hari Libur Bersama berhasil disimpan.'
          : 'Informasi Hari Libur Bersama Direktur telah dicatat oleh Finance.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses Hari Libur Bersama.');
    }
  };

  const handleSaveLocationConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await api.updateAttendanceLocationConfig({
        officeName: cfgOfficeName,
        address: cfgAddress,
        latitude: cfgLat,
        longitude: cfgLon,
        radiusMeters: cfgRadius,
        standardDailyHours: cfgStandardHours,
      });
      setBundle(res.bundle);
      setShowLocationConfigModal(false);
      showToast(`Titik koordinat & radius ${cfgRadius}m WIJNA berhasil ditetapkan oleh Direktur.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan pengaturan koordinat lokasi.');
    }
  };

  // Filtered daily attendance records (Khusus Finance/HR & Director)
  const filteredDailyRecords = useMemo(() => {
    if (!bundle || !Array.isArray(bundle.records)) return [];
    return bundle.records.filter((r) => {
      if (!canViewDetails && r.userId !== currentUser?.id) return false;
      if (filterStaffId !== 'ALL' && r.userId !== filterStaffId) return false;
      if (filterOutsideOnly && !r.isOutsideWorkLocation) return false;
      return true;
    });
  }, [bundle, canViewDetails, currentUser?.id, filterStaffId, filterOutsideOnly]);

  // Daftar WFA, Cuti & Holiday sesuai hak akses (Termasuk WFA di mana staf diajak berkolaborasi)
  const visibleWfaRequests = useMemo(() => {
    const list = bundle?.wfaRequests || [];
    if (canViewDetails) return list;
    return list.filter(
      (w) =>
        w.userId === currentUser?.id ||
        (Array.isArray(w.invitedUserIds) && w.invitedUserIds.includes(currentUser?.id || ''))
    );
  }, [bundle?.wfaRequests, canViewDetails, currentUser?.id]);

  const visibleLeaveRequests = useMemo(() => {
    const list = bundle?.leaveRequests || [];
    if (canViewDetails) return list;
    return list.filter((l) => l.userId === currentUser?.id);
  }, [bundle?.leaveRequests, canViewDetails, currentUser?.id]);

  const visibleHolidayRequests = useMemo(() => {
    return bundle?.holidayRequests || [];
  }, [bundle?.holidayRequests]);

  // ===========================================================================
  // PERHITUNGAN REKAP KERJA RESMI (TIMESHEET & ATTENDANCE DOCUMENTATION)
  // Terhubung otomatis dengan Periode Pelaporan Finance (Period 1, Period 2, dst.)
  // ===========================================================================
  const activeSelectedPeriod = useMemo(() => {
    if (recapPeriodFilter === 'ALL') {
      const start =
        financePeriods.length > 0
          ? financePeriods.reduce(
              (min, p) => (p.startDate < min ? p.startDate : min),
              financePeriods[0].startDate
            )
          : '2026-01-01';
      const end =
        financePeriods.length > 0
          ? financePeriods.reduce(
              (max, p) => (p.endDate > max ? p.endDate : max),
              financePeriods[financePeriods.length - 1].endDate
            )
          : '2026-12-31';
      return {
        id: 'ALL',
        code: 'ALL',
        periodNumber: 0,
        periodTitle: 'Semua Periode Finance',
        label: `Semua Periode Finance (${start} – ${end})`,
        startDate: start,
        endDate: end,
        programName: financePeriods[0]?.programName || 'Organisasi Yayasan WIJNA',
      };
    }
    const found = financePeriods.find((p) => p.id === recapPeriodFilter);
    if (found) return found;
    return (
      financePeriods[0] || {
        id: 'cust-1-2026',
        code: 'P1',
        periodNumber: 1,
        periodTitle: 'Period 1',
        label: 'Period 1 (2026-01-01 – 2026-06-30)',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        programName: 'Organisasi Yayasan WIJNA',
      }
    );
  }, [recapPeriodFilter, financePeriods]);

  const getRecapVerificationFor = useCallback(
    (userId: string, periodId: string): RecapVerificationEntry => {
      const key = `${userId}__${periodId}`;
      const existing =
        (bundle?.workRecapVerifications?.[key] as RecapVerificationEntry | undefined) ||
        recapVerifications[key];
      if (existing) return existing;
      return {
        financeVerified: false,
        financeVerifierName: 'Menunggu Verifikasi HR/Finance',
        financeVerifierRole: 'Finance & HR Manager',
        financeVerifiedAt: '',
        financeRefCode: `FIN-HR/${periodId.toUpperCase().slice(0, 6)}/${userId
          .replace(/^user-/, '')
          .toUpperCase()}`,
        financeNotes: '',
        directorVerified: false,
        directorVerifierName: 'Menunggu Pengesahan Direktur',
        directorVerifierRole: 'Executive Director',
        directorVerifiedAt: '',
        directorRefCode: `DIR-OVS/${periodId.toUpperCase().slice(0, 6)}/${userId
          .replace(/^user-/, '')
          .toUpperCase()}`,
        directorNotes: '',
      };
    },
    [bundle?.workRecapVerifications, recapVerifications]
  );

  const saveRecapVerificationEntry = async (
    userId: string,
    periodId: string,
    stage: 'finance' | 'director',
    notes?: string
  ) => {
    try {
      const res = await api.saveWorkRecapVerification({
        userId,
        periodId,
        stage,
        notes,
      });
      if (res?.bundle) {
        setBundle(res.bundle);
        if (res.bundle.workRecapVerifications) {
          setRecapVerifications(
            res.bundle.workRecapVerifications as Record<string, RecapVerificationEntry>
          );
        }
      }
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan verifikasi Rekap Kerja.');
    }
  };

  const buildStaffWorkRecap = useCallback(
    (targetUser: User) => {
      const allRecords = bundle?.records || [];
      const allWfaRequests = bundle?.wfaRequests || [];
      const allFlexAssignments = bundle?.flextimeAssignments || [];

      const pStart = activeSelectedPeriod.startDate;
      const pEnd = activeSelectedPeriod.endDate;

      const isDateInSelectedPeriod = (dateStr: string) => {
        if (!dateStr) return false;
        const clean = dateStr.slice(0, 10);
        if (recapPeriodFilter === 'ALL') return true;
        return clean >= pStart && clean <= pEnd;
      };

      const isRangeOverlappingSelectedPeriod = (startStr: string, endStr?: string) => {
        const s = (startStr || '').slice(0, 10);
        const e = (endStr || startStr || '').slice(0, 10);
        if (!s) return false;
        if (recapPeriodFilter === 'ALL') return true;
        return s <= pEnd && e >= pStart;
      };

      // Filter hari di mana staf benar-benar bekerja (ATTENDANCE dengan Clock In tercatat)
      const workedRecords = allRecords.filter((r) => {
        if (r.userId !== targetUser.id) return false;
        if (r.recordType !== 'ATTENDANCE') return false;
        if (!r.clockInTime) return false;
        if (!isDateInSelectedPeriod(r.date)) return false;
        return true;
      });

      // Catatan WFA yang tercatat pada periode terpilih
      const wfaRecordsInPeriod = allRecords.filter((r) => {
        if (r.userId !== targetUser.id) return false;
        if (r.recordType !== 'WFA') return false;
        if (!isDateInSelectedPeriod(r.date)) return false;
        return true;
      });

      const activeWfaRequestsInPeriod = allWfaRequests.filter((w) => {
        if (w.userId !== targetUser.id) return false;
        if (w.status === 'Returned' || w.status === 'Pending') return false;
        return isRangeOverlappingSelectedPeriod(w.startDate || w.date, w.endDate || w.date);
      });

      const wfaDaysFromRequests = activeWfaRequestsInPeriod.reduce(
        (sum, w) => sum + (Number(w.totalDays) || 1),
        0
      );
      const wfaOccurrencesCount = Math.max(
        activeWfaRequestsInPeriod.length,
        wfaRecordsInPeriod.length
      );
      const wfaDaysCount = Math.max(wfaDaysFromRequests, wfaRecordsInPeriod.length);

      // Catatan Flextime yang aktif/disetujui atau diterapkan pada periode terpilih
      const activeFlexInPeriod = allFlexAssignments.filter((f) => {
        if (f.userId !== targetUser.id) return false;
        if (f.status === 'Returned' || f.status === 'Pending') return false;
        return isRangeOverlappingSelectedPeriod(f.startDate, f.endDate);
      });
      const flextimeAppliedDaysCount = workedRecords.filter((r) => r.isFlextimeApplied).length;
      const flextimeOccurrencesCount = Math.max(
        flextimeAppliedDaysCount,
        activeFlexInPeriod.length
      );

      // Urutkan terbaru ke terlama
      const sortedWorked = [...workedRecords].sort((a, b) => b.date.localeCompare(a.date));

      // Hitung jumlah hari unik yang benar-benar bekerja
      const uniqueDates = new Set<string>(sortedWorked.map((r) => r.date));
      const workedDays = uniqueDates.size;

      // Hitung total jam kerja dari hari-hari yang benar-benar bekerja
      const rawTotalHours = sortedWorked.reduce((sum, r) => {
        const hrs = Number(r.totalWorkHours) || 0;
        if (hrs > 0) return sum + hrs;
        if (r.clockInTime && !r.clockOutTime) {
          const diff = (nowMs - new Date(r.clockInTime).getTime()) / (1000 * 60 * 60);
          return sum + (diff > 0 ? Math.round(diff * 100) / 100 : 0);
        }
        return sum;
      }, 0);
      const totalHours = Math.round(rawTotalHours * 100) / 100;

      // Rata-rata jam kerja per hari = Total jam kerja ÷ jumlah hari yang benar-benar bekerja
      const avgHoursPerDay =
        workedDays > 0 ? Math.round((totalHours / workedDays) * 100) / 100 : 0;

      // Proporsi jenis pekerjaan atau aktivitas selama periode tersebut (termasuk hari kerja & WFA)
      const categoryCounts: Record<WijnaWorkCategory, number> = {
        'Rapat & Koordinasi': 0,
        'Perencanaan & Pengembangan': 0,
        'Administrasi & Pelaporan': 0,
        'Pendampingan & Supervisi': 0,
        'Komunikasi & Hubungan Eksternal': 0,
        'Pelatihan & Pengembangan Kapasitas': 0,
      };
      let totalContributionsCount = 0;

      const combinedPeriodRecords = [...sortedWorked, ...wfaRecordsInPeriod].sort((a, b) =>
        b.date.localeCompare(a.date)
      );

      for (const r of combinedPeriodRecords) {
        const items = (r.timesheetItems || []).slice(0, 2);
        for (const it of items) {
          if (categoryCounts[it.category] !== undefined) {
            categoryCounts[it.category] += 1;
            totalContributionsCount += 1;
          }
        }
      }

      const categoryProportions = WORK_CATEGORIES_SPEC.map((spec) => {
        const count = categoryCounts[spec.category] || 0;
        const percentage =
          totalContributionsCount > 0
            ? Math.round((count / totalContributionsCount) * 100)
            : 0;
        return {
          category: spec.category,
          scope: spec.scope,
          count,
          percentage,
        };
      }).sort((a, b) => b.count - a.count);

      const primaryContribution =
        totalContributionsCount > 0 && categoryProportions[0].count > 0
          ? categoryProportions[0].category
          : 'Belum ada catatan';

      const dailyLogs = combinedPeriodRecords.map((r) => ({
        id: r.id,
        date: r.date,
        recordType: r.recordType,
        isFlextimeApplied: Boolean(r.isFlextimeApplied),
        flextimeRuleLabel: r.flextimeRuleLabel,
        clockInTime: r.clockInTime,
        clockOutTime: r.clockOutTime,
        hours: Number(r.totalWorkHours) || 0,
        items: (r.timesheetItems || []).slice(0, 2),
      }));

      const verification = getRecapVerificationFor(targetUser.id, activeSelectedPeriod.id);

      return {
        user: targetUser,
        period: activeSelectedPeriod,
        workedDays,
        totalHours,
        avgHoursPerDay,
        flextimeOccurrencesCount,
        flextimeAppliedDaysCount,
        activeFlexInPeriod,
        wfaOccurrencesCount,
        wfaDaysCount,
        activeWfaRequestsInPeriod,
        totalContributionsCount,
        categoryProportions,
        primaryContribution,
        dailyLogs,
        verification,
      };
    },
    [
      bundle?.records,
      bundle?.wfaRequests,
      bundle?.flextimeAssignments,
      recapPeriodFilter,
      activeSelectedPeriod,
      nowMs,
      getRecapVerificationFor,
    ]
  );

  // Target karyawan untuk Preview Rekap Kerja Resmi:
  // Staf biasa hanya dapat melihat rekap miliknya sendiri; Finance/HR & Director dapat memilih staf mana pun
  const selectedRecapTargetUser = useMemo(() => {
    if (!currentUser) return null;
    if (!canViewDetails) return currentUser;
    if (selectedRecapUserId) {
      const found = allUsers.find((u) => u.id === selectedRecapUserId);
      if (found) return found;
    }
    return currentUser;
  }, [currentUser, canViewDetails, selectedRecapUserId, allUsers]);

  // 1. Rekap Resmi Karyawan yang Dipilih (Preview-Ready Official Work Recap)
  const myWorkRecap = useMemo(() => {
    if (!selectedRecapTargetUser) return null;
    return buildStaffWorkRecap(selectedRecapTargetUser);
  }, [selectedRecapTargetUser, buildStaffWorkRecap]);

  // 2. Rekap Keseluruhan Organisasi (Khusus Finance & Director)
  const organizationWorkRecapRows = useMemo(() => {
    if (!canViewDetails) return [];
    const staffList: User[] = allUsers.filter((u) => u.isActive && u.role !== 'admin');
    const rolePriority: Record<string, number> = {
      program_manager: 1,
      meal: 2,
      staff: 3,
      finance: 4,
      hr: 4,
      director: 5,
    };
    const sortedStaff = [...staffList].sort(
      (a, b) => (rolePriority[a.role] || 9) - (rolePriority[b.role] || 9)
    );
    return sortedStaff.map((u) => buildStaffWorkRecap(u));
  }, [canViewDetails, allUsers, buildStaffWorkRecap]);

  // Distribusi Proporsi Kontribusi Kolektif Organisasi (Khusus Finance & Director)
  const orgCategoryDistribution = useMemo(() => {
    const totals: Record<WijnaWorkCategory, number> = {
      'Rapat & Koordinasi': 0,
      'Perencanaan & Pengembangan': 0,
      'Administrasi & Pelaporan': 0,
      'Pendampingan & Supervisi': 0,
      'Komunikasi & Hubungan Eksternal': 0,
      'Pelatihan & Pengembangan Kapasitas': 0,
    };
    let grandTotal = 0;
    for (const row of organizationWorkRecapRows) {
      for (const cp of row.categoryProportions) {
        totals[cp.category] += cp.count;
        grandTotal += cp.count;
      }
    }
    return WORK_CATEGORIES_SPEC.map((spec) => {
      const count = totals[spec.category] || 0;
      const percentage = grandTotal > 0 ? Math.round((count / grandTotal) * 100) : 0;
      return {
        category: spec.category,
        count,
        percentage,
      };
    }).sort((a, b) => b.count - a.count);
  }, [organizationWorkRecapRows]);

  // Fungsi Preview & Download PDF Rekap Kerja Resmi (Khusus Finance/HR & Director)
  const handlePrintOfficialWorkRecap = () => {
    if (!canViewDetails || !myWorkRecap) return;
    setShowWorkRecapPreviewModal(true);
  };

  const handleDownloadOfficialWorkRecapPdf = async (targetElement?: HTMLElement | null) => {
    if (!canViewDetails || !myWorkRecap || downloadingRecapPdf) return;
    const el =
      targetElement ||
      modalWorkRecapSheetRef.current ||
      workRecapSheetRef.current;
    if (!el) return;

    setDownloadingRecapPdf(true);
    try {
      const safeName = myWorkRecap.user.name.replace(/[^a-zA-Z0-9]+/g, '_');
      const safePeriod = myWorkRecap.period.periodTitle.replace(/[^a-zA-Z0-9]+/g, '_');
      const todayIso = new Date().toISOString().slice(0, 10);
      await downloadElementAsPdf({
        element: el,
        filename: `Rekap_Kerja_Resmi_${safeName}_${safePeriod}_${todayIso}.pdf`,
        paperFormat: 'a4',
        orientation: 'portrait',
      });
      showToast(`Dokumen PDF Rekap Kerja Resmi (${myWorkRecap.user.name}) berhasil diunduh.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengunduh PDF Rekap Kerja.');
    } finally {
      setDownloadingRecapPdf(false);
    }
  };

  // Rekap Kuota & Pemakaian Cuti per Staf untuk Tab Khusus Pengaturan Cuti (leave_quota)
  const staffLeaveQuotaRows = useMemo(() => {
    if (!bundle) return [];
    const staffList: User[] = allUsers.filter((u) => u.isActive && u.role !== 'admin');
    const policies = bundle.leavePolicies || [];

    const activeLeaveStatuses = new Set([
      'Approved',
      'Submitted for Review',
      'Reviewed by Director',
      'Notified to Finance',
      'Acknowledged by Finance',
      'Disetujui Director',
    ]);
    const activeWfaStatuses = new Set([
      'Approved',
      'Submitted for Review',
      'Reviewed by Director',
      'Notified to Finance',
      'Acknowledged by Finance',
      'Disetujui HR',
    ]);
    return staffList.map((u) => {
      const approvedLeaves = (bundle.leaveRequests || []).filter(
        (l) => l.userId === u.id && activeLeaveStatuses.has(l.status)
      );
      const pendingLeaves = (bundle.leaveRequests || []).filter(
        (l) =>
          l.userId === u.id &&
          (l.status === 'Pending' ||
            l.status === 'Menunggu Review HR' ||
            l.status === 'Menunggu Keputusan Director')
      );
      const approvedWfaCount = (bundle.wfaRequests || []).filter(
        (w) => w.userId === u.id && activeWfaStatuses.has(w.status)
      ).length;
      const activeFlexCount = (bundle.flextimeAssignments || []).filter(
        (f) => f.userId === u.id && f.isActive
      ).length;

      const breakdownByPolicy = policies.map((pol) => {
        const usedDays = approvedLeaves
          .filter((l) => l.categoryId === pol.id || l.categoryName === pol.name)
          .reduce((sum, l) => sum + (Number(l.totalDays) || 0), 0);
        const remainingDays = Math.max(0, pol.allocationDaysPerYear - usedDays);
        return {
          policyId: pol.id,
          code: pol.code,
          name: pol.name,
          group: pol.group,
          allocated: pol.allocationDaysPerYear,
          used: usedDays,
          remaining: remainingDays,
        };
      });

      const totalUsedLeaveDays = approvedLeaves.reduce(
        (sum, l) => sum + (Number(l.totalDays) || 0),
        0
      );
      const totalPendingLeaveDays = pendingLeaves.reduce(
        (sum, l) => sum + (Number(l.totalDays) || 0),
        0
      );

      return {
        user: u,
        breakdownByPolicy,
        totalUsedLeaveDays,
        totalPendingLeaveDays,
        approvedWfaCount,
        activeFlexCount,
      };
    });
  }, [bundle, allUsers]);

  if (loading && !bundle) {
    return (
      <div className="p-6 bg-white border border-[#E5E5E3] rounded-lg text-xs text-[#6B6B68]">
        Memuat Attendance & Timesheet WIJNA...
      </div>
    );
  }

  if (!bundle) {
    console.info('[APP] Rendering fallback state (reason=attendance_bundle_unavailable)');
    return (
      <div className="p-6 bg-white border border-[#E5E5E3] rounded-lg space-y-3 text-xs text-[#57564F]">
        <div className="font-semibold text-[#1F2937] text-sm">
          Data Kehadiran & Kalender belum dapat dimuat
        </div>
        <p>{errorMsg || 'Koneksi ke server sempat tertunda saat mengambil data kehadiran.'}</p>
        <button
          type="button"
          onClick={() => loadAttendanceBundle()}
          className="px-3.5 py-1.5 rounded-lg bg-[#1F7A63] hover:bg-[#186350] text-white text-xs font-medium transition-colors cursor-pointer"
        >
          Muat Ulang Data
        </button>
      </div>
    );
  }

  const radiusMeters = bundle?.locationConfig?.radiusMeters || 5;
  const officeName = bundle?.locationConfig?.officeName || 'Kantor Pusat Yayasan WIJNA';
  const hasClockedIn = Boolean(myTodayRecord?.clockInTime);
  const hasClockedOut = Boolean(myTodayRecord?.clockOutTime);
  const hasActiveClockSession = Boolean(myActiveClockSession);
  // Sesi Clock In yang masih aktif TIDAK BOLEH tertutup oleh banner WFA agar tombol Clock Out selalu tersedia
  const isWfaDay =
    !hasActiveClockSession &&
    Boolean(myActiveWfaToday || myTodayRecord?.recordType === 'WFA');
  const liveDuration = formatDurationHMS(
    myTodayRecord?.clockInTime,
    myTodayRecord?.clockOutTime,
    nowMs
  );

  return (
    <div className="space-y-3">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex items-center gap-2 bg-[#1F2937] text-white px-3.5 py-2.5 rounded-md shadow-lg border border-[#374151] text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MOBILE QUICK-ACCESS NAVIGATION: LANGSUNG 3 TOMBOL UTAMA DI ATAS       */}
      {/* 1. Your Contribution (Clock In/Out) | 2. WFA | 3. Cuti & Izin         */}
      {/* ===================================================================== */}
      {isMobileQuickMode ? (
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              {
                id: 'daily' as const,
                label: 'Your Contribution',
                sub: 'Clock In & Out',
                icon: Clock,
                active: subTab === 'daily',
              },
              {
                id: 'wfa' as const,
                label: 'WFA',
                sub: 'Kerja Jarak Jauh',
                icon: Home,
                active: subTab === 'wfa',
              },
              {
                id: 'leave' as const,
                label: 'Cuti & Izin',
                sub: 'Pengajuan & Status',
                icon: HeartHandshake,
                active: subTab === 'leave',
              },
            ] as const
          ).map((tabItem) => {
            const IconComp = tabItem.icon;
            return (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setSubTab(tabItem.id)}
                className={`flex flex-col items-start justify-between p-2.5 min-h-[56px] rounded-xl border text-left transition-all cursor-pointer ${
                  tabItem.active
                    ? 'bg-[#F0FAF6] border-[#1F7A63] ring-1 ring-[#1F7A63]/20 text-[#0F4C3A] shadow-2xs'
                    : 'bg-white hover:bg-[#FAF9F6] border-[#E6E5E0] text-[#334155]'
                }`}
              >
                <div className="flex items-center justify-between w-full gap-1">
                  <IconComp
                    className={`w-4 h-4 shrink-0 ${
                      tabItem.active ? 'text-[#1F7A63]' : 'text-[#64748B]'
                    }`}
                  />
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      tabItem.active ? 'bg-[#1F7A63]' : 'bg-[#D3D3D0]'
                    }`}
                  />
                </div>
                <div className="mt-1.5 min-w-0 w-full">
                  <div
                    className={`text-[11.5px] leading-tight truncate ${
                      tabItem.active ? 'font-bold text-[#0F4C3A]' : 'font-semibold text-[#1E293B]'
                    }`}
                  >
                    {tabItem.label}
                  </div>
                  <div className="text-[10px] text-[#64748B] truncate mt-0.5">
                    {tabItem.sub}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : !pureCalendarMode ? (
        /* Navigasi Sub-Tab Tata Letak Grid Rapi Tanpa Scrollbar (Seperti Grid 01..09 Dokumen Program) */
        <div className="bg-[#FAFAF9] border border-[#EDEDEC] rounded-lg p-2 space-y-1.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-1.5">
            {([
              {
                id: 'daily' as const,
                num: '01',
                label: 'Your Contribution',
                active: subTab === 'daily',
                show: true,
                badgeCount: 0,
              },
              {
                id: 'work_recap' as const,
                num: '02',
                label: 'Rekap Kerja',
                active: subTab === 'work_recap' || subTab === 'staff_attendance_detail',
                show: canViewWorkRecap,
                badgeCount: 0,
              },
              {
                id: 'wfa' as const,
                num: '03',
                label: 'WFA',
                active: subTab === 'wfa',
                show: true,
                badgeCount: 0,
              },
              {
                id: 'leave' as const,
                num: '04',
                label: 'Cuti & Izin',
                active: subTab === 'leave',
                show: true,
                badgeCount: 0,
              },
              {
                id: 'holiday' as const,
                num: '05',
                label: 'Hari Libur Bersama',
                active: subTab === 'holiday',
                show: true,
                badgeCount: 0,
              },
              {
                id: 'employee_profile' as const,
                num: '06',
                label: 'Profil Karyawan',
                active: subTab === 'employee_profile',
                show: true,
                badgeCount: isDirector
                  ? (bundle?.employeeTrainings || []).filter(
                      (t) => t.status === 'Menunggu Persetujuan Director'
                    ).length
                  : 0,
              },
              {
                id: 'leave_quota' as const,
                num: '07',
                label: 'Kuota Cuti',
                active: subTab === 'leave_quota',
                show: canViewDetails,
                badgeCount: 0,
              },
              {
                id: 'flextime' as const,
                num: '08',
                label: 'Flextime',
                active: subTab === 'flextime',
                show: canViewDetails,
                badgeCount: 0,
              },
              {
                id: 'audit' as const,
                num: '09',
                label: 'Audit Trail',
                active: subTab === 'audit',
                show: canViewDetails,
                badgeCount: 0,
              },
            ]
              .filter((item) => item.show)
              .map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSubTab(item.id)}
                  className={`group/tab flex items-center justify-between px-3 py-1.5 min-h-[38px] sm:min-h-[34px] rounded border text-left transition-colors duration-150 min-w-0 cursor-pointer ${
                    item.active
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
                        item.active
                          ? 'font-semibold text-[#1D4ED8]'
                          : 'font-medium text-[#2F3437] group-hover/tab:text-[#1D4ED8]'
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.badgeCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A] text-[10px] font-semibold tabular-nums shrink-0">
                        {item.badgeCount}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        item.active ? 'text-[#0F7B6C]' : 'text-[#787774]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          item.active ? 'bg-[#0F7B6C]' : 'bg-[#D3D3D0]'
                        }`}
                      />
                      <span>{item.active ? 'Aktif' : 'Buka'}</span>
                    </span>
                  </div>
                </button>
              )))}

            {isDirector && (
              <button
                type="button"
                onClick={() => setShowLocationConfigModal(true)}
                className="group/tab flex items-center justify-between px-3 py-1.5 min-h-[38px] sm:min-h-[34px] rounded border border-[#EDEDEC] bg-white hover:border-[#D3D3D0] hover:bg-[#F2F1EE] text-left transition-colors duration-150 min-w-0 cursor-pointer"
                title={`Atur Titik Koordinat Lokasi Kerja WIJNA (${bundle?.locationConfig?.latitude?.toFixed(4)}, ${bundle?.locationConfig?.longitude?.toFixed(4)} · Radius ${radiusMeters}m)`}
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#0F7B6C] shrink-0" />
                  <span className="text-[12px] font-medium text-[#2F3437] truncate group-hover/tab:text-[#1D4ED8]">
                    Koordinat WIJNA ({radiusMeters}m)
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0F7B6C] shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0F7B6C] shrink-0" />
                  <span>Atur</span>
                </span>
              </button>
            )}
          </div>
        </div>
      ) : null}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2 rounded-lg text-xs flex items-center justify-between">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-600 hover:text-red-800 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB PROFIL KARYAWAN (SEDERHANA: OUTPUT, CUTI, LIST PELATIHAN, LINK HR)*/}
      {/* ===================================================================== */}
      {subTab === 'employee_profile' && bundle && (
        <EmployeeProfileView
          bundle={bundle}
          currentUser={currentUser}
          allUsers={allUsers}
          isHR={isHR}
          isDirector={isDirector}
          onBundleChange={(nextBundle) => setBundle(nextBundle)}
          onShowToast={showToast}
          onShowError={(msg) => setErrorMsg(msg)}
        />
      )}

      {/* ===================================================================== */}
      {/* PURE CALENDAR (MENU KHUSUS CALENDAR DI BAWAH YOUR NEXT STEPS)         */}
      {/* ===================================================================== */}
      {subTab === 'calendar' && bundle && (
        <InteractiveTeamCalendar
          bundle={bundle}
          currentUser={currentUser}
          allUsers={allUsers}
          allTors={allTors}
          isHR={isHR}
          isDirector={isDirector}
          lockedTodayDate={lockedTodayDate}
          showQuickClockIn={false}
          onToggleQuickClockIn={() => {}}
          isCalendarVisible={true}
          onBundleChange={(nextBundle) => setBundle(nextBundle)}
          onShowToast={showToast}
          onShowError={(msg) => setErrorMsg(msg)}
        />
      )}

      {/* ===================================================================== */}
      {/* YOUR CONTRIBUTION (DESAIN PSIKOLOGIS MENYENANGKAN & TIDAK MEMBERATKAN) */}
      {/* ===================================================================== */}
      {subTab === 'daily' && (
        <div className="space-y-3">
          {/* Panel Presensi & Fokus Hari Ini (Ramah, Tenang & Tidak Memberatkan Staf) */}
          <div className="bg-white border border-[#E6E5E0] rounded-xl p-4 sm:p-5 space-y-4 shadow-2xs">
            {/* Baris Atas: Sapaan Hangat & Konteks Hari Ini */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[#F1F0EC]">
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-[#1E293B]">
                    Halo, {currentUser?.name}
                  </h2>
                  {myActiveFlextimeToday && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE] text-[11px] font-medium">
                      Flextime Aktif
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#64748B]">
                  {hasClockedOut
                    ? 'Terima kasih atas dedikasi Anda hari ini. Selamat beristirahat!'
                    : hasClockedIn
                    ? 'Terima kasih atas kontribusi Anda hari ini. Semoga aktivitas berjalan lancar.'
                    : 'Semoga hari Anda menyenangkan. Pilih 1 atau 2 fokus aktivitas Anda hari ini.'}
                </p>
              </div>

              {/* Info Tanggal */}
              <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF9F6] text-[#475569] border border-[#E6E5E0] font-medium">
                  <Calendar className="w-3.5 h-3.5 text-[#64748B]" />
                  <span>{formatDateIndonesianLocked(lockedTodayDate)}</span>
                </span>
              </div>
            </div>

            {/* Pilihan 6 Fokus Aktivitas (Kata Fokus di Baris Atas Sendiri, Tidak Menghimpit Judul) */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#334155]">
                    Rencana Fokus Hari Ini
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFocusGuideModal(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F0F7F4] hover:bg-[#E2F2EB] text-[#16654E] border border-[#BCE3DC] text-[11px] font-semibold transition-colors cursor-pointer"
                    title="Lihat panduan lengkap memilih Rencana Fokus Hari Ini"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-[#0F7B6C] shrink-0" />
                    <span>Panduan Memilih Fokus</span>
                  </button>
                </div>
                <span className="text-[11px] font-medium text-[#64748B]">
                  {contributions.length === 0
                    ? 'Pilih 1–2 fokus'
                    : `${contributions.length} dari maksimal 2 fokus dipilih`}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-6 gap-2 sm:gap-2.5">
                {WORK_CATEGORIES_SPEC.map((item, idx) => {
                  const selectedIdx = contributions.findIndex(
                    (c) => c.category === item.category
                  );
                  const isSelected = selectedIdx !== -1;

                  const friendlySubtitles: Record<string, string> = {
                    'Rapat & Koordinasi': 'Diskusi tim & penyelarasan kerja',
                    'Perencanaan & Pengembangan': 'Menyusun konsep & rencana kerja',
                    'Administrasi & Pelaporan': 'Dokumentasi & kelengkapan berkas',
                    'Pendampingan & Supervisi': 'Mendampingi tim & mitra program',
                    'Komunikasi & Hubungan Eksternal': 'Kolaborasi mitra & jejaring luar',
                    'Pelatihan & Pengembangan Kapasitas': 'Belajar & berbagi pengetahuan',
                  };

                  const dotColors = [
                    'bg-[#3B82F6]',
                    'bg-[#8B5CF6]',
                    'bg-[#F59E0B]',
                    'bg-[#10B981]',
                    'bg-[#EC4899]',
                    'bg-[#14B8A6]',
                  ];

                  return (
                    <button
                      key={item.category}
                      type="button"
                      onClick={() => handleToggleCategory(item.category)}
                      className={`text-left p-2.5 sm:p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-1.5 sm:gap-2 ${
                        isSelected
                          ? 'bg-[#F0FAF6] border-[#2E9E7B] ring-1 ring-[#2E9E7B]/20 text-[#0F4C3A] shadow-2xs'
                          : 'bg-[#FAF9F6] hover:bg-[#F3F4F6]/80 border-[#E6E5E0] text-[#334155]'
                      }`}
                    >
                      <div className="space-y-1.5 w-full">
                        <div className="flex items-center justify-between gap-1.5 min-h-[20px]">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isSelected ? 'bg-[#1F7A63]' : dotColors[idx % dotColors.length]
                            }`}
                          />
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1F7A63] text-white text-[10px] font-semibold shrink-0 tabular-nums">
                              Fokus {selectedIdx + 1}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-[#94A3B8]">
                              0{idx + 1}
                            </span>
                          )}
                        </div>

                        <div
                          className={`text-xs leading-snug ${
                            isSelected
                              ? 'font-bold text-[#0F4C3A]'
                              : 'font-semibold text-[#1E293B]'
                          }`}
                        >
                          {item.category}
                        </div>
                      </div>

                      <div
                        className={`text-[11px] leading-snug pt-1 border-t ${
                          isSelected
                            ? 'text-[#286653] border-[#CBEAD9]'
                            : 'text-[#64748B] border-[#ECEAE4]'
                        }`}
                      >
                        {friendlySubtitles[item.category] || item.scope}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Baris Bawah: Cek Lokasi Koordinat Kantor WIJNA + Status Kehadiran & Tombol Clock In / Clock Out */}
            {isWfaDay ? (
              <div className="p-3.5 rounded-xl bg-[#F0FAF6] border border-[#C2EBD9] flex items-center justify-between gap-2 text-xs text-[#16654E]">
                <div className="flex items-center gap-2 font-semibold">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>
                    Hari ini Anda terjadwal WFA ({bundle?.locationConfig.standardDailyHours || 8}{' '}
                    Jam) · Fokus kontribusi tersimpan otomatis
                  </span>
                </div>
              </div>
            ) : (
              <div className="pt-3 border-t border-[#F1F0EC] space-y-3">
                {/* BARIS 1: DETEKSI GPS TOMBOL BESAR & INDIKATOR OTOMATIS (DI KANTOR ATAU TIDAK) */}
                <div className="rounded-xl border border-[#EAE8E1] bg-[#FAF9F6] p-3.5 sm:p-4 text-xs space-y-3 transition-all">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-bold text-[#1E293B] flex flex-wrap items-center gap-2">
                        <MapPin className="w-4 h-4 text-[#1F7A63] shrink-0" />
                        <span>Deteksi Titik Koordinat Kantor WIJNA Sebelum Clock In</span>
                      </div>
                      <p className="text-[11px] text-[#64748B]">
                        {!hasCheckedLocation
                          ? `Klik tombol Deteksi GPS untuk mendeteksi otomatis apakah lokasi Anda berada di ${
                              bundle?.locationConfig?.officeName || 'Kantor WIJNA'
                            } (${officeLatVal.toFixed(6)}, ${officeLonVal.toFixed(
                              6
                            )} · radius ${radiusMeters}m).`
                          : isMatchedWithOffice
                          ? `Indikator otomatis: Lokasi Anda berada di Kantor WIJNA (${resolvedCoords.lat.toFixed(
                              6
                            )}, ${resolvedCoords.lon.toFixed(6)}${
                              userCoordAccuracy > 0 ? ` · akurasi GPS ±${userCoordAccuracy}m` : ''
                            } · jarak efektif ${currentDistanceMeters}m). Tombol Clock In telah dibuka.`
                          : `Indikator otomatis: Lokasi terdeteksi di (${resolvedCoords.lat.toFixed(
                              6
                            )}, ${resolvedCoords.lon.toFixed(6)}${
                              userCoordAccuracy > 0 ? ` · akurasi GPS ±${userCoordAccuracy}m` : ''
                            }), berjarak ${currentDistanceMeters}m dari Kantor WIJNA (${officeLatVal.toFixed(
                              6
                            )}, ${officeLonVal.toFixed(
                              6
                            )} · radius ${radiusMeters}m). Gunakan opsi Izin HR di bawah agar Clock In sah.`}
                      </p>
                      {gpsStatusNote && (
                        <p className="text-[11px] text-[#16654E] font-medium">
                          {gpsStatusNote}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      {/* Indikator Otomatis Hasil Deteksi GPS (Bukan Tombol Manual) */}
                      <div className="inline-flex items-center rounded-xl border border-[#E2E0D8] bg-white p-1 gap-1">
                        <div
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all select-none ${
                            hasCheckedLocation && isMatchedWithOffice
                              ? 'bg-[#F0FAF6] text-[#16654E] border border-[#2E9E7B]'
                              : 'text-[#94A3B8] border border-transparent opacity-60'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Di Kantor</span>
                        </div>

                        <div
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all select-none ${
                            hasCheckedLocation && !isMatchedWithOffice
                              ? 'bg-[#FAF9F6] text-[#1E293B] border border-[#CBD5E1] shadow-2xs'
                              : 'text-[#94A3B8] border border-transparent opacity-60'
                          }`}
                        >
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span>Tidak Sesuai Koordinat</span>
                        </div>
                      </div>

                      {/* Tombol Besar Deteksi GPS (Murni membaca sensor lokasi, tidak pernah mereset sesi Clock In aktif) */}
                      <button
                        type="button"
                        disabled={isCheckingLocation}
                        onClick={() => handleCheckLocationNow()}
                        className="h-11 sm:h-12 px-5 rounded-xl bg-[#1F7A63] hover:bg-[#17614E] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        title="Deteksi otomatis koordinat GPS tanpa mengubah sesi Clock In aktif"
                      >
                        <MapPin className="w-4 h-4 shrink-0" />
                        <span>{isCheckingLocation ? 'Mendeteksi GPS...' : 'Deteksi GPS'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* BARIS 2: RINGKASAN KEHADIRAN & TOMBOL TETAP "CLOCK IN" DAN "CLOCK OUT" */}
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 sm:gap-6 bg-[#FAF9F6] px-3.5 sm:px-4 py-2.5 rounded-xl border border-[#EAE8E1] text-xs">
                    <div>
                      <span className="text-[11px] text-[#787774] block">
                        {hasClockedIn ? 'Waktu Clock In' : 'Notifikasi Presensi'}
                      </span>
                      <span className="font-semibold text-sm text-[#1E293B] tabular-nums">
                        {myTodayRecord?.clockInTime
                          ? formatTimeWithSeconds(myTodayRecord.clockInTime)
                          : !hasCheckedLocation
                          ? 'Silakan Deteksi GPS dahulu'
                          : isMatchedWithOffice
                          ? 'Sesuai Koordinat · Siap Clock In'
                          : outsideClockInChoice === 'clock_in_with_hr'
                          ? 'Izin HR Dipilih · Siap Clock In'
                          : 'Pilih Izin HR di bawah'}
                      </span>
                    </div>
                    <div className="h-6 w-px bg-[#E2E0D8]" />
                    <div>
                      <span className="text-[11px] text-[#787774] block">
                        {hasClockedIn ? 'Jam Selesai' : 'Waktu Real-Time'}
                      </span>
                      <span className="font-mono font-semibold text-sm text-[#1E293B] tabular-nums">
                        {myTodayRecord?.clockOutTime
                          ? formatTimeWithSeconds(myTodayRecord.clockOutTime)
                          : hasClockedIn
                          ? '—'
                          : new Date(nowMs).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              hour12: false,
                            })}
                      </span>
                    </div>
                    <div className="h-6 w-px bg-[#E2E0D8]" />
                    <div>
                      <span className="text-[11px] text-[#787774] block">
                        {hasClockedIn ? 'Durasi Real-Time' : 'Status Hari Ini'}
                      </span>
                      <span className="font-semibold text-sm text-[#1F7A63] tabular-nums">
                        {hasClockedOut
                          ? `Selesai (${liveDuration.hms})`
                          : hasClockedIn
                          ? myTodayRecord?.isOutsideWorkLocation &&
                            myTodayRecord?.outsideReviewStatus === 'PENDING_HR_REVIEW'
                            ? `Menunggu ACC HR · ${liveDuration.hms}`
                            : `Sedang Beraktivitas (Sah) · ${liveDuration.hms}`
                          : 'Belum Clock In'}
                      </span>
                    </div>
                  </div>

                  {/* Tombol Besar Clock In & Clock Out (Tulisan tetap "Clock In" dan "Clock Out") */}
                  <div className="grid grid-cols-2 gap-2.5 lg:w-[440px]">
                    <button
                      type="button"
                      disabled={
                        submittingAction ||
                        hasClockedIn ||
                        !hasCheckedLocation ||
                        (!isMatchedWithOffice && outsideClockInChoice !== 'clock_in_with_hr')
                      }
                      onClick={handleClockIn}
                      className={`h-11 sm:h-12 px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                        hasClockedIn
                          ? 'bg-[#F0FAF6] text-[#16654E] border border-[#B8E6D4] cursor-default'
                          : !hasCheckedLocation ||
                            (!isMatchedWithOffice && outsideClockInChoice !== 'clock_in_with_hr')
                          ? 'bg-[#FAF9F6] text-[#94A3B8] border border-[#E5E4DE] cursor-not-allowed'
                          : 'bg-[#1F7A63] hover:bg-[#17614E] text-white shadow-xs cursor-pointer'
                      }`}
                    >
                      <LogIn className="w-4 h-4 shrink-0" />
                      <span>Clock In</span>
                    </button>

                    <button
                      type="button"
                      disabled={submittingAction || !hasClockedIn || hasClockedOut}
                      onClick={handleClockOut}
                      className={`h-11 sm:h-12 px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                        !hasClockedIn || hasClockedOut
                          ? 'bg-[#FAF9F6] text-[#94A3B8] border border-[#E5E4DE] cursor-not-allowed'
                          : 'bg-[#2B5B84] hover:bg-[#214768] text-white shadow-xs cursor-pointer'
                      }`}
                    >
                      <LogOut className="w-4 h-4 shrink-0" />
                      <span>Clock Out</span>
                    </button>
                  </div>
                </div>

                {/* BARIS 3 (DI BAWAH): OPSI & STATUS IZIN HR DENGAN TONE DESAIN YANG SERAGAM */}
                {hasCheckedLocation && !isMatchedWithOffice && !hasClockedIn && (
                  <div className="rounded-xl border border-[#EAE8E1] bg-[#FAF9F6] p-3.5 text-xs space-y-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        setOutsideClockInChoice((prev) =>
                          prev === 'clock_in_with_hr' ? 'none' : 'clock_in_with_hr'
                        )
                      }
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        outsideClockInChoice === 'clock_in_with_hr'
                          ? 'bg-[#F0FAF6] border-[#2E9E7B] text-[#0F4C3A]'
                          : 'bg-white hover:bg-[#F3F4F6]/60 border-[#E6E5E0] text-[#334155]'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={outsideClockInChoice === 'clock_in_with_hr'}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 accent-[#1F7A63] rounded cursor-pointer"
                          />
                          <span>
                            Tetap Clock In dengan Izin HR (Clock In Sah Setelah Di-ACC HR)
                          </span>
                        </div>
                        <p className="text-[11px] text-[#64748B] pl-5.5">
                          Aktifkan opsi ini apabila Anda bertugas di luar titik koordinat Kantor WIJNA agar tombol Clock In dapat digunakan dan diverifikasi oleh HR.
                        </p>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[10px] font-semibold shrink-0 border ${
                          outsideClockInChoice === 'clock_in_with_hr'
                            ? 'bg-[#1F7A63] text-white border-[#1F7A63]'
                            : 'bg-[#FAF9F6] text-[#64748B] border-[#E2E0D8]'
                        }`}
                      >
                        {outsideClockInChoice === 'clock_in_with_hr'
                          ? 'Aktif · Siap Clock In'
                          : 'Pilih Opsi'}
                      </span>
                    </button>

                    {outsideClockInChoice === 'clock_in_with_hr' && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white p-2.5 rounded-xl border border-[#E6E5E0]">
                        <span className="text-[11px] font-semibold text-[#334155] shrink-0">
                          Keterangan Izin HR:
                        </span>
                        <input
                          type="text"
                          value={outsideReasonInput}
                          onChange={(e) => setOutsideReasonInput(e.target.value)}
                          placeholder="Contoh: Dinas luar / rapat koordinasi mitra di lapangan..."
                          className="flex-1 h-8 px-2.5 text-xs bg-[#FAF9F6] border border-[#E2E0D8] rounded-lg focus:outline-none focus:border-[#1F7A63]"
                        />
                      </div>
                    )}
                  </div>
                )}

                {hasClockedIn &&
                  !hasClockedOut &&
                  isWorkingOutsideArea &&
                  !myTodayRecord?.outsideLocationReason && (
                    <div className="rounded-xl border border-[#EAE8E1] bg-[#FAF9F6] p-3 text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white p-2.5 rounded-xl border border-[#E6E5E0]">
                        <span className="text-[11px] font-semibold text-[#334155] shrink-0">
                          Keterangan Clock Out di Luar Kantor:
                        </span>
                        <input
                          type="text"
                          value={outsideReasonInput}
                          onChange={(e) => setOutsideReasonInput(e.target.value)}
                          placeholder="Isi keterangan singkat apabila Anda akan Clock Out dari luar titik koordinat kantor..."
                          className="flex-1 h-8 px-2.5 text-xs bg-[#FAF9F6] border border-[#E2E0D8] rounded-lg focus:outline-none focus:border-[#1F7A63]"
                        />
                      </div>
                    </div>
                  )}

                {hasClockedIn && myTodayRecord?.isOutsideWorkLocation && (
                  <div
                    className={`px-4 py-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
                      myTodayRecord.outsideReviewStatus === 'HR_REVIEWED' ||
                      myTodayRecord.outsideReviewStatus === 'ACKNOWLEDGED_BY_FINANCE' ||
                      myTodayRecord.outsideReviewStatus === 'REVIEWED_BY_DIRECTOR'
                        ? 'bg-[#F0FAF6] border-[#B8E6D4] text-[#0F4C3A]'
                        : 'bg-[#FAF9F6] border-[#EAE8E1] text-[#1E293B]'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-[#1E293B] flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            myTodayRecord.outsideReviewStatus === 'HR_REVIEWED' ||
                            myTodayRecord.outsideReviewStatus === 'ACKNOWLEDGED_BY_FINANCE' ||
                            myTodayRecord.outsideReviewStatus === 'REVIEWED_BY_DIRECTOR'
                              ? 'bg-[#1F7A63]'
                              : 'bg-[#F59E0B]'
                          }`}
                        />
                        <span>
                          {myTodayRecord.outsideReviewStatus === 'HR_REVIEWED' ||
                          myTodayRecord.outsideReviewStatus === 'ACKNOWLEDGED_BY_FINANCE' ||
                          myTodayRecord.outsideReviewStatus === 'REVIEWED_BY_DIRECTOR'
                            ? 'Clock In dengan Izin HR Telah Di-ACC HR (Clock In Sah)'
                            : 'Clock In dengan Izin HR Tercatat — Menunggu ACC HR Agar Clock In Sah'}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#64748B] pl-4">
                        Keterangan Izin HR: {myTodayRecord.outsideLocationReason || '-'}
                      </div>
                    </div>
                    {isHR && myTodayRecord.outsideReviewStatus === 'PENDING_HR_REVIEW' && (
                      <button
                        type="button"
                        onClick={() => handleReviewOutsideLocation(myTodayRecord.id, 'hr', 'approve')}
                        className="h-9 px-4 rounded-xl bg-[#1F7A63] hover:bg-[#17614E] text-white font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>ACC Izin HR (Sah)</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}


      {/* ===================================================================== */}
      {/* TAB 03: KHUSUS WFA (WORK FROM ANYWHERE) — ROLE-BASED WORKFLOW         */}
      {/* ===================================================================== */}
      {subTab === 'wfa' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div
              className={`${
                isHR ? 'lg:col-span-7' : 'lg:col-span-12'
              } bg-white border border-[#E5E5E3] rounded-lg p-4`}
            >
              <form onSubmit={handleStaffSubmitWfa} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                      {isDirector
                        ? 'Pemberitahuan Jadwal WFA & Implementasi Direktur (Director → Finance: Informasi)'
                        : isHR
                        ? 'Pengajuan Jadwal WFA & Implementasi Finance (Finance → Director: Review & Masukan)'
                        : 'Pengajuan Permintaan WFA & Implementasi Staf (Employee → Finance: Persetujuan)'}
                    </h3>
                    <p className="text-[11px] text-[#6B6B68] mt-0.5">
                      {isDirector
                        ? 'Pengaturan WFA Direktur otomatis aktif di kalender dan dikirim ke Finance sebagai informasi/pencatatan administrasi (tanpa persetujuan).'
                        : isHR
                        ? 'Pengajuan WFA Finance otomatis dikirim ke Direktur untuk direview dan diberi masukan strategis (tanpa persetujuan/penolakan).'
                        : 'Pengajuan WFA staf dikirim ke Finance untuk direview dan disetujui (Approved) atau dikembalikan dengan alasan (Returned).'}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                      isDirector
                        ? 'bg-purple-50 text-purple-800 border-purple-200'
                        : isHR
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {isDirector
                      ? 'Notify for Information'
                      : isHR
                      ? 'Submit for Review'
                      : 'Submit for Approval'}
                  </span>
                </div>

                {/* Keterangan Basis Opsi Implementasi ToR per Pengguna */}
                <div className="px-3 py-2 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#334155]">
                  <div className="flex items-start gap-2">
                    <FileText className="w-3.5 h-3.5 text-[#2563EB] shrink-0 mt-0.5" />
                    <span>
                      <strong>Rencana Kontribusi Pekerjaan WFA:</strong> Opsi implementasi ini disusun berdasarkan jenis kegiatan dalam{' '}
                      <strong>Terms of Reference (ToR)</strong> yang telah diajukan oleh{' '}
                      <strong>{currentUser?.name}</strong> dan memperoleh persetujuan dari pihak yang berwenang, ditambah{' '}
                      <strong>Opsi Lainnya</strong>. Setiap pengguna memiliki opsi berbeda dan dapat mengajak staf lain.
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-[#1D4ED8] border border-blue-200 text-[10px] font-semibold whitespace-nowrap">
                    {myApprovedTorOptions.length} Opsi Kegiatan ToR Disetujui + Lainnya
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-[#37352F] mb-1">
                      Mulai WFA
                    </label>
                    <input
                      type="date"
                      required
                      value={wfaDate}
                      onChange={(e) => {
                        setWfaDate(e.target.value);
                        if (wfaEndDate < e.target.value) setWfaEndDate(e.target.value);
                      }}
                      className="w-full px-2 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-[#37352F] mb-1">
                      Selesai WFA
                    </label>
                    <input
                      type="date"
                      required
                      min={wfaDate}
                      value={wfaEndDate}
                      onChange={(e) => setWfaEndDate(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                    />
                  </div>
                  <div className="sm:col-span-6">
                    <label className="block text-xs font-medium text-[#37352F] mb-1">
                      Rencana Kontribusi Pekerjaan WFA (Opsi Implementasi ToR Disetujui)
                    </label>
                    <select
                      value={wfaSelectedOptionValue}
                      onChange={(e) => setWfaSelectedOptionValue(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white font-medium text-[#1F2937]"
                    >
                      {myApprovedTorOptions.length > 0 && (
                        <optgroup
                          label={`Jenis Kegiatan ToR Disetujui — ${currentUser?.name || 'Pengguna'}`}
                        >
                          {myApprovedTorOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Opsi Tambahan / Di Luar Daftar ToR">
                        <option value="__LAINNYA__">
                          Lainnya — Tuliskan Rencana Kontribusi Pekerjaan WFA Secara Manual
                        </option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                {/* Kolom Rincian Manual (Wajib jika memilih "Lainnya", Opsional sebagai catatan tambahan jika memilih Kegiatan ToR) */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                  <div className="sm:col-span-9">
                    <label className="block text-[11px] font-medium text-[#37352F] mb-1">
                      {wfaSelectedOptionValue === '__LAINNYA__' || myApprovedTorOptions.length === 0
                        ? 'Uraian Rencana Kontribusi Pekerjaan WFA (Opsi Lainnya — Wajib Diisi)'
                        : 'Catatan Spesifik / Target Harian Implementasi ToR (Opsional)'}
                    </label>
                    <input
                      type="text"
                      required={
                        wfaSelectedOptionValue === '__LAINNYA__' || myApprovedTorOptions.length === 0
                      }
                      value={wfaReasonPlan}
                      onChange={(e) => setWfaReasonPlan(e.target.value)}
                      placeholder={
                        wfaSelectedOptionValue === '__LAINNYA__' || myApprovedTorOptions.length === 0
                          ? 'Gambaran kontribusi pekerjaan WFA lainnya...'
                          : 'Tambahkan rincian target/lokasi spesifik bila diperlukan (opsional)...'
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      className="w-full py-1.5 px-3 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {isDirector
                        ? 'Kirim Info WFA'
                        : isHR
                        ? 'Ajukan Review'
                        : 'Ajukan WFA'}
                    </button>
                  </div>
                </div>

                {/* Pilihan Mengajak Staf Lain dalam WFA / Implementasi Kegiatan */}
                <div className="pt-2 border-t border-[#EFEFED]">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                    <label className="text-[11px] font-semibold text-[#37352F] flex items-center gap-1.5">
                      <UsersIcon className="w-3.5 h-3.5 text-[#0F7B6C]" />
                      <span>
                        Ajak Staf Lain Berkolaborasi dalam WFA / Implementasi Ini (Opsional)
                      </span>
                    </label>
                    {wfaInvitedUserIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setWfaInvitedUserIds([])}
                        className="text-[10.5px] text-rose-600 hover:underline cursor-pointer font-medium"
                      >
                        Reset Pilihan ({wfaInvitedUserIds.length} staf diajak)
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allUsers
                      .filter(
                        (u) => u.isActive && u.role !== 'admin' && u.id !== currentUser?.id
                      )
                      .map((colleague) => {
                        const isSelected = wfaInvitedUserIds.includes(colleague.id);
                        return (
                          <button
                            key={colleague.id}
                            type="button"
                            onClick={() =>
                              setWfaInvitedUserIds((prev) =>
                                prev.includes(colleague.id)
                                  ? prev.filter((id) => id !== colleague.id)
                                  : [...prev, colleague.id]
                              )
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-teal-50 text-teal-900 border-teal-400 font-semibold'
                                : 'bg-[#FAFAF9] text-[#5A5A58] border-[#E5E5E3] hover:bg-[#F3F4F6]'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isSelected ? 'bg-[#0F7B6C]' : 'bg-[#D1D5DB]'
                              }`}
                            />
                            <span>{colleague.name}</span>
                            <span className="text-[10px] text-[#787774]">
                              ({colleague.roleTitle})
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </form>
            </div>

            {/* Input Manual Status WFA oleh Finance */}
            {isHR && (
              <div className="lg:col-span-5 bg-white border border-[#E5E5E3] rounded-lg p-4">
                <form onSubmit={handleHrManualWfa} className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-teal-900 uppercase tracking-wider">
                        Penetapan Jadwal WFA Staf oleh Finance
                      </h4>
                      <p className="text-[11px] text-[#6B6B68] mt-0.5">
                        Opsi implementasi otomatis menyesuaikan ToR disetujui milik staf terpilih.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-semibold">
                      Otomatis Sinkron Kalender
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-medium text-[#37352F] mb-1">
                        Pilih Staf
                      </label>
                      <select
                        value={hrManualWfaUserId}
                        onChange={(e) => setHrManualWfaUserId(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                      >
                        {allUsers
                          .filter((u) => u.isActive && u.role !== 'admin')
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-medium text-[#37352F] mb-1">
                        Mulai
                      </label>
                      <input
                        type="date"
                        required
                        value={hrManualWfaDate}
                        onChange={(e) => {
                          setHrManualWfaDate(e.target.value);
                          if (hrManualWfaEndDate < e.target.value) {
                            setHrManualWfaEndDate(e.target.value);
                          }
                        }}
                        className="w-full px-1.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-medium text-[#37352F] mb-1">
                        Selesai
                      </label>
                      <input
                        type="date"
                        required
                        min={hrManualWfaDate}
                        value={hrManualWfaEndDate}
                        onChange={(e) => setHrManualWfaEndDate(e.target.value)}
                        className="w-full px-1.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#37352F] mb-1">
                      Opsi Implementasi ToR Disetujui ({hrTargetStaffUser?.name || 'Staf'})
                    </label>
                    <select
                      value={hrManualWfaSelectedOptionValue}
                      onChange={(e) => setHrManualWfaSelectedOptionValue(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                    >
                      {hrTargetApprovedTorOptions.length > 0 && (
                        <optgroup
                          label={`Kegiatan ToR Disetujui — ${hrTargetStaffUser?.name || 'Staf'}`}
                        >
                          {hrTargetApprovedTorOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Opsi Lainnya">
                        <option value="__LAINNYA__">
                          Lainnya — Tuliskan Penugasan WFA Manual
                        </option>
                      </optgroup>
                    </select>
                  </div>

                  <div className="flex gap-1.5 items-end">
                    <div className="flex-1">
                      <label className="block text-[11px] font-medium text-[#37352F] mb-1">
                        {hrManualWfaSelectedOptionValue === '__LAINNYA__' ||
                        hrTargetApprovedTorOptions.length === 0
                          ? 'Keterangan Penugasan WFA (Wajib)'
                          : 'Catatan Tambahan (Opsional)'}
                      </label>
                      <input
                        type="text"
                        required={
                          hrManualWfaSelectedOptionValue === '__LAINNYA__' ||
                          hrTargetApprovedTorOptions.length === 0
                        }
                        value={hrManualWfaReason}
                        onChange={(e) => setHrManualWfaReason(e.target.value)}
                        placeholder="Penugasan / catatan WFA..."
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                      />
                    </div>
                    <button
                      type="submit"
                      className="py-1.5 px-3 rounded bg-[#0F7B6C] hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Simpan
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                {canViewDetails
                  ? 'Daftar WFA & Alur Tindak Lanjut Berdasarkan Peran (Employee → Finance · Finance → Director · Director → Finance)'
                  : 'Riwayat Pengajuan WFA Saya & Kolaborasi Tim (Status: Pending, Approved, atau Returned)'}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase">
                    <th className="py-2.5 px-4 w-[16%]">Tanggal / Periode</th>
                    {canViewDetails && <th className="py-2.5 px-4 w-[18%]">Pengguna & Alur</th>}
                    <th className="py-2.5 px-4 w-[30%]">Rencana Kontribusi (Basis ToR / Lainnya) & Staf Diajak</th>
                    <th className="py-2.5 px-4 w-[16%]">Status</th>
                    {canViewDetails && <th className="py-2.5 px-4 w-[20%] text-right">Tindak Lanjut Sesuai Otoritas</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFED]">
                  {visibleWfaRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-[#787774]">
                        Belum ada catatan WFA.
                      </td>
                    </tr>
                  ) : (
                    visibleWfaRequests.map((w) => {
                      const sDate = w.startDate || w.date;
                      const eDate = w.endDate || sDate;
                      const wfType =
                        w.workflowType ||
                        (w.userId === 'user-director'
                          ? 'DIRECTOR_TO_FINANCE_NOTIFY'
                          : w.userId === 'user-finance'
                          ? 'FINANCE_TO_DIRECTOR_REVIEW'
                          : 'EMPLOYEE_TO_FINANCE_APPROVAL');
                      const isApprovedLike =
                        w.status === 'Approved' ||
                        w.status === 'Disetujui HR' ||
                        w.status === 'Reviewed by Director' ||
                        w.status === 'Acknowledged by Finance';
                      const isReturnedLike =
                        w.status === 'Returned' || w.status === 'Ditolak HR';

                      return (
                        <tr key={w.id} className="hover:bg-[#FAFAF9] align-middle">
                          <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                            <div>{sDate === eDate ? sDate : `${sDate} s/d ${eDate}`}</div>
                            {w.totalDays && w.totalDays > 1 && (
                              <div className="text-[10.5px] font-sans font-normal text-[#6B6B68]">
                                {w.totalDays} hari kerja
                              </div>
                            )}
                          </td>
                          {canViewDetails && (
                            <td className="py-3 px-4">
                              <div className="font-semibold text-[#252525]">{w.userName}</div>
                              <div className="text-[11px] text-[#6B6B68]">{w.userRoleTitle}</div>
                              <span className="inline-block mt-1 px-1.5 py-0.2 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[10px] font-mono text-[#5A5A58]">
                                {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY'
                                  ? 'Director → Finance (Info)'
                                  : wfType === 'FINANCE_TO_DIRECTOR_REVIEW'
                                  ? 'Finance → Director (Review)'
                                  : 'Employee → Finance (Approval)'}
                              </span>
                            </td>
                          )}
                          <td className="py-3 px-4 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {w.torNumber ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-[#1D4ED8] border border-blue-200 text-[10px] font-mono font-semibold">
                                  <FileText className="w-3 h-3" />
                                  <span>Implementasi ToR: {w.torNumber}</span>
                                </span>
                              ) : w.isCustomImplementation ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-semibold">
                                  Opsi Lainnya (Non-ToR)
                                </span>
                              ) : null}
                              {!canViewDetails && w.userId !== currentUser?.id && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-semibold">
                                  Diajak oleh {w.userName}
                                </span>
                              )}
                            </div>
                            <div className="text-[#252525] leading-relaxed font-medium">
                              {w.reasonAndPlan}
                            </div>
                            {w.invitedUserNames && w.invitedUserNames.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50/90 border border-teal-200 text-[10.5px] text-teal-900 font-medium">
                                  <UsersIcon className="w-3 h-3 text-[#0F7B6C]" />
                                  <span>
                                    Mengajak Staf: <strong>{w.invitedUserNames.join(', ')}</strong>
                                  </span>
                                </span>
                              </div>
                            )}
                            {(w.returnReason || (isReturnedLike && w.hrNotes)) && (
                              <div className="px-2 py-1 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                                <strong>Alasan Dikembalikan (Finance):</strong> &ldquo;
                                {w.returnReason || w.hrNotes}&rdquo;
                              </div>
                            )}
                            {!isReturnedLike && w.hrNotes && (
                              <div className="text-[11px] text-teal-800">
                                <strong>Catatan Finance ({w.hrManagedByName || 'Finance'}):</strong>{' '}
                                {w.hrNotes}
                              </div>
                            )}
                            {w.directorReviewNotes && (
                              <div className="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                                <strong>Review & Masukan Direktur ({w.directorAcknowledgedByName || 'Direktur'}):</strong>{' '}
                                &ldquo;{w.directorReviewNotes}&rdquo;
                              </div>
                            )}
                            {w.financeAckNotes && (
                              <div className="text-[11px] text-purple-800">
                                <strong>Tercatat oleh Finance ({w.financeAcknowledgedByName || 'Finance'}):</strong>{' '}
                                {w.financeAckNotes}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold border ${
                                isApprovedLike
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : isReturnedLike
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : w.status === 'Notified to Finance'
                                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                                  : w.status === 'Submitted for Review'
                                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {w.status}
                            </span>
                          </td>
                          {canViewDetails && (
                            <td className="py-3 px-4 text-right">
                              {/* 1. Employee -> Finance: Finance Approves or Returns with mandatory reason */}
                              {wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' && isHR && (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <input
                                    type="text"
                                    value={wfaDecisionNotesMap[w.id] || ''}
                                    onChange={(e) =>
                                      setWfaDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [w.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Catatan / alasan return..."
                                    className="w-36 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  {w.status !== 'Approved' && (
                                    <button
                                      type="button"
                                      onClick={() => handleWfaDecision(w.id, 'hr', 'approve')}
                                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                                    >
                                      Approve
                                    </button>
                                  )}
                                  {w.status !== 'Returned' && (
                                    <button
                                      type="button"
                                      onClick={() => handleWfaDecision(w.id, 'hr', 'return')}
                                      className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                                    >
                                      Return
                                    </button>
                                  )}
                                </div>
                              )}
                              {wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' && isDirector && (
                                <span className="text-[11px] text-[#787774]">
                                  Wewenang Persetujuan Finance
                                </span>
                              )}

                              {/* 2. Finance -> Director: Director provides strategic review note only (No Approve/Return) */}
                              {wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && isDirector && (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <input
                                    type="text"
                                    value={wfaDecisionNotesMap[w.id] || ''}
                                    onChange={(e) =>
                                      setWfaDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [w.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Masukan / catatan review..."
                                    className="w-40 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleWfaDecision(w.id, 'director', 'review')}
                                    className="px-2.5 py-1 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                  >
                                    Simpan Catatan Review
                                  </button>
                                </div>
                              )}
                              {wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && isHR && (
                                <span className="text-[11px] text-[#787774]">
                                  {w.directorReviewNotes
                                    ? 'Telah Direview Direktur'
                                    : 'Menunggu Masukan Review Direktur'}
                                </span>
                              )}

                              {/* 3. Director -> Finance: Finance acknowledges for information/record-keeping only (No Approve/Return) */}
                              {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && isHR && (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <input
                                    type="text"
                                    value={wfaDecisionNotesMap[w.id] || ''}
                                    onChange={(e) =>
                                      setWfaDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [w.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Catatan pencatatan HR..."
                                    className="w-36 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  {w.status !== 'Acknowledged by Finance' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleWfaDecision(w.id, 'hr', 'acknowledge')}
                                      className="px-2.5 py-1 rounded bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                    >
                                      Catat / Acknowledge
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-purple-800 font-semibold">
                                      Tercatat di Finance
                                    </span>
                                  )}
                                </div>
                              )}
                              {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && isDirector && (
                                <span className="text-[11px] text-[#787774]">
                                  Informasi ke Finance (Tanpa Approval)
                                </span>
                              )}
                            </td>
                          )}
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
      {/* TAB 05: HARI LIBUR BERSAMA / NASIONAL (BERLAKU UMUM UNTUK SELURUH TIM) */}
      {/* ===================================================================== */}
      {subTab === 'holiday' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#E5E5E3] rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                  Penetapan & Usulan Hari Libur Bersama / Nasional (Seluruh Tim WIJNA)
                </h3>
                <p className="text-[11px] text-[#6B6B68]">
                  {isDirector
                    ? 'Penetapan Hari Libur Bersama oleh Direktur otomatis aktif di Kalender Tim & diberitahukan ke Finance sebagai informasi.'
                    : isHR
                    ? 'Penetapan Hari Libur Bersama oleh Finance otomatis aktif di Kalender Tim & dikirim ke Direktur untuk direview.'
                    : 'Usulan Hari Libur Bersama oleh Staf dikirim ke Finance untuk direview dan disetujui (Approved) atau dikembalikan (Returned).'}
                </p>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                  isDirector
                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                    : isHR
                    ? 'bg-blue-50 text-blue-800 border-blue-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {isDirector
                  ? 'Notify for Information'
                  : isHR
                  ? 'Submit for Review'
                  : 'Submit for Approval'}
              </span>
            </div>

            <form
              onSubmit={handleSubmitHolidayRequest}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end text-xs"
            >
              <div className="sm:col-span-4">
                <label className="block font-medium text-[#37352F] mb-1">
                  Nama Hari Libur Bersama / Nasional
                </label>
                <input
                  type="text"
                  required
                  value={holidayTitle}
                  onChange={(e) => setHolidayTitle(e.target.value)}
                  placeholder="Contoh: Hari Libur Bersama — Libur Nasional / Cuti Bersama"
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-[#37352F] mb-1">Mulai</label>
                <input
                  type="date"
                  required
                  value={holidayStartDate}
                  onChange={(e) => {
                    setHolidayStartDate(e.target.value);
                    if (holidayEndDate < e.target.value) setHolidayEndDate(e.target.value);
                  }}
                  className="w-full px-2 py-1.5 border border-[#D9D9D6] rounded bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-[#37352F] mb-1">Selesai</label>
                <input
                  type="date"
                  required
                  min={holidayStartDate}
                  value={holidayEndDate}
                  onChange={(e) => setHolidayEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#D9D9D6] rounded bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-[#37352F] mb-1">Keterangan</label>
                <input
                  type="text"
                  required
                  value={holidayReason}
                  onChange={(e) => setHolidayReason(e.target.value)}
                  placeholder="Keterangan singkat..."
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full py-1.5 px-3 rounded bg-purple-600 hover:bg-purple-700 text-white font-semibold cursor-pointer whitespace-nowrap"
                >
                  {isDirector
                    ? 'Kirim Info Libur'
                    : isHR
                    ? 'Tetapkan & Review'
                    : 'Ajukan ke Finance'}
                </button>
              </div>
            </form>
          </div>

          <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3]">
              <h4 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                Daftar Hari Libur Bersama / Nasional (Seluruh Staf WIJNA)
              </h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase">
                    <th className="py-2.5 px-4">Periode Tanggal</th>
                    <th className="py-2.5 px-4">Cakupan & Alur</th>
                    <th className="py-2.5 px-4">Nama Hari Libur Bersama & Catatan</th>
                    <th className="py-2.5 px-4">Status</th>
                    {canViewDetails && <th className="py-2.5 px-4 text-right">Tindak Lanjut</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFED]">
                  {visibleHolidayRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-[#787774]">
                        Belum ada jadwal Hari Libur Bersama / Nasional.
                      </td>
                    </tr>
                  ) : (
                    visibleHolidayRequests.map((h) => {
                      const wfType = h.workflowType || 'FINANCE_TO_DIRECTOR_REVIEW';
                      const isReturned = h.status === 'Returned' || h.status === 'Ditolak HR';
                      return (
                        <tr key={h.id} className="hover:bg-[#FAFAF9] align-middle">
                          <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                            <div>
                              {h.startDate === h.endDate
                                ? h.startDate
                                : `${h.startDate} s/d ${h.endDate}`}
                            </div>
                            <div className="text-[10.5px] font-sans font-normal text-[#6B6B68]">
                              {h.totalDays} hari kerja
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-[#252525]">Seluruh Tim WIJNA</div>
                            <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[10px] font-mono text-[#5A5A58]">
                              {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY'
                                ? 'Director → Finance (Info)'
                                : wfType === 'FINANCE_TO_DIRECTOR_REVIEW'
                                ? 'Finance → Director (Review)'
                                : 'Employee → Finance (Approval)'}
                            </span>
                          </td>
                          <td className="py-3 px-4 space-y-1">
                            <div className="font-semibold text-[#252525]">
                              {h.title.replace(/Personal Holiday/gi, 'Hari Libur Bersama')}
                            </div>
                            <div className="text-[11px] text-[#5A5A58]">{h.reason}</div>
                            {h.returnReason && (
                              <div className="px-2 py-1 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                                <strong>Alasan Dikembalikan (Finance):</strong> &ldquo;{h.returnReason}&rdquo;
                              </div>
                            )}
                            {h.directorReviewNotes && (
                              <div className="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                                <strong>Review Direktur ({h.directorAcknowledgedByName || 'Direktur'}):</strong>{' '}
                                &ldquo;{h.directorReviewNotes}&rdquo;
                              </div>
                            )}
                            {h.financeAckNotes && (
                              <div className="text-[11px] text-purple-800">
                                <strong>Tercatat Finance:</strong> {h.financeAckNotes}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold border ${
                                isReturned
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : h.status === 'Pending'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-purple-50 text-purple-800 border-purple-200'
                              }`}
                            >
                              {h.status}
                            </span>
                          </td>
                          {canViewDetails && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' && isHR && (
                                <div className="inline-flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={holidayDecisionNotesMap[h.id] || ''}
                                    onChange={(e) =>
                                      setHolidayDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [h.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Catatan / alasan return..."
                                    className="w-32 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleHolidayDecision(h.id, 'hr', 'approve')}
                                    className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleHolidayDecision(h.id, 'hr', 'return')}
                                    className="px-2.5 py-1 rounded bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    Return
                                  </button>
                                </div>
                              )}
                              {wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && isDirector && (
                                <div className="inline-flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={holidayDecisionNotesMap[h.id] || ''}
                                    onChange={(e) =>
                                      setHolidayDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [h.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Catatan review Direktur..."
                                    className="w-36 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleHolidayDecision(h.id, 'director', 'review')}
                                    className="px-2.5 py-1 rounded bg-[#1D4ED8] text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    Simpan Review
                                  </button>
                                </div>
                              )}
                              {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && isHR && (
                                <div className="inline-flex items-center gap-1.5">
                                  {h.status !== 'Acknowledged by Finance' ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleHolidayDecision(h.id, 'hr', 'acknowledge')
                                      }
                                      className="px-2.5 py-1 rounded bg-purple-700 text-white text-[11px] font-semibold cursor-pointer"
                                    >
                                      Catat / Acknowledge
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-purple-800 font-semibold">
                                      Tercatat di Finance
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          )}
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
      {/* TAB 04: KHUSUS PENGAJUAN & TINDAK LANJUT CUTI / IZIN                  */}
      {/* ===================================================================== */}
      {subTab === 'leave' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#E5E5E3] rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEFED] pb-2.5">
              <div>
                <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                  {isDirector
                    ? 'Pemberitahuan Cuti / Izin Direktur (Director → Finance: Informasi)'
                    : isHR
                    ? 'Pengajuan Cuti / Izin Finance (Finance → Director: Review & Masukan)'
                    : 'Pengajuan Cuti / Izin Staf (Employee → Finance: Persetujuan)'}
                </h3>
                <p className="text-[11px] text-[#6B6B68]">
                  {isDirector
                    ? 'Cuti/izin Direktur otomatis aktif di kalender dan diberitahukan ke Finance sebagai informasi administrasi (tanpa persetujuan).'
                    : isHR
                    ? 'Cuti/izin Finance diajukan ke Direktur untuk direview dan diberi masukan strategis (tanpa persetujuan/penolakan).'
                    : 'Cuti/izin staf diajukan ke Finance untuk disetujui (Approved) atau dikembalikan dengan alasan (Returned).'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                    isDirector
                      ? 'bg-purple-50 text-purple-800 border-purple-200'
                      : isHR
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {isDirector
                    ? 'Notify for Information'
                    : isHR
                    ? 'Submit for Review'
                    : 'Submit for Approval'}
                </span>
                {canViewDetails && (
                  <button
                    type="button"
                    onClick={() => setSubTab('leave_quota')}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#F7F7F5] hover:bg-[#EAEAE8] border border-[#D9D9D6] text-xs font-semibold text-[#2563EB] cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Buka Tab Kuota Cuti</span>
                  </button>
                )}
              </div>
            </div>

            <form
              onSubmit={handleSubmitLeaveRequest}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end text-xs"
            >
              <div className="sm:col-span-3">
                <label className="block font-medium text-[#37352F] mb-1">
                  Pilih Kategori Cuti / Izin
                </label>
                <select
                  value={leaveCategoryId}
                  onChange={(e) => setLeaveCategoryId(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                >
                  {(bundle?.leavePolicies || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.allocationDaysPerYear} hr/thn)
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-[#37352F] mb-1">Mulai</label>
                <input
                  type="date"
                  required
                  value={leaveStartDate}
                  onChange={(e) => setLeaveStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#D9D9D6] rounded bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-[#37352F] mb-1">Selesai</label>
                <input
                  type="date"
                  required
                  value={leaveEndDate}
                  onChange={(e) => setLeaveEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 border border-[#D9D9D6] rounded bg-white"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-medium text-[#37352F] mb-1">
                  Alasan / Keterangan Cuti & Delegasi
                </label>
                <input
                  type="text"
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Keterangan singkat cuti/izin..."
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full py-1.5 px-3 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold cursor-pointer whitespace-nowrap"
                >
                  {isDirector
                    ? 'Kirim Info Cuti'
                    : isHR
                    ? 'Ajukan Review'
                    : 'Ajukan Cuti'}
                </button>
              </div>
            </form>
          </div>

          <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3]">
              <h4 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                Daftar Cuti & Izin (Alur: Employee → Finance · Finance → Director · Director → Finance)
              </h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase">
                    {canViewDetails && <th className="py-2.5 px-4 w-[18%]">Pengguna & Alur</th>}
                    <th className="py-2.5 px-4 w-[24%]">Kategori & Tanggal</th>
                    <th className="py-2.5 px-4 w-[26%]">Catatan & Jejak Tindak Lanjut</th>
                    <th className="py-2.5 px-4 w-[12%]">Status</th>
                    {canViewDetails && (
                      <th className="py-2.5 px-4 w-[20%] text-right">
                        Tindak Lanjut Sesuai Otoritas
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFED]">
                  {visibleLeaveRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-[#787774]">
                        Belum ada pengajuan cuti/izin.
                      </td>
                    </tr>
                  ) : (
                    visibleLeaveRequests.map((lv) => {
                      const wfType =
                        lv.workflowType ||
                        (lv.userId === 'user-director'
                          ? 'DIRECTOR_TO_FINANCE_NOTIFY'
                          : lv.userId === 'user-finance'
                          ? 'FINANCE_TO_DIRECTOR_REVIEW'
                          : 'EMPLOYEE_TO_FINANCE_APPROVAL');
                      const isApprovedLike =
                        lv.status === 'Approved' ||
                        lv.status === 'Disetujui Director' ||
                        lv.status === 'Reviewed by Director' ||
                        lv.status === 'Acknowledged by Finance';
                      const isReturnedLike =
                        lv.status === 'Returned' || lv.status === 'Ditolak';

                      return (
                        <tr key={lv.id} className="hover:bg-[#FAFAF9] align-middle">
                          {canViewDetails && (
                            <td className="py-3 px-4">
                              <div className="font-semibold text-[#252525]">{lv.userName}</div>
                              <div className="text-[11px] text-[#6B6B68]">{lv.userRoleTitle}</div>
                              <span className="inline-block mt-1 px-1.5 py-0.2 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[10px] font-mono text-[#5A5A58]">
                                {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY'
                                  ? 'Director → Finance (Info)'
                                  : wfType === 'FINANCE_TO_DIRECTOR_REVIEW'
                                  ? 'Finance → Director (Review)'
                                  : 'Employee → Finance (Approval)'}
                              </span>
                            </td>
                          )}
                          <td className="py-3 px-4">
                            <div className="font-semibold text-[#252525]">{lv.categoryName}</div>
                            <div className="font-mono text-[11px] text-[#5A5A58] mt-0.5">
                              {lv.startDate} s/d {lv.endDate} ({lv.totalDays} hari)
                            </div>
                            {lv.reason && (
                              <div className="text-[11px] text-[#6B6B68] mt-0.5">{lv.reason}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 space-y-1">
                            {(lv.returnReason || (isReturnedLike && lv.hrReviewNotes)) && (
                              <div className="px-2 py-1 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                                <strong>Alasan Dikembalikan (Finance):</strong> &ldquo;
                                {lv.returnReason || lv.hrReviewNotes}&rdquo;
                              </div>
                            )}
                            {!isReturnedLike && lv.hrReviewerName && (
                              <div className="text-[11px] text-emerald-800">
                                <strong>Finance ({lv.hrReviewerName}):</strong>{' '}
                                {lv.hrReviewNotes || 'Disetujui & sinkron ke kalender'}
                              </div>
                            )}
                            {(lv.directorReviewNotes || lv.directorDecisionNotes) && (
                              <div className="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                                <strong>
                                  Review & Masukan Direktur ({lv.directorDecisionByName || 'Direktur'}):
                                </strong>{' '}
                                &ldquo;{lv.directorReviewNotes || lv.directorDecisionNotes}&rdquo;
                              </div>
                            )}
                            {lv.financeAckNotes && (
                              <div className="text-[11px] text-purple-800">
                                <strong>Tercatat Finance ({lv.financeAcknowledgedByName || 'Finance'}):</strong>{' '}
                                {lv.financeAckNotes}
                              </div>
                            )}
                            {!lv.hrReviewerName &&
                              !lv.directorDecisionByName &&
                              !lv.returnReason &&
                              !lv.financeAckNotes && (
                                <span className="text-[11px] text-[#787774]">
                                  {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY'
                                    ? 'Informasi aktif di kalender · Menunggu pencatatan Finance'
                                    : wfType === 'FINANCE_TO_DIRECTOR_REVIEW'
                                    ? 'Aktif di kalender · Menunggu review Direktur'
                                    : 'Menunggu persetujuan Finance'}
                                </span>
                              )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold border ${
                                isApprovedLike
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : isReturnedLike
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : lv.status === 'Notified to Finance'
                                  ? 'bg-purple-50 text-purple-800 border-purple-200'
                                  : lv.status === 'Submitted for Review'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {lv.status}
                            </span>
                          </td>
                          {canViewDetails && (
                            <td className="py-3 px-4 text-right">
                              {/* 1. Employee -> Finance: Finance Approves or Returns with mandatory reason */}
                              {wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' && isHR && (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <input
                                    type="text"
                                    value={leaveDecisionNotesMap[lv.id] || ''}
                                    onChange={(e) =>
                                      setLeaveDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [lv.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Catatan / alasan return..."
                                    className="w-36 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  {lv.status !== 'Approved' && (
                                    <button
                                      type="button"
                                      onClick={() => handleLeaveDecision(lv.id, 'hr', 'approve')}
                                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-semibold cursor-pointer whitespace-nowrap"
                                    >
                                      Approve
                                    </button>
                                  )}
                                  {lv.status !== 'Returned' && (
                                    <button
                                      type="button"
                                      onClick={() => handleLeaveDecision(lv.id, 'hr', 'return')}
                                      className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10.5px] font-semibold cursor-pointer whitespace-nowrap"
                                    >
                                      Return
                                    </button>
                                  )}
                                </div>
                              )}
                              {wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' && isDirector && (
                                <span className="text-[11px] text-[#787774]">
                                  Wewenang Persetujuan Finance
                                </span>
                              )}

                              {/* 2. Finance -> Director: Director reviews & gives strategic input only (No Approve/Return) */}
                              {wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && isDirector && (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <input
                                    type="text"
                                    value={leaveDecisionNotesMap[lv.id] || ''}
                                    onChange={(e) =>
                                      setLeaveDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [lv.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Masukan / catatan review..."
                                    className="w-40 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleLeaveDecision(lv.id, 'director', 'review')
                                    }
                                    className="px-2.5 py-1 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[10.5px] font-semibold cursor-pointer whitespace-nowrap"
                                  >
                                    Simpan Catatan Review
                                  </button>
                                </div>
                              )}
                              {wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && isHR && (
                                <span className="text-[11px] text-[#787774]">
                                  {lv.directorReviewNotes || lv.directorDecisionNotes
                                    ? 'Telah Direview Direktur'
                                    : 'Menunggu Masukan Review Direktur'}
                                </span>
                              )}

                              {/* 3. Director -> Finance: Finance acknowledges for information/record-keeping only */}
                              {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && isHR && (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <input
                                    type="text"
                                    value={leaveDecisionNotesMap[lv.id] || ''}
                                    onChange={(e) =>
                                      setLeaveDecisionNotesMap((prev) => ({
                                        ...prev,
                                        [lv.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Catatan pencatatan HR..."
                                    className="w-36 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                                  />
                                  {lv.status !== 'Acknowledged by Finance' ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleLeaveDecision(lv.id, 'hr', 'acknowledge')
                                      }
                                      className="px-2.5 py-1 rounded bg-purple-700 hover:bg-purple-800 text-white text-[10.5px] font-semibold cursor-pointer whitespace-nowrap"
                                    >
                                      Catat / Acknowledge
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-purple-800 font-semibold">
                                      Tercatat di Finance
                                    </span>
                                  )}
                                </div>
                              )}
                              {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && isDirector && (
                                <span className="text-[11px] text-[#787774]">
                                  Informasi ke Finance (Tanpa Approval)
                                </span>
                              )}
                            </td>
                          )}
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
      {/* TAB 08: FLEXTIME (KHUSUS FINANCE/HR & DIRECTOR)                       */}
      {/* ===================================================================== */}
      {subTab === 'flextime' && canViewDetails && (
        <div className="space-y-4">
          <div className="bg-white border border-[#E5E5E3] rounded-lg p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEFED] pb-2">
              <div>
                <h3 className="font-bold text-[#252525] uppercase tracking-wider">
                  Pengaturan & Tindak Lanjut Flextime (Employee → Finance · Finance → Director · Director → Finance)
                </h3>
                <p className="text-[11px] text-[#6B6B68] mt-0.5">
                  {isDirector
                    ? 'Direktur dapat mengatur Flextime (diberitahukan ke Finance sebagai informasi) atau memberikan catatan review atas pengajuan Flextime Finance.'
                    : 'Finance menyetujui (Approve) atau mengembalikan (Return dengan alasan) pengajuan Flextime staf, serta mencatat informasi Flextime Direktur.'}
                </p>
              </div>
            </div>

            {isHR && (
              <form
                onSubmit={handleSaveFlextime}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end"
              >
                <div className="lg:col-span-3">
                  <label className="block font-medium text-[#37352F] mb-1">Pilih Staf</label>
                  <select
                    value={flexUserId}
                    onChange={(e) => setFlexUserId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                  >
                    {allUsers
                      .filter((u) => u.isActive && u.role !== 'admin')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.roleTitle})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block font-medium text-[#37352F] mb-1">Mulai Periode</label>
                  <input
                    type="date"
                    required
                    value={flexStartDate}
                    onChange={(e) => setFlexStartDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-[#D9D9D6] rounded bg-white"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="block font-medium text-[#37352F] mb-1">Akhir Periode</label>
                  <input
                    type="date"
                    required
                    value={flexEndDate}
                    onChange={(e) => setFlexEndDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-[#D9D9D6] rounded bg-white"
                  />
                </div>
                <div className="lg:col-span-3">
                  <label className="block font-medium text-[#37352F] mb-1">
                    Pengaturan Jam Kerja & Catatan
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      required
                      value={flexSchedule}
                      onChange={(e) => setFlexSchedule(e.target.value)}
                      placeholder="Mis. 07:30–10:00 WIB"
                      className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                    />
                    <input
                      type="text"
                      value={flexNotes}
                      onChange={(e) => setFlexNotes(e.target.value)}
                      placeholder="Catatan kebijakan..."
                      className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                    />
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <button
                    type="submit"
                    className="w-full py-1.5 px-3 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Simpan Flextime
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3]">
              <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                Daftar Penugasan & Periode Flextime Staf
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase">
                    <th className="py-2.5 px-4 w-[18%] min-w-[160px]">Nama Staf & Alur</th>
                    <th className="py-2.5 px-4 w-[16%] min-w-[160px]">Periode</th>
                    <th className="py-2.5 px-4 w-[32%] min-w-[240px]">
                      Pengaturan Flextime & Catatan
                    </th>
                    <th className="py-2.5 px-4 w-[12%] min-w-[110px]">Status</th>
                    <th className="py-2.5 px-4 w-[22%] min-w-[180px] text-right">Tindak Lanjut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFED]">
                  {(bundle?.flextimeAssignments || []).map((f) => {
                    const wfType =
                      f.workflowType ||
                      (f.userId === 'user-director'
                        ? 'DIRECTOR_TO_FINANCE_NOTIFY'
                        : f.userId === 'user-finance'
                        ? 'FINANCE_TO_DIRECTOR_REVIEW'
                        : 'EMPLOYEE_TO_FINANCE_APPROVAL');
                    const isReturned = f.status === 'Returned' || f.status === 'Ditolak HR';
                    return (
                      <tr key={f.id} className="hover:bg-[#FAFAF9] align-middle">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#252525] leading-snug">
                            {f.userName}
                          </div>
                          <div className="text-[11px] text-[#6B6B68] mt-0.5">{f.userRoleTitle}</div>
                          <span className="inline-block mt-1 px-1.5 py-0.2 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[10px] font-mono text-[#5A5A58]">
                            {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY'
                              ? 'Director → Finance'
                              : wfType === 'FINANCE_TO_DIRECTOR_REVIEW'
                              ? 'Finance → Director'
                              : 'Employee → Finance'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11.5px] text-[#252525] whitespace-nowrap">
                          {f.startDate} s/d {f.endDate}
                        </td>
                        <td className="py-3 px-4 space-y-1">
                          <div className="font-semibold text-[#252525] leading-snug">
                            {f.scheduleArrangement}
                          </div>
                          {f.policyNotes && (
                            <div className="text-[11px] text-[#6B6B68] leading-relaxed">
                              {f.policyNotes}
                            </div>
                          )}
                          {f.returnReason && (
                            <div className="px-2 py-1 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                              <strong>Alasan Dikembalikan (Finance):</strong> &ldquo;{f.returnReason}&rdquo;
                            </div>
                          )}
                          {f.directorReviewNotes && (
                            <div className="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                              <strong>Review Direktur:</strong> &ldquo;{f.directorReviewNotes}&rdquo;
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold border ${
                              f.status === 'Pending' || f.status === 'Diajukan Staf'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : isReturned
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : f.isActive
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : 'bg-[#F4F4F2] text-[#787774] border-[#D9D9D6]'
                            }`}
                          >
                            {f.status || (f.isActive ? 'Approved' : 'Nonaktif')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' && isHR && (
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="text"
                                value={flexDecisionNotesMap[f.id] || ''}
                                onChange={(e) =>
                                  setFlexDecisionNotesMap((prev) => ({
                                    ...prev,
                                    [f.id]: e.target.value,
                                  }))
                                }
                                placeholder="Catatan / alasan return..."
                                className="w-32 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleFlextimeDecision(f.id, 'approve')}
                                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleFlextimeDecision(f.id, 'return')}
                                className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Return
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteFlextime(f.id)}
                                className="p-1.5 rounded text-[#787774] hover:text-red-600 cursor-pointer"
                                title="Hapus"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          {wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && isDirector && (
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="text"
                                value={flexDecisionNotesMap[f.id] || ''}
                                onChange={(e) =>
                                  setFlexDecisionNotesMap((prev) => ({
                                    ...prev,
                                    [f.id]: e.target.value,
                                  }))
                                }
                                placeholder="Catatan review Direktur..."
                                className="w-36 px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleFlextimeDecision(f.id, 'review')}
                                className="px-2.5 py-1 rounded bg-[#1D4ED8] text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Simpan Review
                              </button>
                            </div>
                          )}
                          {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && isHR && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleFlextimeDecision(f.id, 'acknowledge')}
                                className="px-2.5 py-1 rounded bg-purple-700 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Catat / Acknowledge
                              </button>
                            </div>
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
      {/* TAB KHUSUS: ATUR JUMLAH CUTI, KUOTA & REKAP CUTI (FINANCE/HR & DIR)   */}
      {/* ===================================================================== */}
      {subTab === 'leave_quota' && canViewDetails && (
        <div className="space-y-4">
          {/* Bagian 1: Pengaturan Master Kategori & Jumlah Alokasi Cuti Tahunan/Sakit/Khusus */}
          <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                  Pengaturan Kategori & Jumlah Alokasi Cuti / Izin (Otoritas Finance / HR)
                </h3>
                <p className="text-[11px] text-[#6B6B68] mt-0.5">
                  Atur jenis cuti sakit, cuti khusus, cuti tahunan, beserta jumlah alokasi hari per tahun.
                </p>
              </div>
              {isHR && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingPolicyId(undefined);
                    setPolCode('');
                    setPolName('');
                    setPolGroup('CUTI_SAKIT');
                    setPolAllocation(12);
                    setPolTerms('');
                    setShowLeavePolicyModal(true);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Tambah Kategori Cuti</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] text-[#6B6B68] uppercase">
                    <th className="py-2.5 px-3.5">Kode</th>
                    <th className="py-2.5 px-3.5">Nama Kategori Cuti / Izin</th>
                    <th className="py-2.5 px-3.5">Kelompok</th>
                    <th className="py-2.5 px-3.5">Jumlah / Alokasi Cuti (Hari/Tahun)</th>
                    <th className="py-2.5 px-3.5">Ketentuan & Syarat</th>
                    {isHR && <th className="py-2.5 px-3.5 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFED]">
                  {(bundle?.leavePolicies || []).map((pol) => {
                    const isRowEditing = isHR && editingQuotaRowId === pol.id;
                    const draftVal =
                      inlineQuotaMap[pol.id] !== undefined
                        ? inlineQuotaMap[pol.id]
                        : pol.allocationDaysPerYear;
                    return (
                      <tr key={pol.id} className="hover:bg-[#FAFAF9]">
                        <td className="py-2.5 px-3.5 font-mono font-semibold text-[#252525]">
                          {pol.code}
                        </td>
                        <td className="py-2.5 px-3.5 font-semibold text-[#252525]">{pol.name}</td>
                        <td className="py-2.5 px-3.5">
                          <span className="px-2 py-0.5 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[10px] font-semibold">
                            {pol.group === 'CUTI_SAKIT'
                              ? 'Jenis Cuti Sakit'
                              : pol.group === 'CUTI_KHUSUS'
                              ? 'Jenis Cuti Khusus'
                              : 'Ketentuan Cuti Lainnya'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5">
                          {isRowEditing ? (
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                value={draftVal}
                                onChange={(e) =>
                                  setInlineQuotaMap((prev) => ({
                                    ...prev,
                                    [pol.id]: parseInt(e.target.value, 10) || 0,
                                  }))
                                }
                                className="w-16 px-2 py-1 border border-[#2563EB] rounded font-mono text-xs bg-white focus:outline-none"
                              />
                              <span className="text-[11px] text-[#6B6B68]">hari/thn</span>
                              <button
                                type="button"
                                onClick={() => handleQuickUpdatePolicyQuota(pol, draftVal)}
                                className="px-2 py-0.5 rounded bg-[#2563EB] text-white text-[10px] font-semibold cursor-pointer"
                              >
                                Simpan
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQuotaRowId(null);
                                  setInlineQuotaMap((prev) => ({
                                    ...prev,
                                    [pol.id]: pol.allocationDaysPerYear,
                                  }));
                                }}
                                className="px-2 py-0.5 rounded border border-[#D9D9D6] bg-white text-[#5A5A58] text-[10px] font-medium cursor-pointer"
                              >
                                Batal
                              </button>
                            </div>
                          ) : (
                            <span className="font-mono font-bold text-[#252525]">
                              {pol.allocationDaysPerYear}{' '}
                              <span className="font-sans font-normal text-[11px] text-[#6B6B68]">
                                hari/thn
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-[#5A5A58]">{pol.termsAndProvisions}</td>
                        {isHR && (
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQuotaRowId(pol.id);
                                  setInlineQuotaMap((prev) => ({
                                    ...prev,
                                    [pol.id]: pol.allocationDaysPerYear,
                                  }));
                                }}
                                className="px-2 py-1 rounded border border-[#D9D9D6] hover:bg-[#F4F4F2] text-[11px] font-medium cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPolicyId(pol.id);
                                  setPolCode(pol.code);
                                  setPolName(pol.name);
                                  setPolGroup(pol.group);
                                  setPolAllocation(pol.allocationDaysPerYear);
                                  setPolTerms(pol.termsAndProvisions);
                                  setShowLeavePolicyModal(true);
                                }}
                                className="px-2 py-1 rounded border border-[#D9D9D6] hover:bg-[#F4F4F2] text-[11px] font-medium cursor-pointer"
                              >
                                Edit Detail
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteLeavePolicy(pol.id)}
                                className="p-1 rounded text-[#787774] hover:text-red-600 cursor-pointer"
                                title="Hapus Kategori"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bagian 2: Tabel Kuota, Pemakaian & Sisa Cuti + Status WFA/Flextime per Staf */}
          <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3]">
              <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                Rekapitulasi Kuota, Pemakaian & Sisa Cuti Serta WFA / Flextime Seluruh Staf
              </h3>
              <p className="text-[11px] text-[#6B6B68] mt-0.5">
                Cuti, izin, dan WFA dikelola pada tab administrasi ini dan tidak dihitung sebagai hari kerja yang hilang pada halaman Rekap Kerja.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] text-[#6B6B68] uppercase">
                    <th className="py-2.5 px-3.5">Staf</th>
                    <th className="py-2.5 px-3 text-center">Cuti Terpakai (Disetujui)</th>
                    <th className="py-2.5 px-3 text-center">Menunggu Proses</th>
                    <th className="py-2.5 px-3 text-center">Hari WFA</th>
                    <th className="py-2.5 px-3 text-center">Periode Flextime</th>
                    <th className="py-2.5 px-3.5">Rincian Sisa Kuota per Jenis Cuti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFEFED]">
                  {staffLeaveQuotaRows.map((row) => (
                    <tr key={row.user.id} className="hover:bg-[#FAFAF9] align-top">
                      <td className="py-2.5 px-3.5">
                        <div className="font-semibold text-[#252525]">{row.user.name}</div>
                        <div className="text-[11px] text-[#6B6B68]">{row.user.roleTitle}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-[#252525]">
                        {row.totalUsedLeaveDays} hari
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-[#5A5A58]">
                        {row.totalPendingLeaveDays} hari
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-semibold text-teal-800">
                        {row.approvedWfaCount} hari
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-semibold text-indigo-700">
                        {row.activeFlexCount} aktif
                      </td>
                      <td className="py-2.5 px-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          {row.breakdownByPolicy.map((b) => (
                            <span
                              key={b.policyId}
                              className="px-2 py-0.5 rounded bg-[#F7F7F5] border border-[#E5E5E3] text-[11px] text-[#37352F]"
                            >
                              <strong>{b.name}:</strong> sisa{' '}
                              <span className="font-mono font-bold text-emerald-800">
                                {b.remaining}
                              </span>
                              /{b.allocated} hr
                              {b.used > 0 ? ` (terpakai ${b.used} hr)` : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB REKAP KERJA (DOKUMENTASI RESMI TIMESHEET & KEHADIRAN PER PERIODE) */}
      {/* ===================================================================== */}
      {subTab === 'work_recap' && canViewWorkRecap && (
        <div className="space-y-4">
          {/* Bar Kontrol Atas: Pilih Periode Pelaporan Finance, Pilih Karyawan (Khusus Finance/Director), serta Tombol Cetak & Unduh (Khusus Finance/Director) */}
          <div className="bg-white border border-[#E5E5E3] rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xs font-bold text-[#171717] uppercase tracking-wider">
                  Rekap Kerja — Dokumentasi Resmi Timesheet &amp; Kehadiran
                </h2>
                <span className="px-2 py-0.5 rounded bg-[#F7F7F5] border border-[#E5E5E3] text-[11px] font-medium text-[#5A5A58]">
                  Hak Akses:{' '}
                  <strong>
                    {currentUser?.role === 'director'
                      ? 'Director (Akses Penuh • Verifikasi • Cetak & Unduh)'
                      : 'Finance/HR (Akses Penuh • Verifikasi • Cetak & Unduh)'}
                  </strong>
                </span>
              </div>
              <p className="text-[11px] text-[#6B6B68]">
                Periode pelaporan (Period 1, Period 2, dst.) terhubung otomatis dengan periode anggaran yang ditetapkan oleh Finance.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Pemilihan Karyawan (Hanya tersedia bagi Finance/HR dan Director) */}
              {canViewDetails && (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[#37352F]">Karyawan:</span>
                  <select
                    value={selectedRecapTargetUser?.id || ''}
                    onChange={(e) => setSelectedRecapUserId(e.target.value)}
                    className="px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white text-xs font-medium text-[#252525]"
                  >
                    {allUsers
                      .filter((u) => u.isActive && u.role !== 'admin')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.roleTitle})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Pemilihan Periode Pelaporan (Otomatis mengikuti Periode Finance) */}
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[#37352F]">Periode:</span>
                <select
                  value={recapPeriodFilter}
                  onChange={(e) => setRecapPeriodFilter(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white text-xs font-medium text-[#252525]"
                >
                  {financePeriods.map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.periodTitle} ({fp.startDate} s/d {fp.endDate})
                    </option>
                  ))}
                  <option value="ALL">Semua Periode Finance (Kumulatif)</option>
                </select>
              </div>

              {/* Tombol Preview & Download PDF (HANYA terlihat & dapat diakses oleh Finance/HR dan Director) */}
              {canViewDetails && (
                <div className="flex flex-wrap items-center gap-1.5 pl-1 border-l border-[#E5E5E3]">
                  <button
                    type="button"
                    onClick={handlePrintOfficialWorkRecap}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCDAD5] bg-white hover:bg-[#FAF9F6] text-xs font-medium text-[#2F3437] cursor-pointer"
                    title="Buka Preview Penuh Dokumen Rekap Kerja (Khusus Finance/HR & Director)"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#787774]" />
                    <span>Preview Dokumen</span>
                  </button>
                  <button
                    type="button"
                    disabled={downloadingRecapPdf}
                    onClick={() => handleDownloadOfficialWorkRecapPdf(workRecapSheetRef.current)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2F3437] hover:bg-[#1f2325] text-white text-xs font-medium cursor-pointer disabled:opacity-60"
                    title="Download PDF Dokumen Resmi Rekap Kerja (Khusus Finance/HR & Director)"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{downloadingRecapPdf ? 'Menyiapkan PDF...' : 'Download PDF'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ================================================================= */}
          {/* 1. DOKUMEN REKAP KERJA RESMI (GAYA FORMAL SEPERTI TOR & NOTULEN)  */}
          {/* ================================================================= */}
          {myWorkRecap && (() => {
            const recapDocNumber = `RKP/${myWorkRecap.period.code || 'P2'}/WIJNA/${myWorkRecap.user.id
              .replace(/^user-/, '')
              .toUpperCase()}/2026`;
            const downloadDateIso = new Date().toISOString().slice(0, 10);
            const isTargetHR =
              myWorkRecap.user.role === 'hr' ||
              myWorkRecap.user.role === 'finance' ||
              myWorkRecap.user.id === 'user-finance';
            const isTargetDirector =
              myWorkRecap.user.role === 'director' ||
              myWorkRecap.user.id === 'user-director';
            const isTargetStaff = !isTargetHR && !isTargetDirector;

            return (
              <div className="space-y-3">
                {/* Lembar Formal Rekap Kerja (Format Identik dengan ToR & Notulen) */}
                <article
                  ref={workRecapSheetRef}
                  className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-9 sm:py-8 shadow-xs space-y-5 text-[13.5px] leading-[1.38] text-black"
                  style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
                >
                  <div className="text-center font-bold uppercase tracking-wide text-black text-[15px]">
                    REKAP KERJA &amp; KEHADIRAN KARYAWAN / OFFICIAL WORK RECAP
                  </div>

                  {/* 1. Informasi Karyawan & Ringkasan Rekap Kerja */}
                  <section>
                    <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
                      1. Informasi Karyawan &amp; Ringkasan Rekap Kerja
                    </div>
                    <table className="w-full border-collapse border border-black text-[13px] text-black">
                      <tbody>
                        <tr>
                          <td className="w-[30%] border border-black px-2.5 py-1 font-bold align-top">
                            Nomor Dokumen Rekap
                          </td>
                          <td className="w-[70%] border border-black px-2.5 py-1 align-top font-bold">
                            {recapDocNumber}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Nama Karyawan
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top font-bold">
                            {myWorkRecap.user.name}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Jabatan &amp; Divisi
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {myWorkRecap.user.roleTitle} — {myWorkRecap.user.department}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Periode yang Dipilih
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top font-bold">
                            {myWorkRecap.period.periodTitle} ({myWorkRecap.period.startDate} s/d{' '}
                            {myWorkRecap.period.endDate})
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Rata-rata Jam Kerja
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top font-bold">
                            {formatDecimalId(myWorkRecap.avgHoursPerDay)} Jam / Hari (Total{' '}
                            {formatDecimalId(myWorkRecap.totalHours)} Jam pada{' '}
                            {myWorkRecap.workedDays} Hari Kerja)
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Jumlah Flextime
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {myWorkRecap.flextimeOccurrencesCount} Kali
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Jumlah WFA
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {myWorkRecap.wfaOccurrencesCount} Kali ({myWorkRecap.wfaDaysCount} Hari
                            Pelaksanaan WFA)
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Metode &amp; Otoritas Verifikasi
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top font-bold">
                            {isTargetHR
                              ? 'Diverifikasi oleh Direktur Berdasarkan Audit Digital Sistem'
                              : isTargetDirector
                              ? 'Diverifikasi oleh HR / Finance Berdasarkan Audit Digital Sistem'
                              : 'Diverifikasi oleh HR / Finance & Disahkan Direktur Berdasarkan Audit Digital Sistem'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Tanggal Dokumen
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formatDateIndonesianLocked(downloadDateIso)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </section>

                  {/* 2. Jenis Pekerjaan / Aktivitas yang Dilakukan Selama Periode */}
                  <section>
                    <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
                      2. Jenis Pekerjaan atau Aktivitas yang Dilakukan Selama Periode
                    </div>
                    <table className="w-full border-collapse border border-black text-[13px] text-black">
                      <thead>
                        <tr className="bg-[#F2F2F2] font-bold">
                          <th className="w-[8%] border border-black px-2.5 py-1 text-center">
                            No.
                          </th>
                          <th className="w-[54%] border border-black px-2.5 py-1 text-left">
                            Jenis Pekerjaan / Aktivitas
                          </th>
                          <th className="w-[20%] border border-black px-2.5 py-1 text-center">
                            Frekuensi Aktivitas
                          </th>
                          <th className="w-[18%] border border-black px-2.5 py-1 text-right">
                            Proporsi (%)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {myWorkRecap.categoryProportions.map((cp, idx) => (
                          <tr key={cp.category}>
                            <td className="border border-black px-2.5 py-1 text-center align-top">
                              {idx + 1}.
                            </td>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              {cp.category}
                            </td>
                            <td className="border border-black px-2.5 py-1 text-center align-top">
                              {cp.count} catatan
                            </td>
                            <td className="border border-black px-2.5 py-1 text-right font-bold align-top">
                              {cp.percentage}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  {/* 3. Pengesahan & Verifikasi Rekap Kerja Berdasarkan Audit Digital */}
                  <section className="pt-2 pdf-keep-together">
                    <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
                      3. Pengesahan &amp; Verifikasi Rekap Kerja (Berdasarkan Audit Digital)
                    </div>

                    {isTargetHR ? (
                      /* HR / Finance: Diverifikasi oleh Direktur Berdasarkan Audit Digital */
                      <div className="border border-black text-[12.5px] text-black p-4 flex flex-col items-center justify-between text-center min-h-[165px]">
                        <div>
                          <div className="font-bold">
                            Diverifikasi Oleh Direktur (Berdasarkan Audit Digital),
                          </div>
                          <div className="text-[11px] text-stone-700 mt-0.5">
                            Berdasarkan Audit Digital Kehadiran, Timesheet, WFA &amp; Flextime Sistem WIJNA
                          </div>
                        </div>
                        <div className="my-2 flex items-center justify-center">
                          <ApprovalBarcodeStamp
                            compact
                            variant={
                              myWorkRecap.verification.directorVerified ? 'authorized' : 'pending'
                            }
                            documentNumber={recapDocNumber}
                            roleCode="DIR"
                            signerName={myWorkRecap.verification.directorVerifierName}
                            signDate={downloadDateIso}
                            statusLabel={
                              myWorkRecap.verification.directorVerified
                                ? 'TERVERIFIKASI AUDIT DIGITAL'
                                : 'MENUNGGU VERIFIKASI DIREKTUR'
                            }
                          />
                        </div>
                        <div>
                          <div className="font-bold underline">
                            {myWorkRecap.verification.directorVerifierName}
                          </div>
                          <div className="text-[11px] text-stone-700">
                            {myWorkRecap.verification.directorVerifierRole}
                          </div>
                        </div>
                      </div>
                    ) : isTargetDirector ? (
                      /* Direktur: Diverifikasi oleh HR / Finance Berdasarkan Audit Digital */
                      <div className="border border-black text-[12.5px] text-black p-4 flex flex-col items-center justify-between text-center min-h-[165px]">
                        <div>
                          <div className="font-bold">
                            Diverifikasi Oleh HR / Finance (Berdasarkan Audit Digital),
                          </div>
                          <div className="text-[11px] text-stone-700 mt-0.5">
                            Berdasarkan Audit Digital Kehadiran, Timesheet, WFA &amp; Flextime Sistem WIJNA
                          </div>
                        </div>
                        <div className="my-2 flex items-center justify-center">
                          <ApprovalBarcodeStamp
                            compact
                            variant={
                              myWorkRecap.verification.financeVerified ? 'authorized' : 'pending'
                            }
                            documentNumber={recapDocNumber}
                            roleCode="FIN"
                            signerName={myWorkRecap.verification.financeVerifierName}
                            signDate={downloadDateIso}
                            statusLabel={
                              myWorkRecap.verification.financeVerified
                                ? 'TERVERIFIKASI AUDIT DIGITAL'
                                : 'MENUNGGU VERIFIKASI HR/FINANCE'
                            }
                          />
                        </div>
                        <div>
                          <div className="font-bold underline">
                            {myWorkRecap.verification.financeVerifierName}
                          </div>
                          <div className="text-[11px] text-stone-700">
                            {myWorkRecap.verification.financeVerifierRole}
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Staf-staf: Tidak menggunakan stempel Karyawan (Gambar 1), langsung Diverifikasi HR/Finance & Disahkan Direktur Berdasarkan Audit Digital */
                      <div className="grid grid-cols-1 sm:grid-cols-2 border border-black text-[12.5px] text-black divide-y sm:divide-y-0 sm:divide-x divide-black">
                        {/* Kolom 1: Diverifikasi Oleh Finance / HR Berdasarkan Audit Digital */}
                        <div className="p-3.5 flex flex-col items-center justify-between text-center min-h-[160px]">
                          <div>
                            <div className="font-bold">
                              Diverifikasi Oleh (HR / Finance),
                            </div>
                            <div className="text-[10.5px] text-stone-700">
                              Berdasarkan Audit Digital Sistem
                            </div>
                          </div>
                          <div className="my-1.5 flex items-center justify-center">
                            <ApprovalBarcodeStamp
                              compact
                              variant={
                                myWorkRecap.verification.financeVerified ? 'authorized' : 'pending'
                              }
                              documentNumber={recapDocNumber}
                              roleCode="FIN"
                              signerName={myWorkRecap.verification.financeVerifierName}
                              signDate={downloadDateIso}
                              statusLabel={
                                myWorkRecap.verification.financeVerified
                                  ? 'TERVERIFIKASI AUDIT DIGITAL'
                                  : 'MENUNGGU VERIFIKASI'
                              }
                            />
                          </div>
                          <div>
                            <div className="font-bold underline">
                              {myWorkRecap.verification.financeVerifierName}
                            </div>
                            <div className="text-[11px] text-stone-700">
                              {myWorkRecap.verification.financeVerifierRole}
                            </div>
                          </div>
                        </div>

                        {/* Kolom 2: Disahkan Oleh Director Berdasarkan Audit Digital */}
                        <div className="p-3.5 flex flex-col items-center justify-between text-center min-h-[160px]">
                          <div>
                            <div className="font-bold">
                              Disahkan Oleh (Director),
                            </div>
                            <div className="text-[10.5px] text-stone-700">
                              Berdasarkan Audit Digital Sistem
                            </div>
                          </div>
                          <div className="my-1.5 flex items-center justify-center">
                            <ApprovalBarcodeStamp
                              compact
                              variant={
                                myWorkRecap.verification.directorVerified ? 'authorized' : 'pending'
                              }
                              documentNumber={recapDocNumber}
                              roleCode="DIR"
                              signerName={myWorkRecap.verification.directorVerifierName}
                              signDate={downloadDateIso}
                              statusLabel={
                                myWorkRecap.verification.directorVerified
                                  ? 'DISETUJUI AUDIT DIGITAL'
                                  : 'MENUNGGU PENGESAHAN'
                              }
                            />
                          </div>
                          <div>
                            <div className="font-bold underline">
                              {myWorkRecap.verification.directorVerifierName}
                            </div>
                            <div className="text-[11px] text-stone-700">
                              {myWorkRecap.verification.directorVerifierRole}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                </article>

                {/* Panel Kontrol Verifikasi untuk Finance/HR atau Director (Tidak Ikut Tercetak di PDF) */}
                {canViewDetails && (
                  <div className="bg-white border border-[#E5E5E3] rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden text-xs">
                    <div className="text-[#5A5A58]">
                      <strong>
                        Otorisasi Verifikasi Audit Digital ({myWorkRecap.user.name}):
                      </strong>{' '}
                      {isTargetHR
                        ? 'Rekap Kerja HR/Finance diverifikasi oleh Direktur berdasarkan audit digital.'
                        : isTargetDirector
                        ? 'Rekap Kerja Direktur diverifikasi oleh HR/Finance berdasarkan audit digital.'
                        : 'Rekap Kerja Staf diverifikasi berdasarkan audit digital (tanpa stempel penyusun staf).'}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isHR && (isTargetStaff || isTargetDirector) && (
                        <button
                          type="button"
                          onClick={async () => {
                            await saveRecapVerificationEntry(
                              myWorkRecap.user.id,
                              myWorkRecap.period.id,
                              'finance'
                            );
                            showToast(
                              `Verifikasi Audit Digital HR/Finance untuk ${myWorkRecap.user.name} telah disahkan dan disimpan permanen.`
                            );
                          }}
                          className="px-3 py-1.5 rounded bg-[#0F7B6C] hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                        >
                          {myWorkRecap.verification.financeVerified
                            ? 'Perbarui Verifikasi HR/Finance (Audit Digital)'
                            : 'Verifikasi HR/Finance (Audit Digital)'}
                        </button>
                      )}
                      {isDirector && (isTargetStaff || isTargetHR) && (
                        <button
                          type="button"
                          onClick={async () => {
                            await saveRecapVerificationEntry(
                              myWorkRecap.user.id,
                              myWorkRecap.period.id,
                              'director'
                            );
                            showToast(
                              `Verifikasi Audit Digital Direktur untuk ${myWorkRecap.user.name} telah disahkan dan disimpan permanen.`
                            );
                          }}
                          className="px-3 py-1.5 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold cursor-pointer"
                        >
                          {myWorkRecap.verification.directorVerified
                            ? 'Perbarui Verifikasi Direktur (Audit Digital)'
                            : 'Verifikasi sebagai Direktur (Audit Digital)'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ================================================================= */}
          {/* 2. REKAP KESELURUHAN ORGANISASI (KHUSUS FINANCE DAN DIRECTOR)     */}
          {/* ================================================================= */}
          {canViewDetails && (
            <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden print:hidden">
              <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-[#171717] uppercase tracking-wider">
                    2. Ringkasan Rekap Kerja Seluruh Karyawan — {activeSelectedPeriod.periodTitle} (Akses Finance/HR &amp; Director)
                  </h3>
                  <p className="text-[11px] text-[#6B6B68] mt-0.5">
                    Pilih karyawan untuk menampilkan pratinjau dokumen resmi, melakukan verifikasi, mencetak, atau mengunduh rekap kerja.
                  </p>
                </div>
              </div>

              {/* Distribusi Kontribusi Kolektif Organisasi */}
              <div className="px-4 py-3 border-b border-[#EFEFED] bg-white">
                <div className="text-[11px] font-bold text-[#5A5A58] uppercase tracking-wider mb-2">
                  Distribusi Jenis Pekerjaan Organisasi pada {activeSelectedPeriod.periodTitle}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {orgCategoryDistribution.map((item) => (
                    <div
                      key={item.category}
                      className="p-2 rounded border border-[#E5E5E3] bg-[#FAFAF9] text-xs"
                    >
                      <div className="font-semibold text-[#252525] text-[11px] line-clamp-1">
                        {item.category}
                      </div>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className="font-mono font-bold text-[#1D4ED8]">
                          {item.percentage}%
                        </span>
                        <span className="text-[10px] text-[#6B6B68]">{item.count} aktivitas</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabel Rekap Keseluruhan Staf */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase">
                      <th className="py-2.5 px-4">Nama Karyawan</th>
                      <th className="py-2.5 px-3 text-right">Rata-rata Kerja</th>
                      <th className="py-2.5 px-3 text-right">Jumlah Flextime</th>
                      <th className="py-2.5 px-3 text-right">Jumlah WFA</th>
                      <th className="py-2.5 px-3">Aktivitas Utama</th>
                      <th className="py-2.5 px-3 text-center">Verifikasi</th>
                      <th className="py-2.5 px-4 text-right">Aksi Dokumen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFED]">
                    {organizationWorkRecapRows.map((row) => {
                      const isSelectedPreview = selectedRecapTargetUser?.id === row.user.id;
                      return (
                        <tr
                          key={row.user.id}
                          className={`hover:bg-[#FAFAF9] align-middle ${
                            isSelectedPreview ? 'bg-blue-50/20' : ''
                          }`}
                        >
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-[#252525]">{row.user.name}</div>
                            <div className="text-[11px] text-[#6B6B68]">{row.user.roleTitle}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#1D4ED8]">
                            {formatDecimalId(row.avgHoursPerDay)} jam/hr
                            <div className="text-[10px] font-normal text-[#6B6B68]">
                              {row.workedDays} hr ({formatDecimalId(row.totalHours)} jam)
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#252525]">
                            {row.flextimeOccurrencesCount} kali
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#0F7B6C]">
                            {row.wfaOccurrencesCount} kali ({row.wfaDaysCount} hr)
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-[#1D4ED8] border border-blue-200 text-[11px] font-semibold">
                              {row.primaryContribution}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {row.user.role === 'hr' ||
                            row.user.role === 'finance' ||
                            row.user.id === 'user-finance' ? (
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded border font-mono text-[10px] font-semibold ${
                                  row.verification.directorVerified
                                    ? 'bg-blue-50 border-blue-200 text-[#1D4ED8]'
                                    : 'bg-[#F4F3EF] border-[#E2E1DC] text-[#787774]'
                                }`}
                                title="Diverifikasi oleh Direktur berdasarkan audit digital"
                              >
                                DIR (Audit Digital) {row.verification.directorVerified ? '✓' : '•'}
                              </span>
                            ) : row.user.role === 'director' ||
                              row.user.id === 'user-director' ? (
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded border font-mono text-[10px] font-semibold ${
                                  row.verification.financeVerified
                                    ? 'bg-[#EBF7F5] border-[#BCE3DC] text-[#0F7B6C]'
                                    : 'bg-[#F4F3EF] border-[#E2E1DC] text-[#787774]'
                                }`}
                                title="Diverifikasi oleh HR/Finance berdasarkan audit digital"
                              >
                                HR/FIN (Audit Digital) {row.verification.financeVerified ? '✓' : '•'}
                              </span>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <span
                                  className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold ${
                                    row.verification.financeVerified
                                      ? 'bg-[#EBF7F5] border-[#BCE3DC] text-[#0F7B6C]'
                                      : 'bg-[#F4F3EF] border-[#E2E1DC] text-[#787774]'
                                  }`}
                                >
                                  FIN {row.verification.financeVerified ? '✓' : '•'}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold ${
                                    row.verification.directorVerified
                                      ? 'bg-blue-50 border-blue-200 text-[#1D4ED8]'
                                      : 'bg-[#F4F3EF] border-[#E2E1DC] text-[#787774]'
                                  }`}
                                >
                                  DIR {row.verification.directorVerified ? '✓' : '•'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedRecapUserId(row.user.id)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                                isSelectedPreview
                                  ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]'
                                  : 'border-[#D9D9D6] bg-white hover:bg-[#F4F4F2] text-[#252525]'
                              }`}
                            >
                              <span>{isSelectedPreview ? 'Sedang Ditampilkan' : 'Buka Rekap'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* 3. DETAIL KEHADIRAN, LOKASI & KONTRIBUSI SELURUH STAF             */}
          {/* ================================================================= */}
          {canViewDetails && (
            <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-[#FAFAF9] border-b border-[#E5E5E3] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
                    3. Detail Kehadiran, Lokasi & Kontribusi Seluruh Staf (Akses Finance/HR & Director)
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={filterStaffId}
                    onChange={(e) => setFilterStaffId(e.target.value)}
                    className="px-2.5 py-1 text-xs border border-[#D9D9D6] rounded bg-white"
                  >
                    <option value="ALL">Semua Staf</option>
                    {allUsers
                      .filter((u) => u.isActive && u.role !== 'admin')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                  <label className="inline-flex items-center gap-1.5 text-xs text-[#37352F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterOutsideOnly}
                      onChange={(e) => setFilterOutsideOnly(e.target.checked)}
                      className="rounded border-[#D9D9D6]"
                    />
                    <span>Hanya Outside Location</span>
                  </label>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase">
                      <th className="py-2 px-3.5">Tanggal</th>
                      <th className="py-2 px-3.5">Nama Staf</th>
                      <th className="py-2 px-3.5">Clock In / Out & Durasi</th>
                      <th className="py-2 px-3.5">Status Lokasi (Radius {radiusMeters}m)</th>
                      <th className="py-2 px-3.5">Kontribusi Harian (Maks. 2)</th>
                      <th className="py-2 px-3.5">Review Finance/HR & Director</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFED]">
                    {filteredDailyRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-[#787774]">
                          Belum ada catatan kehadiran/timesheet sesuai filter.
                        </td>
                      </tr>
                    ) : (
                      filteredDailyRecords.map((rec) => {
                        const recDur = formatDurationHMS(rec.clockInTime, rec.clockOutTime, nowMs);
                        return (
                          <tr key={rec.id} className="hover:bg-[#FAFAF9] align-top">
                            <td className="py-2.5 px-3.5 font-mono font-semibold text-[#252525] whitespace-nowrap">
                              <div>{rec.date}</div>
                              {rec.isFlextimeApplied && (
                                <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-sans font-semibold">
                                  Flextime
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <div className="font-semibold text-[#252525]">{rec.userName}</div>
                              <div className="text-[11px] text-[#6B6B68]">{rec.userRoleTitle}</div>
                            </td>
                            <td className="py-2.5 px-3.5 whitespace-nowrap">
                              {rec.recordType === 'WFA' ? (
                                <div>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-semibold text-[11px]">
                                    WFA (1 Hari Penuh)
                                  </span>
                                  <div className="text-[11px] text-[#37352F] font-semibold mt-0.5">
                                    {rec.totalWorkHours} Jam
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="font-mono text-[#252525]">
                                    {formatTimeWithSeconds(rec.clockInTime)} –{' '}
                                    {formatTimeWithSeconds(rec.clockOutTime)}
                                  </div>
                                  <div className="text-[11px] font-mono font-semibold text-blue-700">
                                    Durasi: {recDur.hms}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5">
                              {rec.recordType === 'WFA' ? (
                                <span className="text-[#6B6B68] text-[11px]">
                                  Work From Anywhere
                                </span>
                              ) : rec.isOutsideWorkLocation ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[11px]">
                                    <AlertTriangle className="w-3 h-3" />
                                    Outside Work Location
                                  </span>
                                  {rec.outsideLocationReason && (
                                    <div className="text-[11px] text-[#37352F]">
                                      Ket: &ldquo;{rec.outsideLocationReason}&rdquo;
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                                  Dalam Area WIJNA (≤ {radiusMeters}m)
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5">
                              {!rec.timesheetItems || rec.timesheetItems.length === 0 ? (
                                <span className="text-[#9B9A97] italic">Belum diisi</span>
                              ) : (
                                <ul className="space-y-1">
                                  {rec.timesheetItems.slice(0, 2).map((ts, i) => (
                                    <li key={ts.id || i} className="text-[11.5px]">
                                      <span className="font-semibold text-[#1D4ED8]">
                                        #{i + 1} {ts.category}:
                                      </span>{' '}
                                      <span className="text-[#37352F]">{ts.shortDescription}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5">
                              {!rec.isOutsideWorkLocation ? (
                                <span className="text-[11px] text-[#787774]">Otomatis Tercatat</span>
                              ) : (
                                (() => {
                                  const wfType =
                                    rec.workflowType ||
                                    (rec.userId === 'user-director'
                                      ? 'DIRECTOR_TO_FINANCE_NOTIFY'
                                      : rec.userId === 'user-finance'
                                      ? 'FINANCE_TO_DIRECTOR_REVIEW'
                                      : 'EMPLOYEE_TO_FINANCE_APPROVAL');
                                  return (
                                    <div className="space-y-1 min-w-[200px]">
                                      <div className="text-[11px] flex flex-wrap items-center gap-1">
                                        <span
                                          className={`px-2 py-0.5 rounded border font-semibold ${
                                            rec.outsideReviewStatus === 'HR_REVIEWED' ||
                                            rec.outsideReviewStatus === 'REVIEWED_BY_DIRECTOR' ||
                                            rec.outsideReviewStatus === 'ACKNOWLEDGED_BY_FINANCE' ||
                                            rec.outsideReviewStatus === 'DIRECTOR_ACKNOWLEDGED'
                                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                              : rec.outsideReviewStatus === 'RETURNED_BY_FINANCE'
                                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                                              : 'bg-amber-50 text-amber-800 border-amber-200'
                                          }`}
                                        >
                                          {rec.outsideReviewStatus}
                                        </span>
                                      </div>
                                      {rec.returnReason && (
                                        <div className="text-[10.5px] text-rose-700">
                                          Alasan Return: &ldquo;{rec.returnReason}&rdquo;
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1 pt-0.5">
                                        <input
                                          type="text"
                                          value={reviewNoteMap[rec.id] || ''}
                                          onChange={(e) =>
                                            setReviewNoteMap((prev) => ({
                                              ...prev,
                                              [rec.id]: e.target.value,
                                            }))
                                          }
                                          placeholder="Catatan / alasan..."
                                          className="px-2 py-1 text-[11px] border border-[#D9D9D6] rounded bg-white w-28"
                                        />
                                        {wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' && isHR && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleReviewOutsideLocation(rec.id, 'hr', 'approve')
                                              }
                                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold cursor-pointer"
                                            >
                                              Approve
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleReviewOutsideLocation(rec.id, 'hr', 'return')
                                              }
                                              className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-semibold cursor-pointer"
                                            >
                                              Return
                                            </button>
                                          </>
                                        )}
                                        {wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && isDirector && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleReviewOutsideLocation(
                                                rec.id,
                                                'director',
                                                'review'
                                              )
                                            }
                                            className="px-2 py-1 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-[10px] font-semibold cursor-pointer"
                                          >
                                            Simpan Review
                                          </button>
                                        )}
                                        {wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && isHR && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleReviewOutsideLocation(
                                                rec.id,
                                                'hr',
                                                'acknowledge'
                                              )
                                            }
                                            className="px-2 py-1 rounded bg-purple-700 hover:bg-purple-800 text-white text-[10px] font-semibold cursor-pointer"
                                          >
                                            Acknowledge
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()
                              )}
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
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 6: AUDIT TRAIL (KHUSUS FINANCE/HR & DIRECTOR)                     */}
      {/* ===================================================================== */}
      {subTab === 'audit' && canViewDetails && (
        <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3]">
            <h3 className="text-xs font-bold text-[#252525] uppercase tracking-wider">
              Audit Trail Attendance, Lokasi Kerja, Kontribusi, Flextime, WFA & Cuti (Finance/HR & Director)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] text-[#6B6B68] uppercase">
                  <th className="py-2.5 px-3.5">Waktu</th>
                  <th className="py-2.5 px-3.5">Pengguna & Peran</th>
                  <th className="py-2.5 px-3.5">Modul</th>
                  <th className="py-2.5 px-3.5">Tindakan</th>
                  <th className="py-2.5 px-3.5">Rincian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEFED]">
                {(bundle?.auditTrail || []).map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#FAFAF9]">
                    <td className="py-2 px-3.5 font-mono text-[11px] text-[#5A5A58] whitespace-nowrap">
                      {formatDateTimeShort(entry.timestamp)}
                    </td>
                    <td className="py-2 px-3.5">
                      <div className="font-semibold text-[#252525]">{entry.actorName}</div>
                      <div className="text-[11px] text-[#6B6B68]">{entry.actorRole}</div>
                    </td>
                    <td className="py-2 px-3.5">
                      <span className="px-2 py-0.5 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[10px] font-semibold">
                        {entry.module}
                      </span>
                    </td>
                    <td className="py-2 px-3.5 font-semibold text-[#252525]">{entry.action}</td>
                    <td className="py-2 px-3.5 text-[#37352F]">{entry.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PENGATURAN KATEGORI CUTI OLEH FINANCE/HR                        */}
      {/* ===================================================================== */}
      {showLeavePolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E5E5E3] flex items-center justify-between bg-[#FAFAF9]">
              <h3 className="text-xs font-bold text-[#252525]">
                {editingPolicyId
                  ? 'Edit Kategori Cuti (Finance/HR)'
                  : 'Tambah Kategori Cuti (Finance/HR)'}
              </h3>
              <button
                type="button"
                onClick={() => setShowLeavePolicyModal(false)}
                className="p-1 rounded text-[#787774] hover:text-[#252525] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveLeavePolicy} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">Kode</label>
                  <input
                    type="text"
                    required
                    value={polCode}
                    onChange={(e) => setPolCode(e.target.value)}
                    placeholder="CS-01"
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-[#37352F] mb-1">Kelompok Cuti</label>
                  <select
                    value={polGroup}
                    onChange={(e) => setPolGroup(e.target.value as LeaveCategoryGroup)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded bg-white"
                  >
                    <option value="CUTI_SAKIT">Jenis Cuti Sakit</option>
                    <option value="CUTI_KHUSUS">Jenis Cuti Khusus</option>
                    <option value="CUTI_LAINNYA">Ketentuan Cuti Lainnya</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-[#37352F] mb-1">
                  Nama Kategori Cuti / Izin
                </label>
                <input
                  type="text"
                  required
                  value={polName}
                  onChange={(e) => setPolName(e.target.value)}
                  placeholder="Contoh: Cuti Sakit Rawat Jalan"
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded"
                />
              </div>
              <div>
                <label className="block font-medium text-[#37352F] mb-1">
                  Jumlah / Alokasi Hari per Tahun
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={polAllocation}
                  onChange={(e) => setPolAllocation(parseInt(e.target.value, 10) || 0)}
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-[#37352F] mb-1">Ketentuan Cuti</label>
                <textarea
                  rows={2}
                  value={polTerms}
                  onChange={(e) => setPolTerms(e.target.value)}
                  placeholder="Ketentuan dan syarat pengajuan..."
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#EFEFED]">
                <button
                  type="button"
                  onClick={() => setShowLeavePolicyModal(false)}
                  className="px-3 py-1.5 rounded border border-[#D9D9D6] font-semibold text-[#5A5A58] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded bg-[#2563EB] text-white font-semibold cursor-pointer"
                >
                  Simpan Kategori Cuti
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PENENTUAN TITIK KOORDINAT & RADIUS WIJNA OLEH DIREKTUR          */}
      {/* ===================================================================== */}
      {showLocationConfigModal && isDirector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E5E5E3] flex items-center justify-between bg-[#FAFAF9]">
              <h3 className="text-xs font-bold text-[#252525]">
                Penentuan Titik Koordinat & Radius Lokasi WIJNA (Khusus Direktur)
              </h3>
              <button
                type="button"
                onClick={() => setShowLocationConfigModal(false)}
                className="p-1 rounded text-[#787774] hover:text-[#252525] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveLocationConfig} className="p-4 space-y-3 text-xs">
              <div className="p-2.5 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                Hanya <strong>Direktur</strong> yang dapat menentukan titik koordinat lokasi kerja WIJNA. Staf yang berada di luar titik koordinat dan radius ini otomatis <strong>tidak dapat melakukan Clock In</strong>.
              </div>
              <div>
                <label className="block font-medium text-[#37352F] mb-1">Nama Lokasi Kantor</label>
                <input
                  type="text"
                  required
                  value={cfgOfficeName}
                  onChange={(e) => setCfgOfficeName(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded"
                />
              </div>
              <div>
                <label className="block font-medium text-[#37352F] mb-1">Alamat</label>
                <input
                  type="text"
                  required
                  value={cfgAddress}
                  onChange={(e) => setCfgAddress(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#37352F]">Titik Koordinat Kantor</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            setCfgLat(Number(pos.coords.latitude.toFixed(6)));
                            setCfgLon(Number(pos.coords.longitude.toFixed(6)));
                            showToast('Titik GPS lokasi saat ini berhasil dimasukkan ke form koordinat kantor.');
                          },
                          () => {
                            setErrorMsg('Gagal membaca GPS perangkat. Pastikan izin lokasi browser aktif.');
                          },
                          { enableHighAccuracy: true, timeout: 8000 }
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#F0F7F4] hover:bg-[#E2F2EB] text-[#16654E] border border-[#BCE3DC] text-[11px] font-semibold cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />
                    <span>Gunakan GPS Saat Ini</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-[#37352F] mb-1">Latitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={cfgLat}
                      onChange={(e) => setCfgLat(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#37352F] mb-1">Longitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={cfgLon}
                      onChange={(e) => setCfgLon(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded font-mono"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Radius Area WIJNA (Meter)
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={cfgRadius}
                    onChange={(e) => setCfgRadius(parseInt(e.target.value, 10) || 5)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Jam Kerja Penuh WFA (Jam)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    required
                    value={cfgStandardHours}
                    onChange={(e) => setCfgStandardHours(parseInt(e.target.value, 10) || 8)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#EFEFED]">
                <button
                  type="button"
                  onClick={() => setShowLocationConfigModal(false)}
                  className="px-3 py-1.5 rounded border border-[#D9D9D6] font-semibold text-[#5A5A58] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded bg-[#2563EB] text-white font-semibold cursor-pointer"
                >
                  Simpan Lokasi Referensi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PANDUAN MEMILIH RENCANA FOKUS HARI INI (POP-UP PANDUAN LENGKAP) */}
      {/* ===================================================================== */}
      {showFocusGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-5"
          onClick={() => setShowFocusGuideModal(false)}
        >
          <div
            className="bg-white rounded-xl border border-[#E5E5E3] shadow-2xl max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden text-[#2F3437]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal */}
            <div className="px-5 py-3.5 border-b border-[#EDEDEC] bg-[#FAFAF9] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#EBF7F5] border border-[#BCE3DC] text-[#0F7B6C] flex items-center justify-center shrink-0">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#171717]">
                    Panduan Memilih Rencana Fokus Hari Ini
                  </h3>
                  <p className="text-[11px] text-[#787774]">
                    Panduan praktis menentukan 1–2 prioritas kontribusi utama selama hari kerja
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFocusGuideModal(false)}
                className="p-1.5 rounded-lg text-[#787774] hover:text-[#171717] hover:bg-[#EFEFED] transition-colors cursor-pointer"
                aria-label="Tutup panduan"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body Modal Scrollable */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs leading-relaxed">
              {/* Pengantar & Cara Memilih Fokus */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 bg-[#FAF9F6] border border-[#EAE8E1] rounded-xl p-3.5">
                <div className="lg:col-span-7 space-y-2 pr-0 lg:pr-3 lg:border-r lg:border-[#EAE8E1]">
                  <h4 className="text-xs font-bold text-[#171717]">
                    Apa itu Rencana Fokus Hari Ini?
                  </h4>
                  <p className="text-[#475569]">
                    <strong>Rencana Fokus Hari Ini</strong> membantu Anda menentukan{' '}
                    <strong>1–2 area pekerjaan</strong> yang menjadi prioritas utama selama hari kerja.
                  </p>
                  <p className="text-[#475569]">
                    Fitur ini <strong>bukan daftar semua tugas</strong> yang Anda kerjakan. Pilih fokus berdasarkan{' '}
                    <strong>kontribusi atau hasil utama</strong> yang ingin Anda capai hari ini.
                  </p>
                  <div className="p-2.5 rounded-lg bg-white border border-[#E6E5E0] text-[11.5px] text-[#334155]">
                    <span className="font-semibold text-[#0F7B6C]">Contoh:</span> Anda mungkin mengirim email, menghadiri rapat, dan membuat dokumen dalam satu hari. Namun, jika tujuan utama Anda adalah menyelesaikan konsep program baru, fokus utama Anda tetap{' '}
                    <strong>Perencanaan &amp; Pengembangan</strong>.
                  </div>
                </div>

                <div className="lg:col-span-5 space-y-2 flex flex-col justify-center">
                  <h4 className="text-xs font-bold text-[#171717]">
                    Cara Memilih Fokus
                  </h4>
                  <ol className="space-y-1.5 text-[11.5px] text-[#334155]">
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded bg-[#EBF7F5] text-[#0F7B6C] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <span>Lihat pekerjaan yang akan Anda lakukan hari ini.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded bg-[#EBF7F5] text-[#0F7B6C] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <span>Tentukan hasil atau kontribusi utama yang ingin dicapai.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded bg-[#EBF7F5] text-[#0F7B6C] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <span>Pilih maksimal 2 fokus yang paling mewakili pekerjaan tersebut.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded bg-[#EBF7F5] text-[#0F7B6C] font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        4
                      </span>
                      <span>Jika pekerjaan berubah di tengah hari, fokus dapat diperbarui sesuai kebutuhan.</span>
                    </li>
                  </ol>
                </div>
              </div>

              {/* Detail 6 Kategori Fokus */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 01. Rapat & Koordinasi */}
                <div className="rounded-xl border border-[#EDEDEC] bg-white p-3.5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] shrink-0" />
                        <h5 className="text-xs font-bold text-[#171717]">
                          01. Rapat &amp; Koordinasi
                        </h5>
                      </div>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-[#1D4ED8] border border-blue-200/60 font-semibold">
                        Penyelarasan Tim
                      </span>
                    </div>

                    <p className="text-[11.5px] text-[#475569]">
                      <strong className="text-[#1E293B]">Tujuan:</strong> Digunakan ketika sebagian besar pekerjaan Anda berfokus pada diskusi, penyelarasan, pengambilan keputusan, atau koordinasi pekerjaan bersama orang lain.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Pilih fokus ini jika Anda:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Mengikuti rapat internal atau lintas divisi.</li>
                          <li>Mengkoordinasikan pembagian tugas.</li>
                          <li>Menyelaraskan rencana kerja dengan tim.</li>
                          <li>Membahas kendala &amp; mencari solusi bersama.</li>
                          <li>Mengambil keputusan melalui forum/diskusi.</li>
                        </ul>
                      </div>
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Contoh kegiatan:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Rapat koordinasi mingguan tim.</li>
                          <li>Diskusi persiapan kegiatan lapangan.</li>
                          <li>Koordinasi pembagian tugas antarstaf.</li>
                          <li>Meeting evaluasi pelaksanaan program.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="p-2 rounded-lg bg-[#F0FAF6] border border-[#C2EBD9] text-[11px] text-[#16654E]">
                      <strong>Contoh hasil yang diharapkan:</strong> “Tim memiliki kesepakatan mengenai pembagian tugas dan langkah kerja berikutnya.”
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200/80 text-[11px] text-[#92400E]">
                      <strong>Jangan pilih kategori ini jika:</strong> Anda hanya menghadiri rapat singkat, tetapi sebagian besar pekerjaan hari itu sebenarnya adalah menyusun laporan atau mengembangkan program.
                    </div>
                  </div>
                </div>

                {/* 02. Perencanaan & Pengembangan */}
                <div className="rounded-xl border border-[#EDEDEC] bg-white p-3.5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shrink-0" />
                        <h5 className="text-xs font-bold text-[#171717]">
                          02. Perencanaan &amp; Pengembangan
                        </h5>
                      </div>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-[#0F7B6C] border border-emerald-200/60 font-semibold">
                        Kreasi &amp; Inovasi
                      </span>
                    </div>

                    <p className="text-[11.5px] text-[#475569]">
                      <strong className="text-[#1E293B]">Tujuan:</strong> Digunakan ketika fokus utama Anda adalah merancang, menyusun, memperbaiki, atau mengembangkan program, sistem, strategi, atau ide baru (menciptakan/meningkatkan sesuatu).
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Pilih fokus ini jika Anda:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Menyusun konsep atau proposal.</li>
                          <li>Membuat rencana kerja.</li>
                          <li>Mendesain program atau kegiatan.</li>
                          <li>Mengembangkan sistem kerja &amp; strategi.</li>
                          <li>Memperbaiki proses/inovasi yang ada.</li>
                        </ul>
                      </div>
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Contoh kegiatan:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Menyusun concept note proyek Papua.</li>
                          <li>Membuat desain kurikulum pelatihan.</li>
                          <li>Mengembangkan fitur baru MEAL Connect.</li>
                          <li>Menyusun strategi pengembangan organisasi.</li>
                          <li>Merancang alur kerja atau SOP baru.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="p-2 rounded-lg bg-[#F0FAF6] border border-[#C2EBD9] text-[11px] text-[#16654E]">
                      <strong>Contoh hasil yang diharapkan:</strong> “Draft konsep program dan rencana implementasi selesai untuk dibahas bersama tim.”
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200/80 text-[11px] text-[#92400E]">
                      <strong>Jangan pilih kategori ini jika:</strong> Pekerjaan Anda hanya memasukkan data atau melengkapi dokumen dari rencana yang sudah ada. Gunakan <em>Administrasi &amp; Pelaporan</em>.
                    </div>
                  </div>
                </div>

                {/* 03. Administrasi & Pelaporan */}
                <div className="rounded-xl border border-[#EDEDEC] bg-white p-3.5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B] shrink-0" />
                        <h5 className="text-xs font-bold text-[#171717]">
                          03. Administrasi &amp; Pelaporan
                        </h5>
                      </div>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-[#B45309] border border-amber-200/60 font-semibold">
                        Ketertiban &amp; Akuntabilitas
                      </span>
                    </div>

                    <p className="text-[11.5px] text-[#475569]">
                      <strong className="text-[#1E293B]">Tujuan:</strong> Digunakan untuk pekerjaan yang berhubungan dengan kelengkapan administrasi, dokumentasi, pencatatan, pengelolaan dokumen, dan pelaporan agar tetap tertib dan dapat dipertanggungjawabkan.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Pilih fokus ini jika Anda:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Menyusun laporan program atau keuangan.</li>
                          <li>Melengkapi dokumen kegiatan.</li>
                          <li>Memeriksa kelengkapan administrasi.</li>
                          <li>Mengarsipkan dokumen &amp; input data.</li>
                          <li>Menyusun notulen atau dokumentasi resmi.</li>
                        </ul>
                      </div>
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Contoh kegiatan:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Menyelesaikan laporan kegiatan.</li>
                          <li>Memeriksa kelengkapan TOR &amp; dokumen.</li>
                          <li>Menginput data monitoring.</li>
                          <li>Menyusun laporan keuangan.</li>
                          <li>Merapikan dokumentasi proyek.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="p-2 rounded-lg bg-[#F0FAF6] border border-[#C2EBD9] text-[11px] text-[#16654E]">
                      <strong>Contoh hasil yang diharapkan:</strong> “Laporan kegiatan periode Oktober selesai dan siap untuk proses review.”
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200/80 text-[11px] text-[#92400E]">
                      <strong>Jangan pilih kategori ini jika:</strong> Tujuan utama Anda adalah merancang sesuatu yang baru. Dalam situasi tersebut, pilih <em>Perencanaan &amp; Pengembangan</em>.
                    </div>
                  </div>
                </div>

                {/* 04. Pendampingan & Supervisi */}
                <div className="rounded-xl border border-[#EDEDEC] bg-white p-3.5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shrink-0" />
                        <h5 className="text-xs font-bold text-[#171717]">
                          04. Pendampingan &amp; Supervisi
                        </h5>
                      </div>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-[#0F7B6C] border border-emerald-200/60 font-semibold">
                        Dukungan &amp; Kualitas
                      </span>
                    </div>

                    <p className="text-[11.5px] text-[#475569]">
                      <strong className="text-[#1E293B]">Tujuan:</strong> Digunakan ketika Anda berperan aktif dalam mendampingi, memantau, memberikan arahan, atau meningkatkan kualitas pekerjaan orang lain atau mitra.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Pilih fokus ini jika Anda:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Mendampingi mitra dalam implementasi.</li>
                          <li>Memberikan supervisi kepada staf.</li>
                          <li>Melakukan monitoring lapangan.</li>
                          <li>Membantu menyelesaikan kendala mitra.</li>
                          <li>Memberikan masukan pelaksanaan kerja.</li>
                        </ul>
                      </div>
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Contoh kegiatan:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Mendampingi mitra menyusun laporan.</li>
                          <li>Monitoring pelaksanaan di lapangan.</li>
                          <li>Supervisi pekerjaan staf.</li>
                          <li>Memberikan konsultasi ke implementing partner.</li>
                          <li>Melakukan partner accompaniment.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="p-2 rounded-lg bg-[#F0FAF6] border border-[#C2EBD9] text-[11px] text-[#16654E]">
                      <strong>Contoh hasil yang diharapkan:</strong> “Mitra memahami kendala implementasi dan memiliki langkah tindak lanjut yang jelas.”
                    </div>
                    <div className="p-2 rounded-lg bg-blue-50/60 border border-blue-200/80 text-[11px] text-[#1E3A8A]">
                      <strong>Perbedaan dengan Rapat &amp; Koordinasi:</strong> Rapat &amp; Koordinasi menyelaraskan pekerjaan bersama, sedangkan Pendampingan &amp; Supervisi membantu atau mengarahkan pihak lain secara khusus.
                    </div>
                  </div>
                </div>

                {/* 05. Komunikasi & Hubungan Eksternal */}
                <div className="rounded-xl border border-[#EDEDEC] bg-white p-3.5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#EC4899] shrink-0" />
                        <h5 className="text-xs font-bold text-[#171717]">
                          05. Komunikasi &amp; Hubungan Eksternal
                        </h5>
                      </div>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-pink-50 text-[#BE185D] border border-pink-200/60 font-semibold">
                        Relasi &amp; Kemitraan
                      </span>
                    </div>

                    <p className="text-[11.5px] text-[#475569]">
                      <strong className="text-[#1E293B]">Tujuan:</strong> Digunakan ketika pekerjaan utama Anda berhubungan dengan membangun, menjaga, atau mengembangkan relasi dan kolaborasi dengan pihak di luar organisasi.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Pilih fokus ini jika Anda:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Berkomunikasi dengan donor.</li>
                          <li>Bertemu organisasi mitra.</li>
                          <li>Membangun jejaring baru.</li>
                          <li>Koordinasi dengan institusi eksternal.</li>
                          <li>Menindaklanjuti peluang kerja sama.</li>
                        </ul>
                      </div>
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Contoh kegiatan:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Meeting dengan calon donor.</li>
                          <li>Diskusi kerja sama dengan universitas.</li>
                          <li>Koordinasi dengan gereja/komunitas mitra.</li>
                          <li>Menjalin komunikasi dengan organisasi baru.</li>
                          <li>Menindaklanjuti proposal kolaborasi.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="p-2 rounded-lg bg-[#F0FAF6] border border-[#C2EBD9] text-[11px] text-[#16654E]">
                      <strong>Contoh hasil yang diharapkan:</strong> “Terdapat kesepahaman awal untuk melanjutkan pembahasan kerja sama.”
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200/80 text-[11px] text-[#92400E]">
                      <strong>Jangan pilih kategori ini jika:</strong> Komunikasi hanya menjadi bagian kecil dari pekerjaan administratif Anda, misalnya mengirim email untuk meminta dokumen.
                    </div>
                  </div>
                </div>

                {/* 06. Pelatihan & Pengembangan Kapasitas */}
                <div className="rounded-xl border border-[#EDEDEC] bg-white p-3.5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#14B8A6] shrink-0" />
                        <h5 className="text-xs font-bold text-[#171717]">
                          06. Pelatihan &amp; Pengembangan Kapasitas
                        </h5>
                      </div>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-[#0F766E] border border-teal-200/60 font-semibold">
                        Kompetensi Manusia
                      </span>
                    </div>

                    <p className="text-[11.5px] text-[#475569]">
                      <strong className="text-[#1E293B]">Tujuan:</strong> Digunakan ketika fokus utama hari Anda adalah belajar, meningkatkan kompetensi, atau membantu meningkatkan kapasitas orang lain.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Pilih fokus ini jika Anda:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Mengikuti pelatihan.</li>
                          <li>Mempelajari keterampilan baru.</li>
                          <li>Pembelajaran mendalam terkait pekerjaan.</li>
                          <li>Memfasilitasi pelatihan.</li>
                          <li>Menyelenggarakan sesi berbagi pengetahuan.</li>
                        </ul>
                      </div>
                      <div className="bg-[#FAF9F6] p-2 rounded-lg border border-[#EAE8E1]">
                        <span className="font-semibold text-[#1E293B] block mb-1">
                          Contoh kegiatan:
                        </span>
                        <ul className="list-disc pl-4 space-y-0.5 text-[#475569]">
                          <li>Mengikuti pelatihan MEAL.</li>
                          <li>Belajar sistem keuangan baru.</li>
                          <li>Memfasilitasi workshop bagi mitra.</li>
                          <li>Mengadakan knowledge-sharing internal.</li>
                          <li>Mengikuti webinar relevan dengan pekerjaan.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="p-2 rounded-lg bg-[#F0FAF6] border border-[#C2EBD9] text-[11px] text-[#16654E]">
                      <strong>Contoh hasil yang diharapkan:</strong> “Peserta memahami metode baru dan dapat menerapkannya dalam pekerjaan.”
                    </div>
                    <div className="p-2 rounded-lg bg-blue-50/60 border border-blue-200/80 text-[11px] text-[#1E3A8A]">
                      <strong>Perbedaan dengan Perencanaan &amp; Pengembangan:</strong> Pelatihan fokus pada peningkatan kompetensi manusia, sedangkan Perencanaan fokus pada pengembangan program, sistem, strategi, atau produk kerja.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Modal */}
            <div className="px-5 py-3 border-t border-[#EDEDEC] bg-[#FAFAF9] flex items-center justify-between gap-3 shrink-0">
              <span className="text-[11px] text-[#787774]">
                Pilih 1–2 fokus yang paling mencerminkan hasil utama Anda hari ini.
              </span>
              <button
                type="button"
                onClick={() => setShowFocusGuideModal(false)}
                className="h-8 px-4 rounded-lg bg-[#1F7A63] hover:bg-[#17614E] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Mengerti &amp; Tutup Panduan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PREVIEW & DOWNLOAD PDF REKAP KERJA RESMI (GAYA TOR & NOTULEN)   */}
      {/* ===================================================================== */}
      {showWorkRecapPreviewModal && canViewDetails && myWorkRecap && (() => {
        const recapDocNumber = `RKP/${myWorkRecap.period.code || 'P2'}/WIJNA/${myWorkRecap.user.id
          .replace(/^user-/, '')
          .toUpperCase()}/2026`;
        const downloadDateIso = new Date().toISOString().slice(0, 10);
        const isTargetHR =
          myWorkRecap.user.role === 'hr' ||
          myWorkRecap.user.role === 'finance' ||
          myWorkRecap.user.id === 'user-finance';
        const isTargetDirector =
          myWorkRecap.user.role === 'director' ||
          myWorkRecap.user.id === 'user-director';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5 overflow-y-auto">
            <div className="bg-white rounded-xl border border-[#E5E5E3] shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
              {/* Top Action Bar Modal Preview (Sama seperti ToR dan Notulen) */}
              <div className="px-5 py-3 border-b border-stone-200 bg-white flex flex-wrap items-center justify-between gap-2 shrink-0 print:hidden">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowWorkRecapPreviewModal(false)}
                    className="text-xs font-medium text-stone-600 hover:text-stone-900 cursor-pointer"
                  >
                    ← Tutup Preview
                  </button>
                  <span className="text-stone-300">|</span>
                  <span className="font-mono text-xs text-stone-700 font-medium">
                    {recapDocNumber}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={downloadingRecapPdf}
                    onClick={() =>
                      handleDownloadOfficialWorkRecapPdf(modalWorkRecapSheetRef.current)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2F3437] hover:bg-[#1f2325] text-white text-xs font-medium cursor-pointer disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{downloadingRecapPdf ? 'Menyiapkan PDF...' : 'Download PDF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWorkRecapPreviewModal(false)}
                    className="p-1.5 rounded-md text-[#787774] hover:text-[#171717] hover:bg-[#EAEAE8] cursor-pointer"
                    title="Tutup Preview"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Lembar Dokumen Resmi (Gaya Formal ToR & Notulen) */}
              <div className="p-5 sm:p-7 overflow-y-auto bg-[#F4F4F2] flex-1">
                <div className="max-w-3xl mx-auto">
                  <article
                    ref={modalWorkRecapSheetRef}
                    className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-9 sm:py-8 shadow-xs space-y-5 text-[13.5px] leading-[1.38] text-black"
                    style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
                  >
                    <div className="text-center font-bold uppercase tracking-wide text-black text-[15px]">
                      REKAP KERJA &amp; KEHADIRAN KARYAWAN / OFFICIAL WORK RECAP
                    </div>

                    {/* 1. Informasi Karyawan & Ringkasan Rekap Kerja */}
                    <section>
                      <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
                        1. Informasi Karyawan &amp; Ringkasan Rekap Kerja
                      </div>
                      <table className="w-full border-collapse border border-black text-[13px] text-black">
                        <tbody>
                          <tr>
                            <td className="w-[30%] border border-black px-2.5 py-1 font-bold align-top">
                              Nomor Dokumen Rekap
                            </td>
                            <td className="w-[70%] border border-black px-2.5 py-1 align-top font-bold">
                              {recapDocNumber}
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Nama Karyawan
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top font-bold">
                              {myWorkRecap.user.name}
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Jabatan &amp; Divisi
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top">
                              {myWorkRecap.user.roleTitle} — {myWorkRecap.user.department}
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Periode yang Dipilih
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top font-bold">
                              {myWorkRecap.period.periodTitle} ({myWorkRecap.period.startDate} s/d{' '}
                              {myWorkRecap.period.endDate})
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Rata-rata Jam Kerja
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top font-bold">
                              {formatDecimalId(myWorkRecap.avgHoursPerDay)} Jam / Hari (Total{' '}
                              {formatDecimalId(myWorkRecap.totalHours)} Jam pada{' '}
                              {myWorkRecap.workedDays} Hari Kerja)
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Jumlah Flextime
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top">
                              {myWorkRecap.flextimeOccurrencesCount} Kali
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Jumlah WFA
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top">
                              {myWorkRecap.wfaOccurrencesCount} Kali ({myWorkRecap.wfaDaysCount}{' '}
                              Hari Pelaksanaan WFA)
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Metode &amp; Otoritas Verifikasi
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top font-bold">
                              {isTargetHR
                                ? 'Diverifikasi oleh Direktur Berdasarkan Audit Digital Sistem'
                                : isTargetDirector
                                ? 'Diverifikasi oleh HR / Finance Berdasarkan Audit Digital Sistem'
                                : 'Diverifikasi oleh HR / Finance & Disahkan Direktur Berdasarkan Audit Digital Sistem'}
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-2.5 py-1 font-bold align-top">
                              Tanggal Dokumen
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top">
                              {formatDateIndonesianLocked(downloadDateIso)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </section>

                    {/* 2. Jenis Pekerjaan / Aktivitas yang Dilakukan Selama Periode */}
                    <section>
                      <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
                        2. Jenis Pekerjaan atau Aktivitas yang Dilakukan Selama Periode
                      </div>
                      <table className="w-full border-collapse border border-black text-[13px] text-black">
                        <thead>
                          <tr className="bg-[#F2F2F2] font-bold">
                            <th className="w-[8%] border border-black px-2.5 py-1 text-center">
                              No.
                            </th>
                            <th className="w-[54%] border border-black px-2.5 py-1 text-left">
                              Jenis Pekerjaan / Aktivitas
                            </th>
                            <th className="w-[20%] border border-black px-2.5 py-1 text-center">
                              Frekuensi Aktivitas
                            </th>
                            <th className="w-[18%] border border-black px-2.5 py-1 text-right">
                              Proporsi (%)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {myWorkRecap.categoryProportions.map((cp, idx) => (
                            <tr key={cp.category}>
                              <td className="border border-black px-2.5 py-1 text-center align-top">
                                {idx + 1}.
                              </td>
                              <td className="border border-black px-2.5 py-1 font-bold align-top">
                                {cp.category}
                              </td>
                              <td className="border border-black px-2.5 py-1 text-center align-top">
                                {cp.count} catatan
                              </td>
                              <td className="border border-black px-2.5 py-1 text-right font-bold align-top">
                                {cp.percentage}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>

                    {/* 3. Pengesahan & Verifikasi Rekap Kerja Berdasarkan Audit Digital */}
                    <section className="pt-2 pdf-keep-together">
                      <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
                        3. Pengesahan &amp; Verifikasi Rekap Kerja (Berdasarkan Audit Digital)
                      </div>

                      {isTargetHR ? (
                        /* HR / Finance: Diverifikasi oleh Direktur Berdasarkan Audit Digital */
                        <div className="border border-black text-[12.5px] text-black p-4 flex flex-col items-center justify-between text-center min-h-[165px]">
                          <div>
                            <div className="font-bold">
                              Diverifikasi Oleh Direktur (Berdasarkan Audit Digital),
                            </div>
                            <div className="text-[11px] text-stone-700 mt-0.5">
                              Berdasarkan Audit Digital Kehadiran, Timesheet, WFA &amp; Flextime Sistem WIJNA
                            </div>
                          </div>
                          <div className="my-2 flex items-center justify-center">
                            <ApprovalBarcodeStamp
                              compact
                              variant={
                                myWorkRecap.verification.directorVerified
                                  ? 'authorized'
                                  : 'pending'
                              }
                              documentNumber={recapDocNumber}
                              roleCode="DIR"
                              signerName={myWorkRecap.verification.directorVerifierName}
                              signDate={downloadDateIso}
                              statusLabel={
                                myWorkRecap.verification.directorVerified
                                  ? 'TERVERIFIKASI AUDIT DIGITAL'
                                  : 'MENUNGGU VERIFIKASI DIREKTUR'
                              }
                            />
                          </div>
                          <div>
                            <div className="font-bold underline">
                              {myWorkRecap.verification.directorVerifierName}
                            </div>
                            <div className="text-[11px] text-stone-700">
                              {myWorkRecap.verification.directorVerifierRole}
                            </div>
                          </div>
                        </div>
                      ) : isTargetDirector ? (
                        /* Direktur: Diverifikasi oleh HR / Finance Berdasarkan Audit Digital */
                        <div className="border border-black text-[12.5px] text-black p-4 flex flex-col items-center justify-between text-center min-h-[165px]">
                          <div>
                            <div className="font-bold">
                              Diverifikasi Oleh HR / Finance (Berdasarkan Audit Digital),
                            </div>
                            <div className="text-[11px] text-stone-700 mt-0.5">
                              Berdasarkan Audit Digital Kehadiran, Timesheet, WFA &amp; Flextime Sistem WIJNA
                            </div>
                          </div>
                          <div className="my-2 flex items-center justify-center">
                            <ApprovalBarcodeStamp
                              compact
                              variant={
                                myWorkRecap.verification.financeVerified
                                  ? 'authorized'
                                  : 'pending'
                              }
                              documentNumber={recapDocNumber}
                              roleCode="FIN"
                              signerName={myWorkRecap.verification.financeVerifierName}
                              signDate={downloadDateIso}
                              statusLabel={
                                myWorkRecap.verification.financeVerified
                                  ? 'TERVERIFIKASI AUDIT DIGITAL'
                                  : 'MENUNGGU VERIFIKASI HR/FINANCE'
                              }
                            />
                          </div>
                          <div>
                            <div className="font-bold underline">
                              {myWorkRecap.verification.financeVerifierName}
                            </div>
                            <div className="text-[11px] text-stone-700">
                              {myWorkRecap.verification.financeVerifierRole}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Staf-staf: Tidak menggunakan stempel Karyawan (Gambar 1), langsung Diverifikasi HR/Finance & Disahkan Direktur Berdasarkan Audit Digital */
                        <div className="grid grid-cols-1 sm:grid-cols-2 border border-black text-[12.5px] text-black divide-y sm:divide-y-0 sm:divide-x divide-black">
                          {/* Kolom 1: Diverifikasi Oleh Finance / HR Berdasarkan Audit Digital */}
                          <div className="p-3.5 flex flex-col items-center justify-between text-center min-h-[160px]">
                            <div>
                              <div className="font-bold">
                                Diverifikasi Oleh (HR / Finance),
                              </div>
                              <div className="text-[10.5px] text-stone-700">
                                Berdasarkan Audit Digital Sistem
                              </div>
                            </div>
                            <div className="my-1.5 flex items-center justify-center">
                              <ApprovalBarcodeStamp
                                compact
                                variant={
                                  myWorkRecap.verification.financeVerified
                                    ? 'authorized'
                                    : 'pending'
                                }
                                documentNumber={recapDocNumber}
                                roleCode="FIN"
                                signerName={myWorkRecap.verification.financeVerifierName}
                                signDate={downloadDateIso}
                                statusLabel={
                                  myWorkRecap.verification.financeVerified
                                    ? 'TERVERIFIKASI AUDIT DIGITAL'
                                    : 'MENUNGGU VERIFIKASI'
                                }
                              />
                            </div>
                            <div>
                              <div className="font-bold underline">
                                {myWorkRecap.verification.financeVerifierName}
                              </div>
                              <div className="text-[11px] text-stone-700">
                                {myWorkRecap.verification.financeVerifierRole}
                              </div>
                            </div>
                          </div>

                          {/* Kolom 2: Disahkan Oleh Director Berdasarkan Audit Digital */}
                          <div className="p-3.5 flex flex-col items-center justify-between text-center min-h-[160px]">
                            <div>
                              <div className="font-bold">
                                Disahkan Oleh (Director),
                              </div>
                              <div className="text-[10.5px] text-stone-700">
                                Berdasarkan Audit Digital Sistem
                              </div>
                            </div>
                            <div className="my-1.5 flex items-center justify-center">
                              <ApprovalBarcodeStamp
                                compact
                                variant={
                                  myWorkRecap.verification.directorVerified
                                    ? 'authorized'
                                    : 'pending'
                                }
                                documentNumber={recapDocNumber}
                                roleCode="DIR"
                                signerName={myWorkRecap.verification.directorVerifierName}
                                signDate={downloadDateIso}
                                statusLabel={
                                  myWorkRecap.verification.directorVerified
                                    ? 'DISETUJUI AUDIT DIGITAL'
                                    : 'MENUNGGU PENGESAHAN'
                                }
                              />
                            </div>
                            <div>
                              <div className="font-bold underline">
                                {myWorkRecap.verification.directorVerifierName}
                              </div>
                              <div className="text-[11px] text-stone-700">
                                {myWorkRecap.verification.directorVerifierRole}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </section>
                  </article>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
