import React, { useState, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  Eye,
  EyeOff,
  Users,
  User as UserIcon,
  Clock,
  Home,
  HeartHandshake,
  Sparkles,
  Palmtree,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  FileText,
  MapPin,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  User,
  Tor,
  AttendanceSystemBundle,
  DailyAttendanceTimesheetRecord,
  WfaRequestRecord,
  LeaveRequestRecord,
  FlextimeAssignment,
  HolidayRequestRecord,
  WijnaWorkCategory,
} from '../../types/index.js';
import { api } from '../../lib/api.js';
import {
  WORK_CATEGORIES_SPEC,
  buildApprovedTorImplementationOptionsForUser,
} from './AttendanceTimesheetView.js';

export type CalendarEventCategory =
  | 'ATTENDANCE'
  | 'WFA'
  | 'FLEXTIME'
  | 'LEAVE'
  | 'HOLIDAY';

export type CalendarApprovalState = 'APPROVED' | 'PENDING' | 'REJECTED';

export interface UnifiedCalendarEvent {
  id: string;
  sourceId: string;
  category: CalendarEventCategory;
  userId: string;
  userName: string;
  userRoleTitle: string;
  department: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isMultiDay: boolean;
  totalDays: number;
  title: string;
  subtitle: string;
  description: string;
  approvalState: CalendarApprovalState;
  statusLabel: string;
  needsHrAction: boolean;
  needsDirectorAction: boolean;
  // Raw references for rich modal actions
  attendanceRecord?: DailyAttendanceTimesheetRecord;
  wfaRecord?: WfaRequestRecord;
  leaveRecord?: LeaveRequestRecord;
  flextimeRecord?: FlextimeAssignment;
  holidayRecord?: HolidayRequestRecord;
  relatedTimesheetRecords?: DailyAttendanceTimesheetRecord[];
}

interface WeekEventSegment {
  event: UnifiedCalendarEvent;
  startCol: number; // 0..6 (Mon..Sun)
  endCol: number; // 0..6
  span: number; // 1..7
  continuesLeft: boolean;
  continuesRight: boolean;
  lane: number;
}

interface InteractiveTeamCalendarProps {
  bundle: AttendanceSystemBundle;
  currentUser: User | null;
  allUsers: User[];
  allTors?: Tor[];
  isHR: boolean;
  isDirector: boolean;
  lockedTodayDate: string;
  showQuickClockIn: boolean;
  onToggleQuickClockIn: () => void;
  isCalendarVisible?: boolean;
  onToggleCalendarVisible?: () => void;
  onBundleChange: (nextBundle: AttendanceSystemBundle) => void;
  onShowToast: (msg: string) => void;
  onShowError: (msg: string) => void;
}

const CATEGORY_META: Record<
  CalendarEventCategory,
  {
    label: string;
    shortLabel: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
    accentClass: string;
    badgeBg: string;
    dotClass: string;
  }
> = {
  ATTENDANCE: {
    label: 'Attendance & Timesheet',
    shortLabel: 'Hadir',
    bgClass: 'bg-blue-50/95 hover:bg-blue-100/90',
    textClass: 'text-blue-950',
    borderClass: 'border-blue-300',
    accentClass: 'bg-[#2563EB]',
    badgeBg: 'bg-blue-100 text-blue-800 border-blue-200',
    dotClass: 'bg-[#2563EB]',
  },
  WFA: {
    label: 'WFA (Work From Anywhere)',
    shortLabel: 'WFA',
    bgClass: 'bg-teal-50/95 hover:bg-teal-100/90',
    textClass: 'text-teal-950',
    borderClass: 'border-teal-300',
    accentClass: 'bg-[#0F7B6C]',
    badgeBg: 'bg-teal-100 text-teal-800 border-teal-200',
    dotClass: 'bg-[#0F7B6C]',
  },
  FLEXTIME: {
    label: 'Flextime',
    shortLabel: 'Flextime',
    bgClass: 'bg-indigo-50/95 hover:bg-indigo-100/90',
    textClass: 'text-indigo-950',
    borderClass: 'border-indigo-300',
    accentClass: 'bg-indigo-600',
    badgeBg: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    dotClass: 'bg-indigo-600',
  },
  LEAVE: {
    label: 'Cuti & Izin',
    shortLabel: 'Cuti/Izin',
    bgClass: 'bg-amber-50/95 hover:bg-amber-100/90',
    textClass: 'text-amber-950',
    borderClass: 'border-amber-300',
    accentClass: 'bg-amber-600',
    badgeBg: 'bg-amber-100 text-amber-900 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  HOLIDAY: {
    label: 'Hari Libur Bersama / Nasional',
    shortLabel: 'Libur Bersama',
    bgClass: 'bg-purple-50/95 hover:bg-purple-100/90',
    textClass: 'text-purple-950',
    borderClass: 'border-purple-300',
    accentClass: 'bg-purple-600',
    badgeBg: 'bg-purple-100 text-purple-900 border-purple-200',
    dotClass: 'bg-purple-600',
  },
};

const DAY_NAMES_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function getShortPersonName(fullName: string): string {
  if (!fullName) return 'Staf';
  const clean = fullName.split(',')[0].trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts[0].endsWith('.')) {
    // e.g. Dr. Hendra Wijaya -> Dr. Hendra
    return `${parts[0]} ${parts[1] || ''}`.trim();
  }
  return `${parts[0]} ${parts[1]?.[0] ? parts[1][0] + '.' : ''}`.trim();
}

function countWorkingDaysClient(startDate: string, endDate: string): number {
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endDate || startDate}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 1;
  let weekdays = 0;
  let total = 0;
  const cur = new Date(s);
  let guard = 0;
  while (cur <= e && guard < 366) {
    total++;
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) weekdays++;
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard++;
  }
  return weekdays > 0 ? weekdays : Math.max(1, total);
}

function formatDateIdShort(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  if (isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateIdFull(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  if (isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatClockHHMM(iso?: string): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 5);
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Menghasilkan matriks minggu (setiap minggu berisi 7 hari Senin..Minggu) untuk bulan terpilih.
 */
function buildMonthWeeksGrid(year: number, monthZeroIndexed: number): {
  dateStr: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isWeekend: boolean;
}[][] {
  const firstDayOfMonth = new Date(Date.UTC(year, monthZeroIndexed, 1));
  const lastDayOfMonth = new Date(Date.UTC(year, monthZeroIndexed + 1, 0));

  // Konversi hari Minggu (0) menjadi 6, Senin (1) menjadi 0
  const startDowMonFirst = (firstDayOfMonth.getUTCDay() + 6) % 7;
  const gridStartDate = new Date(firstDayOfMonth);
  gridStartDate.setUTCDate(gridStartDate.getUTCDate() - startDowMonFirst);

  const endDowMonFirst = (lastDayOfMonth.getUTCDay() + 6) % 7;
  const gridEndDate = new Date(lastDayOfMonth);
  gridEndDate.setUTCDate(gridEndDate.getUTCDate() + (6 - endDowMonFirst));

  const weeks: {
    dateStr: string;
    dayNumber: number;
    isCurrentMonth: boolean;
    isWeekend: boolean;
  }[][] = [];

  const cur = new Date(gridStartDate);
  let safety = 0;
  while (cur <= gridEndDate && safety < 10) {
    const week: {
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isWeekend: boolean;
    }[] = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = cur.toISOString().slice(0, 10);
      const dayNumber = cur.getUTCDate();
      const isCurrentMonth = cur.getUTCMonth() === monthZeroIndexed;
      const dow = cur.getUTCDay();
      const isWeekend = dow === 0 || dow === 6;
      week.push({ dateStr, dayNumber, isCurrentMonth, isWeekend });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
    safety++;
  }
  return weeks;
}

export const InteractiveTeamCalendar: React.FC<InteractiveTeamCalendarProps> = ({
  bundle,
  currentUser,
  allUsers,
  allTors = [],
  isHR,
  isDirector,
  lockedTodayDate,
  showQuickClockIn,
  onToggleQuickClockIn,
  isCalendarVisible = true,
  onToggleCalendarVisible,
  onBundleChange,
  onShowToast,
  onShowError,
}) => {
  // Mode Kalender: 'PERSONAL' (My Personal Calendar sebagai default) atau 'TEAM' (General Team Calendar untuk seluruh tim)
  const [calendarScope, setCalendarScope] = useState<'TEAM' | 'PERSONAL'>('PERSONAL');

  // Bulan aktif (default ke bulan dari lockedTodayDate atau 2026-11)
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const base = lockedTodayDate ? new Date(`${lockedTodayDate}T00:00:00Z`) : new Date();
    if (isNaN(base.getTime())) return new Date(Date.UTC(2026, 10, 1));
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  });

  // Hide / Show & Filter States (Default: Hide Filter aktif terlebih dahulu agar tampilan ringkas & fokus)
  const [showFilterBar, setShowFilterBar] = useState<boolean>(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [selectedApprovalFilter, setSelectedApprovalFilter] = useState<
    'ALL' | 'APPROVED' | 'PENDING' | 'REJECTED'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleCategories, setVisibleCategories] = useState<
    Record<CalendarEventCategory, boolean>
  >({
    ATTENDANCE: false,
    WFA: true,
    FLEXTIME: true,
    LEAVE: true,
    HOLIDAY: true,
  });
  const [compactMaxLanes, setCompactMaxLanes] = useState<number>(4);

  // Modal States
  const [selectedDayModalDate, setSelectedDayModalDate] = useState<string | null>(null);
  const [selectedEventModal, setSelectedEventModal] = useState<UnifiedCalendarEvent | null>(
    null
  );
  const [showRequestModal, setShowRequestModal] = useState<boolean>(false);

  // Form Pengajuan Langsung dari Kalender
  const [reqType, setReqType] = useState<'WFA' | 'FLEXTIME' | 'LEAVE' | 'HOLIDAY'>('WFA');
  const [reqStartDate, setReqStartDate] = useState<string>(lockedTodayDate);
  const [reqEndDate, setReqEndDate] = useState<string>(lockedTodayDate);
  const [reqReason, setReqReason] = useState<string>('');
  const [reqWfaSelectedOptionValue, setReqWfaSelectedOptionValue] = useState<string>('');
  const [reqWfaInvitedUserIds, setReqWfaInvitedUserIds] = useState<string[]>([]);
  const [reqFlexSchedule, setReqFlexSchedule] = useState<string>(
    'Jam Masuk Fleksibel 07:30–10:00 WIB (8 Jam Kerja/Hari)'
  );
  const [reqLeaveCategoryId, setReqLeaveCategoryId] = useState<string>(
    bundle.leavePolicies?.[0]?.id || ''
  );
  const [reqHolidayTitle, setReqHolidayTitle] = useState<string>(
    'Hari Libur Bersama — Libur Nasional / Kelembagaan'
  );
  const [reqTargetUserId, setReqTargetUserId] = useState<string>(currentUser?.id || '');
  const [submittingRequest, setSubmittingRequest] = useState<boolean>(false);

  // State di dalam Modal Detail Event (Approval & Update Timesheet)
  const [decisionNotes, setDecisionNotes] = useState<string>('');
  const [processingDecision, setProcessingDecision] = useState<boolean>(false);
  const [editingTimesheetDate, setEditingTimesheetDate] = useState<string>('');
  const [editingTimesheetItems, setEditingTimesheetItems] = useState<
    { id?: string; category: WijnaWorkCategory; shortDescription: string }[]
  >([]);

  const activeStaffList = useMemo(
    () => allUsers.filter((u) => u.isActive && u.role !== 'admin'),
    [allUsers]
  );

  const effectiveModalTargetUser = useMemo(() => {
    if (isHR && reqTargetUserId) {
      return allUsers.find((u) => u.id === reqTargetUserId) || currentUser;
    }
    return currentUser;
  }, [isHR, reqTargetUserId, allUsers, currentUser]);

  const modalApprovedTorOptions = useMemo(
    () => buildApprovedTorImplementationOptionsForUser(effectiveModalTargetUser, allTors),
    [effectiveModalTargetUser, allTors]
  );

  // ===========================================================================
  // 1. NORMALISASI & DEDUPLIKASI SELURUH EVENT KALENDER (TANPA DUPLIKASI DATA)
  // ===========================================================================
  const allUnifiedEvents = useMemo<UnifiedCalendarEvent[]>(() => {
    const events: UnifiedCalendarEvent[] = [];

    // Petakan record harian per userId + date untuk referensi timesheet dan mencegah duplikasi
    const recordsByUserAndDate = new Map<string, DailyAttendanceTimesheetRecord>();
    const seenAttendanceKeys = new Set<string>();

    for (const r of bundle.records || []) {
      const key = `${r.userId}__${r.date}`;
      if (!recordsByUserAndDate.has(key)) {
        recordsByUserAndDate.set(key, r);
      }
    }

    const resolveCalendarApprovalState = (
      status?: string,
      workflowType?: string,
      isActiveFlag?: boolean
    ): CalendarApprovalState => {
      if (
        workflowType === 'FINANCE_TO_DIRECTOR_REVIEW' ||
        workflowType === 'DIRECTOR_TO_FINANCE_NOTIFY' ||
        status === 'Submitted for Review' ||
        status === 'Reviewed by Director' ||
        status === 'Notified to Finance' ||
        status === 'Acknowledged by Finance' ||
        status === 'Approved' ||
        status === 'Disetujui HR' ||
        status === 'Disetujui Director'
      ) {
        return isActiveFlag === false ? 'PENDING' : 'APPROVED';
      }
      if (status === 'Returned' || status === 'Ditolak HR' || status === 'Ditolak') {
        return 'REJECTED';
      }
      return 'PENDING';
    };

    // A. WFA Requests (Single-Day & Multi-Day)
    const coveredWfaUserDates = new Set<string>();
    for (const w of bundle.wfaRequests || []) {
      const startDate = w.startDate || w.date;
      const endDate = w.endDate || startDate;
      const totalDays = w.totalDays || countWorkingDaysClient(startDate, endDate);
      const wfType =
        w.workflowType ||
        (w.userId === 'user-director'
          ? 'DIRECTOR_TO_FINANCE_NOTIFY'
          : w.userId === 'user-hr'
          ? 'FINANCE_TO_DIRECTOR_REVIEW'
          : 'EMPLOYEE_TO_FINANCE_APPROVAL');
      const approvalState = resolveCalendarApprovalState(w.status, wfType);

      const relatedTs: DailyAttendanceTimesheetRecord[] = [];
      const cur = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      let guard = 0;
      while (cur <= end && guard < 366) {
        const dStr = cur.toISOString().slice(0, 10);
        coveredWfaUserDates.add(`${w.userId}__${dStr}`);
        const rec = recordsByUserAndDate.get(`${w.userId}__${dStr}`);
        if (rec) relatedTs.push(rec);
        cur.setUTCDate(cur.getUTCDate() + 1);
        guard++;
      }

      const invitedCount = Array.isArray(w.invitedUserNames) ? w.invitedUserNames.length : 0;
      const invitedTitleBadge = invitedCount > 0 ? ` (+${invitedCount} Staf)` : '';
      const torBadge = w.torNumber ? ` [${w.torNumber}]` : '';

      events.push({
        id: `cal-wfa-${w.id}`,
        sourceId: w.id,
        category: 'WFA',
        userId: w.userId,
        userName: w.userName,
        userRoleTitle: w.userRoleTitle,
        department: w.department,
        startDate,
        endDate,
        isMultiDay: startDate !== endDate,
        totalDays,
        title: `${getShortPersonName(w.userName)}${invitedTitleBadge} • WFA${torBadge}`,
        subtitle:
          startDate === endDate
            ? `WFA 1 Hari (${bundle.locationConfig?.standardDailyHours || 8}j)${
                invitedCount > 0 ? ` • Mengajak: ${w.invitedUserNames?.join(', ')}` : ''
              }`
            : `WFA ${totalDays} Hari Kerja${
                invitedCount > 0 ? ` • Mengajak: ${w.invitedUserNames?.join(', ')}` : ''
              }`,
        description: w.reasonAndPlan,
        approvalState,
        statusLabel: w.status,
        needsHrAction:
          (wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' &&
            (w.status === 'Pending' || w.status === 'Diajukan Staf')) ||
          (wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && w.status === 'Notified to Finance'),
        needsDirectorAction:
          wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && w.status === 'Submitted for Review',
        wfaRecord: w,
        relatedTimesheetRecords: relatedTs,
      });
    }

    // B. Leave / Cuti & Izin Requests (Single-Day & Multi-Day)
    const coveredLeaveUserDates = new Set<string>();
    for (const l of bundle.leaveRequests || []) {
      const startDate = l.startDate;
      const endDate = l.endDate || startDate;
      const totalDays = l.totalDays || countWorkingDaysClient(startDate, endDate);
      const wfType =
        l.workflowType ||
        (l.userId === 'user-director'
          ? 'DIRECTOR_TO_FINANCE_NOTIFY'
          : l.userId === 'user-hr'
          ? 'FINANCE_TO_DIRECTOR_REVIEW'
          : 'EMPLOYEE_TO_FINANCE_APPROVAL');
      const approvalState = resolveCalendarApprovalState(l.status, wfType);

      const cur = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      let guard = 0;
      while (cur <= end && guard < 366) {
        const dStr = cur.toISOString().slice(0, 10);
        coveredLeaveUserDates.add(`${l.userId}__${dStr}`);
        cur.setUTCDate(cur.getUTCDate() + 1);
        guard++;
      }

      events.push({
        id: `cal-leave-${l.id}`,
        sourceId: l.id,
        category: 'LEAVE',
        userId: l.userId,
        userName: l.userName,
        userRoleTitle: l.userRoleTitle,
        department: l.department,
        startDate,
        endDate,
        isMultiDay: startDate !== endDate,
        totalDays,
        title: `${getShortPersonName(l.userName)} • ${l.categoryName}`,
        subtitle: `${l.categoryName} (${totalDays} Hari)`,
        description: l.reason || l.categoryName,
        approvalState,
        statusLabel: l.status,
        needsHrAction:
          (wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' &&
            (l.status === 'Pending' || l.status === 'Menunggu Review HR')) ||
          (wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && l.status === 'Notified to Finance'),
        needsDirectorAction:
          wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && l.status === 'Submitted for Review',
        leaveRecord: l,
      });
    }

    // C. Hari Libur Bersama / Nasional (Berlaku Umum untuk Seluruh Tim — Single-Day & Multi-Day)
    const coveredHolidayUserDates = new Set<string>();
    for (const h of bundle.holidayRequests || []) {
      const startDate = h.startDate;
      const endDate = h.endDate || startDate;
      const totalDays = h.totalDays || countWorkingDaysClient(startDate, endDate);
      const wfType = h.workflowType || 'EMPLOYEE_TO_FINANCE_APPROVAL';
      const approvalState = resolveCalendarApprovalState(h.status, wfType);

      const cur = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      let guard = 0;
      while (cur <= end && guard < 366) {
        const dStr = cur.toISOString().slice(0, 10);
        coveredHolidayUserDates.add(`${h.userId}__${dStr}`);
        cur.setUTCDate(cur.getUTCDate() + 1);
        guard++;
      }

      const cleanTitle = (h.title || 'Hari Libur Bersama')
        .replace(/^Hari Libur Bersama\s*—\s*/i, '')
        .replace(/^Personal Holiday\s*—\s*/i, '')
        .trim();

      events.push({
        id: `cal-hol-${h.id}`,
        sourceId: h.id,
        category: 'HOLIDAY',
        userId: 'ALL_TEAM',
        userName: 'Seluruh Tim WIJNA',
        userRoleTitle: 'Hari Libur Bersama / Nasional',
        department: 'Seluruh Divisi WIJNA',
        startDate,
        endDate,
        isMultiDay: startDate !== endDate,
        totalDays,
        title: `Libur Bersama • ${cleanTitle}`,
        subtitle: h.title.replace(/Personal Holiday/gi, 'Hari Libur Bersama'),
        description: h.reason || h.title,
        approvalState,
        statusLabel:
          h.status === 'Approved' || h.status === 'Disetujui HR'
            ? 'Hari Libur Aktif (Umum)'
            : h.status,
        needsHrAction:
          (wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' &&
            (h.status === 'Pending' || h.status === 'Diajukan Staf')) ||
          (wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && h.status === 'Notified to Finance'),
        needsDirectorAction:
          wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && h.status === 'Submitted for Review',
        holidayRecord: h,
      });
    }

    // D. Flextime Assignments & Requests (Single-Day & Multi-Day)
    for (const f of bundle.flextimeAssignments || []) {
      const startDate = f.startDate;
      const endDate = f.endDate || startDate;
      const totalDays = countWorkingDaysClient(startDate, endDate);
      const wfType =
        f.workflowType ||
        (f.userId === 'user-director'
          ? 'DIRECTOR_TO_FINANCE_NOTIFY'
          : f.userId === 'user-hr'
          ? 'FINANCE_TO_DIRECTOR_REVIEW'
          : 'EMPLOYEE_TO_FINANCE_APPROVAL');
      const status = f.status || (f.isActive ? 'Approved' : 'Pending');
      const approvalState = resolveCalendarApprovalState(status, wfType, f.isActive);

      events.push({
        id: `cal-flex-${f.id}`,
        sourceId: f.id,
        category: 'FLEXTIME',
        userId: f.userId,
        userName: f.userName,
        userRoleTitle: f.userRoleTitle,
        department: f.department || 'Lintas Divisi',
        startDate,
        endDate,
        isMultiDay: startDate !== endDate,
        totalDays,
        title: `${getShortPersonName(f.userName)} • Flextime`,
        subtitle: f.scheduleArrangement,
        description: f.policyNotes || f.scheduleArrangement,
        approvalState,
        statusLabel:
          (status === 'Approved' || status === 'Disetujui HR') && f.isActive
            ? 'Flextime Aktif'
            : status,
        needsHrAction:
          (wfType === 'EMPLOYEE_TO_FINANCE_APPROVAL' &&
            (status === 'Pending' || status === 'Diajukan Staf')) ||
          (wfType === 'DIRECTOR_TO_FINANCE_NOTIFY' && status === 'Notified to Finance'),
        needsDirectorAction:
          wfType === 'FINANCE_TO_DIRECTOR_REVIEW' && status === 'Submitted for Review',
        flextimeRecord: f,
      });
    }

    return events;
  }, [bundle]);

  // ===========================================================================
  // 2. FILTER EVENT SESUAI PERSONAL / TEAM, STAF, KATEGORI, & STATUS APPROVAL
  // ===========================================================================
  const filteredEvents = useMemo<UnifiedCalendarEvent[]>(() => {
    return allUnifiedEvents.filter((ev) => {
      // Personal vs Team Calendar (Hari Libur Bersama & WFA Kolaborasi tampil untuk staf terkait)
      if (
        calendarScope === 'PERSONAL' &&
        currentUser &&
        ev.category !== 'HOLIDAY' &&
        ev.userId !== currentUser.id &&
        !(ev.wfaRecord?.invitedUserIds || []).includes(currentUser.id)
      ) {
        return false;
      }
      // Filter Staf (Hari Libur Bersama berlaku umum, WFA mencakup staf yang diajak)
      if (
        calendarScope === 'TEAM' &&
        selectedStaffId !== 'ALL' &&
        ev.category !== 'HOLIDAY' &&
        ev.userId !== selectedStaffId &&
        !(ev.wfaRecord?.invitedUserIds || []).includes(selectedStaffId)
      ) {
        return false;
      }
      // Filter Kategori (Hide/Show per jenis aktivitas)
      if (!visibleCategories[ev.category]) {
        return false;
      }
      // Filter Approval Status
      if (selectedApprovalFilter === 'ALL') {
        // Sembunyikan yang ditolak secara default agar kalender tetap bersih, kecuali di Personal Calendar
        if (ev.approvalState === 'REJECTED' && calendarScope === 'TEAM') {
          return false;
        }
      } else if (ev.approvalState !== selectedApprovalFilter) {
        return false;
      }
      // Filter Pencarian Teks
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          ev.userName.toLowerCase().includes(q) ||
          ev.title.toLowerCase().includes(q) ||
          ev.subtitle.toLowerCase().includes(q) ||
          ev.description.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    allUnifiedEvents,
    calendarScope,
    currentUser,
    selectedStaffId,
    visibleCategories,
    selectedApprovalFilter,
    searchQuery,
  ]);

  // ===========================================================================
  // 3. GRID MINGGUAN & ALGORITMA HORIZONTAL MULTI-DAY BAR LANE PACKING
  // ===========================================================================
  const monthWeeks = useMemo(
    () =>
      buildMonthWeeksGrid(
        currentMonthDate.getUTCFullYear(),
        currentMonthDate.getUTCMonth()
      ),
    [currentMonthDate]
  );

  // Semua aktivitas per tanggal YYYY-MM-DD (tanpa batas jumlah untuk modal "+N More")
  const eventsByDateMap = useMemo(() => {
    const map = new Map<string, UnifiedCalendarEvent[]>();
    for (const week of monthWeeks) {
      for (const day of week) {
        map.set(day.dateStr, []);
      }
    }
    for (const ev of filteredEvents) {
      for (const [dateStr, list] of map.entries()) {
        if (ev.startDate <= dateStr && ev.endDate >= dateStr) {
          list.push(ev);
        }
      }
    }
    // Urutkan multi-day & pending/approved terlebih dahulu
    for (const [, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.isMultiDay !== b.isMultiDay) return a.isMultiDay ? -1 : 1;
        if (a.endDate !== b.endDate) return b.endDate.localeCompare(a.endDate);
        return a.category.localeCompare(b.category);
      });
    }
    return map;
  }, [monthWeeks, filteredEvents]);

  // Untuk setiap minggu, hitung segmen bar horizontal beserta nomor jalur (lane) vertikalnya
  const weekSegmentsLayout = useMemo(() => {
    return monthWeeks.map((week) => {
      const weekStart = week[0].dateStr;
      const weekEnd = week[6].dateStr;

      // Ambil semua event yang bersinggungan dengan minggu ini
      const overlapping = filteredEvents.filter(
        (ev) => ev.startDate <= weekEnd && ev.endDate >= weekStart
      );

      // Urutkan agar event multi-day dan yang mulai lebih awal menempati jalur atas secara konsisten
      overlapping.sort((a, b) => {
        if (a.isMultiDay !== b.isMultiDay) return a.isMultiDay ? -1 : 1;
        const aClampStart = a.startDate < weekStart ? weekStart : a.startDate;
        const bClampStart = b.startDate < weekStart ? weekStart : b.startDate;
        if (aClampStart !== bClampStart) return aClampStart.localeCompare(bClampStart);
        const aClampEnd = a.endDate > weekEnd ? weekEnd : a.endDate;
        const bClampEnd = b.endDate > weekEnd ? weekEnd : b.endDate;
        if (aClampEnd !== bClampEnd) return bClampEnd.localeCompare(aClampEnd);
        return a.userName.localeCompare(b.userName);
      });

      // Lakukan penempatan jalur (lane) bebas tabrakan untuk setiap kolom 0..6
      const laneOccupancy: boolean[][] = []; // laneOccupancy[lane][col]
      const segments: WeekEventSegment[] = [];

      for (const ev of overlapping) {
        const startCol = Math.max(
          0,
          week.findIndex((d) => d.dateStr >= ev.startDate)
        );
        let endCol = 6;
        for (let c = 6; c >= 0; c--) {
          if (week[c].dateStr <= ev.endDate) {
            endCol = c;
            break;
          }
        }
        if (endCol < startCol) continue;

        let assignedLane = 0;
        while (true) {
          if (!laneOccupancy[assignedLane]) {
            laneOccupancy[assignedLane] = [
              false,
              false,
              false,
              false,
              false,
              false,
              false,
            ];
          }
          let free = true;
          for (let c = startCol; c <= endCol; c++) {
            if (laneOccupancy[assignedLane][c]) {
              free = false;
              break;
            }
          }
          if (free) {
            for (let c = startCol; c <= endCol; c++) {
              laneOccupancy[assignedLane][c] = true;
            }
            break;
          }
          assignedLane++;
        }

        segments.push({
          event: ev,
          startCol,
          endCol,
          span: endCol - startCol + 1,
          continuesLeft: ev.startDate < weekStart,
          continuesRight: ev.endDate > weekEnd,
          lane: assignedLane,
        });
      }

      // Hitung jumlah event tersembunyi (+N More) per kolom hari (0..6)
      const hiddenCountPerCol = week.map((day, colIdx) => {
        const allForDay = eventsByDateMap.get(day.dateStr) || [];
        const visibleForCol = segments.filter(
          (seg) =>
            seg.lane < compactMaxLanes &&
            seg.startCol <= colIdx &&
            seg.endCol >= colIdx
        );
        return Math.max(0, allForDay.length - visibleForCol.length);
      });

      return {
        week,
        visibleSegments: segments.filter((s) => s.lane < compactMaxLanes),
        hiddenCountPerCol,
      };
    });
  }, [monthWeeks, filteredEvents, eventsByDateMap, compactMaxLanes]);

  // Ringkasan jumlah per kategori & pending approval pada bulan ini
  const monthSummaryStats = useMemo(() => {
    const mPrefix = currentMonthDate.toISOString().slice(0, 7);
    const inMonth = filteredEvents.filter(
      (ev) => ev.startDate.startsWith(mPrefix) || ev.endDate.startsWith(mPrefix)
    );
    return {
      total: inMonth.length,
      attendance: inMonth.filter((e) => e.category === 'ATTENDANCE').length,
      wfa: inMonth.filter((e) => e.category === 'WFA').length,
      flextime: inMonth.filter((e) => e.category === 'FLEXTIME').length,
      leave: inMonth.filter((e) => e.category === 'LEAVE').length,
      holiday: inMonth.filter((e) => e.category === 'HOLIDAY').length,
      pendingApproval: inMonth.filter((e) => e.approvalState === 'PENDING').length,
    };
  }, [filteredEvents, currentMonthDate]);

  // Navigasi Bulan
  const handlePrevMonth = () => {
    setCurrentMonthDate(
      (prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() - 1, 1))
    );
  };

  const handleNextMonth = () => {
    setCurrentMonthDate(
      (prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1))
    );
  };

  const handleJumpToday = () => {
    const base = lockedTodayDate ? new Date(`${lockedTodayDate}T00:00:00Z`) : new Date();
    setCurrentMonthDate(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)));
  };

  const toggleCategoryVisibility = (cat: CalendarEventCategory) => {
    setVisibleCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Buka Modal Pengajuan pada Tanggal Tertentu
  const openCreateRequestForDate = (
    dateStr: string,
    defaultCategory: 'WFA' | 'FLEXTIME' | 'LEAVE' | 'HOLIDAY' = 'WFA'
  ) => {
    setReqType(defaultCategory);
    setReqStartDate(dateStr);
    setReqEndDate(dateStr);
    setReqReason('');
    setReqWfaInvitedUserIds([]);
    const userOptions = buildApprovedTorImplementationOptionsForUser(currentUser, allTors);
    setReqWfaSelectedOptionValue(
      userOptions.length > 0 ? userOptions[0].value : '__LAINNYA__'
    );
    setReqTargetUserId(currentUser?.id || '');
    if (bundle.leavePolicies?.length > 0 && !reqLeaveCategoryId) {
      setReqLeaveCategoryId(bundle.leavePolicies[0].id);
    }
    setShowRequestModal(true);
  };

  // Buka Modal Detail Event
  const openEventDetailModal = (ev: UnifiedCalendarEvent) => {
    setSelectedEventModal(ev);
    setDecisionNotes('');
    if (ev.attendanceRecord) {
      setEditingTimesheetDate(ev.attendanceRecord.date);
      setEditingTimesheetItems(
        (ev.attendanceRecord.timesheetItems || []).slice(0, 2).map((t) => ({
          id: t.id,
          category: t.category,
          shortDescription: t.shortDescription,
        }))
      );
    } else if (ev.wfaRecord) {
      const targetDate = ev.wfaRecord.startDate || ev.wfaRecord.date;
      setEditingTimesheetDate(targetDate);
      const existingRec = ev.relatedTimesheetRecords?.find((r) => r.date === targetDate);
      setEditingTimesheetItems(
        existingRec && existingRec.timesheetItems.length > 0
          ? existingRec.timesheetItems.slice(0, 2).map((t) => ({
              id: t.id,
              category: t.category,
              shortDescription: t.shortDescription,
            }))
          : [
              {
                category: 'Perencanaan & Pengembangan',
                shortDescription: ev.wfaRecord.reasonAndPlan,
              },
            ]
      );
    } else {
      setEditingTimesheetDate('');
      setEditingTimesheetItems([]);
    }
  };

  // Submit Pengajuan Baru dari Kalender (WFA, Flextime, Cuti/Izin, atau Personal Holiday)
  const handleCalendarRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqStartDate) return;
    const validEnd = reqEndDate && reqEndDate >= reqStartDate ? reqEndDate : reqStartDate;
    setSubmittingRequest(true);
    try {
      if (reqType === 'WFA') {
        const isHrForStaff = isHR && reqTargetUserId && reqTargetUserId !== currentUser?.id;
        const isCustom =
          reqWfaSelectedOptionValue === '__LAINNYA__' || !reqWfaSelectedOptionValue;
        const matchedTorOpt = !isCustom
          ? modalApprovedTorOptions.find((o) => o.value === reqWfaSelectedOptionValue)
          : undefined;
        const composedPlan = matchedTorOpt
          ? reqReason.trim()
            ? `${matchedTorOpt.shortActivity} — Catatan: ${reqReason.trim()}`
            : matchedTorOpt.shortActivity
          : reqReason.trim() || 'Pelaksanaan kerja jarak jauh (WFA) terjadwal di kalender.';

        const res = await api.submitOrAssignWfa({
          mode: isHrForStaff ? 'hr_manual' : 'staff_request',
          userId: isHrForStaff ? reqTargetUserId : currentUser?.id,
          date: reqStartDate,
          startDate: reqStartDate,
          endDate: validEnd,
          reasonAndPlan: composedPlan,
          torId: matchedTorOpt?.torId,
          torNumber: matchedTorOpt?.torNumber,
          torTitle: matchedTorOpt?.torTitle,
          implementationOption: matchedTorOpt
            ? matchedTorOpt.label
            : 'Lainnya (Di Luar Daftar ToR)',
          isCustomImplementation: isCustom,
          invitedUserIds: reqWfaInvitedUserIds,
        });
        onBundleChange(res.bundle);
        onShowToast(
          isHrForStaff
            ? 'Jadwal WFA berhasil ditetapkan di kalender & timesheet.'
            : 'Pengajuan WFA berhasil dikirim ke HR/Finance.'
        );
      } else if (reqType === 'FLEXTIME') {
        const isHrDirect = isHR && reqTargetUserId && reqTargetUserId !== currentUser?.id;
        const res = await api.saveFlextimeAssignment({
          userId: isHrDirect ? reqTargetUserId : currentUser?.id,
          startDate: reqStartDate,
          endDate: validEnd,
          scheduleArrangement: reqFlexSchedule.trim(),
          policyNotes: reqReason.trim() || 'Pengajuan jadwal Flextime melalui Kalender.',
          mode: isHrDirect ? 'hr_assign' : 'staff_request',
        });
        onBundleChange(res.bundle);
        onShowToast(
          isHrDirect
            ? 'Periode Flextime berhasil diaktifkan di kalender.'
            : 'Pengajuan Flextime berhasil dikirim untuk persetujuan HR/Finance.'
        );
      } else if (reqType === 'LEAVE') {
        const res = await api.submitLeaveRequest({
          categoryId: reqLeaveCategoryId || bundle.leavePolicies?.[0]?.id || '',
          startDate: reqStartDate,
          endDate: validEnd,
          reason: reqReason.trim() || 'Pengajuan cuti/izin melalui kalender.',
        });
        onBundleChange(res.bundle);
        onShowToast('Pengajuan Cuti/Izin berhasil dikirim ke HR/Finance & Director.');
      } else if (reqType === 'HOLIDAY') {
        const res = await api.submitHolidayRequest({
          userId: 'ALL_TEAM',
          title: reqHolidayTitle.trim() || 'Hari Libur Bersama',
          startDate: reqStartDate,
          endDate: validEnd,
          reason:
            reqReason.trim() ||
            'Penetapan / usulan Hari Libur Bersama untuk seluruh staf Yayasan WIJNA.',
          autoApproveByHr: isHR,
        });
        onBundleChange(res.bundle);
        onShowToast(
          isHR
            ? 'Hari Libur Bersama berhasil ditetapkan di Kalender Tim untuk seluruh staf.'
            : 'Usulan Hari Libur Bersama berhasil dikirim ke HR/Finance.'
        );
      }
      setShowRequestModal(false);
    } catch (err: any) {
      onShowError(err.message || 'Gagal mengirim pengajuan dari kalender.');
    } finally {
      setSubmittingRequest(false);
    }
  };

  // Eksekusi Tindakan Berdasarkan Peran Langsung dari Modal Event Kalender
  const handleEventApprovalAction = async (
    ev: UnifiedCalendarEvent,
    decision: 'approve' | 'return' | 'review' | 'acknowledge',
    stage: 'hr' | 'director'
  ) => {
    if (decision === 'return' && !decisionNotes.trim()) {
      onShowError(
        'Wajib mengisi alasan pengembalian (Return Reason) saat mengembalikan pengajuan staf.'
      );
      return;
    }
    setProcessingDecision(true);
    try {
      const trimmedNotes = decisionNotes.trim() || undefined;
      if (ev.category === 'WFA' && ev.wfaRecord) {
        const res = await api.decideWfaRequest(ev.wfaRecord.id, {
          stage,
          decision,
          notes: trimmedNotes,
          returnReason: decision === 'return' ? trimmedNotes : undefined,
        });
        onBundleChange(res.bundle);
        onShowToast(
          decision === 'approve'
            ? `WFA ${ev.userName} berhasil disetujui & disinkronkan ke Kalender.`
            : decision === 'return'
            ? `WFA ${ev.userName} dikembalikan untuk revisi.`
            : decision === 'review'
            ? `Catatan review strategis Direktur disimpan untuk WFA ${ev.userName}.`
            : `Notifikasi WFA ${ev.userName} telah dikonfirmasi oleh Finance.`
        );
      } else if (ev.category === 'FLEXTIME' && ev.flextimeRecord) {
        const res = await api.decideFlextimeRequest(ev.flextimeRecord.id, {
          decision,
          notes: trimmedNotes,
          returnReason: decision === 'return' ? trimmedNotes : undefined,
        });
        onBundleChange(res.bundle);
        onShowToast(
          decision === 'approve'
            ? `Flextime ${ev.userName} berhasil disetujui & diaktifkan di kalender.`
            : decision === 'return'
            ? `Flextime ${ev.userName} dikembalikan untuk revisi.`
            : decision === 'review'
            ? `Catatan review strategis Direktur disimpan untuk Flextime ${ev.userName}.`
            : `Notifikasi Flextime ${ev.userName} telah dikonfirmasi oleh Finance.`
        );
      } else if (ev.category === 'LEAVE' && ev.leaveRecord) {
        const res = await api.decideLeaveRequest(ev.leaveRecord.id, {
          stage,
          decision,
          notes: trimmedNotes,
          returnReason: decision === 'return' ? trimmedNotes : undefined,
        });
        onBundleChange(res.bundle);
        onShowToast(
          decision === 'approve'
            ? `Pengajuan cuti/izin ${ev.userName} disetujui Finance & disinkronkan ke kalender.`
            : decision === 'return'
            ? `Pengajuan cuti/izin ${ev.userName} dikembalikan untuk revisi.`
            : decision === 'review'
            ? `Catatan review strategis Direktur atas cuti/izin ${ev.userName} berhasil disimpan.`
            : `Notifikasi cuti/izin Direktur telah dikonfirmasi oleh Finance.`
        );
      } else if (ev.category === 'HOLIDAY' && ev.holidayRecord) {
        const res = await api.decideHolidayRequest(ev.holidayRecord.id, {
          stage,
          decision,
          notes: trimmedNotes,
          returnReason: decision === 'return' ? trimmedNotes : undefined,
        });
        onBundleChange(res.bundle);
        onShowToast(
          decision === 'approve'
            ? `Hari Libur Bersama (${ev.subtitle}) disetujui & diperbarui di kalender.`
            : decision === 'return'
            ? `Usulan Hari Libur Bersama dikembalikan untuk revisi.`
            : decision === 'review'
            ? `Catatan review Direktur disimpan.`
            : `Informasi Hari Libur Bersama dikonfirmasi Finance.`
        );
      } else if (ev.category === 'ATTENDANCE' && ev.attendanceRecord) {
        const res = await api.reviewOutsideLocation({
          recordId: ev.attendanceRecord.id,
          stage,
          decision,
          notes: trimmedNotes,
        });
        onBundleChange(res.bundle);
        onShowToast('Tindak lanjut kehadiran luar lokasi berhasil disimpan.');
      }
      setSelectedEventModal(null);
    } catch (err: any) {
      onShowError(err.message || 'Gagal memproses tindakan.');
    } finally {
      setProcessingDecision(false);
    }
  };

  // Simpan pembaruan Timesheet Harian dari Modal Kalender
  const handleSaveModalTimesheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTimesheetDate || editingTimesheetItems.length === 0) return;
    setProcessingDecision(true);
    try {
      const res = await api.updateDailyTimesheet({
        date: editingTimesheetDate,
        timesheetItems: editingTimesheetItems.slice(0, 2).map((item) => ({
          id: item.id,
          category: item.category,
          shortDescription: item.shortDescription.trim() || item.category,
        })),
      });
      onBundleChange(res.bundle);
      onShowToast(`Timesheet tanggal ${editingTimesheetDate} berhasil diperbarui.`);
      setSelectedEventModal(null);
    } catch (err: any) {
      onShowError(err.message || 'Gagal memperbarui timesheet.');
    } finally {
      setProcessingDecision(false);
    }
  };

  const monthTitle = currentMonthDate.toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const dayModalEvents = useMemo(() => {
    if (!selectedDayModalDate) return [];
    return eventsByDateMap.get(selectedDayModalDate) || [];
  }, [selectedDayModalDate, eventsByDateMap]);

  return (
    <div className="space-y-2">
      {/* =================================================================== */}
      {/* HEADER UTAMA KALENDER: SINGLE-ROW NOTION TOOLBAR                    */}
      {/* =================================================================== */}
      <div className="bg-white border border-[#E6E5E0] rounded-lg px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Kiri: Switch My Personal Calendar (Default) vs General Team Calendar + Navigasi Bulan */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center bg-[#F4F3EF] p-0.5 rounded-md border border-[#E5E3DC]">
              <button
                type="button"
                onClick={() => setCalendarScope('PERSONAL')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  calendarScope === 'PERSONAL'
                    ? 'bg-white text-[#252525] font-semibold shadow-2xs border border-[#E2E0D8]'
                    : 'text-[#6B6A65] hover:text-[#252525]'
                }`}
              >
                <UserIcon className="w-3.5 h-3.5 text-[#5A5A58]" />
                <span>My Personal Calendar</span>
              </button>
              <button
                type="button"
                onClick={() => setCalendarScope('TEAM')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  calendarScope === 'TEAM'
                    ? 'bg-white text-[#252525] font-semibold shadow-2xs border border-[#E2E0D8]'
                    : 'text-[#6B6A65] hover:text-[#252525]'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-[#5A5A58]" />
                <span>General Team Calendar</span>
              </button>
            </div>

            {/* Navigasi Bulan */}
            <div className="inline-flex items-center gap-0.5 bg-[#FAF9F6] border border-[#E5E3DC] rounded-md px-1 py-0.5">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 rounded hover:bg-[#EFECE6] text-[#37352F] cursor-pointer"
                title="Bulan Sebelumnya"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-xs font-semibold text-[#252525] min-w-[116px] text-center whitespace-nowrap">
                {monthTitle}
              </span>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 rounded hover:bg-[#EFECE6] text-[#37352F] cursor-pointer"
                title="Bulan Berikutnya"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleJumpToday}
                className="ml-0.5 px-2 py-0.5 rounded bg-white hover:bg-[#F4F3EF] border border-[#DFDDD6] text-[11px] font-medium text-[#37352F] cursor-pointer whitespace-nowrap"
              >
                Hari Ini
              </button>
            </div>
          </div>

          {/* Kanan: Kontrol Ringkas Satu Baris (Notion Tone) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowFilterBar((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11.5px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                showFilterBar
                  ? 'bg-[#EFECE6] text-[#252525] border-[#D5D2C8] font-semibold'
                  : 'bg-white text-[#5A5A58] border-[#E5E3DC] hover:bg-[#FAF9F6]'
              }`}
              title="Tampilkan atau sembunyikan bar filter staf, kategori, dan status persetujuan"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#6B6A65]" />
              <span>{showFilterBar ? 'Hide Filter' : 'Filter'}</span>
              {monthSummaryStats.pendingApproval > 0 && !showFilterBar && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded bg-[#FAF3E6] text-[#9A5B13] border border-[#E8D5B5] text-[10px] font-semibold tabular-nums">
                  {monthSummaryStats.pendingApproval} Pending
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => openCreateRequestForDate(lockedTodayDate, 'WFA')}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#2F3437] hover:bg-[#1D2022] text-white text-[11.5px] font-medium cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ajukan di Kalender</span>
            </button>
          </div>
        </div>


        {/* ================================================================= */}
        {/* BAR FILTER & HIDE/SHOW KATEGORI (COLLAPSIBLE — DEFAULT HIDDEN)    */}
        {/* ================================================================= */}
        {showFilterBar && (
          <div className="pt-2.5 border-t border-[#EFEFED] flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            {/* Hide/Show Jenis Aktivitas (Clickable Category Toggles) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-[#6B6B68] mr-1 flex items-center gap-1">
                <Eye className="w-3 h-3" />
                <span>Tampilkan:</span>
              </span>
              {(
                [
                  ['WFA', monthSummaryStats.wfa],
                  ['FLEXTIME', monthSummaryStats.flextime],
                  ['LEAVE', monthSummaryStats.leave],
                  ['HOLIDAY', monthSummaryStats.holiday],
                ] as [CalendarEventCategory, number][]
              ).map(([cat, count]) => {
                const meta = CATEGORY_META[cat];
                const isOn = visibleCategories[cat];
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategoryVisibility(cat)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-semibold transition-all cursor-pointer ${
                      isOn
                        ? `${meta.badgeBg}`
                        : 'bg-[#F7F7F5] text-[#9A9996] border-[#E5E5E3] opacity-60 line-through'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${meta.dotClass}`} />
                    <span>{meta.shortLabel}</span>
                    <span className="px-1 py-0.2 rounded bg-white/80 text-[10px] font-mono">
                      {count}
                    </span>
                  </button>
                );
              })}

              {monthSummaryStats.pendingApproval > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedApprovalFilter((prev) =>
                      prev === 'PENDING' ? 'ALL' : 'PENDING'
                    )
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold cursor-pointer ${
                    selectedApprovalFilter === 'PENDING'
                      ? 'bg-amber-600 text-white border-amber-700'
                      : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                  }`}
                >
                  <AlertCircle className="w-3 h-3" />
                  <span>{monthSummaryStats.pendingApproval} Menunggu Approval</span>
                </button>
              )}
            </div>

            {/* Filter Staf, Status Persetujuan, & Pencarian */}
            <div className="flex flex-wrap items-center gap-2">
              {calendarScope === 'TEAM' && (
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-[#D9D9D6] rounded-md bg-white text-[#252525] font-medium"
                  aria-label="Filter Staf"
                >
                  <option value="ALL">Semua Staf ({activeStaffList.length})</option>
                  {activeStaffList.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.roleTitle})
                    </option>
                  ))}
                </select>
              )}

              <select
                value={selectedApprovalFilter}
                onChange={(e) => setSelectedApprovalFilter(e.target.value as any)}
                className="px-2.5 py-1 text-xs border border-[#D9D9D6] rounded-md bg-white text-[#252525] font-medium"
                aria-label="Filter Status Approval"
              >
                <option value="ALL">Status: Disetujui & Pending</option>
                <option value="APPROVED">Disetujui / Aktif</option>
                <option value="PENDING">Menunggu Approval HR/Director</option>
                <option value="REJECTED">Ditolak</option>
              </select>

              <select
                value={compactMaxLanes}
                onChange={(e) => setCompactMaxLanes(Number(e.target.value))}
                className="px-2 py-1 text-xs border border-[#D9D9D6] rounded-md bg-white text-[#252525]"
                title="Jumlah baris event yang ditampilkan sebelum +N More"
              >
                <option value={3}>Ringkas (Maks 3 Baris/Hari)</option>
                <option value={4}>Proporsional (Maks 4 Baris/Hari)</option>
                <option value={6}>Detail (Maks 6 Baris/Hari)</option>
                <option value={8}>Lengkap (Maks 8 Baris/Hari)</option>
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#9A9996] absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari staf / aktivitas..."
                  className="pl-7 pr-2.5 py-1 text-xs border border-[#D9D9D6] rounded-md bg-white w-36 sm:w-44"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* GRID KALENDER INTERAKTIF (PROPORSIONAL, BEBAS NUMPUK, +N MORE RAPI) */}
      {/* =================================================================== */}
      {isCalendarVisible && (
        <div className="bg-white border border-[#E5E5E3] rounded-xl overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              {/* Header Hari (Senin s/d Minggu) */}
              <div className="grid grid-cols-7 bg-[#F7F7F5] border-b border-[#E5E5E3]">
                {DAY_NAMES_SHORT.map((dayName, idx) => (
                  <div
                    key={dayName}
                    className={`py-2.5 px-3 text-[11px] font-bold uppercase tracking-wider text-center border-r last:border-r-0 border-[#E5E5E3] ${
                      idx >= 5 ? 'text-[#8E8D8A] bg-[#F3F3F1]' : 'text-[#4B4B48]'
                    }`}
                  >
                    {dayName}
                  </div>
                ))}
              </div>

              {/* Baris-Baris Minggu (Normal Vertical Flow — Tidak Akan Pernah Numpuk) */}
              <div className="divide-y divide-[#E5E5E3]">
                {weekSegmentsLayout.map((weekData, weekIdx) => {
                  const { week, visibleSegments, hiddenCountPerCol } = weekData;
                  const maxUsedLane =
                    visibleSegments.length > 0
                      ? Math.max(...visibleSegments.map((s) => s.lane)) + 1
                      : 0;
                  const lanesToRender = Array.from(
                    { length: Math.min(compactMaxLanes, Math.max(3, maxUsedLane)) },
                    (_, i) => i
                  );
                  const hasAnyHiddenInWeek = hiddenCountPerCol.some((c) => c > 0);

                  return (
                    <div
                      key={week[0].dateStr || weekIdx}
                      className="relative min-h-[168px] flex flex-col justify-between select-none"
                    >
                      {/* Lapisan Background 7 Kolom (Garis Batas Vertikal & Klik Sel Tanggal) */}
                      <div className="absolute inset-0 grid grid-cols-7">
                        {week.map((day) => {
                          const isToday = day.dateStr === lockedTodayDate;
                          return (
                            <div
                              key={day.dateStr}
                              onClick={() => setSelectedDayModalDate(day.dateStr)}
                              className={`h-full border-r last:border-r-0 border-[#E5E5E3] transition-colors cursor-pointer ${
                                !day.isCurrentMonth
                                  ? 'bg-[#F8F8F7] text-[#A0A09C]'
                                  : isToday
                                  ? 'bg-blue-50/20 hover:bg-blue-50/35'
                                  : day.isWeekend
                                  ? 'bg-[#FCFCFB] hover:bg-[#F7F7F5]'
                                  : 'bg-white hover:bg-[#FAFAF9]'
                              }`}
                            />
                          );
                        })}
                      </div>

                      {/* Bagian Atas: Baris Nomor Tanggal & Tombol Cepat '+' */}
                      <div className="relative z-10 grid grid-cols-7 pointer-events-none">
                        {week.map((day) => {
                          const isToday = day.dateStr === lockedTodayDate;
                          const totalDayEvents = (
                            eventsByDateMap.get(day.dateStr) || []
                          ).length;

                          return (
                            <div
                              key={day.dateStr}
                              className="flex items-center justify-between px-2.5 pt-2 pb-1"
                            >
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedDayModalDate(day.dateStr)}
                                  className={`pointer-events-auto inline-flex items-center justify-center text-xs font-bold rounded-full transition-colors cursor-pointer ${
                                    isToday
                                      ? 'w-6 h-6 bg-[#2563EB] text-white shadow-2xs'
                                      : day.isCurrentMonth
                                      ? 'text-[#1F2937] hover:text-[#2563EB]'
                                      : 'text-[#A0A09C]'
                                  }`}
                                >
                                  {day.dayNumber}
                                </button>
                                {isToday && (
                                  <span className="text-[10.5px] font-bold text-[#2563EB] hidden sm:inline">
                                    Hari Ini
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1">
                                {totalDayEvents > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedDayModalDate(day.dateStr)}
                                    className="pointer-events-auto text-[10px] font-mono font-semibold text-[#5F5E5B] hover:text-[#171717] px-1.5 py-0.2 rounded bg-[#F1F1EF] hover:bg-[#E5E5E2] cursor-pointer"
                                    title={`${totalDayEvents} aktivitas pada tanggal ini (Klik untuk lihat semua)`}
                                  >
                                    {totalDayEvents}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openCreateRequestForDate(day.dateStr, 'WFA');
                                  }}
                                  className="pointer-events-auto p-1 rounded hover:bg-blue-50 text-[#8E8D8A] hover:text-[#2563EB] transition-colors cursor-pointer"
                                  title={`Ajukan WFA / Flextime / Cuti / Holiday pada ${day.dateStr}`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Bagian Tengah: Jalur (Lanes) Event Single-Day & Continuous Multi-Day Horizontal Bars */}
                      <div className="relative z-10 flex flex-col gap-1.5 px-1.5 py-1.5 pointer-events-none flex-1">
                        {lanesToRender.map((laneIdx) => {
                          const laneSegs = visibleSegments
                            .filter((s) => s.lane === laneIdx)
                            .sort((a, b) => a.startCol - b.startCol);

                          return (
                            <div
                              key={laneIdx}
                              className="grid grid-cols-7 gap-x-1.5 min-h-[26px] items-center"
                            >
                              {laneSegs.map((seg) => {
                                const { event: ev } = seg;
                                const meta = CATEGORY_META[ev.category];
                                const isPending = ev.approvalState === 'PENDING';
                                const isRejected = ev.approvalState === 'REJECTED';

                                const roundedClass =
                                  seg.continuesLeft && seg.continuesRight
                                    ? 'rounded-none border-x-0'
                                    : seg.continuesLeft
                                    ? 'rounded-r-md rounded-l-none border-l-0'
                                    : seg.continuesRight
                                    ? 'rounded-l-md rounded-r-none border-r-0'
                                    : 'rounded-md';

                                return (
                                  <button
                                    key={`${ev.id}-w${weekIdx}-c${seg.startCol}`}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEventDetailModal(ev);
                                    }}
                                    style={{
                                      gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                                      gridRow: 1,
                                    }}
                                    title={`${ev.userName} — ${meta.label}\n${
                                      ev.startDate === ev.endDate
                                        ? ev.startDate
                                        : `${ev.startDate} s/d ${ev.endDate}`
                                    }\nStatus: ${ev.statusLabel}\n${ev.subtitle}`}
                                    className={`pointer-events-auto h-[26px] w-full px-2 text-left flex items-center justify-between gap-1.5 border text-[11.5px] leading-none transition-all cursor-pointer overflow-hidden shadow-2xs ${
                                      meta.bgClass
                                    } ${meta.textClass} ${meta.borderClass} ${roundedClass} ${
                                      isPending ? 'border-dashed ring-1 ring-amber-400/70' : ''
                                    } ${isRejected ? 'opacity-55 line-through' : ''}`}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                                      {!seg.continuesLeft && (
                                        <span
                                          className={`w-1.5 h-3.5 rounded-xs shrink-0 ${meta.accentClass}`}
                                        />
                                      )}
                                      {seg.continuesLeft && (
                                        <span className="text-[9px] font-bold opacity-75 shrink-0">
                                          ◀
                                        </span>
                                      )}
                                      <span className="font-semibold truncate">
                                        {ev.title}
                                      </span>
                                      {seg.span > 1 && (
                                        <span className="text-[10.5px] opacity-85 truncate hidden sm:inline">
                                          — {ev.subtitle}
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                      {isPending && (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-200/95 text-amber-950 text-[9px] font-bold uppercase tracking-tight">
                                          Pending
                                        </span>
                                      )}
                                      {seg.continuesRight && (
                                        <span className="text-[9px] font-bold opacity-75">
                                          ▶
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>

                      {/* Bagian Bawah: Indikator "+N More" pada setiap kotak tanggal (Normal Flow, Tidak Numpuk) */}
                      {hasAnyHiddenInWeek && (
                        <div className="relative z-10 grid grid-cols-7 gap-x-1.5 px-1.5 pt-1 pb-2.5 mt-auto pointer-events-none">
                          {week.map((day, colIdx) => {
                            const hiddenCount = hiddenCountPerCol[colIdx];
                            if (hiddenCount <= 0) {
                              return <div key={day.dateStr} />;
                            }
                            return (
                              <div key={day.dateStr}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDayModalDate(day.dateStr);
                                  }}
                                  className="pointer-events-auto w-full py-1 px-2 rounded-md bg-[#F1F0EC] hover:bg-[#E4E3DD] border border-[#DEDCD6] text-[#1F2937] text-[10.5px] font-bold text-left flex items-center justify-between transition-colors cursor-pointer shadow-2xs"
                                >
                                  <span>+{hiddenCount} More</span>
                                  <span className="text-[9.5px] font-medium text-[#6B6A65]">
                                    Lihat semua
                                  </span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 1: SELURUH AKTIVITAS PADA TANGGAL TERTENTU (+N MORE / KLIK)   */}
      {/* =================================================================== */}
      {selectedDayModalDate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-xl max-w-2xl w-full shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[#171717]">
                  Aktivitas Tim — {formatDateIdFull(selectedDayModalDate)}
                </h3>
                <p className="text-[11px] text-[#6B6B68]">
                  Menampilkan seluruh {dayModalEvents.length} aktivitas staf pada tanggal ini
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const targetDate = selectedDayModalDate;
                    setSelectedDayModalDate(null);
                    openCreateRequestForDate(targetDate, 'WFA');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Ajukan di Tanggal Ini</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDayModalDate(null)}
                  className="p-1 text-[#6B6B68] hover:text-[#171717] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2">
              {dayModalEvents.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#6B6B68] space-y-2">
                  <p>Belum ada aktivitas tercatat pada tanggal ini.</p>
                  <button
                    type="button"
                    onClick={() => {
                      const targetDate = selectedDayModalDate;
                      setSelectedDayModalDate(null);
                      openCreateRequestForDate(targetDate, 'WFA');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1D4ED8] border border-blue-200 text-xs font-semibold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah WFA / Flextime / Cuti / Holiday</span>
                  </button>
                </div>
              ) : (
                dayModalEvents.map((ev) => {
                  const meta = CATEGORY_META[ev.category];
                  return (
                    <div
                      key={ev.id}
                      onClick={() => {
                        setSelectedDayModalDate(null);
                        openEventDetailModal(ev);
                      }}
                      className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${meta.bgClass} ${meta.borderClass}`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${meta.badgeBg}`}
                          >
                            {meta.label}
                          </span>
                          <span className="text-xs font-bold text-[#171717]">
                            {ev.userName}
                          </span>
                          <span className="text-[11px] text-[#6B6B68]">
                            ({ev.userRoleTitle})
                          </span>
                          {ev.isMultiDay && (
                            <span className="px-1.5 py-0.5 rounded bg-white/80 border border-[#D9D9D6] text-[10px] font-mono text-[#37352F]">
                              {ev.startDate} s/d {ev.endDate} ({ev.totalDays} hari)
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-[#252525]">
                          {ev.subtitle}
                        </div>
                        <div className="text-[11px] text-[#5A5A58] line-clamp-2">
                          {ev.description}
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-end justify-between gap-1.5 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${
                            ev.approvalState === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : ev.approvalState === 'PENDING'
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}
                        >
                          {ev.statusLabel}
                        </span>
                        <span className="text-[11px] font-semibold text-[#2563EB] hover:underline">
                          Detail & Approval →
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: DETAIL EVENT, APPROVAL HR/DIRECTOR, & EDIT TIMESHEET       */}
      {/* =================================================================== */}
      {selectedEventModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-xl max-w-lg w-full shadow-xl overflow-hidden flex flex-col max-h-[88vh]">
            {(() => {
              const ev = selectedEventModal;
              const meta = CATEGORY_META[ev.category];
              const canHrApprove =
                isHR &&
                !isDirector &&
                ev.needsHrAction &&
                (ev.category === 'WFA' ||
                  ev.category === 'FLEXTIME' ||
                  ev.category === 'LEAVE' ||
                  ev.category === 'HOLIDAY' ||
                  ev.category === 'ATTENDANCE');
              const canDirectorApprove =
                isDirector &&
                ev.needsDirectorAction &&
                (ev.category === 'LEAVE' ||
                  ev.category === 'WFA' ||
                  ev.category === 'FLEXTIME' ||
                  ev.category === 'HOLIDAY' ||
                  ev.category === 'ATTENDANCE');

              const isDirectorNotifyFlow =
                ev.statusLabel === 'Notified to Finance' ||
                ev.statusLabel === 'Acknowledged by Finance' ||
                ev.userId === 'user-director';
              const isFinanceReviewFlow =
                ev.statusLabel === 'Submitted for Review' ||
                ev.statusLabel === 'Reviewed by Director' ||
                ev.userId === 'user-hr';

              const isOwner = currentUser?.id === ev.userId;
              const canEditTimesheetHere =
                isOwner &&
                (ev.category === 'ATTENDANCE' ||
                  (ev.category === 'WFA' && ev.approvalState === 'APPROVED'));

              return (
                <>
                  <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold border ${meta.badgeBg}`}
                      >
                        {meta.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                          ev.approvalState === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : ev.approvalState === 'PENDING'
                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                      >
                        {ev.statusLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedEventModal(null)}
                      className="p-1 text-[#6B6B68] hover:text-[#171717] cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-4 overflow-y-auto space-y-3.5 text-xs">
                    {/* Informasi Staf & Rentang Tanggal */}
                    <div className="p-3 rounded-lg bg-[#F7F7F5] border border-[#E5E5E3] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-[#171717]">
                            {ev.userName}
                          </div>
                          <div className="text-[11px] text-[#6B6B68]">
                            {ev.userRoleTitle} • {ev.department}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold text-[#171717]">
                            {ev.startDate === ev.endDate
                              ? formatDateIdShort(ev.startDate)
                              : `${formatDateIdShort(ev.startDate)} – ${formatDateIdShort(
                                  ev.endDate
                                )}`}
                          </div>
                          <div className="text-[11px] text-[#6B6B68]">
                            {ev.totalDays} Hari Kerja
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Detail Aktivitas */}
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-[#6B6B68] uppercase">
                        Ringkasan Aktivitas / Pengaturan
                      </span>
                      <div className="font-bold text-[#171717] text-xs">
                        {ev.subtitle}
                      </div>
                      <p className="text-[#37352F] leading-relaxed bg-[#FAFAF9] p-2.5 rounded border border-[#E5E5E3]">
                        {ev.description}
                      </p>
                    </div>

                    {/* Detail Jam Clock In/Out jika Attendance */}
                    {ev.attendanceRecord && (
                      <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-blue-50/60 border border-blue-200">
                        <div>
                          <span className="text-[10px] text-[#6B6B68] block">
                            Clock In
                          </span>
                          <span className="font-mono font-bold text-[#171717]">
                            {formatClockHHMM(ev.attendanceRecord.clockInTime)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#6B6B68] block">
                            Clock Out
                          </span>
                          <span className="font-mono font-bold text-[#171717]">
                            {formatClockHHMM(ev.attendanceRecord.clockOutTime)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#6B6B68] block">
                            Total Jam Kerja
                          </span>
                          <span className="font-mono font-bold text-[#1D4ED8]">
                            {ev.attendanceRecord.totalWorkHours} Jam
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Form Edit Timesheet Harian langsung dari Kalender (Untuk Pemilik pada Hari Kerja / WFA) */}
                    {canEditTimesheetHere && (
                      <form
                        onSubmit={handleSaveModalTimesheet}
                        className="p-3 rounded-lg bg-[#FAFAF9] border border-[#E5E5E3] space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#171717]">
                            Kontribusi Timesheet Harian ({editingTimesheetDate})
                          </span>
                          {ev.isMultiDay && ev.wfaRecord && (
                            <input
                              type="date"
                              min={ev.startDate}
                              max={ev.endDate}
                              value={editingTimesheetDate}
                              onChange={(e) => setEditingTimesheetDate(e.target.value)}
                              className="px-2 py-0.5 text-[11px] border border-[#D9D9D6] rounded bg-white"
                            />
                          )}
                        </div>
                        {editingTimesheetItems.map((item, idx) => (
                          <div key={idx} className="space-y-1">
                            <select
                              value={item.category}
                              onChange={(e) => {
                                const next = [...editingTimesheetItems];
                                next[idx] = {
                                  ...next[idx],
                                  category: e.target.value as WijnaWorkCategory,
                                };
                                setEditingTimesheetItems(next);
                              }}
                              className="w-full px-2 py-1 text-xs border border-[#D9D9D6] rounded bg-white font-semibold"
                            >
                              {WORK_CATEGORIES_SPEC.map((spec) => (
                                <option key={spec.category} value={spec.category}>
                                  {spec.category}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={item.shortDescription}
                              onChange={(e) => {
                                const next = [...editingTimesheetItems];
                                next[idx] = {
                                  ...next[idx],
                                  shortDescription: e.target.value,
                                };
                                setEditingTimesheetItems(next);
                              }}
                              placeholder="Deskripsi singkat kontribusi..."
                              className="w-full px-2 py-1 text-xs border border-[#D9D9D6] rounded bg-white"
                            />
                          </div>
                        ))}
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={processingDecision}
                            className="px-3 py-1 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
                          >
                            Simpan Timesheet
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Panel Tindakan Berdasarkan Alur Peran (Employee->Finance, Finance->Director, Director->Finance) */}
                    {(canHrApprove || canDirectorApprove) && (
                      <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 space-y-2.5">
                        <div className="font-bold text-amber-950 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-amber-700" />
                          <span>
                            {canDirectorApprove
                              ? 'Review & Masukan Strategis Direktur (Tanpa Approval/Return)'
                              : isDirectorNotifyFlow
                              ? 'Pencatatan & Konfirmasi Informasi Direktur (Tanpa Approval)'
                              : 'Keputusan Persetujuan / Pengembalian Finance (Employee → Finance)'}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={decisionNotes}
                          onChange={(e) => setDecisionNotes(e.target.value)}
                          placeholder={
                            canDirectorApprove
                              ? 'Tuliskan rekomendasi atau masukan strategis Direktur...'
                              : isDirectorNotifyFlow
                              ? 'Catatan administrasi Finance (opsional)...'
                              : 'Catatan Finance (wajib diisi jika dikembalikan / Return)...'
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white"
                        />
                        <div className="flex items-center gap-2">
                          {canDirectorApprove ? (
                            <button
                              type="button"
                              disabled={processingDecision}
                              onClick={() =>
                                handleEventApprovalAction(ev, 'review', 'director')
                              }
                              className="flex-1 py-1.5 px-3 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Simpan Catatan Review Strategis</span>
                            </button>
                          ) : isDirectorNotifyFlow ? (
                            <button
                              type="button"
                              disabled={processingDecision}
                              onClick={() =>
                                handleEventApprovalAction(ev, 'acknowledge', 'hr')
                              }
                              className="flex-1 py-1.5 px-3 rounded bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Konfirmasi Terima Informasi (Acknowledge)</span>
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={processingDecision}
                                onClick={() =>
                                  handleEventApprovalAction(ev, 'approve', 'hr')
                                }
                                className="flex-1 py-1.5 px-3 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approve & Sinkronkan Kalender</span>
                              </button>
                              <button
                                type="button"
                                disabled={processingDecision}
                                onClick={() =>
                                  handleEventApprovalAction(ev, 'return', 'hr')
                                }
                                className="py-1.5 px-3 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Kembalikan (Return)</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: PENGAJUAN AKTIVITAS LANGSUNG DARI KALENDER                 */}
      {/* (WFA, FLEXTIME, CUTI/IZIN, & PERSONAL HOLIDAY — SINGLE/MULTI-DAY)   */}
      {/* =================================================================== */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E3] rounded-xl max-w-lg w-full shadow-xl overflow-hidden">
            <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#171717]">
                  Ajukan Jadwal & Aktivitas Kalender
                </h3>
                <p className="text-[11px] text-[#6B6B68]">
                  Terintegrasi otomatis dengan Approval HR/Finance, Kalender Tim, & Timesheet
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRequestModal(false)}
                className="p-1 text-[#6B6B68] hover:text-[#171717] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCalendarRequestSubmit} className="p-4 space-y-3 text-xs">
              {/* Pilihan Jenis Pengajuan */}
              <div>
                <label className="block font-semibold text-[#37352F] mb-1.5">
                  Pilih Jenis Pengajuan
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {(
                    [
                      ['WFA', 'WFA', Home],
                      ['FLEXTIME', 'Flextime', Clock],
                      ['LEAVE', 'Cuti / Izin', HeartHandshake],
                      ['HOLIDAY', 'Libur Bersama', Palmtree],
                    ] as const
                  ).map(([code, label, IconComp]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setReqType(code)}
                      className={`py-2 px-2 rounded-lg border font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        reqType === code
                          ? 'bg-blue-50 border-[#2563EB] text-[#1D4ED8] ring-1 ring-[#2563EB]'
                          : 'bg-[#FAFAF9] border-[#E5E5E3] text-[#5A5A58] hover:bg-[#F4F4F2]'
                      }`}
                    >
                      <IconComp className="w-4 h-4" />
                      <span className="text-[11px]">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Jika HR/Finance, dapat memilih staf untuk penugasan WFA/Flextime */}
              {isHR && reqType !== 'LEAVE' && reqType !== 'HOLIDAY' && (
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Staf
                  </label>
                  <select
                    value={reqTargetUserId}
                    onChange={(e) => setReqTargetUserId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white"
                  >
                    {activeStaffList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.roleTitle})
                        {u.id === currentUser?.id ? ' — Saya' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Rentang Tanggal (Mendukung 1 Hari maupun Multi-Day) */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Tanggal Mulai
                  </label>
                  <input
                    type="date"
                    required
                    value={reqStartDate}
                    onChange={(e) => {
                      setReqStartDate(e.target.value);
                      if (reqEndDate < e.target.value) {
                        setReqEndDate(e.target.value);
                      }
                    }}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Tanggal Selesai (Multi-Day)
                  </label>
                  <input
                    type="date"
                    required
                    min={reqStartDate}
                    value={reqEndDate}
                    onChange={(e) => setReqEndDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white"
                  />
                </div>
              </div>

              <div className="px-2.5 py-1.5 rounded bg-[#F7F7F5] border border-[#E5E5E3] flex items-center justify-between text-[11px] text-[#5A5A58]">
                <span>Perhitungan Hari Kerja Efektif (Senin–Jumat):</span>
                <span className="font-bold text-[#171717]">
                  {countWorkingDaysClient(reqStartDate, reqEndDate)} Hari Kerja
                </span>
              </div>

              {/* Field Spesifik Kategori */}
              {reqType === 'LEAVE' && (
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Kategori Cuti / Izin
                  </label>
                  <select
                    value={reqLeaveCategoryId}
                    onChange={(e) => setReqLeaveCategoryId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white"
                  >
                    {(bundle.leavePolicies || []).map((pol) => (
                      <option key={pol.id} value={pol.id}>
                        [{pol.code}] {pol.name} (Kuota: {pol.allocationDaysPerYear} hari/thn)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {reqType === 'FLEXTIME' && (
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Pengaturan Jam Kerja Flextime
                  </label>
                  <select
                    value={reqFlexSchedule}
                    onChange={(e) => setReqFlexSchedule(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white"
                  >
                    <option value="Jam Masuk Pagi 07:00–15:00 WIB (8 Jam Kerja/Hari)">
                      Jam Masuk Pagi 07:00–15:00 WIB (8 Jam Kerja/Hari)
                    </option>
                    <option value="Jam Masuk Fleksibel 07:30–10:00 WIB (8 Jam Kerja/Hari)">
                      Jam Masuk Fleksibel 07:30–10:00 WIB (8 Jam Kerja/Hari)
                    </option>
                    <option value="Jam Kerja Siang 09:30–17:30 WIB (Pasca Perjalanan Dinas)">
                      Jam Kerja Siang 09:30–17:30 WIB (Pasca Perjalanan Dinas)
                    </option>
                    <option value="Jam Kerja Sore 10:00–18:00 WIB (Koordinasi Mitra)">
                      Jam Kerja Sore 10:00–18:00 WIB (Koordinasi Mitra)
                    </option>
                  </select>
                </div>
              )}

              {reqType === 'HOLIDAY' && (
                <div>
                  <label className="block font-medium text-[#37352F] mb-1">
                    Nama Hari Libur Bersama / Nasional (Berlaku untuk Seluruh Tim)
                  </label>
                  <input
                    type="text"
                    required
                    value={reqHolidayTitle}
                    onChange={(e) => setReqHolidayTitle(e.target.value)}
                    placeholder="Contoh: Hari Libur Bersama — Libur Nasional / Cuti Bersama Organisasi"
                    className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white"
                  />
                </div>
              )}

              {reqType === 'WFA' && (
                <div className="space-y-2.5">
                  <div className="px-2.5 py-1.5 rounded bg-blue-50/70 border border-blue-200 text-[11px] text-[#1E3A8A]">
                    Opsi implementasi ini disusun berdasarkan jenis kegiatan dalam{' '}
                    <strong>Terms of Reference (ToR)</strong> yang telah diajukan oleh{' '}
                    <strong>{effectiveModalTargetUser?.name}</strong> dan memperoleh persetujuan dari pihak yang berwenang, ditambah{' '}
                    <strong>Opsi Lainnya</strong>. Anda juga dapat mengajak staf lain.
                  </div>
                  <div>
                    <label className="block font-medium text-[#37352F] mb-1">
                      Opsi Implementasi Kegiatan (Dari ToR Disetujui Pengguna)
                    </label>
                    <select
                      value={reqWfaSelectedOptionValue}
                      onChange={(e) => setReqWfaSelectedOptionValue(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white font-medium"
                    >
                      {modalApprovedTorOptions.length > 0 && (
                        <optgroup
                          label={`Kegiatan ToR Disetujui — ${
                            effectiveModalTargetUser?.name || 'Pengguna'
                          }`}
                        >
                          {modalApprovedTorOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Opsi Lainnya">
                        <option value="__LAINNYA__">
                          Lainnya — Tuliskan Rencana Kontribusi Pekerjaan WFA Manual
                        </option>
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-[#37352F] mb-1">
                      Ajak Staf Lain Berkolaborasi dalam WFA Ini (Opsional)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {activeStaffList
                        .filter((u) => u.id !== effectiveModalTargetUser?.id)
                        .map((colleague) => {
                          const selected = reqWfaInvitedUserIds.includes(colleague.id);
                          return (
                            <button
                              key={colleague.id}
                              type="button"
                              onClick={() =>
                                setReqWfaInvitedUserIds((prev) =>
                                  prev.includes(colleague.id)
                                    ? prev.filter((id) => id !== colleague.id)
                                    : [...prev, colleague.id]
                                )
                              }
                              className={`px-2 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
                                selected
                                  ? 'bg-teal-50 text-teal-900 border-teal-400 font-semibold'
                                  : 'bg-[#FAFAF9] text-[#5A5A58] border-[#E5E5E3] hover:bg-[#F3F4F6]'
                              }`}
                            >
                              {colleague.name}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-medium text-[#37352F] mb-1">
                  {reqType === 'WFA'
                    ? reqWfaSelectedOptionValue === '__LAINNYA__' ||
                      modalApprovedTorOptions.length === 0
                      ? 'Rencana Kontribusi Pekerjaan Selama WFA (Opsi Lainnya — Wajib)'
                      : 'Catatan Tambahan Pelaksanaan Implementasi ToR (Opsional)'
                    : 'Alasan / Keterangan Pengajuan'}
                </label>
                <textarea
                  rows={2}
                  required={
                    reqType !== 'WFA' ||
                    reqWfaSelectedOptionValue === '__LAINNYA__' ||
                    modalApprovedTorOptions.length === 0
                  }
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  placeholder={
                    reqType === 'WFA'
                      ? 'Tuliskan fokus rencana kerja harian selama WFA...'
                      : 'Tuliskan keterangan singkat pengajuan...'
                  }
                  className="w-full px-2.5 py-1.5 border border-[#D9D9D6] rounded-md bg-white"
                />
              </div>

              <div className="pt-2 border-t border-[#EFEFED] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="px-3 py-1.5 rounded-md border border-[#D9D9D6] text-[#37352F] hover:bg-[#F4F4F2] font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingRequest}
                  className="px-4 py-1.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold cursor-pointer"
                >
                  {submittingRequest
                    ? 'Mengirim...'
                    : isDirector
                    ? 'Notify for Information (ke Finance)'
                    : isHR
                    ? 'Submit for Review (ke Direktur)'
                    : 'Submit for Approval (ke Finance)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
