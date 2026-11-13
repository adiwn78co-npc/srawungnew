import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Program,
  Outcome,
  Output,
  Activity,
  User,
  OutputRaciRecord,
  OutputRaciStatus,
  ActivityMonitoringRecord,
  SelectedActivityMonitoringTool,
  Tor,
  ApprovalHubItem,
  ApprovalNotificationItem,
  ApprovalCategoryCode,
} from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../lib/api.js';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  UserCheck,
  ClipboardCheck,
  Search,
  X,
  BookOpen,
  Edit3,
  Check,
  FileText,
  Plus,
  HelpCircle,
  Bell,
  History,
} from 'lucide-react';

const CATEGORY_STAGE_MAP: Record<ApprovalCategoryCode, number> = {
  tor: 1,
  cash_advance: 2,
  notulen: 4,
  dokumentasi: 5,
  executive_summary: 6,
  laporan_keuangan_akhir: 8,
};

const CATEGORY_SHORT_LABEL: Record<ApprovalCategoryCode, string> = {
  tor: 'ToR',
  cash_advance: 'Cash Advance',
  notulen: 'Notulen',
  dokumentasi: 'Dokumentasi',
  executive_summary: 'Executive Summary',
  laporan_keuangan_akhir: 'Final Financial Report',
};

export const RACI_ROLE_GUIDE: {
  role: string;
  responsibility: string;
}[] = [
  {
    role: 'Responsible (Pelaksana)',
    responsibility:
      'Pelaksana kegiatan, membuat ToR, mengelola Monitoring Tools, mengumpulkan bukti, dan melaporkan hasil.',
  },
  {
    role: 'Accountable Program (Penanggung Jawab Program)',
    responsibility:
      'Bertanggung jawab atas kualitas, pencapaian Output, arahan, dan persetujuan hasil program.',
  },
  {
    role: 'Accountable Finance (Penanggung Jawab Keuangan)',
    responsibility:
      'Bertanggung jawab atas anggaran, realisasi pengeluaran, bukti transaksi, dan kepatuhan keuangan.',
  },
  {
    role: 'Consulted (Konsultasi Teknis)',
    responsibility:
      'Pihak yang memberikan masukan, konsultasi, dan pertimbangan teknis.',
  },
  {
    role: 'Informed (Penerima Informasi)',
    responsibility:
      'Pihak yang menerima informasi perkembangan dan hasil kegiatan.',
  },
];

export interface MonitoringToolCatalogItem {
  id: string;
  categoryCode: 'A' | 'B' | 'C' | 'D' | 'E';
  categoryName: string;
  name: string;
  shortFunction: string;
}

export const MONITORING_TOOLS_LIBRARY: MonitoringToolCatalogItem[] = [
  // A. Program & Activity Monitoring
  {
    id: 'A-1',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Activity Monitoring Checklist',
    shortFunction:
      'Daftar periksa standar untuk memastikan kesiapan teknis, logistik, dan tahapan pelaksanaan kegiatan sesuai rencana.',
  },
  {
    id: 'A-2',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Field Visit Monitoring Form',
    shortFunction:
      'Formulir pencatatan temuan lapangan, kondisi lokasi, dan verifikasi langsung saat kunjungan monitoring.',
  },
  {
    id: 'A-3',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Activity Observation Form',
    shortFunction:
      'Instrumen observasi kualitas fasilitasi, dinamika partisipasi peserta, dan jalannya kegiatan secara langsung.',
  },
  {
    id: 'A-4',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Participant Attendance Sheet',
    shortFunction:
      'Lembar daftar hadir peserta terpilah (gender, kelompok usia, desa/instansi) sebagai bukti partisipasi kegiatan.',
  },
  {
    id: 'A-5',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Activity Progress Tracker',
    shortFunction:
      'Alat pelacak tahapan penyelesaian kegiatan dari persiapan, pelaksanaan, hingga tindak lanjut pasca-kegiatan.',
  },
  {
    id: 'A-6',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Output Achievement Tracker',
    shortFunction:
      'Pemantau realisasi capaian target kuantitatif dan kualitatif pada tingkat Output terhadap target program.',
  },
  {
    id: 'A-7',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Work Plan Monitoring',
    shortFunction:
      'Instrumen pemantauan ketepatan jadwal pelaksanaan kegiatan dibandingkan dengan lini masa rencana kerja (Work Plan).',
  },
  {
    id: 'A-8',
    categoryCode: 'A',
    categoryName: 'A. Program & Activity Monitoring',
    name: 'Implementation Verification Form',
    shortFunction:
      'Formulir verifikasi kesesuaian teknis hasil implementasi kegiatan terhadap spesifikasi TOR dan standar mutu.',
  },

  // B. Partner Capacity Monitoring
  {
    id: 'B-1',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'Partner Capacity Assessment',
    shortFunction:
      'Penilaian komprehensif kapasitas tata kelola, teknis, dan operasional organisasi mitra pelaksana.',
  },
  {
    id: 'B-2',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'Partner Performance Monitoring',
    shortFunction:
      'Evaluasi berkala atas kinerja mitra dalam mencapai target kegiatan, ketepatan waktu, dan mutu luaran.',
  },
  {
    id: 'B-3',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'Partner Accompaniment Form',
    shortFunction:
      'Catatan pendampingan teknis (coaching/mentoring) dan solusi bersama yang diberikan kepada mitra lokal.',
  },
  {
    id: 'B-4',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'Institutional Capacity Checklist',
    shortFunction:
      'Daftar periksa kelengkapan SOP kelembagaan, struktur organisasi, dan kepatuhan legalitas mitra.',
  },
  {
    id: 'B-5',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'MEAL System Assessment',
    shortFunction:
      'Penilaian kesiapan sistem pengumpulan data, penyimpanan bukti (MoV), dan pelaporan MEAL milik mitra.',
  },
  {
    id: 'B-6',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'Financial Compliance Checklist',
    shortFunction:
      'Pemeriksaan kepatuhan pembukuan keuangan, kelengkapan bukti transaksi, dan akuntabilitas dana mitra.',
  },
  {
    id: 'B-7',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'Safeguarding Compliance Checklist',
    shortFunction:
      'Daftar periksa penerapan kebijakan perlindungan anak dan kelompok rentan dalam operasional mitra.',
  },
  {
    id: 'B-8',
    categoryCode: 'B',
    categoryName: 'B. Partner Capacity Monitoring',
    name: 'Partner Improvement Plan',
    shortFunction:
      'Rencana tindak lanjut penguatan kapasitas mitra berdasarkan temuan asesmen dan rekomendasi monitoring.',
  },

  // C. Outcome & Impact Monitoring
  {
    id: 'C-1',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Pre-Test & Post-Test',
    shortFunction:
      'Pengukuran peningkatan pengetahuan dan pemahaman peserta sebelum dan sesudah pelatihan/lokakarya.',
  },
  {
    id: 'C-2',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Outcome Harvesting',
    shortFunction:
      'Metode identifikasi, perumusan, dan verifikasi perubahan nyata (perilaku, kebijakan, praktik) dari intervensi program.',
  },
  {
    id: 'C-3',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Most Significant Change (MSC)',
    shortFunction:
      'Pengumpulan dan seleksi cerita perubahan paling bermakna secara partisipatif dari penerima manfaat.',
  },
  {
    id: 'C-4',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Key Informant Interview (KII)',
    shortFunction:
      'Panduan wawancara mendalam dengan tokoh kunci, pemangku kepentingan desa, atau pimpinan komite.',
  },
  {
    id: 'C-5',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Focus Group Discussion (FGD)',
    shortFunction:
      'Panduan diskusi kelompok terarah untuk menggali persepsi kolektif, dampak sosial, dan pembelajaran warga.',
  },
  {
    id: 'C-6',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Beneficiary Feedback Form',
    shortFunction:
      'Formulir umpan balik langsung dari penerima manfaat mengenai manfaat dan relevansi kegiatan.',
  },
  {
    id: 'C-7',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Outcome Indicator Tracking',
    shortFunction:
      'Instrumen pelacakan perkembangan indikator tingkat Outcome dibandingkan baseline dan target akhir.',
  },
  {
    id: 'C-8',
    categoryCode: 'C',
    categoryName: 'C. Outcome & Impact Monitoring',
    name: 'Behaviour Change Assessment',
    shortFunction:
      'Survei dan observasi perubahan praktik/perilaku masyarakat sasaran pasca-intervensi program.',
  },

  // D. Quality & Accountability Monitoring
  {
    id: 'D-1',
    categoryCode: 'D',
    categoryName: 'D. Quality & Accountability Monitoring',
    name: 'Activity Quality Assessment',
    shortFunction:
      'Penilaian mutu pelaksanaan kegiatan berdasarkan tolok ukur kualitas teknis, inklusivitas, dan ketepatan sasaran.',
  },
  {
    id: 'D-2',
    categoryCode: 'D',
    categoryName: 'D. Quality & Accountability Monitoring',
    name: 'Community Satisfaction Survey',
    shortFunction:
      'Survei tingkat kepuasan masyarakat penerima manfaat terhadap layanan dan hasil kegiatan program.',
  },
  {
    id: 'D-3',
    categoryCode: 'D',
    categoryName: 'D. Quality & Accountability Monitoring',
    name: 'Accountability Checklist',
    shortFunction:
      'Daftar periksa keterbukaan informasi program, partisipasi warga, dan akuntabilitas sosial di lokasi kegiatan.',
  },
  {
    id: 'D-4',
    categoryCode: 'D',
    categoryName: 'D. Quality & Accountability Monitoring',
    name: 'Feedback & Complaint Mechanism (FCM)',
    shortFunction:
      'Log pencatatan, penanganan, dan tindak lanjut masukan atau pengaduan dari masyarakat.',
  },
  {
    id: 'D-5',
    categoryCode: 'D',
    categoryName: 'D. Quality & Accountability Monitoring',
    name: 'PSEAH Monitoring Checklist',
    shortFunction:
      'Pemantauan pencegahan eksploitasi, penyalahgunaan, dan pelecehan seksual selama pelaksanaan kegiatan.',
  },
  {
    id: 'D-6',
    categoryCode: 'D',
    categoryName: 'D. Quality & Accountability Monitoring',
    name: 'Do No Harm Assessment',
    shortFunction:
      'Analisis sensitivitas konflik dan risiko dampak tidak disengaja agar kegiatan tidak memperburuk kerentanan lokal.',
  },
  {
    id: 'D-7',
    categoryCode: 'D',
    categoryName: 'D. Quality & Accountability Monitoring',
    name: 'Risk Monitoring Register',
    shortFunction:
      'Daftar pemantauan risiko operasional, keamanan, dan lingkungan beserta status tindakan mitigasinya.',
  },

  // E. Documentation & Reporting Monitoring
  {
    id: 'E-1',
    categoryCode: 'E',
    categoryName: 'E. Documentation & Reporting Monitoring',
    name: 'Photo Documentation Checklist',
    shortFunction:
      'Daftar periksa kelengkapan foto terbaik (Five Best Photos), informasi subjek foto, lokasi, dan fotografer.',
  },
  {
    id: 'E-2',
    categoryCode: 'E',
    categoryName: 'E. Documentation & Reporting Monitoring',
    name: 'Human Interest Story Tracker',
    shortFunction:
      'Pelacak pengumpulan cerita human interest tentang individu, komunitas, atau dampak nyata program.',
  },
  {
    id: 'E-3',
    categoryCode: 'E',
    categoryName: 'E. Documentation & Reporting Monitoring',
    name: 'Monthly Progress Report (MPR)',
    shortFunction:
      'Format pemantauan kelengkapan dan ketepatan waktu laporan perkembangan kegiatan bulanan.',
  },
  {
    id: 'E-4',
    categoryCode: 'E',
    categoryName: 'E. Documentation & Reporting Monitoring',
    name: 'Quarterly Progress Report (QPR)',
    shortFunction:
      'Format pemantauan laporan capaian triwulanan program untuk konsolidasi manajemen dan donor.',
  },
  {
    id: 'E-5',
    categoryCode: 'E',
    categoryName: 'E. Documentation & Reporting Monitoring',
    name: 'Indicator Tracking Table',
    shortFunction:
      'Tabel rekapitulasi realisasi angka indikator Output dan Activity secara berkala.',
  },
  {
    id: 'E-6',
    categoryCode: 'E',
    categoryName: 'E. Documentation & Reporting Monitoring',
    name: 'Evidence Verification Checklist',
    shortFunction:
      'Daftar periksa keabsahan dokumen bukti verifikasi (Means of Verification / MoV) sebelum laporan disahkan.',
  },
  {
    id: 'E-7',
    categoryCode: 'E',
    categoryName: 'E. Documentation & Reporting Monitoring',
    name: 'Reporting Compliance Tracker',
    shortFunction:
      'Pemantau kepatuhan tenggat waktu penyerahan laporan teknis dan kelengkapan lampiran kegiatan.',
  },
];

export const CATEGORY_LIST: {
  code: 'A' | 'B' | 'C' | 'D' | 'E';
  label: string;
}[] = [
  { code: 'A', label: 'A. Program & Activity Monitoring' },
  { code: 'B', label: 'B. Partner Capacity Monitoring' },
  { code: 'C', label: 'C. Outcome & Impact Monitoring' },
  { code: 'D', label: 'D. Quality & Accountability Monitoring' },
  { code: 'E', label: 'E. Documentation & Reporting Monitoring' },
];

interface MonitoringToolsViewProps {
  programs: Program[];
  outcomes: Outcome[];
  outputs: Output[];
  activities: Activity[];
  users: User[];
  tors?: Tor[];
  onSelectTor?: (
    torId: string,
    initialStage?: number,
    options?: {
      targetEntityId?: string;
      focusedSourceMode?: boolean;
      autoOpenEdit?: boolean;
    }
  ) => void;
  onOpenCreateTorForActivity?: (outcomeId: string, outputId: string, activityId: string) => void;
  onOpenApprovalForActivity?: (activityId: string) => void;
  onRaciChanged?: () => void;
  responsibleApprovalItems?: ApprovalHubItem[];
  notifications?: ApprovalNotificationItem[];
  onMarkNotificationRead?: (notificationId?: string, markAll?: boolean) => void;
}

export const MonitoringToolsView: React.FC<MonitoringToolsViewProps> = ({
  programs,
  outcomes,
  outputs,
  activities,
  users,
  tors = [],
  onSelectTor,
  onOpenCreateTorForActivity,
  onOpenApprovalForActivity,
  onRaciChanged,
  responsibleApprovalItems = [],
  notifications = [],
  onMarkNotificationRead,
}) => {
  const { currentUser, isDirector, isProgramManager, isAdmin } = useAuth();
  const [showFollowUpInbox, setShowFollowUpInbox] = useState<boolean>(false);

  // Core data from server
  const [raciMap, setRaciMap] = useState<Record<string, OutputRaciRecord>>({});
  const [activityMonMap, setActivityMonMap] = useState<Record<string, ActivityMonitoringRecord>>({});
  const [loading, setLoading] = useState(true);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Step 1: Initial view is List Program (selectedProgramId === null).
  // Clicking a Program opens List Output for that Program.
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [programSearch, setProgramSearch] = useState<string>('');
  const [outputSearch, setOutputSearch] = useState<string>('');

  // Scope filter: all active users can toggle 'ALL' vs 'ASSIGNED'; management/MEAL/Finance/HR default to 'ALL'
  const isGlobalViewerRole =
    isProgramManager ||
    isDirector ||
    isAdmin ||
    currentUser?.role === 'meal' ||
    currentUser?.role === 'finance' ||
    currentUser?.role === 'hr' ||
    Boolean(currentUser?.permissions?.canViewAllTors || currentUser?.permissions?.canManagePrograms);
  const canViewAllScope = Boolean(currentUser && currentUser.isActive !== false);
  const [viewScope, setViewScope] = useState<'ALL' | 'ASSIGNED'>(() =>
    isGlobalViewerRole ? 'ALL' : 'ASSIGNED'
  );

  useEffect(() => {
    if (isGlobalViewerRole) {
      setViewScope('ALL');
    }
  }, [isGlobalViewerRole]);

  // Show / Hide Activity per Output (keyed by output.id)
  const [expandedOutputActivityMap, setExpandedOutputActivityMap] = useState<
    Record<string, boolean>
  >({});

  // Show / Hide Panduan RACI in top corner
  const [showGlobalRaciGuide, setShowGlobalRaciGuide] = useState(false);

  // Optional Library Modal so users can also browse all 38 tools anytime
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [librarySearch, setLibrarySearch] = useState<string>('');
  const [libraryCategory, setLibraryCategory] = useState<'ALL' | 'A' | 'B' | 'C' | 'D' | 'E'>(
    'ALL'
  );

  // RACI Editor Modal per Output
  const [editingRaciOutput, setEditingRaciOutput] = useState<Output | null>(null);
  const [draftResponsibleId, setDraftResponsibleId] = useState<string>('');
  const [draftAccountableId, setDraftAccountableId] = useState<string>('');
  const [draftConsulted, setDraftConsulted] = useState<string[]>([]);
  const [draftInformed, setDraftInformed] = useState<string[]>([]);
  const [manualConsultedInput, setManualConsultedInput] = useState<string>('');
  const [manualInformedInput, setManualInformedInput] = useState<string>('');
  const [savingRaci, setSavingRaci] = useState(false);

  // Director Revision Notes state
  const [approvingOutputId, setApprovingOutputId] = useState<string | null>(null);
  const [directorNotesInput, setDirectorNotesInput] = useState<string>('');

  // Compact Riwayat Audit RACI (Hide / Show di pojok atas & per Output)
  const [showCornerRaciAudit, setShowCornerRaciAudit] = useState<boolean>(false);
  const [expandedOutputRaciAuditMap, setExpandedOutputRaciAuditMap] = useState<
    Record<string, boolean>
  >({});

  // Activity Monitoring Tools Assignment Modal
  const [editingActivity, setEditingActivity] = useState<{
    activity: Activity;
    output: Output;
    outcome?: Outcome;
  } | null>(null);
  const [draftTools, setDraftTools] = useState<SelectedActivityMonitoringTool[]>([]);
  const [toolSearchQuery, setToolSearchQuery] = useState<string>('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<
    'ALL' | 'A' | 'B' | 'C' | 'D' | 'E'
  >('ALL');
  const [savingActivityTools, setSavingActivityTools] = useState(false);

  const loadMonitoringData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getMonitoringConnect();
      if (res) {
        setRaciMap(res.outputRaciRecords || {});
        setActivityMonMap(res.activityMonitoringRecords || {});
      }
    } catch (err: any) {
      console.error('Failed to load monitoring connect data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMonitoringData();
  }, [loadMonitoringData]);

  // Registered active users
  const activeUsers = useMemo(() => users.filter((u) => u.isActive !== false), [users]);

  // Finance Manager user (automatically included in Accountable)
  const financeManagerUser = useMemo(
    () =>
      activeUsers.find(
        (u) =>
          u.role === 'finance' ||
          (u.roleTitle || '').toLowerCase().includes('finance')
      ) || null,
    [activeUsers]
  );

  // Set of registered user names (normalized) to distinguish User Asli vs Manual
  const registeredUserNameSet = useMemo(
    () => new Set(users.map((u) => u.name.trim().toLowerCase())),
    [users]
  );

  const isRegisteredUserName = useCallback(
    (name: string): boolean => {
      return registeredUserNameSet.has((name || '').trim().toLowerCase());
    },
    [registeredUserNameSet]
  );

  // Helper to get effective RACI status for an Output
  const getOutputRaci = useCallback(
    (output: Output): OutputRaciRecord => {
      const existing = raciMap[output.id];
      if (existing) return existing;
      const outc = outcomes.find((oc) => oc.id === output.outcomeId);
      return {
        outputId: output.id,
        programId: outc?.programId || '',
        outcomeId: output.outcomeId,
        responsibleUserId: '',
        responsibleUserName: '',
        accountableUserId: '',
        accountableUserName: '',
        consultedUsers: [],
        informedUsers: [],
        status: 'Menunggu Program Manager',
        updatedAt: '',
      };
    },
    [raciMap, outcomes]
  );

  // Build effective RACI audit history entries per Output (including fallback from existing fields)
  const getOutputRaciAuditList = useCallback(
    (output: Output) => {
      const raci = getOutputRaci(output);
      if (raci.auditHistory && raci.auditHistory.length > 0) {
        return raci.auditHistory.map((entry) => ({
          ...entry,
          outputId: output.id,
          outputName: output.name,
        }));
      }
      const fallback: {
        id: string;
        timestamp: string;
        actorName: string;
        actorRole: string;
        action: string;
        status: OutputRaciStatus;
        notes?: string;
        outputId: string;
        outputName: string;
      }[] = [];
      if (raci.approvedAt && raci.approvedByName) {
        fallback.push({
          id: `aud-app-${output.id}`,
          timestamp: raci.approvedAt,
          actorName: raci.approvedByName,
          actorRole: 'Executive Director',
          action: 'Disetujui Direktur (RACI Aktif)',
          status: raci.status,
          notes: raci.directorNotes || 'Penugasan R & A disetujui Direktur.',
          outputId: output.id,
          outputName: output.name,
        });
      } else if (raci.directorNotes) {
        fallback.push({
          id: `aud-rev-${output.id}`,
          timestamp: raci.updatedAt || raci.assignedAt || '',
          actorName: 'Dr. Hendra Wijaya',
          actorRole: 'Executive Director',
          action: 'Diminta Revisi oleh Direktur',
          status: raci.status,
          notes: raci.directorNotes,
          outputId: output.id,
          outputName: output.name,
        });
      }
      if (raci.assignedAt && raci.assignedByName) {
        fallback.push({
          id: `aud-ass-${output.id}`,
          timestamp: raci.assignedAt,
          actorName: raci.assignedByName,
          actorRole: 'Program Manager',
          action: 'Penugasan RACI Diajukan',
          status: raci.status,
          notes: `R: ${raci.responsibleUserName || '-'} · A1: ${raci.accountableUserName || '-'}`,
          outputId: output.id,
          outputName: output.name,
        });
      }
      return fallback;
    },
    [getOutputRaci]
  );

  const allRaciAuditEntries = useMemo(() => {
    const targetOutputs = selectedProgramId
      ? outputs.filter((op) => {
          const outc = outcomes.find((oc) => oc.id === op.outcomeId);
          return outc?.programId === selectedProgramId;
        })
      : outputs;
    const list = targetOutputs.flatMap((op) => getOutputRaciAuditList(op));
    return list.sort(
      (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );
  }, [outputs, outcomes, selectedProgramId, getOutputRaciAuditList]);

  // Helper to build Accountable names list
  const getAccountableNamesList = useCallback(
    (raci: OutputRaciRecord): { name: string; isAutoFinance: boolean }[] => {
      const primaryName = (raci.accountableUserName || '').trim();
      const finName = (raci.accountableFinanceUserName || '').trim();
      const list: { name: string; isAutoFinance: boolean }[] = [];

      if (primaryName && primaryName.toLowerCase() !== finName.toLowerCase()) {
        list.push({ name: primaryName, isAutoFinance: false });
      }
      if (finName) {
        list.push({ name: finName, isAutoFinance: true });
      } else if (primaryName && financeManagerUser?.name && primaryName.toLowerCase() !== financeManagerUser.name.toLowerCase()) {
        list.push({ name: financeManagerUser.name, isAutoFinance: true });
      }
      return list;
    },
    [financeManagerUser]
  );

  // Helper to get Activity Monitoring Record
  const getActivityMonitoring = useCallback(
    (activity: Activity): ActivityMonitoringRecord => {
      const existing = activityMonMap[activity.id];
      if (existing && existing.tools && existing.tools.length > 0) {
        return {
          ...existing,
          status: 'Sudah Ada Monitoring',
        };
      }
      const outp = outputs.find((o) => o.id === activity.outputId);
      const outc = outcomes.find((oc) => oc.id === outp?.outcomeId);
      return {
        activityId: activity.id,
        outputId: activity.outputId,
        outcomeId: outp?.outcomeId || '',
        programId: outc?.programId || '',
        tools: [],
        status: 'Belum Ada Monitoring',
        updatedById: '',
        updatedByName: '',
        updatedAt: '',
      };
    },
    [activityMonMap, outputs, outcomes]
  );

  // Role permissions for RACI setup & approval (only active accounts with valid permissions)
  const isCurrentAccountActive = Boolean(currentUser && currentUser.isActive !== false);
  const canAssignRaci =
    isCurrentAccountActive &&
    (isProgramManager || isAdmin || Boolean(currentUser?.permissions?.canManagePrograms));
  const canApproveRaci = isCurrentAccountActive && isDirector;

  // Determine user's Responsible / Accountable assignment role on an Output
  const getUserRaciRoleForOutput = useCallback(
    (output: Output): 'Responsible' | 'Accountable Program' | 'Accountable Finance' | null => {
      if (!currentUser || currentUser.isActive === false) return null;
      const raci = getOutputRaci(output);
      const normUserName = String(currentUser.name || '').trim().toLowerCase();
      if (
        raci.responsibleUserId === currentUser.id ||
        (Boolean(normUserName) &&
          String(raci.responsibleUserName || '').trim().toLowerCase() === normUserName)
      ) {
        return 'Responsible';
      }
      if (
        (raci.accountableUserId === currentUser.id && raci.accountableUserId !== '') ||
        (Boolean(normUserName) &&
          String(raci.accountableUserName || '').trim().toLowerCase() === normUserName)
      ) {
        return 'Accountable Program';
      }
      if (
        raci.accountableFinanceUserId === currentUser.id ||
        currentUser.role === 'finance' ||
        (currentUser.roleTitle || '').toLowerCase().includes('finance')
      ) {
        return 'Accountable Finance';
      }
      return null;
    },
    [currentUser, getOutputRaci]
  );

  // Whether an Output is assigned/related to the current user (R, A1, A2, C, I, Output PIC, or ToR PIC/creator)
  const isOutputAssignedToCurrentUser = useCallback(
    (output: Output): boolean => {
      if (!currentUser || currentUser.isActive === false) return false;
      if (getUserRaciRoleForOutput(output) !== null) return true;
      const normUserName = String(currentUser.name || '').trim().toLowerCase();
      if (
        output.picId === currentUser.id ||
        (Boolean(normUserName) &&
          String(output.picName || '').trim().toLowerCase() === normUserName)
      ) {
        return true;
      }
      const raci = getOutputRaci(output);
      if (
        Boolean(normUserName) &&
        ((raci.consultedUsers || []).some(
          (n) => String(n || '').trim().toLowerCase() === normUserName
        ) ||
          (raci.informedUsers || []).some(
            (n) => String(n || '').trim().toLowerCase() === normUserName
          ))
      ) {
        return true;
      }
      const hasRelatedTor = tors.some(
        (t) =>
          t.outputId === output.id &&
          (t.picId === currentUser.id ||
            t.createdById === currentUser.id ||
            (Boolean(normUserName) &&
              (String(t.picName || '').trim().toLowerCase() === normUserName ||
                String(t.createdByName || '').trim().toLowerCase() === normUserName)))
      );
      return hasRelatedTor;
    },
    [currentUser, getOutputRaci, getUserRaciRoleForOutput, tors]
  );

  // Access control for Managing Monitoring Tools & Creating ToR on an Output:
  // Only active R, A1, and A2 on an Output whose RACI is approved by Director ('Aktif')
  const canEditOutputMonitoring = useCallback(
    (output: Output): { allowed: boolean; roleLabel?: string; reason?: string } => {
      if (!currentUser || currentUser.isActive === false) {
        return {
          allowed: false,
          reason: 'Akun pengguna tidak aktif. Hubungi Administrator di Kelola Pengguna.',
        };
      }
      if (currentUser.permissions?.canCreateTor === false && currentUser.role !== 'admin') {
        return {
          allowed: false,
          reason: 'Hak akses pembuatan ToR / pengelolaan kegiatan dinonaktifkan pada pengaturan pengguna Anda.',
        };
      }
      const raci = getOutputRaci(output);
      const userRoleOnOutput = getUserRaciRoleForOutput(output);

      if (raci.status !== 'Aktif') {
        return {
          allowed: false,
          reason:
            raci.status === 'Menunggu Program Manager'
              ? 'Penugasan RACI belum ditentukan oleh Program Manager.'
              : 'Penugasan RACI masih menunggu persetujuan Direktur.',
        };
      }

      if (userRoleOnOutput) {
        return { allowed: true, roleLabel: userRoleOnOutput };
      }

      return {
        allowed: false,
        reason:
          'Hanya user yang ditugaskan sebagai R (Responsible), A1 (Accountable Program), atau A2 (Accountable Finance) pada Output ini yang dapat membuat ToR dan mengelola Monitoring Tools.',
      };
    },
    [currentUser, getOutputRaci, getUserRaciRoleForOutput]
  );

  // Helper to get ToRs linked to an Activity
  const getActivityTors = useCallback(
    (activityId: string): Tor[] => {
      return tors.filter((t) => t.activityId === activityId);
    },
    [tors]
  );

  // Effective scope: if user has at least one assigned output and selects 'ASSIGNED', filter to assigned Outputs;
  // if zero outputs are assigned yet in the system for this user, show all programs/outputs in read-only mode so data never appears missing.
  const hasAnyAssignedOutput = useMemo(
    () => outputs.some((op) => isOutputAssignedToCurrentUser(op)),
    [outputs, isOutputAssignedToCurrentUser]
  );
  const isStrictAssignedView =
    (!canViewAllScope || viewScope === 'ASSIGNED') && hasAnyAssignedOutput;

  // Filtered Programs for Initial List View
  const filteredPrograms = useMemo(() => {
    const basePrograms = isStrictAssignedView
      ? programs.filter((prog) => {
          const progOutcomeIds = new Set(
            outcomes.filter((oc) => oc.programId === prog.id).map((oc) => oc.id)
          );
          return outputs.some(
            (op) => progOutcomeIds.has(op.outcomeId) && isOutputAssignedToCurrentUser(op)
          );
        })
      : programs;

    const q = programSearch.trim().toLowerCase();
    if (!q) return basePrograms;
    return basePrograms.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.location || '').toLowerCase().includes(q) ||
        (p.picName || '').toLowerCase().includes(q) ||
        (p.code || '').toLowerCase().includes(q)
    );
  }, [
    programs,
    outcomes,
    outputs,
    programSearch,
    isStrictAssignedView,
    isOutputAssignedToCurrentUser,
  ]);

  // Selected Program object
  const selectedProgram = useMemo(
    () => programs.find((p) => p.id === selectedProgramId) || null,
    [programs, selectedProgramId]
  );

  // Outputs belonging to selectedProgram (filtered by RACI assignment when in ASSIGNED scope)
  const selectedProgramOutputs = useMemo(() => {
    if (!selectedProgram) return [];
    const progOutcomes = outcomes.filter((oc) => oc.programId === selectedProgram.id);
    const outcomeIds = new Set(progOutcomes.map((oc) => oc.id));
    const rawOutputs = outputs.filter((op) => {
      if (!outcomeIds.has(op.outcomeId)) return false;
      if (isStrictAssignedView && !isOutputAssignedToCurrentUser(op)) return false;
      return true;
    });

    const q = outputSearch.trim().toLowerCase();
    if (!q) return rawOutputs;
    return rawOutputs.filter((op) => {
      const raci = getOutputRaci(op);
      const outc = outcomes.find((oc) => oc.id === op.outcomeId);
      return (
        op.name.toLowerCase().includes(q) ||
        (op.description || '').toLowerCase().includes(q) ||
        (outc?.name || '').toLowerCase().includes(q) ||
        (raci.responsibleUserName || '').toLowerCase().includes(q) ||
        (raci.accountableUserName || '').toLowerCase().includes(q)
      );
    });
  }, [
    selectedProgram,
    outcomes,
    outputs,
    outputSearch,
    getOutputRaci,
    isStrictAssignedView,
    isOutputAssignedToCurrentUser,
  ]);

  // Outcomes for selectedProgram that have at least one visible Output
  const selectedProgramOutcomeGroups = useMemo(() => {
    if (!selectedProgram) return [];
    const progOutcomes = outcomes.filter((oc) => oc.programId === selectedProgram.id);
    return progOutcomes
      .map((oc) => ({
        outcome: oc,
        outputs: selectedProgramOutputs.filter((op) => op.outcomeId === oc.id),
      }))
      .filter((group) => group.outputs.length > 0);
  }, [selectedProgram, outcomes, selectedProgramOutputs]);

  // Toggle Show / Hide Activity for an Output
  const toggleShowActivities = (outputId: string) => {
    setExpandedOutputActivityMap((prev) => ({
      ...prev,
      [outputId]: !prev[outputId],
    }));
  };

  // Open RACI Editor Modal for an Output
  const handleOpenRaciEditor = (output: Output) => {
    const raci = getOutputRaci(output);
    setEditingRaciOutput(output);
    setDraftResponsibleId(raci.responsibleUserId || '');
    setDraftAccountableId(raci.accountableUserId || financeManagerUser?.id || '');
    setDraftConsulted([...(raci.consultedUsers || [])]);
    setDraftInformed([...(raci.informedUsers || [])]);
    setManualConsultedInput('');
    setManualInformedInput('');
  };

  const handleTogglePersonInList = (
    name: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    if (list.includes(name)) {
      setList(list.filter((n) => n !== name));
    } else {
      setList([...list, name]);
    }
  };

  const handleAddManualPerson = (
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!list.includes(trimmed)) {
      setList([...list, trimmed]);
    }
    setInput('');
  };

  const handleSaveRaciAssignment = async () => {
    if (!editingRaciOutput) return;
    if (!draftResponsibleId || !draftAccountableId) {
      setFeedbackBanner({
        type: 'error',
        message:
          'R (Responsible) dan A (Accountable) wajib dipilih (masing-masing 1 user terdaftar).',
      });
      return;
    }

    try {
      setSavingRaci(true);
      const outc = outcomes.find((oc) => oc.id === editingRaciOutput.outcomeId);
      const saved = await api.saveOutputRaci(editingRaciOutput.id, {
        programId: outc?.programId || '',
        outcomeId: editingRaciOutput.outcomeId,
        responsibleUserId: draftResponsibleId,
        accountableUserId: draftAccountableId,
        consultedUsers: draftConsulted,
        informedUsers: draftInformed,
      });
      setRaciMap((prev) => ({ ...prev, [editingRaciOutput.id]: saved }));
      setEditingRaciOutput(null);
      if (onRaciChanged) onRaciChanged();
      setFeedbackBanner({
        type: 'success',
        message: `Penugasan RACI untuk Output "${editingRaciOutput.name}" disimpan dengan status: ${saved.status}.`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Gagal menyimpan penugasan RACI.',
      });
    } finally {
      setSavingRaci(false);
    }
  };

  const handleDirectorDecision = async (
    output: Output,
    decision: 'approve' | 'revision',
    notes?: string
  ) => {
    try {
      const saved = await api.approveOutputRaci(output.id, {
        decision,
        directorNotes: notes,
      });
      setRaciMap((prev) => ({ ...prev, [output.id]: saved }));
      setApprovingOutputId(null);
      setDirectorNotesInput('');
      if (onRaciChanged) onRaciChanged();
      setFeedbackBanner({
        type: 'success',
        message:
          decision === 'approve'
            ? `Penugasan RACI pada Output "${output.name}" telah disetujui Direktur dan kini Aktif.`
            : `Penugasan RACI pada Output "${output.name}" dikembalikan ke Program Manager untuk revisi.`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Gagal memproses persetujuan RACI.',
      });
    }
  };

  // Open Activity Monitoring Tools Modal
  const handleOpenActivityToolsModal = (activity: Activity, output: Output) => {
    const mon = getActivityMonitoring(activity);
    const outc = outcomes.find((oc) => oc.id === output.outcomeId);
    setEditingActivity({ activity, output, outcome: outc });
    setDraftTools([...(mon.tools || [])]);
    setToolSearchQuery('');
    setSelectedCategoryFilter('ALL');
  };

  const handleToggleCatalogTool = (item: MonitoringToolCatalogItem) => {
    const exists = draftTools.some((t) => t.toolId === item.id);
    if (exists) {
      setDraftTools((prev) => prev.filter((t) => t.toolId !== item.id));
    } else {
      setDraftTools((prev) => [
        ...prev,
        {
          toolId: item.id,
          toolName: item.name,
          categoryCode: item.categoryCode,
          categoryName: item.categoryName,
          shortFunction: item.shortFunction,
          toolUrl: '',
          notes: '',
          assignedAt: new Date().toISOString(),
          assignedById: currentUser?.id || '',
          assignedByName: currentUser?.name || '',
        },
      ]);
    }
  };

  const handleUpdateDraftToolMeta = (
    toolId: string,
    field: 'toolUrl' | 'notes',
    value: string
  ) => {
    setDraftTools((prev) =>
      prev.map((t) => (t.toolId === toolId ? { ...t, [field]: value } : t))
    );
  };

  const handleSaveActivityTools = async () => {
    if (!editingActivity) return;
    try {
      setSavingActivityTools(true);
      const saved = await api.saveActivityMonitoringTools(editingActivity.activity.id, {
        outputId: editingActivity.output.id,
        outcomeId: editingActivity.outcome?.id || editingActivity.output.outcomeId,
        programId: editingActivity.outcome?.programId || '',
        tools: draftTools,
      });
      setActivityMonMap((prev) => ({
        ...prev,
        [editingActivity.activity.id]: saved,
      }));
      setEditingActivity(null);
      setFeedbackBanner({
        type: 'success',
        message: `Monitoring Tools untuk Activity "${editingActivity.activity.name}" disimpan (${saved.status}).`,
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Gagal menyimpan Monitoring Tools Activity.',
      });
    } finally {
      setSavingActivityTools(false);
    }
  };

  // Filtered tools inside modal
  const filteredModalCatalog = useMemo(() => {
    const q = toolSearchQuery.trim().toLowerCase();
    return MONITORING_TOOLS_LIBRARY.filter((tool) => {
      const matchCategory =
        selectedCategoryFilter === 'ALL' || tool.categoryCode === selectedCategoryFilter;
      const matchQuery =
        !q ||
        tool.name.toLowerCase().includes(q) ||
        tool.shortFunction.toLowerCase().includes(q) ||
        tool.categoryName.toLowerCase().includes(q);
      return matchCategory && matchQuery;
    });
  }, [toolSearchQuery, selectedCategoryFilter]);

  // Filtered tools inside Library modal
  const filteredLibraryCatalog = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return MONITORING_TOOLS_LIBRARY.filter((tool) => {
      const matchCategory =
        libraryCategory === 'ALL' || tool.categoryCode === libraryCategory;
      const matchQuery =
        !q ||
        tool.name.toLowerCase().includes(q) ||
        tool.shortFunction.toLowerCase().includes(q) ||
        tool.categoryName.toLowerCase().includes(q);
      return matchCategory && matchQuery;
    });
  }, [librarySearch, libraryCategory]);

  // Render RACI Status Label (Clean Typographic Metadata)
  const renderRaciStatusText = (status: OutputRaciStatus) => {
    if (status === 'Aktif') {
      return <span className="text-emerald-700 font-medium">RACI Aktif</span>;
    }
    if (status === 'Menunggu Persetujuan Direktur') {
      return <span className="text-amber-700 font-medium">Menunggu Persetujuan Direktur</span>;
    }
    return <span className="text-[#787774] font-medium">Menunggu Program Manager</span>;
  };

  // Render Activity Monitoring Status Text
  const renderActivityMonitoringText = (
    status: 'Sudah Ada Monitoring' | 'Belum Ada Monitoring'
  ) => {
    if (status === 'Sudah Ada Monitoring') {
      return <span className="text-emerald-700 font-medium">Monitoring Tersedia</span>;
    }
    return <span className="text-[#787774]">Belum Ada Monitoring</span>;
  };

  // Render Activity ToR Status Text
  const renderActivityTorText = (hasTor: boolean, torCount: number) => {
    if (hasTor) {
      return (
        <span className="text-[#37352F] font-medium">
          ToR Tersedia{torCount > 1 ? ` (${torCount})` : ''}
        </span>
      );
    }
    return <span className="text-[#787774]">ToR Belum Dibuat</span>;
  };

  // Render Panduan Role & Fungsi Tanggung Jawab RACI Table
  const renderRaciGuideTable = (onClose?: () => void, embedded = false) => (
    <div
      className={
        embedded
          ? 'border-t border-[#EAEAEA] bg-[#F7F7F5]'
          : 'rounded-lg border border-[#EAEAEA] bg-white overflow-hidden'
      }
    >
      <div className="px-4 py-2.5 bg-[#F7F7F5] border-b border-[#EAEAEA] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#37352F]">
          <HelpCircle className="w-3.5 h-3.5 text-[#787774] shrink-0" />
          <span>Panduan Peran &amp; Fungsi Tanggung Jawab RACI</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[#9B9A97] hover:text-[#37352F] p-0.5 cursor-pointer"
            title="Tutup panduan RACI"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="overflow-x-auto bg-white">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#FAF9F6] border-b border-[#EAEAEA] text-[11px] font-semibold text-[#787774]">
              <th className="py-2.5 px-4 w-60 border-r border-[#EAEAEA]">Role</th>
              <th className="py-2.5 px-4">Fungsi dan Tanggung Jawab</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAEAEA]">
            {RACI_ROLE_GUIDE.map((item) => (
              <tr key={item.role} className="hover:bg-[#FAF9F6] transition-colors">
                <td className="py-2.5 px-4 font-semibold text-[#37352F] border-r border-[#EAEAEA] align-top whitespace-nowrap">
                  {item.role}
                </td>
                <td className="py-2.5 px-4 text-[#5A5A58] leading-relaxed align-top">
                  {item.responsibility}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Feedback Notification Banner */}
      {feedbackBanner && (
        <div
          className={`px-4 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedbackBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="p-0.5 hover:opacity-75 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* RINGKASAN APPROVAL & PEMBARUAN RACI TERBARU (DIRECTOR & PM)        */}
      {/* ================================================================== */}
      {(() => {
        if (!currentUser) return null;

        const isNotifRead = (n: ApprovalNotificationItem) =>
          Boolean(currentUser && (n.isReadByUserIds || []).includes(currentUser.id));

        const myRaciNotifications = [...notifications]
          .filter((n) => n.approvalItemId?.startsWith('raci-'))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const unreadNotifCount = myRaciNotifications.filter((n) => !isNotifRead(n)).length;

        // Live Output RACI summary across all visible outputs
        const allVisibleOutputs = outputs.filter((op) => {
          const oc = outcomes.find((o) => o.id === op.outcomeId);
          return oc && filteredPrograms.some((p) => p.id === oc.programId);
        });

        const pendingDirectorOutputs = allVisibleOutputs.filter(
          (op) => getOutputRaci(op).status === 'Menunggu Persetujuan Direktur'
        );
        const needPmUpdateOutputs = allVisibleOutputs.filter(
          (op) => getOutputRaci(op).status === 'Menunggu Program Manager'
        );
        const revisionOutputs = needPmUpdateOutputs.filter((op) =>
          Boolean(getOutputRaci(op).directorNotes)
        );
        const activeOutputs = allVisibleOutputs.filter(
          (op) => getOutputRaci(op).status === 'Aktif'
        );

        const actionableOutputs = [...pendingDirectorOutputs, ...needPmUpdateOutputs];
        const totalActionableItems = actionableOutputs.length;

        if (!canApproveRaci && !canAssignRaci && totalActionableItems === 0 && unreadNotifCount === 0) {
          return null;
        }

        return (
          <div className="bg-white rounded-lg border border-[#E6E5E2] overflow-hidden">
            {/* Compact Single-Row Summary Bar */}
            <div
              onClick={() => setShowFollowUpInbox((prev) => !prev)}
              className={`px-3.5 py-2 bg-[#FAF9F6] flex flex-wrap items-center justify-between gap-2 select-none cursor-pointer hover:bg-[#F4F3EF]/70 transition-colors ${
                showFollowUpInbox ? 'border-b border-[#E6E5E2]' : ''
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded bg-[#E7F3F8] border border-[#C5DFEE] text-[#2E75B6] flex items-center justify-center shrink-0">
                  <Bell className="w-3 h-3" />
                </div>
                <span className="text-[11.5px] font-bold uppercase tracking-wider text-[#2F3437]">
                  Ringkasan Approval &amp; Update RACI Terbaru
                </span>

                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10.5px] font-semibold font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  {pendingDirectorOutputs.length} Menunggu Direktur
                </span>

                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F4F3EF] text-[#37352F] border border-[#E3E2E0] text-[10.5px] font-semibold font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#787774]" />
                  {needPmUpdateOutputs.length} Perlu Update PM
                  {revisionOutputs.length > 0 ? ` (${revisionOutputs.length} Revisi)` : ''}
                </span>

                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10.5px] font-semibold font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                  {activeOutputs.length} RACI Aktif
                </span>

                {unreadNotifCount > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#2F3437] text-white text-[10px] font-mono font-semibold">
                    {unreadNotifCount} Notif Baru
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {unreadNotifCount > 0 && onMarkNotificationRead && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkNotificationRead(undefined, true);
                    }}
                    className="h-6 px-2 rounded border border-[#E3E2E0] bg-white hover:bg-[#F4F3EF] text-[10.5px] font-medium text-[#57564F] transition-colors cursor-pointer"
                  >
                    Tandai Semua Dibaca
                  </button>
                )}
                <span className="text-[11px] font-medium text-[#57564F] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#E3E2E0] bg-white">
                  {showFollowUpInbox ? (
                    <>
                      <span>Hide</span>
                      <ChevronUp className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      <span>
                        Lihat Daftar Perlu Update ({totalActionableItems})
                      </span>
                      <ChevronDown className="w-3 h-3" />
                    </>
                  )}
                </span>
              </div>
            </div>

            {showFollowUpInbox && (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F7F7F5] border-b border-[#EAEAEA] text-[10px] font-bold uppercase tracking-wider text-[#787774]">
                      <th className="py-1.5 px-3">Output &amp; Program</th>
                      <th className="py-1.5 px-3">R &amp; A1 Saat Ini</th>
                      <th className="py-1.5 px-3">Status Approval Terbaru</th>
                      <th className="py-1.5 px-3">Update Terakhir &amp; Catatan</th>
                      <th className="py-1.5 px-3 text-right">Tindak Lanjut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECEBE8]">
                    {(actionableOutputs.length > 0 ? actionableOutputs : allVisibleOutputs).map((op) => {
                      const raci = getOutputRaci(op);
                      const oc = outcomes.find((o) => o.id === op.outcomeId);
                      const prog = programs.find((p) => p.id === oc?.programId);
                      const latestAudit = getOutputRaciAuditList(op)[0];
                      const isPendingDir = raci.status === 'Menunggu Persetujuan Direktur';
                      const isNeedPm = raci.status === 'Menunggu Program Manager';
                      const hasRevision = Boolean(raci.directorNotes && raci.status !== 'Aktif');

                      return (
                        <tr key={op.id} className="hover:bg-[#FAF9F6] transition-colors">
                          <td className="py-2 px-3 min-w-[220px]">
                            <div className="font-semibold text-[#2F3437] leading-snug">
                              {op.name}
                            </div>
                            <div className="text-[10.5px] text-[#787774] truncate max-w-xs">
                              {prog?.name || '-'}
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-[11px]">
                            <div>
                              <span className="font-mono font-semibold text-[#787774]">R:</span>{' '}
                              <span className="font-medium text-[#2F3437]">
                                {raci.responsibleUserName || 'Belum diatur'}
                              </span>
                            </div>
                            <div>
                              <span className="font-mono font-semibold text-[#787774]">A1:</span>{' '}
                              <span className="font-medium text-[#2F3437]">
                                {raci.accountableUserName || 'Belum diatur'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded border text-[10.5px] font-semibold ${
                                isPendingDir
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : hasRevision
                                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                                  : isNeedPm
                                  ? 'bg-stone-100 text-stone-700 border-stone-200'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              }`}
                            >
                              {hasRevision ? 'Perlu Revisi Direktur' : raci.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-[11px] text-[#57564F] max-w-xs">
                            {latestAudit ? (
                              <div className="truncate">
                                <span className="font-medium text-[#2F3437]">
                                  {latestAudit.action}
                                </span>{' '}
                                oleh {latestAudit.actorName}
                              </div>
                            ) : (
                              <div className="text-[#9B9A97]">Belum ada riwayat approval</div>
                            )}
                            {raci.directorNotes && (
                              <div className="text-[10.5px] text-amber-800 truncate">
                                Catatan: &ldquo;{raci.directorNotes}&rdquo;
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {canApproveRaci && isPendingDir && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDirectorDecision(
                                      op,
                                      'approve',
                                      'Penugasan R & A disetujui Direktur.'
                                    )
                                  }
                                  className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[#2F3437] hover:bg-[#37352F] text-white text-[10.5px] font-medium cursor-pointer"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Setujui</span>
                                </button>
                              )}
                              {canAssignRaci && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (oc?.programId) {
                                      setSelectedProgramId(oc.programId);
                                    }
                                    handleOpenRaciEditor(op);
                                  }}
                                  className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-[10.5px] font-medium cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>{isNeedPm ? 'Update RACI' : 'Atur RACI'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (oc?.programId) {
                                    setSelectedProgramId(oc.programId);
                                  }
                                }}
                                className="inline-flex items-center h-6 px-2 rounded border border-[#E3E2E0] bg-[#FAF9F6] hover:bg-[#EFEFED] text-[#37352F] text-[10.5px] font-medium cursor-pointer"
                              >
                                Buka →
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ================================================================== */}
      {/* VIEW 1: LIST PROGRAM — PENUGASAN YANG DIPERCAYAKAN                 */}
      {/* ================================================================== */}
      {!selectedProgram && (
        <div className="space-y-3">
          {/* Compact Single-Row Toolbar Header */}
          <div className="bg-white rounded-lg border border-[#EAEAEA] overflow-hidden">
            <div className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-sm font-semibold text-[#37352F] tracking-tight">
                  Penugasan yang Dipercayakan
                </h2>
                <span className="px-2 py-0.5 rounded bg-[#FAF9F6] border border-[#E3E2E0] text-[11px] font-mono font-medium text-[#57564F]">
                  {filteredPrograms.length} Program
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowGlobalRaciGuide((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11.5px] font-medium transition-colors cursor-pointer ${
                    showGlobalRaciGuide
                      ? 'bg-[#2F3437] text-white border-[#2F3437]'
                      : 'border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F]'
                  }`}
                  title="Lihat panduan Role dan Fungsi & Tanggung Jawab RACI"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Panduan RACI</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowLibraryModal(true)}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-[11.5px] font-medium transition-colors cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Library Tools ({MONITORING_TOOLS_LIBRARY.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowCornerRaciAudit((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11.5px] font-medium transition-colors cursor-pointer ${
                    showCornerRaciAudit
                      ? 'bg-[#2F3437] text-white border-[#2F3437]'
                      : 'border-[#E3E2E0] bg-[#FAF9F6] hover:bg-[#F0EFEA] text-[#37352F]'
                  }`}
                  title="Tampilkan atau sembunyikan Riwayat Audit RACI"
                >
                  <History className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Riwayat Audit ({allRaciAuditEntries.length})</span>
                  <span className="text-[10px] opacity-80">
                    {showCornerRaciAudit ? 'Hide' : 'Show'}
                  </span>
                </button>
              </div>
            </div>

            {showCornerRaciAudit && (
              <div className="px-3.5 py-2.5 bg-[#FAF9F6] border-t border-[#EAEAEA] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#37352F]">
                    <History className="w-3.5 h-3.5 text-[#787774]" />
                    <span>Riwayat Audit Penugasan &amp; Revisi RACI Output</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCornerRaciAudit(false)}
                    className="text-[11px] text-[#787774] hover:text-[#2F3437] font-medium cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
                {allRaciAuditEntries.length === 0 ? (
                  <div className="text-[11px] text-[#787774]">Belum ada riwayat audit RACI.</div>
                ) : (
                  <div className="max-h-40 overflow-y-auto divide-y divide-[#EAEAEA] bg-white rounded-md border border-[#E3E2E0]">
                    {allRaciAuditEntries.slice(0, 12).map((aud) => (
                      <div
                        key={aud.id}
                        className="px-3 py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
                      >
                        <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.2 rounded font-semibold text-[10px] ${
                              aud.action.toLowerCase().includes('revisi')
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : aud.status === 'Aktif'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-stone-100 text-stone-700 border border-stone-200'
                            }`}
                          >
                            {aud.action}
                          </span>
                          <span className="font-semibold text-[#37352F] truncate">
                            {aud.outputName}
                          </span>
                          {aud.notes && (
                            <span className="text-[#5A5A58] truncate">· Catatan: {aud.notes}</span>
                          )}
                        </div>
                        <div className="text-[10.5px] text-[#787774] font-mono shrink-0">
                          {aud.actorName} ·{' '}
                          {aud.timestamp
                            ? new Date(aud.timestamp).toLocaleString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showGlobalRaciGuide && renderRaciGuideTable(() => setShowGlobalRaciGuide(false), true)}
          </div>

          {/* Program List Container */}
          <div className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-[#787774] text-xs">
                Memuat daftar program...
              </div>
            ) : filteredPrograms.length === 0 ? (
              <div className="py-16 text-center text-[#787774] space-y-2">
                <FileText className="w-7 h-7 text-stone-300 mx-auto" />
                <p className="font-medium text-[#37352F] text-sm">
                  Belum ada Program dengan Output yang ditugaskan kepada Anda
                </p>
              </div>
            ) : (
              filteredPrograms.map((prog, index) => {
                const progOutcomes = outcomes.filter((oc) => oc.programId === prog.id);
                const progOutcomeIds = new Set(progOutcomes.map((oc) => oc.id));
                const allProgOutputs = outputs.filter((op) => progOutcomeIds.has(op.outcomeId));
                const progOutputs = isStrictAssignedView
                  ? allProgOutputs.filter((op) => isOutputAssignedToCurrentUser(op))
                  : allProgOutputs;
                const progOutputIds = new Set(progOutputs.map((op) => op.id));
                const progActivities = activities.filter((a) => progOutputIds.has(a.outputId));

                const activeRaciCount = progOutputs.filter(
                  (op) => getOutputRaci(op).status === 'Aktif'
                ).length;
                const pendingDirCount = progOutputs.filter(
                  (op) => getOutputRaci(op).status === 'Menunggu Persetujuan Direktur'
                ).length;
                const needPmCount = progOutputs.filter(
                  (op) => getOutputRaci(op).status === 'Menunggu Program Manager'
                ).length;
                const monitoredActCount = progActivities.filter(
                  (a) => getActivityMonitoring(a).status === 'Sudah Ada Monitoring'
                ).length;

                return (
                  <div
                    key={prog.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedProgramId(prog.id);
                      setOutputSearch('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedProgramId(prog.id);
                        setOutputSearch('');
                      }
                    }}
                    className="px-5 py-3.5 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr_auto] items-center gap-4 bg-white hover:bg-[#FAF9F6] transition-colors cursor-pointer group outline-none"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#787774]">
                        <span>Status: {prog.status}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums text-[#37352F] font-medium">
                          {progOutputs.length} Output / {progActivities.length} Activity
                        </span>
                      </div>

                      <h3 className="text-[15px] font-semibold text-[#37352F] group-hover:text-[#252525] transition-colors leading-snug break-words">
                        {prog.name}
                      </h3>

                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-[#787774] font-mono tabular-nums pt-0.5">
                        <span>
                          RACI Aktif: <strong className="text-[#37352F]">{activeRaciCount}/{progOutputs.length}</strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Monitoring Tools: <strong className="text-[#37352F]">{monitoredActCount}/{progActivities.length}</strong>
                        </span>
                      </div>
                    </div>

                    {/* Kolom Ringkasan Approval Terbaru */}
                    <div className="lg:border-l lg:border-[#EAEAEA] lg:pl-4 space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#787774]">
                        Ringkasan Approval RACI Terbaru
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                        {pendingDirCount > 0 && (
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                            {pendingDirCount} Menunggu Direktur
                          </span>
                        )}
                        {needPmCount > 0 && (
                          <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200 font-semibold">
                            {needPmCount} Perlu Update PM
                          </span>
                        )}
                        {pendingDirCount === 0 && needPmCount === 0 && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                            Semua Output Disetujui ({activeRaciCount}/{progOutputs.length})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProgramId(prog.id);
                          setOutputSearch('');
                        }}
                        className="h-8 px-3.5 rounded-md border border-[#E3E2E0] bg-white group-hover:bg-[#2F3437] group-hover:text-white group-hover:border-[#2F3437] text-[#37352F] text-xs font-medium transition-colors cursor-pointer"
                      >
                        Buka Penugasan Output →
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* VIEW 2: OUTCOME → OUTPUT → ACTIVITY (PENUGASAN YANG DIPERCAYAKAN)  */}
      {/* ================================================================== */}
      {selectedProgram && (
        <div className="space-y-3">
          {/* Compact Single-Row Program Header & Toolbar (Zero Space Waste) */}
          <div className="bg-white rounded-lg border border-[#EAEAEA] overflow-hidden">
            <div className="px-3.5 py-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
              {/* Kiri: Tombol Kembali, Nama Program & Jumlah Output dalam 1 Baris Rapi */}
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedProgramId(null)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded border border-[#E3E2E0] bg-[#FAF9F6] hover:bg-[#F0EFEA] text-xs font-medium text-[#37352F] cursor-pointer shrink-0 transition-colors"
                >
                  <span>← Daftar Program</span>
                </button>
                <h2 className="text-sm font-semibold text-[#37352F] leading-snug truncate max-w-xl">
                  {selectedProgram.name}
                </h2>
                <span className="px-2 py-0.5 rounded bg-[#FAF9F6] border border-[#E3E2E0] font-mono text-[11px] font-medium text-[#5A5A58] tabular-nums shrink-0">
                  {selectedProgramOutputs.length} Output
                </span>
              </div>

              {/* Kanan: Pencarian, Scope Filter, Panduan RACI, Library & Audit */}
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <div className="relative w-full sm:w-52">
                  <Search className="w-3.5 h-3.5 text-[#9B9A97] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={outputSearch}
                    onChange={(e) => setOutputSearch(e.target.value)}
                    placeholder="Cari output / personel RACI..."
                    className="w-full h-7 pl-7 pr-2.5 bg-[#FAF9F6] focus:bg-white border border-[#E3E2E0] focus:border-[#787774] rounded-md text-xs text-[#37352F] focus:outline-none transition-colors"
                  />
                </div>

                {canViewAllScope && (
                  <div className="inline-flex rounded-md border border-[#E3E2E0] bg-[#EFEFED] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setViewScope('ALL')}
                      className={`px-2 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap ${
                        viewScope === 'ALL'
                          ? 'bg-white text-[#37352F] font-medium shadow-2xs'
                          : 'text-[#787774] hover:text-[#37352F]'
                      }`}
                    >
                      Semua Output
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewScope('ASSIGNED')}
                      className={`px-2 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap ${
                        viewScope === 'ASSIGNED'
                          ? 'bg-white text-[#37352F] font-medium shadow-2xs'
                          : 'text-[#787774] hover:text-[#37352F]'
                      }`}
                    >
                      Penugasan Saya
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowGlobalRaciGuide((prev) => !prev)}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 ${
                    showGlobalRaciGuide
                      ? 'bg-[#2F3437] text-white border-[#2F3437]'
                      : 'border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F]'
                  }`}
                  title="Lihat panduan Role dan Fungsi & Tanggung Jawab RACI"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Panduan RACI</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowLibraryModal(true)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-[11.5px] font-medium transition-colors cursor-pointer shrink-0"
                >
                  <BookOpen className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Library</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowCornerRaciAudit((prev) => !prev)}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 ${
                    showCornerRaciAudit
                      ? 'bg-[#2F3437] text-white border-[#2F3437]'
                      : 'border-[#E3E2E0] bg-[#FAF9F6] hover:bg-[#F0EFEA] text-[#37352F]'
                  }`}
                  title="Tampilkan atau sembunyikan Riwayat Audit RACI"
                >
                  <History className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Audit ({allRaciAuditEntries.length})</span>
                  <span className="text-[10px] opacity-80">
                    {showCornerRaciAudit ? 'Hide' : 'Show'}
                  </span>
                </button>
              </div>
            </div>

            {showCornerRaciAudit && (
              <div className="px-3.5 py-2.5 bg-[#FAF9F6] border-t border-[#EAEAEA] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#37352F]">
                    <History className="w-3.5 h-3.5 text-[#787774]" />
                    <span>Riwayat Audit Penugasan &amp; Revisi RACI Output</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCornerRaciAudit(false)}
                    className="text-[11px] text-[#787774] hover:text-[#2F3437] font-medium cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
                {allRaciAuditEntries.length === 0 ? (
                  <div className="text-[11px] text-[#787774]">Belum ada riwayat audit RACI.</div>
                ) : (
                  <div className="max-h-40 overflow-y-auto divide-y divide-[#EAEAEA] bg-white rounded-md border border-[#E3E2E0]">
                    {allRaciAuditEntries.map((aud) => (
                      <div
                        key={aud.id}
                        className="px-3 py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
                      >
                        <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.2 rounded font-semibold text-[10px] ${
                              aud.action.toLowerCase().includes('revisi')
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : aud.status === 'Aktif'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-stone-100 text-stone-700 border border-stone-200'
                            }`}
                          >
                            {aud.action}
                          </span>
                          <span className="font-semibold text-[#37352F] truncate">
                            {aud.outputName}
                          </span>
                          {aud.notes && (
                            <span className="text-[#5A5A58] truncate">· Catatan: {aud.notes}</span>
                          )}
                        </div>
                        <div className="text-[10.5px] text-[#787774] font-mono shrink-0">
                          {aud.actorName} ·{' '}
                          {aud.timestamp
                            ? new Date(aud.timestamp).toLocaleString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showGlobalRaciGuide && renderRaciGuideTable(() => setShowGlobalRaciGuide(false), true)}
          </div>

          {/* Outcome -> Output -> Activity Hierarchy Container */}
          {selectedProgramOutcomeGroups.length === 0 ? (
            <div className="bg-white rounded-lg border border-[#EAEAEA] py-16 text-center text-[#787774] text-xs">
              Tidak ada Output yang ditugaskan kepada Anda pada program ini.
            </div>
          ) : (
            <div className="space-y-4">
              {selectedProgramOutcomeGroups.map(({ outcome, outputs: groupOutputs }, ocIdx) => (
                <div
                  key={outcome.id}
                  className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden"
                >
                  {/* Outcome Header Bar */}
                  <div className="px-5 py-3 bg-[#F7F7F5] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono font-semibold text-[#5A5A58] shrink-0">
                        Outcome {String(ocIdx + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[#D3D1CB]" aria-hidden="true">·</span>
                      <span className="text-xs font-semibold text-[#37352F] break-words">
                        {outcome.name}
                      </span>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-[#787774] shrink-0">
                      {groupOutputs.length} Output
                    </span>
                  </div>

                  {/* Outputs inside this Outcome */}
                  {groupOutputs.map((output, outputIdx) => {
                    const raci = getOutputRaci(output);
                    const outputActivities = activities.filter(
                      (act) => act.outputId === output.id
                    );
                    const monitoredCount = outputActivities.filter(
                      (a) => getActivityMonitoring(a).status === 'Sudah Ada Monitoring'
                    ).length;
                    const editPerm = canEditOutputMonitoring(output);
                    const myRaciRole = getUserRaciRoleForOutput(output);
                    const isActivitiesShown = Boolean(expandedOutputActivityMap[output.id]);
                    const firstActivity = outputActivities[0];

                    return (
                      <div key={output.id} className="p-5 space-y-4">
                        {/* Section 1: Output Title & Action Toolbar */}
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            {/* Clean Unboxed Metadata Row */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#787774]">
                              <span className="font-mono font-semibold text-[#5A5A58]">
                                Output #{outputIdx + 1}
                              </span>
                              <span aria-hidden="true">·</span>
                              {renderRaciStatusText(raci.status)}
                              {myRaciRole && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-[#37352F] font-medium">
                                    Peran Anda: {myRaciRole}
                                  </span>
                                </>
                              )}
                            </div>

                            {/* Output Title */}
                            <h4 className="text-[15px] font-semibold text-[#37352F] leading-snug">
                              {output.name}
                            </h4>
                          </div>

                          {/* Right Uniform Action Toolbar */}
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {editPerm.allowed &&
                              onOpenCreateTorForActivity &&
                              firstActivity && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenCreateTorForActivity(
                                      output.outcomeId,
                                      output.id,
                                      firstActivity.id
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-xs font-medium transition-colors cursor-pointer"
                                  title="Buat ToR untuk Output ini"
                                >
                                  <Plus className="w-3.5 h-3.5 text-[#787774]" />
                                  <span>Create ToR</span>
                                </button>
                              )}

                            {canAssignRaci && (
                              <button
                                type="button"
                                onClick={() => handleOpenRaciEditor(output)}
                                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-xs font-medium transition-colors cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#787774]" />
                                <span>Atur RACI</span>
                              </button>
                            )}

                            {canApproveRaci &&
                              raci.status === 'Menunggu Persetujuan Direktur' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDirectorDecision(
                                        output,
                                        'approve',
                                        'Penugasan R & A disetujui Direktur.'
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[#2F3437] hover:bg-[#37352F] text-white text-xs font-medium transition-colors cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Setujui</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setApprovingOutputId(
                                        approvingOutputId === output.id ? null : output.id
                                      )
                                    }
                                    className="h-8 px-3 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-xs font-medium transition-colors cursor-pointer"
                                  >
                                    Revisi
                                  </button>
                                </>
                              )}

                            <button
                              type="button"
                              onClick={() => toggleShowActivities(output.id)}
                              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-colors cursor-pointer font-mono tabular-nums ${
                                isActivitiesShown
                                  ? 'bg-[#2F3437] text-white border-[#2F3437]'
                                  : 'bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F] border-[#E3E2E0]'
                              }`}
                            >
                              <span className="font-sans">
                                Activity ({monitoredCount}/{outputActivities.length})
                              </span>
                              {isActivitiesShown ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Optional Director Revision Notes Box */}
                        {approvingOutputId === output.id && canApproveRaci && (
                          <div className="p-3 rounded-md bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row gap-2 text-xs">
                            <input
                              type="text"
                              value={directorNotesInput}
                              onChange={(e) => setDirectorNotesInput(e.target.value)}
                              placeholder="Catatan revisi Direktur untuk Program Manager..."
                              className="flex-1 h-8 px-3 rounded border border-amber-300 bg-white text-stone-800 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleDirectorDecision(output, 'revision', directorNotesInput)
                              }
                              className="h-8 px-3.5 rounded bg-amber-800 text-white font-medium cursor-pointer"
                            >
                              Kirim Revisi
                            </button>
                          </div>
                        )}

                        {/* Section 2: RACI Assignment Matrix — Professional Mission Ticket Design */}
                        <div className="relative rounded-xl border border-[#DFDDD7] bg-gradient-to-br from-[#FFFFFF] via-[#FDFCFB] to-[#F8F7F3] shadow-[0_2px_10px_-4px_rgba(28,25,23,0.08)] overflow-hidden">
                          {/* Ticket Left Accent Status Bar */}
                          <div
                            className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                              raci.status === 'Aktif'
                                ? 'bg-gradient-to-b from-emerald-600 via-teal-600 to-emerald-700'
                                : raci.status === 'Menunggu Persetujuan Direktur'
                                ? 'bg-gradient-to-b from-amber-500 via-orange-500 to-amber-600'
                                : 'bg-gradient-to-b from-stone-400 to-stone-500'
                            }`}
                          />

                          {/* Subtle Ticket Side Perforation Notches */}
                          <div
                            aria-hidden="true"
                            className="hidden sm:block absolute -left-2 top-[38px] w-3.5 h-3.5 rounded-full bg-white border border-[#DFDDD7] shadow-inner pointer-events-none"
                          />
                          <div
                            aria-hidden="true"
                            className="hidden sm:block absolute -right-2 top-[38px] w-3.5 h-3.5 rounded-full bg-white border border-[#DFDDD7] shadow-inner pointer-events-none"
                          />

                          {/* Top Ticket Header Stub */}
                          <div className="pl-5 pr-4 py-2.5 bg-[#F6F5F0] border-b border-dashed border-[#D6D3CD] flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#2F3437] text-[#F7F6F2] text-[10px] font-mono font-bold tracking-widest uppercase shadow-2xs">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    raci.status === 'Aktif'
                                      ? 'bg-emerald-400'
                                      : raci.status === 'Menunggu Persetujuan Direktur'
                                      ? 'bg-amber-400'
                                      : 'bg-stone-400'
                                  }`}
                                />
                                TIKET MISI #{String(outputIdx + 1).padStart(2, '0')}
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-bold text-[#2F3437] tracking-tight">
                                  Penugasan yang Dipercayakan
                                </span>
                                <span className="text-[11px] text-[#787774] hidden sm:inline">·</span>
                                <span className="text-[11px] font-medium text-[#6B6A65]">
                                  Matriks Peran &amp; Tanggung Jawab (RACI)
                                </span>
                              </div>
                              {myRaciRole && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200/90 text-[10.5px] font-bold text-emerald-800 shadow-2xs">
                                  ★ Mandat Anda: {myRaciRole}
                                </span>
                              )}
                              {raci.directorNotes && raci.status !== 'Aktif' && (
                                <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10.5px] font-medium text-amber-800">
                                  Revisi Direktur: &ldquo;{raci.directorNotes}&rdquo;
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="hidden md:inline-block text-[10px] font-mono text-[#8A8881] tracking-wider uppercase">
                                MANDAT-{output.id.slice(-4).toUpperCase()}
                              </span>
                              {(() => {
                                const outputAuditList = getOutputRaciAuditList(output);
                                const isAuditOpen = Boolean(expandedOutputRaciAuditMap[output.id]);
                                return (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedOutputRaciAuditMap((prev) => ({
                                        ...prev,
                                        [output.id]: !prev[output.id],
                                      }))
                                    }
                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md border border-[#DCD9D0] bg-white hover:bg-[#FAF9F6] text-[10.5px] font-semibold text-[#4A4945] transition-colors cursor-pointer shadow-2xs"
                                    title="Tampilkan atau sembunyikan riwayat audit RACI Output ini"
                                  >
                                    <History className="w-3 h-3 text-[#787774]" />
                                    <span>Riwayat Audit ({outputAuditList.length})</span>
                                  </button>
                                );
                              })()}
                            </div>
                          </div>

                          {expandedOutputRaciAuditMap[output.id] && (
                            <div className="pl-5 pr-4 py-2.5 bg-[#FAF9F6] border-b border-dashed border-[#DFDDD7] space-y-1.5">
                              {getOutputRaciAuditList(output).length === 0 ? (
                                <div className="text-[11px] text-[#787774]">
                                  Belum ada riwayat audit pada Output ini.
                                </div>
                              ) : (
                                getOutputRaciAuditList(output).map((aud) => (
                                  <div
                                    key={aud.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] bg-white px-2.5 py-1.5 rounded border border-[#E9E9E7]"
                                  >
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className={`px-1.5 py-0.2 rounded font-semibold text-[10px] ${
                                          aud.action.toLowerCase().includes('revisi')
                                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                            : aud.status === 'Aktif'
                                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                            : 'bg-stone-100 text-stone-700'
                                        }`}
                                      >
                                        {aud.action}
                                      </span>
                                      {aud.notes && (
                                        <span className="text-[#37352F]">{aud.notes}</span>
                                      )}
                                    </div>
                                    <span className="text-[10.5px] font-mono text-[#787774] shrink-0">
                                      {aud.actorName} ·{' '}
                                      {aud.timestamp
                                        ? new Date(aud.timestamp).toLocaleString('id-ID', {
                                            day: '2-digit',
                                            month: 'short',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })
                                        : '-'}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          )}

                          {/* 5-Column Mission Ticket Body (English on top, Indonesian directly below, no R/A/C/I letter boxes) */}
                          <div className="pl-1.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 lg:divide-x divide-[#EAE8E1]">
                            {/* Column 1: Responsible / Pelaksana */}
                            <div
                              className="p-3.5 space-y-2 hover:bg-[#FAF9F5]/60 transition-colors"
                              title="Responsible (Pelaksana): Pelaksana kegiatan, membuat ToR, mengelola Monitoring Tools, mengumpulkan bukti, dan melaporkan hasil."
                            >
                              <div className="border-b border-[#EAE8E1]/80 pb-1.5">
                                <div className="text-xs font-bold text-[#2F3437] leading-tight">
                                  Responsible
                                </div>
                                <div className="text-[11px] font-medium text-[#8A8881] leading-tight mt-0.5">
                                  Pelaksana
                                </div>
                              </div>
                              <div className="text-xs font-semibold text-[#2F3437] leading-snug break-words flex flex-wrap items-center gap-1.5">
                                <span>{raci.responsibleUserName || '-'}</span>
                                {raci.responsibleUserId &&
                                  users.some(
                                    (u) => u.id === raci.responsibleUserId && u.isActive === false
                                  ) && (
                                    <span className="px-1.5 py-0.2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-medium">
                                      Nonaktif
                                    </span>
                                  )}
                              </div>
                            </div>

                            {/* Column 2: Accountable / Penanggung Jawab */}
                            <div
                              className="p-3.5 space-y-2 hover:bg-[#FAF9F5]/60 transition-colors"
                              title="Accountable (Penanggung Jawab): Bertanggung jawab atas kualitas pencapaian Output program dan kepatuhan keuangan."
                            >
                              <div className="border-b border-[#EAE8E1]/80 pb-1.5">
                                <div className="text-xs font-bold text-[#2F3437] leading-tight">
                                  Accountable
                                </div>
                                <div className="text-[11px] font-medium text-[#8A8881] leading-tight mt-0.5">
                                  Penanggung Jawab
                                </div>
                              </div>
                              <div className="space-y-1.5 text-xs leading-snug">
                                {getAccountableNamesList(raci).map((acc, idx) => {
                                  const isA1Inactive =
                                    !acc.isAutoFinance &&
                                    raci.accountableUserId &&
                                    users.some(
                                      (u) => u.id === raci.accountableUserId && u.isActive === false
                                    );
                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-baseline justify-between gap-2"
                                    >
                                      <span className="font-semibold text-[#2F3437] break-words">
                                        {acc.name}
                                        {isA1Inactive && (
                                          <span className="ml-1.5 px-1.5 py-0.2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-medium">
                                            Nonaktif
                                          </span>
                                        )}
                                      </span>
                                      <span className="text-[10.5px] text-[#787774] shrink-0">
                                        {acc.isAutoFinance ? 'Finance' : 'Program'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Column 3: Consulted / Konsultasi Teknis */}
                            <div
                              className="p-3.5 space-y-2 hover:bg-[#FAF9F5]/60 transition-colors"
                              title="Consulted (Konsultasi Teknis): Pihak yang memberikan masukan, konsultasi, dan pertimbangan teknis."
                            >
                              <div className="border-b border-[#EAE8E1]/80 pb-1.5">
                                <div className="text-xs font-bold text-[#2F3437] leading-tight">
                                  Consulted
                                </div>
                                <div className="text-[11px] font-medium text-[#8A8881] leading-tight mt-0.5">
                                  Konsultasi Teknis
                                </div>
                              </div>
                              {raci.consultedUsers && raci.consultedUsers.length > 0 ? (
                                <div className="space-y-1 text-xs leading-snug">
                                  {raci.consultedUsers.map((person, idx) => {
                                    const isRealUser = isRegisteredUserName(person);
                                    return (
                                      <div
                                        key={idx}
                                        className="flex items-baseline justify-between gap-2"
                                      >
                                        <span className="text-[#2F3437] font-medium break-words">
                                          {person}
                                        </span>
                                        <span className="text-[10.5px] text-[#787774] shrink-0">
                                          {isRealUser ? 'Internal' : 'Eksternal'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-xs text-[#A8A29E]">-</div>
                              )}
                            </div>

                            {/* Column 4: Informed / Penerima Informasi */}
                            <div
                              className="p-3.5 space-y-2 hover:bg-[#FAF9F5]/60 transition-colors"
                              title="Informed (Penerima Informasi): Pihak yang menerima informasi perkembangan dan hasil kegiatan."
                            >
                              <div className="border-b border-[#EAE8E1]/80 pb-1.5">
                                <div className="text-xs font-bold text-[#2F3437] leading-tight">
                                  Informed
                                </div>
                                <div className="text-[11px] font-medium text-[#8A8881] leading-tight mt-0.5">
                                  Penerima Informasi
                                </div>
                              </div>
                              {raci.informedUsers && raci.informedUsers.length > 0 ? (
                                <div className="space-y-1 text-xs leading-snug">
                                  {raci.informedUsers.map((person, idx) => {
                                    const isRealUser = isRegisteredUserName(person);
                                    return (
                                      <div
                                        key={idx}
                                        className="flex items-baseline justify-between gap-2"
                                      >
                                        <span className="text-[#2F3437] font-medium break-words">
                                          {person}
                                        </span>
                                        <span className="text-[10.5px] text-[#787774] shrink-0">
                                          {isRealUser ? 'Internal' : 'Eksternal'}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-xs text-[#A8A29E]">-</div>
                              )}
                            </div>

                            {/* Column 5: Ticket Validation Stub (Approval Summary / Ringkasan Persetujuan) */}
                            {(() => {
                              const latestAudit = getOutputRaciAuditList(output)[0];
                              const isPendingDir = raci.status === 'Menunggu Persetujuan Direktur';
                              const isNeedPm = raci.status === 'Menunggu Program Manager';
                              const hasRevision = Boolean(raci.directorNotes && raci.status !== 'Aktif');
                              return (
                                <div className="p-3.5 space-y-2 bg-[#F6F5F0]/85 lg:border-l lg:border-dashed lg:border-[#D5D2CA] flex flex-col justify-between">
                                  <div className="space-y-1.5">
                                    <div className="border-b border-[#DFDDD7] pb-1.5">
                                      <div className="text-xs font-bold text-[#2F3437] leading-tight">
                                        Approval Summary
                                      </div>
                                      <div className="text-[11px] font-medium text-[#8A8881] leading-tight mt-0.5">
                                        Ringkasan Persetujuan
                                      </div>
                                    </div>
                                    <div className="pt-0.5">
                                      <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10.5px] font-semibold ${
                                          isPendingDir
                                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                                            : hasRevision
                                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                                            : isNeedPm
                                            ? 'bg-stone-100 text-stone-700 border-stone-200'
                                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                        }`}
                                      >
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full ${
                                            isPendingDir
                                              ? 'bg-amber-500'
                                              : hasRevision
                                              ? 'bg-rose-500'
                                              : isNeedPm
                                              ? 'bg-stone-400'
                                              : 'bg-emerald-500'
                                          }`}
                                        />
                                        {hasRevision ? 'Perlu Revisi Direktur' : raci.status}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-[#57564F] leading-snug">
                                      {isPendingDir ? (
                                        <span className="font-medium text-amber-800">
                                          Perlu: Persetujuan Direktur
                                        </span>
                                      ) : isNeedPm ? (
                                        <span className="font-medium text-[#37352F]">
                                          Perlu: Update RACI oleh PM
                                        </span>
                                      ) : (
                                        <span className="text-emerald-700 font-medium">
                                          Terverifikasi &amp; Aktif
                                        </span>
                                      )}
                                    </div>
                                    {raci.directorNotes && raci.status !== 'Aktif' && (
                                      <div className="text-[10.5px] text-rose-700 bg-rose-50/70 px-1.5 py-0.5 rounded border border-rose-200 leading-snug break-words">
                                        Catatan: &ldquo;{raci.directorNotes}&rdquo;
                                      </div>
                                    )}
                                    {latestAudit && (
                                      <div className="text-[10px] text-[#787774] font-mono truncate">
                                        {latestAudit.actorName}
                                        {latestAudit.timestamp
                                          ? ` · ${new Date(latestAudit.timestamp).toLocaleString('id-ID', {
                                              day: '2-digit',
                                              month: 'short',
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}`
                                          : ''}
                                      </div>
                                    )}
                                  </div>

                                  {(canApproveRaci && isPendingDir) || (canAssignRaci && isNeedPm) ? (
                                    <div className="pt-1.5 flex flex-wrap items-center gap-1.5">
                                      {canApproveRaci && isPendingDir && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDirectorDecision(
                                                output,
                                                'approve',
                                                'Penugasan R & A disetujui Direktur.'
                                              )
                                            }
                                            className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[#2F3437] hover:bg-[#37352F] text-white text-[10.5px] font-medium cursor-pointer"
                                          >
                                            <Check className="w-3 h-3" />
                                            <span>Setujui</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setApprovingOutputId(
                                                approvingOutputId === output.id ? null : output.id
                                              )
                                            }
                                            className="h-6 px-2 rounded border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-[10.5px] font-medium cursor-pointer"
                                          >
                                            Revisi
                                          </button>
                                        </>
                                      )}
                                      {canAssignRaci && isNeedPm && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenRaciEditor(output)}
                                          className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-[10.5px] font-medium cursor-pointer"
                                        >
                                          <Edit3 className="w-3 h-3" />
                                          <span>Update RACI</span>
                                        </button>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Section 3: Compact Activity List (Show / Hide) */}
                        {isActivitiesShown && (
                          <div className="border border-[#EAEAEA] rounded-lg divide-y divide-[#EAEAEA] overflow-hidden bg-white">
                            <div className="px-4 py-2 bg-[#F7F7F5] flex items-center justify-between text-xs font-semibold text-[#5A5A58]">
                              <span>Daftar Activity &amp; Monitoring Tools</span>
                              <span className="font-mono tabular-nums text-[#787774]">
                                {monitoredCount}/{outputActivities.length} Terhubung Monitoring Tools
                              </span>
                            </div>
                            {outputActivities.length === 0 ? (
                              <div className="p-4 text-xs text-[#787774]">
                                Belum ada Activity pada Output ini.
                              </div>
                            ) : (
                              outputActivities.map((act) => {
                                const mon = getActivityMonitoring(act);
                                const hasTools = mon.tools.length > 0;
                                return (
                                  <div
                                    key={act.id}
                                    className="px-4 py-2.5 space-y-1 bg-white hover:bg-[#FAF9F6] transition-colors"
                                  >
                                    {/* BARIS 1: Judul Activity Utuh (Terbaca Semua) di Kiri + Tombol Monitoring Tools Proporsional di Kanan */}
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div className="flex items-baseline gap-2 min-w-0 flex-1">
                                        {act.code && (
                                          <span className="font-mono text-xs font-semibold text-[#5A5A58] shrink-0">
                                            {act.code}
                                          </span>
                                        )}
                                        <span className="text-[13px] font-semibold text-[#2F3437] leading-snug">
                                          {act.name}
                                        </span>
                                      </div>

                                      {/* Kanan Baris 1: Tombol Kelola / Pilih Monitoring Tools */}
                                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        {editPerm.allowed ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenActivityToolsModal(act, output)
                                            }
                                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-[#2F3437] hover:bg-[#37352F] text-white text-[11.5px] font-medium cursor-pointer whitespace-nowrap transition-colors"
                                          >
                                            <ClipboardCheck className="w-3 h-3" />
                                            <span>
                                              {hasTools
                                                ? `Kelola Tools (${mon.tools.length})`
                                                : '+ Monitoring Tools'}
                                            </span>
                                          </button>
                                        ) : (
                                          <>
                                            {hasTools && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleOpenActivityToolsModal(act, output)
                                                }
                                                className="h-7 px-2.5 rounded-md border border-[#E3E2E0] bg-white hover:bg-[#F7F7F5] text-[#37352F] text-[11.5px] font-medium cursor-pointer whitespace-nowrap transition-colors"
                                              >
                                                Lihat Tools ({mon.tools.length})
                                              </button>
                                            )}
                                            {raci.status !== 'Aktif' && myRaciRole && (
                                              <span className="text-[11px] text-amber-700 whitespace-nowrap">
                                                Menunggu Persetujuan RACI Direktur
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    {/* BARIS 2: Status Monitoring & Daftar Instrumen Monitoring Tools (Tanpa Duplikasi Status Dokumen Approval) */}
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] min-w-0">
                                      <span className="shrink-0 whitespace-nowrap">
                                        {renderActivityMonitoringText(mon.status)}
                                      </span>

                                      {hasTools ? (
                                        <>
                                          <span
                                            className="text-[#D3D1CB] shrink-0"
                                            aria-hidden="true"
                                          >
                                            ·
                                          </span>
                                          <span className="text-[#5A5A58] min-w-0">
                                            {mon.tools.map((t, idx) => (
                                              <React.Fragment key={t.toolId}>
                                                {idx > 0 && (
                                                  <span className="mx-1.5 text-[#D3D1CB]">
                                                    ·
                                                  </span>
                                                )}
                                                <strong className="font-mono text-[#37352F]">
                                                  {t.toolId}
                                                </strong>{' '}
                                                <span>{t.toolName}</span>
                                              </React.Fragment>
                                            ))}
                                          </span>
                                        </>
                                      ) : (
                                        <>
                                          <span
                                            className="text-[#D3D1CB] shrink-0"
                                            aria-hidden="true"
                                          >
                                            ·
                                          </span>
                                          <span className="text-[#9B9A97]">
                                            Belum ada instrumen Monitoring Tools yang dipilih pada Activity ini.
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 1: RACI ASSIGNMENT PER OUTPUT (PROGRAM MANAGER)              */}
      {/* ================================================================== */}
      {editingRaciOutput && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg border border-stone-200 max-w-2xl w-full overflow-hidden shadow-lg my-8">
            <div className="px-5 py-3.5 border-b border-stone-200 flex items-center justify-between bg-[#F7F7F5]">
              <div>
                <h3 className="text-sm font-semibold text-[#252525]">
                  Penugasan RACI Output (Program Manager)
                </h3>
                <p className="text-xs text-[#787774] truncate max-w-md">
                  {editingRaciOutput.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRaciOutput(null)}
                className="p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
              {renderRaciGuideTable()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Responsible */}
                <div>
                  <label className="block mb-1">
                    <span className="block font-bold text-stone-900">Responsible *</span>
                    <span className="block text-[11px] text-stone-500">Pelaksana</span>
                  </label>
                  <select
                    value={draftResponsibleId}
                    onChange={(e) => setDraftResponsibleId(e.target.value)}
                    className="w-full h-9 px-2.5 rounded border border-stone-200 bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                  >
                    <option value="">-- Pilih User Responsible --</option>
                    {draftResponsibleId &&
                      !activeUsers.some((u) => u.id === draftResponsibleId) &&
                      (() => {
                        const inactiveR = users.find((u) => u.id === draftResponsibleId);
                        return inactiveR ? (
                          <option key={inactiveR.id} value={inactiveR.id}>
                            {inactiveR.name} — {inactiveR.roleTitle} (Nonaktif - Histori)
                          </option>
                        ) : null;
                      })()}
                    {activeUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.roleTitle}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Accountable */}
                <div>
                  <label className="block mb-1">
                    <span className="block font-bold text-stone-900">Accountable *</span>
                    <span className="block text-[11px] text-stone-500">Penanggung Jawab</span>
                  </label>
                  <select
                    value={draftAccountableId}
                    onChange={(e) => setDraftAccountableId(e.target.value)}
                    className="w-full h-9 px-2.5 rounded border border-stone-200 bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                  >
                    <option value="">-- Pilih User Accountable --</option>
                    {draftAccountableId &&
                      !activeUsers.some((u) => u.id === draftAccountableId) &&
                      (() => {
                        const inactiveA = users.find((u) => u.id === draftAccountableId);
                        return inactiveA ? (
                          <option key={inactiveA.id} value={inactiveA.id}>
                            {inactiveA.name} — {inactiveA.roleTitle} (Nonaktif - Histori)
                          </option>
                        ) : null;
                      })()}
                    {activeUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.roleTitle}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-stone-500">
                    + Otomatis menyertakan Finance Manager ({financeManagerUser?.name || 'Ratna Kusuma, S.E.'})
                  </p>
                </div>
              </div>

              {/* Consulted */}
              <div className="p-3.5 rounded-md border border-stone-200 bg-[#FAF9F6] space-y-2.5">
                <div>
                  <div className="font-bold text-stone-900">Consulted</div>
                  <div className="text-[11px] text-stone-500">Konsultasi Teknis</div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Kolom User Terdaftar */}
                  <div className="p-2.5 rounded border border-stone-200 bg-white space-y-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-400">
                      User Terdaftar
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeUsers.map((u) => {
                        const selected = draftConsulted.includes(u.name);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              handleTogglePersonInList(u.name, draftConsulted, setDraftConsulted)
                            }
                            className={`px-2 py-1 rounded border text-[11px] transition-colors cursor-pointer ${
                              selected
                                ? 'bg-stone-900 text-white border-stone-900 font-medium'
                                : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                            }`}
                          >
                            {selected ? '✓ ' : '+ '}
                            {u.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Kolom Input Manual */}
                  <div className="p-2.5 rounded border border-stone-200 bg-white space-y-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-400">
                      Input Manual (Non-User)
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={manualConsultedInput}
                        onChange={(e) => setManualConsultedInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddManualPerson(
                              manualConsultedInput,
                              setManualConsultedInput,
                              draftConsulted,
                              setDraftConsulted
                            );
                          }
                        }}
                        placeholder="Nama pihak manual..."
                        className="flex-1 h-7 px-2 rounded border border-stone-200 bg-white text-stone-800 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleAddManualPerson(
                            manualConsultedInput,
                            setManualConsultedInput,
                            draftConsulted,
                            setDraftConsulted
                          )
                        }
                        className="px-2.5 h-7 rounded border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-medium cursor-pointer shrink-0"
                      >
                        + Tambah
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {draftConsulted
                        .filter((p) => !isRegisteredUserName(p))
                        .map((person, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 border border-stone-200 text-stone-800 text-[11px]"
                          >
                            <span>{person}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftConsulted((prev) => prev.filter((p) => p !== person))
                              }
                              className="text-stone-400 hover:text-rose-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Informed */}
              <div className="p-3.5 rounded-md border border-stone-200 bg-[#FAF9F6] space-y-2.5">
                <div>
                  <div className="font-bold text-stone-900">Informed</div>
                  <div className="text-[11px] text-stone-500">Penerima Informasi</div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Kolom User Terdaftar */}
                  <div className="p-2.5 rounded border border-stone-200 bg-white space-y-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-400">
                      User Terdaftar
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeUsers.map((u) => {
                        const selected = draftInformed.includes(u.name);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              handleTogglePersonInList(u.name, draftInformed, setDraftInformed)
                            }
                            className={`px-2 py-1 rounded border text-[11px] transition-colors cursor-pointer ${
                              selected
                                ? 'bg-stone-900 text-white border-stone-900 font-medium'
                                : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                            }`}
                          >
                            {selected ? '✓ ' : '+ '}
                            {u.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Kolom Input Manual */}
                  <div className="p-2.5 rounded border border-stone-200 bg-white space-y-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-400">
                      Input Manual (Non-User)
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={manualInformedInput}
                        onChange={(e) => setManualInformedInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddManualPerson(
                              manualInformedInput,
                              setManualInformedInput,
                              draftInformed,
                              setDraftInformed
                            );
                          }
                        }}
                        placeholder="Nama pihak manual..."
                        className="flex-1 h-7 px-2 rounded border border-stone-200 bg-white text-stone-800 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleAddManualPerson(
                            manualInformedInput,
                            setManualInformedInput,
                            draftInformed,
                            setDraftInformed
                          )
                        }
                        className="px-2.5 h-7 rounded border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-medium cursor-pointer shrink-0"
                      >
                        + Tambah
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {draftInformed
                        .filter((p) => !isRegisteredUserName(p))
                        .map((person, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 border border-stone-200 text-stone-800 text-[11px]"
                          >
                            <span>{person}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftInformed((prev) => prev.filter((p) => p !== person))
                              }
                              className="text-stone-400 hover:text-rose-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-[#F7F7F5] border-t border-stone-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingRaciOutput(null)}
                className="px-3 py-1.5 rounded border border-stone-200 bg-white text-stone-700 text-xs font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveRaciAssignment}
                disabled={savingRaci}
                className="px-4 py-1.5 rounded bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
              >
                {savingRaci ? 'Menyimpan...' : 'Simpan & Ajukan Persetujuan Direktur'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 2: ASSIGN MONITORING TOOLS PER ACTIVITY (RESPONSIBLE)        */}
      {/* ================================================================== */}
      {editingActivity && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg border border-stone-200 max-w-4xl w-full overflow-hidden shadow-lg my-6">
            <div className="px-5 py-3.5 border-b border-stone-200 flex items-center justify-between bg-[#F7F7F5]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-stone-200 text-stone-700">
                    Activity {editingActivity.activity.code || ''}
                  </span>
                  <h3 className="text-sm font-semibold text-[#252525]">
                    {editingActivity.activity.name}
                  </h3>
                </div>
                <p className="text-xs text-[#787774] mt-0.5">
                  Output: {editingActivity.output.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingActivity(null)}
                className="p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const editPerm = canEditOutputMonitoring(editingActivity.output);
              return (
                <>
                  <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
                    {!editPerm.allowed && (
                      <div className="p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                        Mode Baca Saja: {editPerm.reason}
                      </div>
                    )}

                    {/* Currently Selected Tools with optional Link/Notes */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-stone-800">
                          Monitoring Tools Terpilih untuk Activity Ini ({draftTools.length})
                        </span>
                        {renderActivityMonitoringText(
                          draftTools.length > 0
                            ? 'Sudah Ada Monitoring'
                            : 'Belum Ada Monitoring'
                        )}
                      </div>

                      {draftTools.length === 0 ? (
                        <div className="p-3.5 rounded border border-dashed border-stone-200 text-center text-stone-500">
                          Belum ada Monitoring Tool yang dipilih. Centang dari daftar Monitoring Tools Library di bawah.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {draftTools.map((selectedTool) => (
                            <div
                              key={selectedTool.toolId}
                              className="p-3 rounded-md border border-stone-200 bg-[#FAF9F6] space-y-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <span className="font-mono text-[11px] text-blue-700 font-semibold mr-1.5">
                                    [{selectedTool.toolId}]
                                  </span>
                                  <span className="font-semibold text-stone-900">
                                    {selectedTool.toolName}
                                  </span>
                                  <span className="text-[11px] text-stone-500 ml-2">
                                    ({selectedTool.categoryName})
                                  </span>
                                  <p className="text-[11px] text-stone-600 mt-0.5">
                                    {selectedTool.shortFunction}
                                  </p>
                                </div>
                                {editPerm.allowed && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraftTools((prev) =>
                                        prev.filter((t) => t.toolId !== selectedTool.toolId)
                                      )
                                    }
                                    className="text-stone-400 hover:text-rose-600 p-1 cursor-pointer"
                                    title="Hapus tool ini"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input
                                  type="url"
                                  disabled={!editPerm.allowed}
                                  value={selectedTool.toolUrl || ''}
                                  onChange={(e) =>
                                    handleUpdateDraftToolMeta(
                                      selectedTool.toolId,
                                      'toolUrl',
                                      e.target.value
                                    )
                                  }
                                  placeholder="Link Dokumen / Form Monitoring (opsional, mis. Google Drive/Forms)..."
                                  className="h-7 px-2.5 rounded border border-stone-200 bg-white text-stone-800 text-[11px] focus:outline-none disabled:bg-stone-100"
                                />
                                <input
                                  type="text"
                                  disabled={!editPerm.allowed}
                                  value={selectedTool.notes || ''}
                                  onChange={(e) =>
                                    handleUpdateDraftToolMeta(
                                      selectedTool.toolId,
                                      'notes',
                                      e.target.value
                                    )
                                  }
                                  placeholder="Catatan pelaksanaan monitoring (opsional)..."
                                  className="h-7 px-2.5 rounded border border-stone-200 bg-white text-stone-800 text-[11px] focus:outline-none disabled:bg-stone-100"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Monitoring Tools Library Picker (Categories A-E) */}
                    {editPerm.allowed && (
                      <div className="space-y-3 pt-3 border-t border-stone-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <span className="font-semibold text-stone-800">
                            Pilih dari Monitoring Tools Library (Kategori A–E)
                          </span>
                          <div className="relative w-full sm:w-64">
                            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2" />
                            <input
                              type="text"
                              value={toolSearchQuery}
                              onChange={(e) => setToolSearchQuery(e.target.value)}
                              placeholder="Cari nama tool..."
                              className="w-full h-7 pl-8 pr-2.5 rounded border border-stone-200 text-xs focus:outline-none"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedCategoryFilter('ALL')}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                              selectedCategoryFilter === 'ALL'
                                ? 'bg-stone-900 text-white'
                                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                            }`}
                          >
                            Semua Kategori
                          </button>
                          {CATEGORY_LIST.map((cat) => (
                            <button
                              key={cat.code}
                              type="button"
                              onClick={() => setSelectedCategoryFilter(cat.code)}
                              className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                                selectedCategoryFilter === cat.code
                                  ? 'bg-stone-900 text-white'
                                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                              }`}
                            >
                              {cat.label}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                          {filteredModalCatalog.map((item) => {
                            const isChecked = draftTools.some((t) => t.toolId === item.id);
                            return (
                              <div
                                key={item.id}
                                onClick={() => handleToggleCatalogTool(item)}
                                className={`p-2.5 rounded border cursor-pointer transition-colors flex items-start gap-2.5 ${
                                  isChecked
                                    ? 'bg-emerald-50/70 border-emerald-300'
                                    : 'bg-white border-stone-200 hover:bg-stone-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="mt-0.5 cursor-pointer"
                                />
                                <div className="min-w-0">
                                  <div className="font-semibold text-stone-800">
                                    <span className="font-mono text-[11px] text-stone-500 mr-1">
                                      [{item.id}]
                                    </span>
                                    {item.name}
                                  </div>
                                  <p className="text-[11px] text-stone-500 leading-snug mt-0.5">
                                    {item.shortFunction}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-3 bg-[#F7F7F5] border-t border-stone-200 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingActivity(null)}
                      className="px-3 py-1.5 rounded border border-stone-200 bg-white text-stone-700 text-xs font-medium cursor-pointer"
                    >
                      Tutup
                    </button>
                    {editPerm.allowed && (
                      <button
                        type="button"
                        onClick={handleSaveActivityTools}
                        disabled={savingActivityTools}
                        className="px-4 py-1.5 rounded bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                      >
                        {savingActivityTools ? 'Menyimpan...' : 'Simpan Monitoring Tools'}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 3: MONITORING TOOLS LIBRARY (KATALOG 38 TOOLS A–E)           */}
      {/* ================================================================== */}
      {showLibraryModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg border border-stone-200 max-w-4xl w-full overflow-hidden shadow-lg my-6">
            <div className="px-5 py-3.5 border-b border-stone-200 flex items-center justify-between bg-[#F7F7F5]">
              <div>
                <h3 className="text-sm font-semibold text-[#252525]">
                  Monitoring Tools Library ({MONITORING_TOOLS_LIBRARY.length} Tools)
                </h3>
                <p className="text-xs text-[#787774]">
                  Katalog lengkap monitoring tools berdasarkan kategori A–E beserta fungsi singkatnya
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLibraryModal(false)}
                className="p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Cari nama monitoring tool atau fungsinya..."
                    className="w-full h-8 pl-8 pr-3 rounded border border-stone-200 text-xs text-stone-800 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLibraryCategory('ALL')}
                    className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                      libraryCategory === 'ALL'
                        ? 'bg-stone-900 text-white'
                        : 'bg-[#F7F7F5] text-stone-700 hover:bg-stone-200/70'
                    }`}
                  >
                    Semua ({MONITORING_TOOLS_LIBRARY.length})
                  </button>
                  {CATEGORY_LIST.map((cat) => (
                    <button
                      key={cat.code}
                      type="button"
                      onClick={() => setLibraryCategory(cat.code)}
                      className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                        libraryCategory === cat.code
                          ? 'bg-stone-900 text-white'
                          : 'bg-[#F7F7F5] text-stone-700 hover:bg-stone-200/70'
                      }`}
                    >
                      Kategori {cat.code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {CATEGORY_LIST.filter(
                  (cat) => libraryCategory === 'ALL' || cat.code === libraryCategory
                ).map((cat) => {
                  const items = filteredLibraryCatalog.filter(
                    (t) => t.categoryCode === cat.code
                  );
                  if (items.length === 0) return null;

                  return (
                    <div
                      key={cat.code}
                      className="bg-white rounded-lg border border-[#EAEAEA] overflow-hidden"
                    >
                      <div className="px-4 py-2.5 bg-[#F7F7F5] border-b border-[#EAEAEA] flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[#252525]">
                          {cat.label}
                        </h4>
                        <span className="text-[11px] font-mono text-[#787774]">
                          {items.length} Tools
                        </span>
                      </div>
                      <div className="divide-y divide-[#EAEAEA]">
                        {items.map((tool, idx) => (
                          <div
                            key={tool.id}
                            className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#FAF9F6]"
                          >
                            <div>
                              <div className="text-xs font-semibold text-[#252525]">
                                <span className="font-mono text-[#787774] mr-2">
                                  {idx + 1}.
                                </span>
                                {tool.name}
                              </div>
                              <p className="text-xs text-[#787774] mt-0.5">
                                {tool.shortFunction}
                              </p>
                            </div>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-600 shrink-0 self-start sm:self-center">
                              {tool.id}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-5 py-3 bg-[#F7F7F5] border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowLibraryModal(false)}
                className="px-3.5 py-1.5 rounded bg-stone-900 text-white text-xs font-medium cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
