import type {
  AttendanceSystemBundle,
  AttendanceWorkflowType,
  WijnaLocationConfig,
  LeaveCategoryPolicy,
} from '../types/index.ts';

/**
 * Menentukan alur kerja kehadiran (WFA, Cuti, Izin, Flextime, Kehadiran) berdasarkan peran pengguna:
 * 1. Employee -> Finance: EMPLOYEE_TO_FINANCE_APPROVAL (Submit for Approval)
 * 2. Finance -> Director: FINANCE_TO_DIRECTOR_REVIEW (Submit for Review & Strategic Input)
 * 3. Director -> Finance: DIRECTOR_TO_FINANCE_NOTIFY (Notify for Information & Record-Keeping)
 */
export function resolveAttendanceWorkflowType(
  userId?: string,
  userRole?: string,
  userRoleTitle?: string
): AttendanceWorkflowType {
  const uid = String(userId || '').toLowerCase();
  const role = String(userRole || '').toLowerCase();
  const title = String(userRoleTitle || '').toLowerCase();

  if (
    uid === 'user-director' ||
    role === 'director' ||
    title.includes('director') ||
    title.includes('direktur')
  ) {
    return 'DIRECTOR_TO_FINANCE_NOTIFY';
  }
  if (
    uid === 'user-finance' ||
    role === 'finance' ||
    role === 'hr' ||
    title.includes('finance') ||
    title.includes('hr manager')
  ) {
    return 'FINANCE_TO_DIRECTOR_REVIEW';
  }
  return 'EMPLOYEE_TO_FINANCE_APPROVAL';
}

export function normalizeAttendanceStatusByWorkflow(
  rawStatus: string | undefined,
  workflowType: AttendanceWorkflowType,
  options?: {
    hasDirectorReview?: boolean;
    hasFinanceAck?: boolean;
    isActive?: boolean;
  }
):
  | 'Pending'
  | 'Approved'
  | 'Returned'
  | 'Submitted for Review'
  | 'Reviewed by Director'
  | 'Notified to Finance'
  | 'Acknowledged by Finance' {
  const s = String(rawStatus || '').trim();

  if (workflowType === 'DIRECTOR_TO_FINANCE_NOTIFY') {
    if (s === 'Acknowledged by Finance' || options?.hasFinanceAck) {
      return 'Acknowledged by Finance';
    }
    return 'Notified to Finance';
  }

  if (workflowType === 'FINANCE_TO_DIRECTOR_REVIEW') {
    if (s === 'Reviewed by Director' || options?.hasDirectorReview) {
      return 'Reviewed by Director';
    }
    return 'Submitted for Review';
  }

  // EMPLOYEE_TO_FINANCE_APPROVAL
  if (s === 'Returned' || s === 'Ditolak' || s === 'Ditolak HR') {
    return 'Returned';
  }
  if (
    s === 'Approved' ||
    s === 'Disetujui HR' ||
    s === 'Disetujui Director' ||
    (!s && options?.isActive)
  ) {
    return 'Approved';
  }
  return 'Pending';
}

export function isAttendanceArrangementActiveOnCalendar(
  status: string | undefined,
  workflowType?: AttendanceWorkflowType
): boolean {
  const s = String(status || '').trim();
  if (workflowType === 'DIRECTOR_TO_FINANCE_NOTIFY') {
    return s === 'Notified to Finance' || s === 'Acknowledged by Finance' || s === 'Approved';
  }
  if (workflowType === 'FINANCE_TO_DIRECTOR_REVIEW') {
    return (
      s === 'Submitted for Review' ||
      s === 'Reviewed by Director' ||
      s === 'Approved' ||
      s === 'Disetujui HR' ||
      s === 'Disetujui Director'
    );
  }
  return s === 'Approved' || s === 'Disetujui HR' || s === 'Disetujui Director';
}

export const DEFAULT_WIJNA_LOCATION_CONFIG: WijnaLocationConfig = {
  officeName: 'Kantor Pusat Yayasan WIJNA',
  address: 'Kantor WIJNA (-7.342604, 110.489848)',
  latitude: -7.342604,
  longitude: 110.489848,
  radiusMeters: 5,
  standardDailyHours: 8,
  updatedByName: 'Ratna Kusuma, S.E. (Finance & HR)',
  updatedAt: '2026-11-01T08:00:00Z',
};

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
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
}

export function calculateWorkHoursBetween(clockInIso: string, clockOutIso: string): number {
  const start = new Date(clockInIso).getTime();
  const end = new Date(clockOutIso).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  const diffHours = (end - start) / (1000 * 60 * 60);
  return Math.round(diffHours * 100) / 100;
}

/**
 * Mengembalikan daftar tanggal YYYY-MM-DD dari startDate hingga endDate (inklusif).
 * Jika workingDaysOnly = true, hari Sabtu (6) dan Minggu (0) dilewati kecuali rentangnya hanya jatuh di akhir pekan.
 */
export function enumerateDatesBetween(
  startDate: string,
  endDate: string,
  workingDaysOnly = false
): string[] {
  const startStr = String(startDate || '').slice(0, 10);
  const endStr = String(endDate || startStr).slice(0, 10);
  if (!startStr) return [];
  const s = new Date(`${startStr}T00:00:00Z`);
  const e = new Date(`${endStr}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) {
    return [startStr];
  }
  const allDates: string[] = [];
  const weekdayDates: string[] = [];
  const cur = new Date(s);
  let safety = 0;
  while (cur <= e && safety < 366) {
    const iso = cur.toISOString().slice(0, 10);
    allDates.push(iso);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      weekdayDates.push(iso);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
    safety++;
  }
  if (workingDaysOnly && weekdayDates.length > 0) {
    return weekdayDates;
  }
  return allDates;
}

export function calculateWorkingDaysBetween(startDate: string, endDate: string): number {
  const dates = enumerateDatesBetween(startDate, endDate, true);
  return Math.max(1, dates.length);
}

export function createInitialAttendanceSystem(): AttendanceSystemBundle {
  const leavePolicies: LeaveCategoryPolicy[] = [
    {
      id: 'leave-pol-sick-1',
      code: 'CS-RJ',
      name: 'Cuti Sakit Rawat Jalan',
      group: 'CUTI_SAKIT',
      allocationDaysPerYear: 12,
      requiresAttachmentOrNote: true,
      termsAndProvisions:
        'Maksimal 2 hari berturut-turut cukup dengan keterangan staf; >2 hari wajib melampirkan surat keterangan dokter.',
      isActive: true,
      updatedByName: 'Ratna Kusuma, S.E. (Finance & HR)',
      updatedAt: '2026-01-10T08:00:00Z',
    },
    {
      id: 'leave-pol-sick-2',
      code: 'CS-RI',
      name: 'Cuti Sakit Rawat Inap / Pemulihan Medis',
      group: 'CUTI_SAKIT',
      allocationDaysPerYear: 30,
      requiresAttachmentOrNote: true,
      termsAndProvisions:
        'Berdasarkan surat rujukan rumah sakit/dokter dan diketahui oleh Finance/HR serta disetujui Director.',
      isActive: true,
      updatedByName: 'Ratna Kusuma, S.E. (Finance & HR)',
      updatedAt: '2026-01-10T08:00:00Z',
    },
    {
      id: 'leave-pol-spec-1',
      code: 'CK-KLG',
      name: 'Cuti Khusus Pernikahan / Kelahiran / Kedukaan',
      group: 'CUTI_KHUSUS',
      allocationDaysPerYear: 5,
      requiresAttachmentOrNote: true,
      termsAndProvisions:
        'Cuti khusus di luar kuota cuti tahunan untuk pernikahan staf (3 hari), pendampingan persalinan (5 hari), atau kedukaan keluarga inti (3 hari).',
      isActive: true,
      updatedByName: 'Ratna Kusuma, S.E. (Finance & HR)',
      updatedAt: '2026-01-10T08:00:00Z',
    },
    {
      id: 'leave-pol-oth-1',
      code: 'CT-REG',
      name: 'Cuti Tahunan Reguler',
      group: 'CUTI_LAINNYA',
      allocationDaysPerYear: 12,
      requiresAttachmentOrNote: false,
      termsAndProvisions:
        'Diajukan minimal H-3 sebelum tanggal cuti, direview oleh Finance/HR dan disetujui secara manual oleh Director.',
      isActive: true,
      updatedByName: 'Ratna Kusuma, S.E. (Finance & HR)',
      updatedAt: '2026-01-10T08:00:00Z',
    },
    {
      id: 'leave-pol-oth-2',
      code: 'IZ-MDS',
      name: 'Izin Keperluan Mendesak',
      group: 'CUTI_LAINNYA',
      allocationDaysPerYear: 3,
      requiresAttachmentOrNote: true,
      termsAndProvisions:
        'Izin keperluan keluarga atau urusan mendesak dengan persetujuan Finance/HR & pengakuan Director.',
      isActive: true,
      updatedByName: 'Ratna Kusuma, S.E. (Finance & HR)',
      updatedAt: '2026-01-10T08:00:00Z',
    },
  ];

  return {
    locationConfig: { ...DEFAULT_WIJNA_LOCATION_CONFIG },
    records: [],
    flextimeAssignments: [],
    leavePolicies,
    leaveRequests: [],
    wfaRequests: [],
    holidayRequests: [],
    employeeTrainings: [],
    employeeProfileLinks: {},
    workRecapVerifications: {},
    auditTrail: [],
  };
}

export function ensureAttendanceSystemInitialized(draft: {
  attendanceSystem?: AttendanceSystemBundle;
}): AttendanceSystemBundle {
  if (!draft.attendanceSystem || typeof draft.attendanceSystem !== 'object') {
    draft.attendanceSystem = createInitialAttendanceSystem();
  } else {
    const seed = createInitialAttendanceSystem();
    if (!draft.attendanceSystem.locationConfig) {
      draft.attendanceSystem.locationConfig = seed.locationConfig;
    }
    if (!Array.isArray(draft.attendanceSystem.records)) {
      draft.attendanceSystem.records = [];
    }
    if (!Array.isArray(draft.attendanceSystem.flextimeAssignments)) {
      draft.attendanceSystem.flextimeAssignments = [];
    }
    if (
      !Array.isArray(draft.attendanceSystem.leavePolicies) ||
      draft.attendanceSystem.leavePolicies.length === 0
    ) {
      draft.attendanceSystem.leavePolicies = seed.leavePolicies;
    }
    if (!Array.isArray(draft.attendanceSystem.leaveRequests)) {
      draft.attendanceSystem.leaveRequests = [];
    }
    if (!Array.isArray(draft.attendanceSystem.wfaRequests)) {
      draft.attendanceSystem.wfaRequests = [];
    }
    if (!Array.isArray(draft.attendanceSystem.holidayRequests)) {
      draft.attendanceSystem.holidayRequests = [];
    }
    if (!Array.isArray(draft.attendanceSystem.employeeTrainings)) {
      draft.attendanceSystem.employeeTrainings = [];
    }
    if (
      !draft.attendanceSystem.employeeProfileLinks ||
      typeof draft.attendanceSystem.employeeProfileLinks !== 'object'
    ) {
      draft.attendanceSystem.employeeProfileLinks = {};
    }
    if (
      !draft.attendanceSystem.workRecapVerifications ||
      typeof draft.attendanceSystem.workRecapVerifications !== 'object'
    ) {
      draft.attendanceSystem.workRecapVerifications = {};
    }
    if (!Array.isArray(draft.attendanceSystem.auditTrail)) {
      draft.attendanceSystem.auditTrail = [];
    }
  }
  return draft.attendanceSystem;
}
