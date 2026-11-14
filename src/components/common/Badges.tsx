import React from 'react';
import { ActivityStatus, SubmissionStatus, UserRole } from '../../types/index.js';
import { getDeadlineInfo } from '../../lib/dateUtils.js';

export const RoleBadge: React.FC<{ role: UserRole; title?: string }> = ({ role, title }) => {
  const configs: Record<UserRole, { label: string; bg: string; text: string; border: string }> = {
    system_admin: { label: 'System Administrator', bg: 'bg-[#FFF1F2]', text: 'text-[#9F1239]', border: 'border-[#FECDD3]' },
    admin: { label: 'Admin', bg: 'bg-[#F5F2F9]', text: 'text-[#6B46C1]', border: 'border-[#E9D8FD]' },
    director: { label: 'Director', bg: 'bg-[#EDF5FF]', text: 'text-[#2B6CB0]', border: 'border-[#D2E7FF]' },
    hr: { label: 'Finance & HR', bg: 'bg-[#EBF7EE]', text: 'text-[#1E7E34]', border: 'border-[#D1EED5]' },
    finance: { label: 'Finance & HR', bg: 'bg-[#EBF7EE]', text: 'text-[#1E7E34]', border: 'border-[#D1EED5]' },
    program_manager: { label: 'Program Manager', bg: 'bg-[#FFF8EB]', text: 'text-[#B7791F]', border: 'border-[#FEFCBF]' },
    meal: { label: 'MEAL', bg: 'bg-[#E6FFFA]', text: 'text-[#234E52]', border: 'border-[#B2F5EA]' },
    staff: { label: 'Staf / PIC', bg: 'bg-[#F1F1EF]', text: 'text-[#4A5568]', border: 'border-[#E2E8F0]' },
  };

  const c = configs[role] || configs.staff;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium border ${c.bg} ${c.text} ${c.border}`}>
      {title || c.label}
    </span>
  );
};

export const ActivityStatusBadge: React.FC<{ status: ActivityStatus }> = ({ status }) => {
  const configs: Record<ActivityStatus, { label: string; bg: string; text: string; dot: string; border: string }> = {
    'Belum Dimulai': {
      label: 'Belum Dimulai',
      bg: 'bg-[#F7F7F5]',
      text: 'text-[#5A5A58]',
      dot: 'bg-[#90908C]',
      border: 'border-[#E5E5E3]',
    },
    'Sedang Berjalan': {
      label: 'Sedang Berjalan',
      bg: 'bg-[#EFF6FF]',
      text: 'text-[#1D4ED8]',
      dot: 'bg-[#3B82F6]',
      border: 'border-[#DBEAFE]',
    },
    'Selesai': {
      label: 'Selesai',
      bg: 'bg-[#F0FDF4]',
      text: 'text-[#15803D]',
      dot: 'bg-[#22C55E]',
      border: 'border-[#DCFCE7]',
    },
  };

  const c = configs[status] || configs['Belum Dimulai'];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[12px] font-medium border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
};

export const SubmissionStatusBadge: React.FC<{ status: SubmissionStatus }> = ({ status }) => {
  const configs: Record<SubmissionStatus, { label: string; bg: string; text: string; border: string }> = {
    Draft: {
      label: 'Draft',
      bg: 'bg-[#F7F7F5]',
      text: 'text-[#5A5A58]',
      border: 'border-[#E5E5E3]',
    },
    Diajukan: {
      label: 'Diajukan',
      bg: 'bg-[#EFF6FF]',
      text: 'text-[#1D4ED8]',
      border: 'border-[#DBEAFE]',
    },
    'Menunggu Persetujuan Director': {
      label: 'Disetujui A1 · Diteruskan ke Direktur',
      bg: 'bg-[#EFF6FF]',
      text: 'text-[#1D4ED8]',
      border: 'border-[#DBEAFE]',
    },
    'Menunggu Persetujuan Finance': {
      label: 'Menunggu Pemeriksaan A1',
      bg: 'bg-[#FFF7ED]',
      text: 'text-[#C2410C]',
      border: 'border-[#FFEDD5]',
    },
    Disetujui: {
      label: 'Disetujui',
      bg: 'bg-[#F0FDF4]',
      text: 'text-[#15803D]',
      border: 'border-[#DCFCE7]',
    },
    Ditolak: {
      label: 'Ditolak',
      bg: 'bg-[#FEF2F2]',
      text: 'text-[#B91C1C]',
      border: 'border-[#FEE2E2]',
    },
    'Perlu Perbaikan': {
      label: 'Perlu Perbaikan',
      bg: 'bg-[#FFF7ED]',
      text: 'text-[#C2410C]',
      border: 'border-[#FED7AA]',
    },
  };

  const c = configs[status] || {
    label: status,
    bg: 'bg-[#F7F7F5]',
    text: 'text-[#5A5A58]',
    border: 'border-[#E5E5E3]',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
};

export const DeadlineBadge: React.FC<{ deadline: string; isCompleted?: boolean }> = ({ deadline, isCompleted }) => {
  if (!deadline) {
    return <span className="text-[#787774] text-xs">-</span>;
  }

  const info = getDeadlineInfo(deadline, isCompleted);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[12px] font-medium border ${info.colorClasses.bg} ${info.colorClasses.text} ${info.colorClasses.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${info.colorClasses.dot}`} />
      <span>{info.fullLabel}</span>
    </span>
  );
};
