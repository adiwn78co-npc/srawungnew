import { Tor, MeetingMinutesRecord } from '../types/index.js';
import { getNotulenReportingSchedule } from './dateUtils.js';

export type StatusDotColor = 'red' | 'amber' | 'green' | 'gray';

export interface StatusDotInfo {
  color: StatusDotColor;
  label: string;
  reason: string;
  dotColorClass: string;
  pulseClass: string;
  ringColorClass: string;
  textColorClass: string;
  diffDays: number;
}

const DEADLINE_NEAR_THRESHOLD_DAYS = 3;

/**
 * Calculates days remaining from today to target deadline string (YYYY-MM-DD)
 * Negative indicates overdue days.
 */
export function getDiffDaysFromToday(deadlineStr?: string): number {
  if (!deadlineStr) return 9999;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr).getTime();
  const deadMs = new Date(deadlineStr).getTime();
  return Math.ceil((deadMs - todayMs) / (1000 * 60 * 60 * 24));
}

/**
 * Determines status dot properties based on strict separation of activity status & deadline urgency:
 * - Red: Overdue & not completed
 * - Amber: Approaching deadline (0-3 days) & not completed (takes precedence over in progress)
 * - Green: In Progress & safe deadline (>3 days)
 * - Gray: Not started or completed without urgent deadline
 */
export function getStatusDotInfo(tor: Tor, minutesList: MeetingMinutesRecord[] = []): StatusDotInfo {
  const schedule = getNotulenReportingSchedule(tor, minutesList);
  const isCompleted = tor.activityStatus === 'Selesai' || schedule.allFulfilled;
  const effectiveDeadline = schedule.nearestDueDate || tor.reportingDeadline;
  const diffDays = getDiffDaysFromToday(effectiveDeadline);

  // 1. Red: TOR terlambat (deadline laporan sudah lewat & kewajiban belum selesai)
  if (!isCompleted && diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      color: 'red',
      label: 'Terlambat',
      reason: `Kewajiban pelaporan melewati batas waktu (Terlambat ${overdueDays} hari).`,
      dotColorClass: 'bg-[#DC2626]',
      pulseClass: 'status-dot-pulse',
      ringColorClass: 'ring-2 ring-red-100',
      textColorClass: 'text-[#DC2626]',
      diffDays,
    };
  }

  // 2. Amber: TOR mendekati deadline (tersisa 0-3 hari kalender & belum selesai)
  // Catatan: Jika TOR sedang berjalan tetapi deadline mendekat, tampilkan amber sebagai prioritas deadline.
  if (!isCompleted && diffDays >= 0 && diffDays <= DEADLINE_NEAR_THRESHOLD_DAYS) {
    const timeText = diffDays === 0 ? 'jatuh tempo hari ini' : `tersisa ${diffDays} hari`;
    return {
      color: 'amber',
      label: 'Mendekati Deadline',
      reason: `Batas akhir pelaporan semakin dekat (${timeText}).`,
      dotColorClass: 'bg-[#D97706]',
      pulseClass: 'status-dot-pulse',
      ringColorClass: 'ring-2 ring-amber-100',
      textColorClass: 'text-[#D97706]',
      diffDays,
    };
  }

  // 3. Green: TOR sedang berjalan (dan deadline aman > 3 hari)
  if (!isCompleted && tor.activityStatus === 'Sedang Berjalan') {
    return {
      color: 'green',
      label: 'Sedang Berjalan',
      reason: `Kegiatan sedang aktif berjalan di lapangan dan tenggat laporan aman (tersisa ${diffDays} hari).`,
      dotColorClass: 'bg-[#16A34A]',
      pulseClass: 'status-dot-pulse',
      ringColorClass: 'ring-2 ring-emerald-100',
      textColorClass: 'text-[#16A34A]',
      diffDays,
    };
  }

  // 4. Gray: TOR selesai atau belum dimulai tanpa kondisi mendesak
  if (isCompleted) {
    return {
      color: 'gray',
      label: 'Selesai',
      reason: 'Kegiatan telah selesai dan seluruh kewajiban laporan terpenuhi.',
      dotColorClass: 'bg-[#9CA3AF]',
      pulseClass: '',
      ringColorClass: 'ring-2 ring-slate-100',
      textColorClass: 'text-[#6B7280]',
      diffDays,
    };
  }

  return {
    color: 'gray',
    label: 'Belum Dimulai',
    reason: 'Kegiatan belum dimulai dan tidak memiliki urgensi deadline mendesak.',
    dotColorClass: 'bg-[#9CA3AF]',
    pulseClass: '',
    ringColorClass: 'ring-2 ring-slate-100',
    textColorClass: 'text-[#6B7280]',
    diffDays,
  };
}

/**
 * Calculates smart deadline priority rank:
 * 1. TOR terlambat (diurutkan dari keterlambatan paling lama)
 * 2. TOR deadline hari ini
 * 3. TOR deadline 1-3 hari mendatang (deadline terdekat)
 * 4. TOR aktif lainnya (deadline terdekat)
 * 5. TOR belum dimulai tanpa urgensi
 * 6. TOR selesai
 */
export function getSmartPriorityRank(tor: Tor, minutesList: MeetingMinutesRecord[] = []): { rank: number; subOrder: number } {
  const schedule = getNotulenReportingSchedule(tor, minutesList);
  const isCompleted = tor.activityStatus === 'Selesai' || schedule.allFulfilled;
  const effectiveDeadline = schedule.nearestDueDate || tor.reportingDeadline;
  const diffDays = getDiffDaysFromToday(effectiveDeadline);

  if (!isCompleted && diffDays < 0) {
    // Rank 1: Overdue. SubOrder = diffDays (e.g. -10 is smaller than -3, so -10 comes first)
    return { rank: 1, subOrder: diffDays };
  }

  if (!isCompleted && diffDays === 0) {
    // Rank 2: Deadline hari ini
    return { rank: 2, subOrder: 0 };
  }

  if (!isCompleted && diffDays >= 1 && diffDays <= DEADLINE_NEAR_THRESHOLD_DAYS) {
    // Rank 3: 1-3 hari mendatang (terdekat dulu: 1, lalu 2, lalu 3)
    return { rank: 3, subOrder: diffDays };
  }

  if (!isCompleted && tor.activityStatus === 'Sedang Berjalan') {
    // Rank 4: Aktif lainnya
    return { rank: 4, subOrder: diffDays };
  }

  if (!isCompleted) {
    // Rank 5: Belum dimulai tanpa urgensi
    return { rank: 5, subOrder: diffDays };
  }

  // Rank 6: Selesai
  return { rank: 6, subOrder: 0 };
}
