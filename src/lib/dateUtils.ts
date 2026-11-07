/**
 * Date formatting utilities for NGO HR & Program Management System
 * Formats dates in Indonesian locale (e.g., 19 Okt 2026)
 */

const INDONESIAN_MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

export function formatIndonesianDate(dateStr: string): string {
  if (!dateStr) return '-';
  try {
    // If format is YYYY-MM-DD
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const monthName = INDONESIAN_MONTHS_SHORT[monthIdx] || parts[1];
      return `${day} ${monthName} ${year}`;
    }

    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      const monthName = INDONESIAN_MONTHS_SHORT[d.getMonth()];
      const year = d.getFullYear();
      return `${day} ${monthName} ${year}`;
    }

    return dateStr;
  } catch {
    return dateStr;
  }
}

export function formatPeriodRange(startDateStr: string, endDateStr: string): string {
  if (!startDateStr && !endDateStr) return '-';
  if (!startDateStr) return formatIndonesianDate(endDateStr);
  if (!endDateStr) return formatIndonesianDate(startDateStr);

  try {
    const sParts = startDateStr.split('-');
    const eParts = endDateStr.split('-');

    if (sParts.length === 3 && eParts.length === 3) {
      const sY = sParts[0];
      const sM = parseInt(sParts[1], 10) - 1;
      const sD = parseInt(sParts[2], 10);

      const eY = eParts[0];
      const eM = parseInt(eParts[1], 10) - 1;
      const eD = parseInt(eParts[2], 10);

      // Same year and same month: 10–12 Okt 2026
      if (sY === eY && sM === eM) {
        const monthName = INDONESIAN_MONTHS_SHORT[sM];
        return `${sD}–${eD} ${monthName} ${sY}`;
      }

      // Same year, different month: 28 Okt – 05 Nov 2026
      if (sY === eY) {
        return `${sD} ${INDONESIAN_MONTHS_SHORT[sM]} – ${eD} ${INDONESIAN_MONTHS_SHORT[eM]} ${sY}`;
      }
    }

    return `${formatIndonesianDate(startDateStr)} – ${formatIndonesianDate(endDateStr)}`;
  } catch {
    return `${startDateStr} s/d ${endDateStr}`;
  }
}

export interface DeadlineInfo {
  formattedDate: string;
  indicatorText: string;
  fullLabel: string;
  statusType: 'completed' | 'overdue' | 'today' | 'near' | 'far';
  colorClasses: {
    bg: string;
    text: string;
    border: string;
    dot: string;
  };
}

export function getDeadlineInfo(deadlineStr: string, isCompleted?: boolean): DeadlineInfo {
  if (!deadlineStr) {
    return {
      formattedDate: '-',
      indicatorText: '-',
      fullLabel: '-',
      statusType: 'far',
      colorClasses: {
        bg: 'bg-slate-100',
        text: 'text-slate-600',
        border: 'border-slate-200',
        dot: 'bg-slate-400',
      },
    };
  }

  const formattedDate = formatIndonesianDate(deadlineStr);

  if (isCompleted) {
    return {
      formattedDate,
      indicatorText: 'Selesai',
      fullLabel: `${formattedDate} · Selesai`,
      statusType: 'completed',
      colorClasses: {
        bg: 'bg-emerald-50',
        text: 'text-emerald-800',
        border: 'border-emerald-200',
        dot: 'bg-emerald-600',
      },
    };
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const todayMs = new Date(todayStr).getTime();
  const deadMs = new Date(deadlineStr).getTime();
  const diffDays = Math.ceil((deadMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const count = Math.abs(diffDays);
    const indicatorText = `Terlambat ${count} hari`;
    return {
      formattedDate,
      indicatorText,
      fullLabel: `Deadline ${formattedDate} · ${indicatorText}`,
      statusType: 'overdue',
      colorClasses: {
        bg: 'bg-[#FEF2F2]',
        text: 'text-[#991B1B]',
        border: 'border-[#FEE2E2]',
        dot: 'bg-[#DC2626]',
      },
    };
  }

  if (diffDays === 0) {
    const indicatorText = 'Jatuh tempo hari ini';
    return {
      formattedDate,
      indicatorText,
      fullLabel: `Deadline ${formattedDate} · ${indicatorText}`,
      statusType: 'today',
      colorClasses: {
        bg: 'bg-[#FFF7ED]',
        text: 'text-[#9A3412]',
        border: 'border-[#FFEDD5]',
        dot: 'bg-[#EA580C]',
      },
    };
  }

  if (diffDays <= 7) {
    const indicatorText = `Sisa ${diffDays} hari`;
    return {
      formattedDate,
      indicatorText,
      fullLabel: `Deadline ${formattedDate} · ${indicatorText}`,
      statusType: 'near',
      colorClasses: {
        bg: 'bg-[#FFF7ED]',
        text: 'text-[#9A3412]',
        border: 'border-[#FED7AA]',
        dot: 'bg-[#F97316]',
      },
    };
  }

  const indicatorText = `Sisa ${diffDays} hari`;
  return {
    formattedDate,
    indicatorText,
    fullLabel: `Deadline ${formattedDate} · ${indicatorText}`,
    statusType: 'far',
    colorClasses: {
      bg: 'bg-[#F0F0EE]',
      text: 'text-[#5A5A58]',
      border: 'border-[#E5E5E3]',
      dot: 'bg-[#90908C]',
    },
  };
}

export interface NotulenMilestoneItem {
  index: number;
  title: string;
  dueDate: string;
  isFulfilled: boolean;
  isFinalDeadline?: boolean;
}

export interface NotulenReportingSchedule {
  nearestDueDate: string;
  nearestMilestoneTitle: string;
  fulfilledCount: number;
  totalCount: number;
  allFulfilled: boolean;
  milestones: NotulenMilestoneItem[];
}

/**
 * Menghitung jadwal kewajiban pelaporan Notulen berdasarkan Aturan & Frekuensi Pelaporan Kegiatan
 * pada TOR (Sekali/Akhir Kegiatan, Harian, Mingguan, Bulanan, Setiap akhir kegiatan, Periode Khusus)
 * dan menentukan Tenggat Waktu Laporan Terdekat untuk Notulen.
 */
export function getNotulenReportingSchedule(
  tor: {
    id?: string;
    torNumber?: string;
    startDate?: string;
    endDate?: string;
    reportingPeriodType?: string;
    reportingDeadline?: string;
  },
  minutesList: {
    id?: string;
    torId?: string;
    torNumber?: string;
    meetingDate?: string;
    createdAt?: string;
  }[] = []
): NotulenReportingSchedule {
  const offsetDays = 7;
  const startStr = tor.startDate || '';
  const endStr = tor.endDate || startStr;
  const periodType = tor.reportingPeriodType || 'Sekali / Akhir Kegiatan';

  const rawMilestones: { title: string; dueDate: string; isFinalDeadline?: boolean }[] = [];

  const s = startStr ? new Date(startStr + 'T00:00:00') : null;
  const e = endStr ? new Date(endStr + 'T00:00:00') : null;

  let fallbackFinalIso = tor.reportingDeadline || '';
  if (!fallbackFinalIso && e && !isNaN(e.getTime())) {
    const f = new Date(e);
    f.setDate(f.getDate() + offsetDays);
    fallbackFinalIso = f.toISOString().slice(0, 10);
  }

  if (s && e && !isNaN(s.getTime()) && !isNaN(e.getTime()) && e >= s) {
    if (periodType === 'Harian') {
      const current = new Date(s);
      let dayIdx = 1;
      while (current <= e) {
        const iso = current.toISOString().slice(0, 10);
        rawMilestones.push({
          title: `Notulen Hari ke-${dayIdx}`,
          dueDate: iso,
        });
        current.setDate(current.getDate() + 1);
        dayIdx++;
      }
      if (fallbackFinalIso) {
        rawMilestones.push({
          title: `Laporan Final (H+${offsetDays}): Executive Summary`,
          dueDate: fallbackFinalIso,
          isFinalDeadline: true,
        });
      }
    } else if (periodType === 'Mingguan') {
      const current = new Date(s);
      current.setDate(current.getDate() + 6);
      let weekIdx = 1;
      while (current <= e) {
        const iso = current.toISOString().slice(0, 10);
        rawMilestones.push({
          title: `Notulen Minggu ke-${weekIdx}`,
          dueDate: iso,
        });
        current.setDate(current.getDate() + 7);
        weekIdx++;
      }
      if (fallbackFinalIso) {
        rawMilestones.push({
          title: `Laporan Final (H+${offsetDays}): Executive Summary`,
          dueDate: fallbackFinalIso,
          isFinalDeadline: true,
        });
      }
    } else if (periodType === 'Bulanan') {
      const current = new Date(s);
      current.setMonth(current.getMonth() + 1);
      let monthIdx = 1;
      while (current <= e) {
        const iso = current.toISOString().slice(0, 10);
        rawMilestones.push({
          title: `Notulen Bulan ke-${monthIdx}`,
          dueDate: iso,
        });
        current.setMonth(current.getMonth() + 1);
        monthIdx++;
      }
      if (fallbackFinalIso) {
        rawMilestones.push({
          title: `Laporan Final (H+${offsetDays}): Executive Summary`,
          dueDate: fallbackFinalIso,
          isFinalDeadline: true,
        });
      }
    } else {
      rawMilestones.push({
        title: `Laporan Final (H+${offsetDays}): Executive Summary`,
        dueDate: fallbackFinalIso || endStr,
        isFinalDeadline: true,
      });
    }
  } else if (fallbackFinalIso) {
    rawMilestones.push({
      title: 'Laporan Final (H+7): Executive Summary',
      dueDate: fallbackFinalIso,
      isFinalDeadline: true,
    });
  }

  // Filter Notulen milik TOR ini yang dibuat pada/setelah tanggal mulai pelaksanaan kegiatan
  const matchingMinutes = (minutesList || []).filter((m) => {
    const belongsToTor =
      (tor.id && m.torId === tor.id) ||
      (tor.torNumber && m.torNumber && m.torNumber === tor.torNumber);
    if (!belongsToTor) return false;
    if (startStr && m.meetingDate) {
      return m.meetingDate >= startStr;
    }
    return true;
  });

  const fulfilledCount = Math.min(matchingMinutes.length, rawMilestones.length);
  const totalCount = rawMilestones.length;
  const allFulfilled = totalCount > 0 && fulfilledCount >= totalCount;

  const milestones: NotulenMilestoneItem[] = rawMilestones.map((rm, idx) => ({
    index: idx + 1,
    title: rm.title,
    dueDate: rm.dueDate,
    isFulfilled: idx < fulfilledCount,
    isFinalDeadline: rm.isFinalDeadline,
  }));

  const nextUnfulfilled =
    milestones.find((m) => !m.isFulfilled) || milestones[milestones.length - 1];

  return {
    nearestDueDate: nextUnfulfilled?.dueDate || fallbackFinalIso || '',
    nearestMilestoneTitle: nextUnfulfilled?.title || 'Laporan Final (H+7): Executive Summary',
    fulfilledCount,
    totalCount,
    allFulfilled,
    milestones,
  };
}

