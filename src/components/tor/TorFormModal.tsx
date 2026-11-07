import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Tor,
  Program,
  Outcome,
  Output,
  Activity,
  SubActivity,
  User,
  ReportingPeriodType,
  TorGoalItem,
  TorSpecificObjectiveItem,
  TorTimelineItem,
  TorMonitoringItem,
  TorLocationItem,
  TorRoleItem,
  TorRundownItem,
  ParticipantTableMode,
  TorParticipantRow,
  TorParticipantCustomColumn,
  OutputRaciRecord,
} from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../lib/api.js';
import {
  X,
  AlertCircle,
  Plus,
  Trash2,
  RotateCcw,
  Eraser,
  Calendar,
} from 'lucide-react';
import {
  getTorDraftPreview,
} from '../../lib/torNumberGenerator.js';
import {
  getProgramAgreedCustomPeriods,
  hydrateProgramBudgetDatasetsFromServer,
  ProgramBudgetPeriod,
} from '../../lib/programBudgetStorage.js';

const PROVINSI_INDONESIA = [
  'Aceh',
  'Sumatera Utara',
  'Sumatera Barat',
  'Riau',
  'Kepulauan Riau',
  'Jambi',
  'Sumatera Selatan',
  'Kepulauan Bangka Belitung',
  'Bengkulu',
  'Lampung',
  'DKI Jakarta',
  'Jawa Barat',
  'Banten',
  'Jawa Tengah',
  'DI Yogyakarta',
  'Jawa Timur',
  'Bali',
  'Nusa Tenggara Barat',
  'Nusa Tenggara Timur',
  'Kalimantan Barat',
  'Kalimantan Tengah',
  'Kalimantan Selatan',
  'Kalimantan Timur',
  'Kalimantan Utara',
  'Sulawesi Utara',
  'Gorontalo',
  'Sulawesi Tengah',
  'Sulawesi Barat',
  'Sulawesi Selatan',
  'Sulawesi Tenggara',
  'Maluku',
  'Maluku Utara',
  'Papua',
  'Papua Barat',
  'Papua Selatan',
  'Papua Tengah',
  'Papua Pegunungan',
  'Papua Barat Daya',
];

interface TorFormModalProps {
  programs?: Program[];
  outcomes: Outcome[];
  outputs: Output[];
  activities: Activity[];
  subActivities?: SubActivity[];
  users: User[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (torId: string) => void;
  initialActivitySelection?: {
    outcomeId: string;
    outputId: string;
    activityId: string;
  };
  editingTor?: Tor;
}

interface ReportingMilestone {
  title: string;
  rawDate: string;
  dateStr: string;
  isFinalDeadline?: boolean;
}

// ============================================================================
// CONTOH ISIAN KOMPLEMENTER (DESA CIBULUH — PROGRAM AIR LESTARI WIJNA)
// ============================================================================
const EXAMPLE_TITLE =
  'Pelatihan Teknis Pemeliharaan Pompa dan Pembukuan Iuran Warga Desa Cibuluh';

const EXAMPLE_LOCATIONS: TorLocationItem[] = [
  {
    id: 'loc-1',
    villageCity: 'Balai Desa Cibuluh, Kec. Tanjung Sari, Kab. Sumedang',
    province: 'Jawa Barat',
    country: 'Indonesia',
  },
];

const EXAMPLE_BUDGET = 15000000;

const EXAMPLE_BACKGROUND =
  'Desa Cibuluh kerap mengalami kendala sarana air bersih macet karena pengurus POKMAIR belum terlatih melakukan perawatan berkala dan penggantian paking seal pompa submersible. Selain itu, pencatatan iuran pemeliharaan warga masih dilakukan secara manual tanpa buku kas standar sehingga dana cadangan perbaikan sering tidak mencukupi saat terjadi kerusakan mendadak.';

const EXAMPLE_GENERAL_OBJECTIVE =
  'Meningkatkan kapasitas tata kelola teknis pemeliharaan sarana air bersih dan akuntabilitas pembukuan keuangan iuran warga bagi pengurus POKMAIR Desa Cibuluh secara mandiri dan berkelanjutan.';

const EXAMPLE_SPECIFIC_OBJECTIVES: TorSpecificObjectiveItem[] = [
  {
    id: 'so-1',
    objective:
      'Meningkatkan keterampilan teknis pengurus POKMAIR Desa Cibuluh dalam prosedur bongkar pasang, penggantian paking seal, dan pemeliharaan berkala pompa submersible.',
    expectedResult:
      '15 pengurus dan teknisi lokal mampu melakukan perawatan rutin serta perbaikan dasar pompa air sesuai daftar periksa (checklist) SOP teknis.',
    expectedChange:
      'Frekuensi kerusakan mendadak mesin pompa berkurang dan waktu henti (downtime) distribusi air bersih ke warga dapat ditekan.',
  },
  {
    id: 'so-2',
    objective:
      'Meningkatkan tertib administrasi dan akuntabilitas pengelolaan dana iuran warga melalui penerapan buku kas standar POKMAIR.',
    expectedResult:
      '10 pengurus dan tim bendahara menguasai pencatatan kas masuk/keluar, rekapitulasi tunggakan, dan penyusunan laporan keuangan bulanan.',
    expectedChange:
      'Terbangun transparansi keuangan kas air desa yang meningkatkan kepercayaan warga dalam membayar iuran pemeliharaan tepat waktu.',
  },
  {
    id: 'so-3',
    objective:
      'Memperkuat koordinasi pengawasan operasional antara pengurus POKMAIR, Pemerintah Desa Cibuluh, dan tim pendamping lapangan Yayasan WIJNA.',
    expectedResult:
      'Tersusunnya berita acara kesepakatan SOP pemeliharaan, jadwal piket operator, dan mekanisme pelaporan bulanan kepada Kepala Desa.',
    expectedChange:
      'Terbentuk tata kelola layanan air bersih desa yang mandiri dan berkelanjutan tanpa ketergantungan penuh pada teknisi luar.',
  },
];

const EXAMPLE_TIMELINE_ITEMS: TorTimelineItem[] = [
  {
    id: 'tl-1',
    period: '5–9 Okt 2026',
    activity:
      'Persiapan modul teknis pompa, pencetakan buku kas POKMAIR, dan koordinasi tempat di Balai Desa Cibuluh',
  },
  {
    id: 'tl-2',
    period: '10 Okt 2026',
    activity:
      'Hari ke-1: Pembukaan oleh Kepala Desa Cibuluh & Sesi Teori Dasar Mekanikal Pompa Submersible',
  },
  {
    id: 'tl-3',
    period: '11 Okt 2026',
    activity:
      'Hari ke-2: Praktik Bengkel Bongkar Pasang, Penggantian Paking Seal, dan Uji Panel Listrik di Rumah Pompa Dusun 2',
  },
  {
    id: 'tl-4',
    period: '12 Okt 2026',
    activity:
      'Hari ke-3: Bimbingan Teknis Pembukuan Kas Iuran Warga, Penyusunan Jadwal Piket, dan Post-Test Peserta',
  },
  {
    id: 'tl-5',
    period: '13–19 Okt 2026',
    activity:
      'Penyusunan laporan pelaksanaan kegiatan, dokumentasi, dan pertanggungjawaban keuangan ke Yayasan WIJNA',
  },
];

const EXAMPLE_MONITORING_ITEMS: TorMonitoringItem[] = [
  {
    id: 'me-1',
    aspect: 'Implementation process',
    method:
      'Pemantauan langsung keterlaksanaan sesi teori dan praktik lapangan sesuai jadwal kurikulum pelatihan',
    frequency: 'Setiap hari selama pelatihan (10–12 Okt 2026)',
    pic: 'Budi Santoso (WIJNA)',
  },
  {
    id: 'me-2',
    aspect: 'Participant attendance',
    method:
      'Pencatatan daftar hadir harian peserta pagi dan siang serta rekapitulasi keterwakilan pengurus POKMAIR',
    frequency: 'Setiap sesi kegiatan',
    pic: 'Siti Rahmawati',
  },
  {
    id: 'me-3',
    aspect: 'Quality of materials/output',
    method:
      'Evaluasi pre-test & post-test pemahaman teknis serta uji praktik langsung pembongkaran seal pompa dan pengisian buku kas',
    frequency: 'Awal dan akhir pelatihan',
    pic: 'Ir. Ahmad Zaelani',
  },
  {
    id: 'me-4',
    aspect: 'Documentation & Administration',
    method:
      'Pengumpulan foto kegiatan berketetapan waktu, berita acara serah terima modul/toolkit, nota pengeluaran, dan daftar hadir resmi',
    frequency: 'Setelah kegiatan; laporan akhir maksimal 19 Okt 2026',
    pic: 'Siti Rahmawati; Budi Santoso',
  },
  {
    id: 'me-5',
    aspect: 'Anticipated field challenges',
    method:
      'Antisipasi fluktuasi tegangan listrik desa dengan penyediaan genset cadangan 5 kVA serta penyesuaian jadwal dengan waktu panen warga',
    frequency: 'Sepanjang pelaksanaan kegiatan',
    pic: 'Budi Santoso; Ketua POKMAIR',
  },
];

const EMPTY_DEFAULT_MONITORING_ITEMS: TorMonitoringItem[] = [
  { id: 'me-1', aspect: 'Implementation process', method: '', frequency: '', pic: '' },
  { id: 'me-2', aspect: 'Participant attendance', method: '', frequency: '', pic: '' },
  { id: 'me-3', aspect: 'Quality of materials/output', method: '', frequency: '', pic: '' },
  { id: 'me-4', aspect: 'Documentation & Administration', method: '', frequency: '', pic: '' },
  { id: 'me-5', aspect: 'Anticipated field challenges', method: '', frequency: '', pic: '' },
];

const EXAMPLE_SCOPE_OF_ACTIVITIES: string[] = [
  'Penyusunan dan penggandaan modul teknis pemeliharaan pompa submersible serta buku pedoman pencatatan kas iuran warga bagi 25 peserta.',
  'Pelaksanaan sesi kelas teori mekanikal-elektrikal pompa dan bimbingan teknis pembukuan keuangan di Balai Desa Cibuluh.',
  'Praktik lapangan bongkar pasang pompa, pengecekan katup distribusi, dan penggantian paking seal di instalasi Rumah Pompa Dusun 2.',
  'Penyerahan 1 set kunci perbengkelan dasar (toolkit pemeliharaan) dan buku kas induk kepada pengurus inti POKMAIR Desa Cibuluh.',
  'Dokumentasi kegiatan, evaluasi pre/post-test peserta, dan penyusunan laporan pertanggungjawaban kegiatan ke manajemen Yayasan WIJNA.',
];

const EXAMPLE_IMPLEMENTATION_MECHANISMS: string[] = [
  'Pencairan dana operasional. Dana kegiatan diajukan melalui mekanisme Cash Advance WIJNA oleh PIC Kegiatan dan diverifikasi oleh bagian Finance sebelum keberangkatan tim ke lokasi.',
  'Koordinasi desa & peserta. Tim lapangan WIJNA berkoordinasi dengan Pemerintah Desa Cibuluh dan Ketua POKMAIR untuk memastikan kesiapan Balai Desa, Rumah Pompa Dusun 2, serta kehadiran 25 peserta sasaran.',
  'Pelaksanaan pelatihan & praktik. Pelatihan dilaksanakan selama 3 hari efektif dengan metode 30% pemaparan materi dan 70% praktik langsung perbengkelan pompa serta simulasi pengisian buku kas.',
  'Pelaporan & pertanggungjawaban. Laporan kegiatan beserta daftar hadir, dokumentasi foto, berita acara, dan bukti pengeluaran riil diserahkan paling lambat 7 hari setelah kegiatan selesai.',
];

const EXAMPLE_PARTICIPANT_COLUMNS: TorParticipantCustomColumn[] = [
  { id: 'col-target', label: 'Target Peserta', type: 'text' },
  { id: 'col-male', label: 'Est. Laki-laki', type: 'number' },
  { id: 'col-female', label: 'Est. Perempuan', type: 'number' },
  { id: 'col-note', label: 'Keterangan', type: 'text' },
];

const EXAMPLE_PARTICIPANT_ROWS: TorParticipantRow[] = [
  {
    id: 'prow-1',
    target: 'Pengurus Inti POKMAIR (Ketua, Teknisi, Operator)',
    maleCount: 10,
    femaleCount: 5,
    note: 'Fokus pelatihan bongkar pasang & troubleshooting pompa',
    customValues: {
      'col-target': 'Pengurus Inti POKMAIR (Ketua, Teknisi, Operator)',
      'col-male': '10',
      'col-female': '5',
      'col-note': 'Fokus pelatihan bongkar pasang & troubleshooting pompa',
    },
  },
  {
    id: 'prow-2',
    target: 'Bendahara & Tim Pencatat Iuran Kas Desa',
    maleCount: 3,
    femaleCount: 7,
    note: 'Fokus modul buku kas & pembukuan transparan',
    customValues: {
      'col-target': 'Bendahara & Tim Pencatat Iuran Kas Desa',
      'col-male': '3',
      'col-female': '7',
      'col-note': 'Fokus modul buku kas & pembukuan transparan',
    },
  },
];

const EXAMPLE_ROLES: TorRoleItem[] = [
  {
    id: 'role-1',
    role: 'Ketua Pelaksana',
    nameInstitution: 'Budi Santoso — Yayasan WIJNA',
    picName: 'Budi Santoso',
    institution: 'Yayasan WIJNA',
    responsibilities:
      'Koordinasi umum pelaksanaan kegiatan, fasilitasi kerja sama dengan Kepala Desa Cibuluh, dan pemantauan harian.',
  },
  {
    id: 'role-2',
    role: 'Fasilitator Pembukuan',
    nameInstitution: 'Siti Rahmawati — Yayasan WIJNA',
    picName: 'Siti Rahmawati',
    institution: 'Yayasan WIJNA',
    responsibilities:
      'Penyusunan modul buku kas POKMAIR, bimbingan teknis pencatatan iuran warga, dan rekapitulasi administrasi peserta.',
  },
  {
    id: 'role-3',
    role: 'Instruktur Teknis Pompa',
    nameInstitution: 'Ir. Ahmad Zaelani — Konsultan Hidro-Mekanik',
    picName: 'Ir. Ahmad Zaelani',
    institution: 'Konsultan Hidro-Mekanik',
    responsibilities:
      'Pemaparan materi mekanikal pompa, supervisi praktik bongkar pasang paking seal, dan penyusunan SOP perawatan.',
  },
];

const EXAMPLE_ROLES_NOTES =
  'Seluruh personel tim pelaksana wajib hadir pada rapat persiapan H-1 di lokasi dan memastikan kelengkapan peralatan praktik perbengkelan.';

const EXAMPLE_RUNDOWN: TorRundownItem[] = [
  {
    id: 'rd-1',
    timelineId: 'tl-2',
    timelineLabel:
      '10 Okt 2026 — Hari ke-1: Pembukaan oleh Kepala Desa Cibuluh & Sesi Teori Dasar Mekanikal Pompa Submersible',
    date: 'Hari ke-1 (10 Okt 2026)',
    time: '08:30 – 12:00 WIB',
    agenda: 'Pembukaan, Pre-Test & Teori Dasar Mekanikal Pompa Submersible',
    targetParticipants: 'Seluruh Peserta (25 Pengurus POKMAIR & Bendahara)',
    location: 'Balai Desa Cibuluh',
    picName: 'Ir. Ahmad Zaelani',
  },
  {
    id: 'rd-2',
    timelineId: 'tl-3',
    timelineLabel:
      '11 Okt 2026 — Hari ke-2: Praktik Bengkel Bongkar Pasang, Penggantian Paking Seal, dan Uji Panel Listrik di Rumah Pompa Dusun 2',
    date: 'Hari ke-2 (11 Okt 2026)',
    time: '09:00 – 15:30 WIB',
    agenda: 'Praktik Bengkel Bongkar Pasang & Penggantian Seal Pompa',
    targetParticipants: 'Pengurus Inti POKMAIR (Ketua, Teknisi, Operator - 15 Org)',
    location: 'Rumah Pompa Dusun 2',
    picName: 'Budi Santoso',
  },
  {
    id: 'rd-3',
    timelineId: 'tl-4',
    timelineLabel:
      '12 Okt 2026 — Hari ke-3: Bimbingan Teknis Pembukuan Kas Iuran Warga, Penyusunan Jadwal Piket, dan Post-Test Peserta',
    date: 'Hari ke-3 (12 Okt 2026)',
    time: '09:00 – 14:00 WIB',
    agenda: 'Bimbingan Teknis Pembukuan Kas Iuran, Post-Test & Evaluasi SOP',
    targetParticipants: 'Bendahara & Tim Pencatat Iuran Kas Desa (10 Org)',
    location: 'Balai Desa Cibuluh',
    picName: 'Siti Rahmawati',
  },
];

const EXAMPLE_RUNDOWN_NOTES =
  'Jadwal istirahat dan ibadah menyesuaikan waktu setempat. Sesi praktik di Rumah Pompa Dusun 2 dilengkapi genset cadangan.';

const EXAMPLE_ADDITIONAL_NOTES =
  'Membutuhkan alat peraga mesin pompa submersible percontohan, kunci pipa lengkap, dan papan tulis flipchart di Balai Desa Cibuluh.';

export const TorFormModal: React.FC<TorFormModalProps> = ({
  programs = [],
  outcomes,
  outputs,
  activities,
  users,
  isOpen,
  onClose,
  onSuccess,
  initialActivitySelection,
  editingTor,
}) => {
  const { currentUser } = useAuth();
  const documentContainerRef = useRef<HTMLDivElement>(null);

  const isEditMode = Boolean(editingTor);

  // ==========================================
  // SECTION 1: INFORMASI KEGIATAN & HIERARKI
  // ==========================================
  const [title, setTitle] = useState<string>(() =>
    editingTor ? editingTor.title : EXAMPLE_TITLE
  );
  const [budgetRequestedInput, setBudgetRequestedInput] = useState<number | string>(() =>
    editingTor?.budgetRequested != null ? editingTor.budgetRequested : EXAMPLE_BUDGET
  );
  const [isExampleCleared, setIsExampleCleared] = useState<boolean>(false);

  // RACI Records per Output (Loaded from MEAL Connect)
  const [outputRaciMap, setOutputRaciMap] = useState<Record<string, OutputRaciRecord>>({});
  const [raciLoaded, setRaciLoaded] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    api
      .getMonitoringConnect()
      .then((res) => {
        if (mounted && res?.outputRaciRecords) {
          setOutputRaciMap(res.outputRaciRecords);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setRaciLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const getUserOutputRaciRole = (targetOutputId: string): string | null => {
    if (!currentUser) return null;
    const raci = outputRaciMap[targetOutputId];
    if (!raci || raci.status !== 'Aktif') return null;
    if (raci.responsibleUserId === currentUser.id) return 'R – Responsible';
    if (raci.accountableUserId === currentUser.id) return 'A1 – Accountable Program';
    if (
      currentUser.role === 'finance' ||
      (currentUser.roleTitle || '').toLowerCase().includes('finance')
    ) {
      return 'A2 – Accountable Finance';
    }
    return null;
  };

  const canAccessOutput = (targetOutputId: string): boolean => {
    if (isEditMode) return true;
    if (!raciLoaded) return true;
    return getUserOutputRaciRole(targetOutputId) !== null;
  };

  const accessiblePrograms = useMemo(() => {
    if (isEditMode || !raciLoaded) return programs;
    return programs.filter((prog) => {
      const progOutcomes = outcomes.filter((oc) => oc.programId === prog.id);
      return progOutcomes.some((oc) =>
        outputs.some((op) => op.outcomeId === oc.id && canAccessOutput(op.id))
      );
    });
  }, [programs, outcomes, outputs, outputRaciMap, currentUser, isEditMode, raciLoaded]);

  const initialProgramId = (() => {
    if (editingTor?.programId) return editingTor.programId;
    if (initialActivitySelection?.outcomeId) {
      const oc = outcomes.find((o) => o.id === initialActivitySelection.outcomeId);
      if (oc?.programId) return oc.programId;
    }
    return programs[0]?.id || outcomes[0]?.programId || '';
  })();

  const [programId, setProgramId] = useState<string>(initialProgramId);

  const availableOutcomes = useMemo(() => {
    const raw = outcomes.filter((o) => o.programId === programId);
    if (isEditMode || !raciLoaded) return raw;
    return raw.filter((oc) =>
      outputs.some((op) => op.outcomeId === oc.id && canAccessOutput(op.id))
    );
  }, [outcomes, outputs, programId, outputRaciMap, currentUser, isEditMode, raciLoaded]);

  const [outcomeId, setOutcomeId] = useState<string>(() => {
    if (editingTor?.outcomeId) return editingTor.outcomeId;
    if (initialActivitySelection?.outcomeId) return initialActivitySelection.outcomeId;
    return availableOutcomes[0]?.id || '';
  });

  const availableOutputs = useMemo(() => {
    const raw = outputs.filter((o) => o.outcomeId === outcomeId);
    if (isEditMode || !raciLoaded) return raw;
    return raw.filter((op) => canAccessOutput(op.id));
  }, [outputs, outcomeId, outputRaciMap, currentUser, isEditMode, raciLoaded]);

  const [outputId, setOutputId] = useState<string>(() => {
    if (editingTor?.outputId) return editingTor.outputId;
    if (initialActivitySelection?.outputId) return initialActivitySelection.outputId;
    return availableOutputs[0]?.id || '';
  });

  const availableActivities = useMemo(
    () => activities.filter((a) => a.outputId === outputId),
    [activities, outputId]
  );

  const [activityId, setActivityId] = useState<string>(() => {
    if (editingTor?.activityId) return editingTor.activityId;
    if (initialActivitySelection?.activityId) return initialActivitySelection.activityId;
    return availableActivities[0]?.id || '';
  });

  // Cascade updates
  useEffect(() => {
    if (
      accessiblePrograms.length > 0 &&
      !accessiblePrograms.some((p) => p.id === programId)
    ) {
      setProgramId(accessiblePrograms[0]?.id || '');
    }
  }, [accessiblePrograms, programId]);

  useEffect(() => {
    if (availableOutcomes.length > 0 && !availableOutcomes.some((o) => o.id === outcomeId)) {
      setOutcomeId(availableOutcomes[0]?.id || '');
    } else if (availableOutcomes.length === 0 && raciLoaded && !isEditMode) {
      setOutcomeId('');
    }
  }, [availableOutcomes, outcomeId, raciLoaded, isEditMode]);

  useEffect(() => {
    if (availableOutputs.length > 0 && !availableOutputs.some((o) => o.id === outputId)) {
      setOutputId(availableOutputs[0]?.id || '');
    } else if (availableOutputs.length === 0 && raciLoaded && !isEditMode) {
      setOutputId('');
    }
  }, [availableOutputs, outputId, raciLoaded, isEditMode]);

  useEffect(() => {
    if (availableActivities.length > 0 && !availableActivities.some((a) => a.id === activityId)) {
      setActivityId(availableActivities[0]?.id || '');
    } else if (availableActivities.length === 0 && raciLoaded && !isEditMode) {
      setActivityId('');
    }
  }, [availableActivities, activityId, raciLoaded, isEditMode]);

  const currentProgram = useMemo(
    () => programs.find((p) => p.id === programId),
    [programs, programId]
  );
  const currentOutcome = useMemo(
    () => outcomes.find((o) => o.id === outcomeId),
    [outcomes, outcomeId]
  );
  const currentOutput = useMemo(
    () => outputs.find((o) => o.id === outputId),
    [outputs, outputId]
  );
  const currentActivity = useMemo(
    () => activities.find((a) => a.id === activityId),
    [activities, activityId]
  );

  const [budgetStorageTick, setBudgetStorageTick] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    api
      .getFinanceProgramBudgets()
      .then((remote) => {
        if (mounted && remote && typeof remote === 'object') {
          hydrateProgramBudgetDatasetsFromServer(remote);
          setBudgetStorageTick((t) => t + 1);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const [showTimePeriodCorner, setShowTimePeriodCorner] = useState<boolean>(true);

  // Daftar Custom Period yang telah disepakati pada Program yang dipilih (Dasar Pembuatan TOR)
  const programCustomPeriods = useMemo<ProgramBudgetPeriod[]>(() => {
    return getProgramAgreedCustomPeriods({
      programId,
      programName: currentProgram?.name,
      programStartDate: currentProgram?.startDate,
    });
  }, [programId, currentProgram?.name, currentProgram?.startDate, budgetStorageTick]);

  // Time Period otomatis dipilih oleh Finance (berdasarkan pengaturan Finance Program)
  const financeActiveCustomPeriod = useMemo<ProgramBudgetPeriod | null>(() => {
    if (programCustomPeriods.length === 0) return null;
    return (
      programCustomPeriods.find((p) => p.isActiveForTor) ||
      programCustomPeriods[0] ||
      null
    );
  }, [programCustomPeriods]);

  const [customPeriodId, setCustomPeriodId] = useState<string>(() => {
    if (editingTor?.customPeriodId) return editingTor.customPeriodId;
    return '';
  });

  const selectedCustomPeriod = useMemo<ProgramBudgetPeriod | null>(() => {
    if (programCustomPeriods.length === 0) return null;
    // Prioritaskan periode yang sedang dipilih otomatis oleh Finance
    if (financeActiveCustomPeriod && !editingTor) {
      return financeActiveCustomPeriod;
    }
    if (customPeriodId) {
      const exact = programCustomPeriods.find((p) => p.id === customPeriodId);
      if (exact) return exact;
    }
    if (editingTor?.customPeriodCode) {
      const byCode = programCustomPeriods.find((p) => p.code === editingTor.customPeriodCode);
      if (byCode) return byCode;
    }
    return financeActiveCustomPeriod || programCustomPeriods[0] || null;
  }, [programCustomPeriods, financeActiveCustomPeriod, customPeriodId, editingTor]);

  const [nextSeqFromApi, setNextSeqFromApi] = useState<number>(6);

  useEffect(() => {
    if (editingTor) return;
    let isMounted = true;
    api
      .previewTorNumber({ programId, outcomeId, outputId, activityId })
      .then((res) => {
        if (isMounted && res.nextSequenceNumber) {
          setNextSeqFromApi(res.nextSequenceNumber);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [programId, outcomeId, outputId, activityId, editingTor]);

  const torNumberPreview = useMemo(() => {
    return getTorDraftPreview({
      programName: currentProgram?.name,
      explicitProgramCode: currentProgram?.code,
      programId,
      outcomeId,
      outputId,
      activityId,
      outcomes,
      outputs,
      activities,
      sequence: nextSeqFromApi,
      date: editingTor?.createdAt ? new Date(editingTor.createdAt) : new Date(),
    });
  }, [
    currentProgram,
    programId,
    outcomeId,
    outputId,
    activityId,
    outcomes,
    outputs,
    activities,
    nextSeqFromApi,
    editingTor,
  ]);

  // PIC
  const [picId, setPicId] = useState<string>(() => {
    if (editingTor?.picId) return editingTor.picId;
    if (currentUser?.id) return currentUser.id;
    return users[0]?.id || '';
  });

  const selectedPicUser = useMemo(
    () => users.find((u) => u.id === picId),
    [users, picId]
  );

  // Lokasi Pelaksanaan Kegiatan
  const [locations, setLocations] = useState<TorLocationItem[]>(() => {
    if (editingTor?.locations && editingTor.locations.length > 0) {
      return editingTor.locations;
    }
    if (editingTor?.location) {
      return [
        {
          id: 'loc-1',
          villageCity: editingTor.location,
          province: 'Jawa Barat',
          country: 'Indonesia',
        },
      ];
    }
    return EXAMPLE_LOCATIONS;
  });

  const handleAddLocation = () => {
    setLocations((prev) => [
      ...prev,
      {
        id: `loc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        villageCity: '',
        province: '',
        country: 'Indonesia',
      },
    ]);
  };

  const handleUpdateLocation = (
    id: string,
    field: 'villageCity' | 'province' | 'country',
    val: string
  ) => {
    setLocations((prev) =>
      prev.map((loc) => (loc.id === id ? { ...loc, [field]: val } : loc))
    );
  };

  const handleRemoveLocation = (id: string) => {
    if (locations.length <= 1) {
      setLocations([
        {
          id: 'loc-1',
          villageCity: '',
          province: '',
          country: 'Indonesia',
        },
      ]);
      return;
    }
    setLocations((prev) => prev.filter((loc) => loc.id !== id));
  };

  const locationSummary = useMemo(() => {
    const valid = locations.filter((l) => l.villageCity.trim() || l.province.trim());
    if (valid.length === 0) return '';
    return valid
      .map((l) => {
        const parts = [
          l.villageCity.trim(),
          l.province.trim(),
          l.country.trim() || 'Indonesia',
        ].filter(Boolean);
        return parts.join(', ');
      })
      .join('; ');
  }, [locations]);

  // Tanggal Mulai & Tanggal Selesai
  const [startDate, setStartDate] = useState<string>(() =>
    editingTor?.startDate || '2026-10-10'
  );
  const [endDate, setEndDate] = useState<string>(() =>
    editingTor?.endDate || '2026-10-12'
  );

  // Perhitungan Durasi Hari
  const daysDuration = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    if (isNaN(start) || isNaN(end) || end < start) return 0;
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  }, [startDate, endDate]);

  // Format Tanggal Indonesia
  const formatTanggalIndo = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Frekuensi Pelaporan & Sinkronisasi Tanggal
  const [reportingPeriodType, setReportingPeriodType] =
    useState<ReportingPeriodType>(() =>
      editingTor?.reportingPeriodType || 'Sekali / Akhir Kegiatan'
    );
  const [offsetDays] = useState<number>(7);
  const [manualOverrideDeadline, setManualOverrideDeadline] = useState<boolean>(
    editingTor?.reportingPeriodType === 'Periode Khusus'
  );
  const [customDeadline, setCustomDeadline] = useState<string>(
    editingTor?.reportingDeadline || ''
  );

  // Perhitungan Deadline Otomatis (H+X)
  const calculatedDeadline = useMemo(() => {
    if (!endDate) return '';
    try {
      const endD = new Date(endDate + 'T00:00:00');
      if (isNaN(endD.getTime())) return '';
      endD.setDate(endD.getDate() + offsetDays);
      return endD.toISOString().split('T')[0];
    } catch {
      return '';
    }
  }, [endDate, offsetDays]);

  const effectiveDeadline = manualOverrideDeadline ? customDeadline : calculatedDeadline;

  // Sinkronisasi Jadwal Tanggal Pelaporan Otomatis
  const reportingSchedule = useMemo(() => {
    if (!startDate || !endDate) {
      return {
        milestones: [] as ReportingMilestone[],
        summaryText:
          'Tentukan tanggal mulai dan selesai kegiatan untuk melihat jadwal sinkronisasi pelaporan.',
      };
    }

    const s = new Date(startDate + 'T00:00:00');
    const e = new Date(endDate + 'T00:00:00');
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) {
      return {
        milestones: [] as ReportingMilestone[],
        summaryText: 'Rentang tanggal pelaksanaan tidak valid.',
      };
    }

    const milestones: ReportingMilestone[] = [];
    const diffTime = Math.abs(e.getTime() - s.getTime());
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (reportingPeriodType === 'Harian') {
      const current = new Date(s);
      let dayIndex = 1;
      while (current <= e) {
        const iso = current.toISOString().split('T')[0];
        milestones.push({
          title: `Laporan Hari #${dayIndex}`,
          rawDate: iso,
          dateStr: formatTanggalIndo(iso),
        });
        current.setDate(current.getDate() + 1);
        dayIndex++;
      }

      const finalDeadline = new Date(e);
      finalDeadline.setDate(finalDeadline.getDate() + offsetDays);
      const finalIso = finalDeadline.toISOString().split('T')[0];
      milestones.push({
        title: `Rekap Akhir & Evaluasi (H+${offsetDays})`,
        rawDate: finalIso,
        dateStr: formatTanggalIndo(finalIso),
        isFinalDeadline: true,
      });

      return {
        milestones,
        summaryText: `${milestones.length - 1} laporan harian otomatis terjadwal selama masa kegiatan (${totalDays} hari), dengan penyerahan rekapitulasi akhir paling lambat ${formatTanggalIndo(finalIso)}.`,
      };
    }

    if (reportingPeriodType === 'Mingguan') {
      let weekIndex = 1;
      const current = new Date(s);
      current.setDate(current.getDate() + 6);
      while (current <= e) {
        const iso = current.toISOString().split('T')[0];
        milestones.push({
          title: `Laporan Minggu #${weekIndex}`,
          rawDate: iso,
          dateStr: formatTanggalIndo(iso),
        });
        current.setDate(current.getDate() + 7);
        weekIndex++;
      }

      const finalDeadline = new Date(e);
      finalDeadline.setDate(finalDeadline.getDate() + offsetDays);
      const finalIso = finalDeadline.toISOString().split('T')[0];
      milestones.push({
        title: `Laporan Akhir Mingguan (H+${offsetDays})`,
        rawDate: finalIso,
        dateStr: formatTanggalIndo(finalIso),
        isFinalDeadline: true,
      });

      return {
        milestones,
        summaryText: `Pelaporan berkala setiap 7 hari, dengan rekapitulasi akhir diserahkan maksimal ${formatTanggalIndo(finalIso)}.`,
      };
    }

    if (reportingPeriodType === 'Bulanan') {
      let monthIndex = 1;
      const current = new Date(s);
      current.setMonth(current.getMonth() + 1);
      while (current <= e) {
        const iso = current.toISOString().split('T')[0];
        milestones.push({
          title: `Laporan Bulan #${monthIndex}`,
          rawDate: iso,
          dateStr: formatTanggalIndo(iso),
        });
        current.setMonth(current.getMonth() + 1);
        monthIndex++;
      }

      const finalDeadline = new Date(e);
      finalDeadline.setDate(finalDeadline.getDate() + offsetDays);
      const finalIso = finalDeadline.toISOString().split('T')[0];
      milestones.push({
        title: `Laporan Akhir Periode (H+${offsetDays})`,
        rawDate: finalIso,
        dateStr: formatTanggalIndo(finalIso),
        isFinalDeadline: true,
      });

      return {
        milestones,
        summaryText: `Pelaporan kemajuan setiap bulan, dengan batas akhir dokumen lengkap pada ${formatTanggalIndo(finalIso)}.`,
      };
    }

    const finalDeadline = new Date(e);
    finalDeadline.setDate(finalDeadline.getDate() + offsetDays);
    const finalIso = finalDeadline.toISOString().split('T')[0];
    milestones.push({
      title: `Laporan Akhir Kegiatan (H+${offsetDays})`,
      rawDate: finalIso,
      dateStr: formatTanggalIndo(finalIso),
      isFinalDeadline: true,
    });

    return {
      milestones,
      summaryText: `Laporan komprehensif diserahkan 1 kali setelah seluruh rangkaian acara tuntas, batas waktu ${formatTanggalIndo(finalIso)} (H+${offsetDays}).`,
    };
  }, [startDate, endDate, reportingPeriodType, offsetDays]);

  // ==========================================
  // SECTION 2: LATAR BELAKANG MASALAH
  // ==========================================
  const [background, setBackground] = useState<string>(() =>
    editingTor ? editingTor.background : EXAMPLE_BACKGROUND
  );

  // ==========================================
  // SECTION 3: TUJUAN UMUM & TUJUAN KHUSUS
  // ==========================================
  const [generalObjective, setGeneralObjective] = useState<string>(() =>
    editingTor ? editingTor.generalObjective || editingTor.objectives || '' : EXAMPLE_GENERAL_OBJECTIVE
  );

  const [specificObjectives, setSpecificObjectives] = useState<TorSpecificObjectiveItem[]>(() =>
    editingTor?.specificObjectives && editingTor.specificObjectives.length > 0
      ? editingTor.specificObjectives
      : EXAMPLE_SPECIFIC_OBJECTIVES
  );

  const handleAddSpecificObjectivePoint = () => {
    const newItem: TorSpecificObjectiveItem = {
      id: `so-${Date.now()}`,
      objective: '',
      expectedResult: '',
      expectedChange: '',
    };
    setSpecificObjectives([...specificObjectives, newItem]);
  };

  const handleUpdateObjectiveText = (id: string, objectiveText: string) => {
    setSpecificObjectives(
      specificObjectives.map((so) => (so.id === id ? { ...so, objective: objectiveText } : so))
    );
  };

  const handleUpdateExpectedResult = (id: string, text: string) => {
    setSpecificObjectives(
      specificObjectives.map((so) => (so.id === id ? { ...so, expectedResult: text } : so))
    );
  };

  const handleUpdateExpectedChange = (id: string, text: string) => {
    setSpecificObjectives(
      specificObjectives.map((so) => (so.id === id ? { ...so, expectedChange: text } : so))
    );
  };

  const handleRemoveSpecificObjective = (id: string) => {
    setSpecificObjectives(specificObjectives.filter((so) => so.id !== id));
  };

  const [goals] = useState<TorGoalItem[]>(() => editingTor?.goals || []);

  // ==========================================
  // IMPLEMENTATION TIMELINE (Period & Activity)
  // ==========================================
  const [timelineItems, setTimelineItems] = useState<TorTimelineItem[]>(() =>
    editingTor?.timelineItems && editingTor.timelineItems.length > 0
      ? editingTor.timelineItems
      : EXAMPLE_TIMELINE_ITEMS
  );

  const handleAddTimelineRow = () => {
    const defaultPeriod = selectedCustomPeriod ? selectedCustomPeriod.code : '';
    const newItem: TorTimelineItem = {
      id: `tl-${Date.now()}`,
      period: defaultPeriod,
      activity: '',
    };
    setTimelineItems([...timelineItems, newItem]);
  };

  const handleUpdateTimelineItem = (id: string, field: 'period' | 'activity', value: string) => {
    setTimelineItems(
      timelineItems.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveTimelineRow = (id: string) => {
    setTimelineItems(timelineItems.filter((item) => item.id !== id));
  };

  // ==========================================
  // MONITORING MECHANISM (M&E 4 Columns)
  // ==========================================
  const [monitoringItems, setMonitoringItems] = useState<TorMonitoringItem[]>(() =>
    editingTor?.monitoringItems && editingTor.monitoringItems.length > 0
      ? editingTor.monitoringItems
      : EXAMPLE_MONITORING_ITEMS
  );

  const handleAddMonitoringRow = () => {
    const defaultFreq = selectedCustomPeriod
      ? `Selama ${selectedCustomPeriod.code} — ${selectedCustomPeriod.label} (${formatTanggalIndo(selectedCustomPeriod.startDate)} s/d ${formatTanggalIndo(selectedCustomPeriod.endDate)})`
      : '';
    const newItem: TorMonitoringItem = {
      id: `me-${Date.now()}`,
      aspect: '',
      method: '',
      frequency: defaultFreq,
      pic: '',
    };
    setMonitoringItems([...monitoringItems, newItem]);
  };

  const handleUpdateMonitoringItem = (
    id: string,
    field: 'aspect' | 'method' | 'frequency' | 'pic',
    value: string
  ) => {
    setMonitoringItems(
      monitoringItems.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveMonitoringRow = (id: string) => {
    setMonitoringItems(monitoringItems.filter((item) => item.id !== id));
  };

  // Sinkronisasi seluruh komponen TOR agar mengikuti Custom Period yang dipilih
  const syncAllTorComponentsToCustomPeriod = (
    period: ProgramBudgetPeriod,
    forceOverwriteDates = false
  ) => {
    const pStart = period.startDate;
    const pEnd = period.endDate;

    // 1. Tanggal Pelaksanaan Kegiatan mengikuti rentang Custom Period
    let nextStart = startDate;
    let nextEnd = endDate;
    if (forceOverwriteDates || !nextStart || nextStart < pStart || nextStart > pEnd) {
      nextStart = pStart;
    }
    if (forceOverwriteDates || !nextEnd || nextEnd > pEnd || nextEnd < nextStart) {
      nextEnd = pEnd;
    }
    setStartDate(nextStart);
    setEndDate(nextEnd);

    // 2. Implementation Timeline mengikuti kode depan Custom Period (mis. P1)
    setTimelineItems((prev) => {
      if (!prev || prev.length === 0) {
        return [
          {
            id: `tl-${Date.now()}-1`,
            period: period.code,
            activity: 'Persiapan Teknis, Koordinasi Lapangan & Mobilisasi Peserta',
          },
          {
            id: `tl-${Date.now()}-2`,
            period: period.code,
            activity: 'Pelaksanaan Kegiatan Utama sesuai Tujuan Khusus TOR',
          },
          {
            id: `tl-${Date.now()}-3`,
            period: period.code,
            activity: 'Evaluasi Capaian, Post-Test & Penyusunan Laporan Kegiatan',
          },
        ];
      }
      return prev.map((tl, idx) => {
        const cleanAct = tl.activity || `Pelaksanaan Kegiatan ${idx + 1}`;
        return {
          ...tl,
          period: period.code,
          activity: cleanAct,
        };
      });
    });

    // 3. Monitoring Mechanism (M&E) mengikuti Custom Period
    setMonitoringItems((prev) =>
      prev.map((m) => ({
        ...m,
        frequency: `Selama ${period.code}`,
      }))
    );

    // 4. Rundown Kegiatan mengikuti Custom Period
    setRundown((prev) =>
      prev.map((rd) => ({
        ...rd,
        date: period.code,
        timelineLabel: `${period.code} — ${rd.agenda || 'Pelaksanaan Kegiatan'}`,
      }))
    );
  };

  // Saat programCustomPeriods pertama kali tersedia atau berubah program, otomatis ikuti Custom Period yang ditentukan Finance
  useEffect(() => {
    if (programCustomPeriods.length === 0) return;
    const targetPeriod =
      (!editingTor ? financeActiveCustomPeriod : undefined) ||
      programCustomPeriods.find((p) => p.id === customPeriodId) ||
      (editingTor?.customPeriodCode
        ? programCustomPeriods.find((p) => p.code === editingTor.customPeriodCode)
        : undefined) ||
      financeActiveCustomPeriod ||
      programCustomPeriods[0];

    if (targetPeriod && targetPeriod.id !== customPeriodId) {
      setCustomPeriodId(targetPeriod.id);
      if (!editingTor) {
        syncAllTorComponentsToCustomPeriod(targetPeriod, true);
      } else {
        if (startDate < targetPeriod.startDate || startDate > targetPeriod.endDate) {
          setStartDate(targetPeriod.startDate);
        }
        if (endDate > targetPeriod.endDate || endDate < targetPeriod.startDate) {
          setEndDate(targetPeriod.endDate);
        }
      }
    }
  }, [programCustomPeriods, financeActiveCustomPeriod, customPeriodId, editingTor]);

  // ==========================================
  // SCOPE OF ACTIVITIES (Bulleted List)
  // ==========================================
  const [scopeOfActivities, setScopeOfActivities] = useState<string[]>(() =>
    editingTor?.scopeOfActivities && editingTor.scopeOfActivities.length > 0
      ? editingTor.scopeOfActivities
      : EXAMPLE_SCOPE_OF_ACTIVITIES
  );

  const handleAddScopePoint = () => {
    setScopeOfActivities([...scopeOfActivities, '']);
  };

  const handleUpdateScopePoint = (index: number, value: string) => {
    const next = [...scopeOfActivities];
    next[index] = value;
    setScopeOfActivities(next);
  };

  const handleRemoveScopePoint = (index: number) => {
    setScopeOfActivities(scopeOfActivities.filter((_, i) => i !== index));
  };

  // ==========================================
  // MEKANISME PELAKSANAAN (Bulleted List)
  // ==========================================
  const [implementationMechanisms, setImplementationMechanisms] = useState<string[]>(() =>
    editingTor?.implementationMechanisms && editingTor.implementationMechanisms.length > 0
      ? editingTor.implementationMechanisms
      : EXAMPLE_IMPLEMENTATION_MECHANISMS
  );

  const handleAddMechanismPoint = () => {
    setImplementationMechanisms([...implementationMechanisms, '']);
  };

  const handleUpdateMechanismPoint = (index: number, value: string) => {
    const next = [...implementationMechanisms];
    next[index] = value;
    setImplementationMechanisms(next);
  };

  const handleRemoveMechanismPoint = (index: number) => {
    setImplementationMechanisms(implementationMechanisms.filter((_, i) => i !== index));
  };

  // ==========================================
  // RUNDOWN KEGIATAN OPSIONAL TOGGLE
  // ==========================================
  const [isRundownVisible, setIsRundownVisible] = useState<boolean>(() =>
    editingTor ? editingTor.isRundownVisible ?? true : true
  );

  // ==========================================
  // SECTION 4: PESERTA KEGIATAN (TABEL MANDIRI)
  // ==========================================
  const [participantType, setParticipantType] = useState<string>(() =>
    editingTor
      ? editingTor.participantType || editingTor.participantsType || ''
      : 'Pengurus POKMAIR & Perangkat Desa'
  );
  const [participantsTarget, setParticipantsTarget] = useState<string>(() =>
    editingTor ? editingTor.participantsTarget || '' : 'Pengurus Inti POKMAIR dan Tim Bendahara Iuran'
  );
  const [participantsCount, setParticipantsCount] = useState<string | number>(() =>
    editingTor?.participantsCount != null ? editingTor.participantsCount : ''
  );
  const [participantsCriteria, setParticipantsCriteria] = useState<string>(() =>
    editingTor
      ? editingTor.participantsCriteria || ''
      : 'Pengurus aktif POKMAIR berusia 20–55 tahun yang bertugas dalam pemeliharaan operasional harian dan pencatatan keuangan kas.'
  );

  const participantTableMode: ParticipantTableMode = 'custom';
  const [participantCustomColumns, setParticipantCustomColumns] =
    useState<TorParticipantCustomColumn[]>(() =>
      editingTor?.participantCustomColumns && editingTor.participantCustomColumns.length > 0
        ? editingTor.participantCustomColumns
        : EXAMPLE_PARTICIPANT_COLUMNS
    );
  const [participantRows, setParticipantRows] = useState<TorParticipantRow[]>(() =>
    editingTor?.participantRows && editingTor.participantRows.length > 0
      ? editingTor.participantRows.map((r) => ({
          ...r,
          customValues: r.customValues || {
            'col-target': r.target || '',
            'col-male': r.maleCount != null ? String(r.maleCount) : '',
            'col-female': r.femaleCount != null ? String(r.femaleCount) : '',
            'col-note': r.note || '',
          },
        }))
      : EXAMPLE_PARTICIPANT_ROWS
  );
  const [newCustomColumnName, setNewCustomColumnName] = useState<string>('');
  const [newCustomColumnType, setNewCustomColumnType] = useState<'text' | 'number'>('text');
  const [showAddColumnInput, setShowAddColumnInput] = useState<boolean>(false);

  const handleAddCustomRow = () => {
    const initVals: Record<string, string> = {};
    participantCustomColumns.forEach((col) => {
      initVals[col.id] = '';
    });
    setParticipantRows((prev) => [
      ...prev,
      {
        id: `prow-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        target: '',
        customValues: initVals,
      },
    ]);
  };

  const handleUpdateCustomValue = (rowId: string, colId: string, value: string) => {
    setParticipantRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const nextCustomValues = {
          ...(r.customValues || {}),
          [colId]: value,
        };
        const firstColId = participantCustomColumns[0]?.id;
        const targetVal =
          colId === 'col-target' || colId === firstColId ? value : r.target || '';
        return {
          ...r,
          target: targetVal,
          customValues: nextCustomValues,
        };
      })
    );
  };

  const handleDeleteParticipantRow = (rowId: string) => {
    setParticipantRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleAddCustomColumn = () => {
    if (!newCustomColumnName.trim()) return;
    const colId = `col-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
    const newCol: TorParticipantCustomColumn = {
      id: colId,
      label: newCustomColumnName.trim(),
      type: newCustomColumnType,
    };
    setParticipantCustomColumns((prev) => [...prev, newCol]);
    setNewCustomColumnName('');
    setShowAddColumnInput(false);
  };

  const handleDeleteCustomColumn = (colId: string) => {
    if (participantCustomColumns.length <= 1) return;
    setParticipantCustomColumns((prev) => prev.filter((c) => c.id !== colId));
  };

  const numericColumnsTotal = useMemo(() => {
    const totals: Record<string, number> = {};
    participantCustomColumns.forEach((col) => {
      if (col.type === 'number') {
        let sum = 0;
        participantRows.forEach((r) => {
          const val = Number(r.customValues?.[col.id]);
          if (!isNaN(val)) sum += val;
        });
        totals[col.id] = sum;
      }
    });
    return totals;
  }, [participantCustomColumns, participantRows]);

  const grandTotalParticipants = useMemo(() => {
    const numCols = participantCustomColumns.filter((c) => c.type === 'number');
    if (numCols.length > 0) {
      let grandSum = 0;
      numCols.forEach((c) => {
        grandSum += numericColumnsTotal[c.id] || 0;
      });
      return grandSum;
    }
    return participantRows.length;
  }, [participantCustomColumns, numericColumnsTotal, participantRows]);

  // ==========================================
  // SECTION 5: TIM PELAKSANA (ROLE & RESPONSIBILITY)
  // ==========================================
  const [rolesResponsibilities, setRolesResponsibilities] = useState<TorRoleItem[]>(() =>
    editingTor?.rolesResponsibilities && editingTor.rolesResponsibilities.length > 0
      ? editingTor.rolesResponsibilities
      : EXAMPLE_ROLES
  );
  const [rolesNotes, setRolesNotes] = useState<string>(() =>
    editingTor
      ? editingTor.rolesNotes || editingTor.rolesAdditionalNotes || ''
      : EXAMPLE_ROLES_NOTES
  );
  const [showAddRoleRow, setShowAddRoleRow] = useState<boolean>(false);
  const [newRoleTitle, setNewRoleTitle] = useState<string>('');
  const [newRoleName, setNewRoleName] = useState<string>('');
  const [newRoleInstitution, setNewRoleInstitution] = useState<string>('');
  const [newRoleTasks, setNewRoleTasks] = useState<string>('');

  const handleAddRole = () => {
    if (!newRoleTitle.trim()) return;
    const name = newRoleName.trim() || 'Tim Pelaksana';
    const inst = newRoleInstitution.trim();
    const formattedNameInstitution = inst ? `${name} — ${inst}` : name;

    setRolesResponsibilities([
      ...rolesResponsibilities,
      {
        id: `role-${Date.now()}`,
        role: newRoleTitle.trim(),
        nameInstitution: formattedNameInstitution,
        picName: name,
        institution: inst,
        responsibilities: newRoleTasks.trim() || 'Menjalankan tugas teknis sesuai mandat.',
      },
    ]);
    setNewRoleTitle('');
    setNewRoleName('');
    setNewRoleInstitution('');
    setNewRoleTasks('');
    setShowAddRoleRow(false);
  };

  const handleRemoveRole = (id: string) => {
    setRolesResponsibilities(rolesResponsibilities.filter((r) => r.id !== id));
  };

  // ==========================================
  // SECTION 6: RUNDOWN KEGIATAN
  // ==========================================
  const [rundown, setRundown] = useState<TorRundownItem[]>(() =>
    editingTor?.rundown && editingTor.rundown.length > 0
      ? editingTor.rundown
      : EXAMPLE_RUNDOWN
  );
  const [rundownNotes, setRundownNotes] = useState<string>(() =>
    editingTor
      ? editingTor.rundownNotes || editingTor.rundownAdditionalNotes || ''
      : EXAMPLE_RUNDOWN_NOTES
  );
  const [activeAddSectionKey, setActiveAddSectionKey] = useState<string | null>(null);
  const [newRdTimelineId, setNewRdTimelineId] = useState<string>('');
  const [newRdDate, setNewRdDate] = useState<string>('');
  const [newRdTime, setNewRdTime] = useState<string>('');
  const [newRdAgenda, setNewRdAgenda] = useState<string>('');
  const [newRdTargetParticipants, setNewRdTargetParticipants] = useState<string>('');
  const [newRdLocation, setNewRdLocation] = useState<string>('');
  const [newRdPic, setNewRdPic] = useState<string>('');

  const formatTimelineOptionLabel = (tl: TorTimelineItem) => {
    const shortCode = (tl.period || selectedCustomPeriod?.code || 'P1')
      .split(' · ')[0]
      .split(' (')[0]
      .trim();
    return tl.activity ? `${shortCode} — ${tl.activity}` : shortCode;
  };

  // Group rundown items by Implementation Timeline section
  const rundownSections = useMemo(() => {
    const groups: {
      sectionKey: string;
      timelineId: string;
      timelineLabel: string;
      items: TorRundownItem[];
    }[] = [];

    rundown.forEach((item, idx) => {
      const matchedTl = item.timelineId
        ? timelineItems.find((t) => t.id === item.timelineId)
        : timelineItems[idx] || timelineItems[0];
      const resolvedId = item.timelineId || matchedTl?.id || `sec-default`;
      const resolvedLabel =
        item.timelineLabel ||
        (matchedTl ? formatTimelineOptionLabel(matchedTl) : 'Umum / Seluruh Tahap Pelaksanaan');

      const existingGroup = groups.find((g) => g.timelineId === resolvedId);
      if (existingGroup) {
        existingGroup.items.push(item);
      } else {
        groups.push({
          sectionKey: resolvedId,
          timelineId: resolvedId,
          timelineLabel: resolvedLabel,
          items: [item],
        });
      }
    });

    return groups;
  }, [rundown, timelineItems]);

  const handleOpenAddSessionForSection = (sectionTimelineId: string) => {
    const matchedTl = timelineItems.find((t) => t.id === sectionTimelineId);
    const resolvedTimelineLabel = matchedTl
      ? formatTimelineOptionLabel(matchedTl)
      : 'Tahap Pelaksanaan Kegiatan';

    const newSession: TorRundownItem = {
      id: `rd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timelineId: sectionTimelineId,
      timelineLabel: resolvedTimelineLabel,
      date: '',
      time: '',
      agenda: '',
      targetParticipants: '',
      location: '',
      picName: '',
    };

    setRundown((prev) => [...prev, newSession]);
  };

  const handleAddNewRundownSection = () => {
    const usedIds = new Set(rundownSections.map((s) => s.timelineId));
    const nextAvailableTl =
      timelineItems.find((t) => !usedIds.has(t.id)) || timelineItems[0];
    const targetTlId = nextAvailableTl ? nextAvailableTl.id : `custom-tl-${Date.now()}`;
    const targetTlLabel = nextAvailableTl
      ? formatTimelineOptionLabel(nextAvailableTl)
      : `Tahap Pelaksanaan Baru (${rundownSections.length + 1})`;

    const newSession: TorRundownItem = {
      id: `rd-${Date.now()}`,
      timelineId: targetTlId,
      timelineLabel: targetTlLabel,
      date: '',
      time: '',
      agenda: '',
      targetParticipants: '',
      location: '',
      picName: '',
    };

    setRundown((prev) => [...prev, newSession]);
  };

  const handleChangeSectionTimeline = (oldTimelineId: string, nextTimelineId: string) => {
    const matchedTl = timelineItems.find((t) => t.id === nextTimelineId);
    const nextLabel = matchedTl
      ? formatTimelineOptionLabel(matchedTl)
      : 'Tahap Pelaksanaan Kegiatan';

    setRundown((prev) =>
      prev.map((item, idx) => {
        const fallbackTl = item.timelineId
          ? timelineItems.find((t) => t.id === item.timelineId)
          : timelineItems[idx] || timelineItems[0];
        const currentResolvedId = item.timelineId || fallbackTl?.id || 'sec-default';
        if (currentResolvedId !== oldTimelineId) return item;
        return {
          ...item,
          timelineId: nextTimelineId,
          timelineLabel: nextLabel,
        };
      })
    );
  };

  const handleRemoveRundownSection = (sectionTimelineId: string) => {
    setRundown((prev) =>
      prev.filter((item, idx) => {
        const fallbackTl = item.timelineId
          ? timelineItems.find((t) => t.id === item.timelineId)
          : timelineItems[idx] || timelineItems[0];
        const currentResolvedId = item.timelineId || fallbackTl?.id || 'sec-default';
        return currentResolvedId !== sectionTimelineId;
      })
    );
    if (activeAddSectionKey === sectionTimelineId) {
      setActiveAddSectionKey(null);
    }
  };

  const handleAddRundown = () => {
    const selectedTl =
      timelineItems.find((t) => t.id === newRdTimelineId) || timelineItems[0];
    const resolvedTimelineId =
      newRdTimelineId || selectedTl?.id || `custom-tl-${Date.now()}`;
    const resolvedTimelineLabel = selectedTl
      ? formatTimelineOptionLabel(selectedTl)
      : 'Tahap Pelaksanaan Kegiatan';

    setRundown([
      ...rundown,
      {
        id: `rd-${Date.now()}`,
        timelineId: resolvedTimelineId,
        timelineLabel: resolvedTimelineLabel,
        date: newRdDate.trim(),
        time: newRdTime.trim(),
        agenda: newRdAgenda.trim(),
        targetParticipants: newRdTargetParticipants.trim(),
        location: newRdLocation.trim(),
        picName: newRdPic.trim(),
      },
    ]);
    setNewRdDate('');
    setNewRdTime('');
    setNewRdAgenda('');
    setNewRdTargetParticipants('');
    setNewRdLocation('');
    setNewRdPic('');
    setActiveAddSectionKey(null);
  };

  const handleUpdateRundownField = (
    id: string,
    field: keyof TorRundownItem,
    value: string
  ) => {
    setRundown(
      rundown.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const handleRemoveRundown = (id: string) => {
    setRundown(rundown.filter((r) => r.id !== id));
  };

  // Catatan Tambahan (Opsional)
  const [additionalNotes, setAdditionalNotes] = useState<string>(() =>
    editingTor ? editingTor.additionalNotes || '' : EXAMPLE_ADDITIONAL_NOTES
  );

  // Dynamic Organizer & Person in Charge text complementary to current inputs
  const dynamicOrganizerSummary = useMemo(() => {
    const picDisplay = selectedPicUser
      ? `${selectedPicUser.name} (${selectedPicUser.roleTitle || selectedPicUser.role})`
      : editingTor?.picName || currentUser?.name || 'Budi Santoso';
    const roleLines =
      rolesResponsibilities.length > 0
        ? rolesResponsibilities
            .map(
              (r, i) =>
                `  ${i + 1}. ${r.nameInstitution || r.picName} — ${r.role}`
            )
            .join('\n')
        : '  (Belum ada rincian tim pelaksana)';

    return [
      `Penyelenggara: Yayasan WIJNA (${currentProgram?.name || 'Program Lapangan WIJNA'})`,
      `Penanggung Jawab Utama (PIC): ${picDisplay}`,
      `Tim Pelaksana & Peran:`,
      roleLines,
    ].join('\n');
  }, [selectedPicUser, editingTor, currentUser, rolesResponsibilities, currentProgram]);

  // ==========================================
  // CLEAR SEMUA CONTOH / ISI CONTOH HANDLERS
  // ==========================================
  const handleClearAllExamples = () => {
    setTitle('');
    setLocations([
      {
        id: 'loc-1',
        villageCity: '',
        province: '',
        country: 'Indonesia',
      },
    ]);
    setBudgetRequestedInput('');
    setBackground('');
    setGeneralObjective('');
    setSpecificObjectives([
      {
        id: `so-${Date.now()}`,
        objective: '',
        expectedResult: '',
        expectedChange: '',
      },
    ]);
    setParticipantType('');
    setParticipantsTarget('');
    setParticipantsCount('');
    setParticipantsCriteria('');
    setParticipantRows([
      {
        id: `prow-${Date.now()}`,
        target: '',
        customValues: {
          'col-target': '',
          'col-male': '',
          'col-female': '',
          'col-note': '',
        },
      },
    ]);
    setRolesResponsibilities([]);
    setRolesNotes('');
    setTimelineItems([
      {
        id: `tl-${Date.now()}`,
        period: '',
        activity: '',
      },
    ]);
    setMonitoringItems(
      EMPTY_DEFAULT_MONITORING_ITEMS.map((m, idx) => ({
        ...m,
        id: `me-${Date.now()}-${idx}`,
      }))
    );
    setScopeOfActivities(['']);
    setImplementationMechanisms(['']);
    setRundown([]);
    setRundownNotes('');
    setIsRundownVisible(false);
    setAdditionalNotes('');
    setErrorMessage(null);
    setIsExampleCleared(true);
  };

  const handleRestoreExamples = () => {
    setTitle(EXAMPLE_TITLE);
    setLocations(EXAMPLE_LOCATIONS);
    setBudgetRequestedInput(EXAMPLE_BUDGET);
    setBackground(EXAMPLE_BACKGROUND);
    setGeneralObjective(EXAMPLE_GENERAL_OBJECTIVE);
    setSpecificObjectives(EXAMPLE_SPECIFIC_OBJECTIVES);
    setParticipantType('Pengurus POKMAIR & Perangkat Desa');
    setParticipantsTarget('Pengurus Inti POKMAIR dan Tim Bendahara Iuran');
    setParticipantsCriteria(
      'Pengurus aktif POKMAIR berusia 20–55 tahun yang bertugas dalam pemeliharaan operasional harian dan pencatatan keuangan kas.'
    );
    setParticipantCustomColumns(EXAMPLE_PARTICIPANT_COLUMNS);
    setParticipantRows(EXAMPLE_PARTICIPANT_ROWS);
    setRolesResponsibilities(EXAMPLE_ROLES);
    setRolesNotes(EXAMPLE_ROLES_NOTES);
    setTimelineItems(EXAMPLE_TIMELINE_ITEMS);
    setMonitoringItems(EXAMPLE_MONITORING_ITEMS);
    setScopeOfActivities(EXAMPLE_SCOPE_OF_ACTIVITIES);
    setImplementationMechanisms(EXAMPLE_IMPLEMENTATION_MECHANISMS);
    setRundown(EXAMPLE_RUNDOWN);
    setRundownNotes(EXAMPLE_RUNDOWN_NOTES);
    setIsRundownVisible(true);
    setAdditionalNotes(EXAMPLE_ADDITIONAL_NOTES);
    setErrorMessage(null);
    setIsExampleCleared(false);
  };

  // Status & Error Handlers
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [controlledSyncConfirmed, setControlledSyncConfirmed] = useState<boolean>(true);

  // Validasi Form
  const validateForm = () => {
    if (!title.trim()) {
      return 'Nama Acara / Judul Kegiatan TOR wajib diisi.';
    }
    if (!programId) {
      return 'Pilih Program Induk terlebih dahulu.';
    }
    if (!selectedCustomPeriod) {
      return 'Pilih Custom Period Program yang telah disepakati sebagai dasar pembuatan TOR.';
    }
    if (!outcomeId) {
      return 'Pilih Outcome dari Program yang dipilih.';
    }
    if (!outputId) {
      return 'Pilih Output / Produk yang sesuai.';
    }
    if (!activityId) {
      return 'Pilih Activity (Kegiatan) terkait.';
    }
    if (!picId) {
      return 'Pilih Organizer / PIC yang bertanggung jawab.';
    }
    const hasValidLocation = locations.some(
      (loc) => loc.villageCity.trim() && loc.province.trim()
    );
    if (!hasValidLocation) {
      return 'Lokasi pelaksanaan kegiatan (Desa/Kota, Provinsi, Negara) wajib diisi minimal 1 lokasi.';
    }
    if (!startDate) {
      return 'Tanggal mulai kegiatan wajib diisi.';
    }
    if (!endDate) {
      return 'Tanggal selesai kegiatan wajib diisi.';
    }
    if (endDate < startDate) {
      return 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.';
    }
    if (
      selectedCustomPeriod &&
      (startDate < selectedCustomPeriod.startDate || endDate > selectedCustomPeriod.endDate)
    ) {
      return `Seluruh tanggal pelaksanaan TOR (${startDate} s/d ${endDate}) wajib mengikuti rentang Custom Period yang disepakati: ${selectedCustomPeriod.code} (${selectedCustomPeriod.startDate} s/d ${selectedCustomPeriod.endDate}).`;
    }
    if (!effectiveDeadline) {
      return 'Tanggal deadline pelaporan belum ditentukan.';
    }
    if (effectiveDeadline < endDate) {
      return 'Tanggal deadline pelaporan tidak boleh lebih awal dari tanggal kegiatan selesai.';
    }
    if (!background.trim()) {
      return 'Latar Belakang Masalah wajib diisi.';
    }
    return null;
  };

  // Submit Handler
  const handleSubmit = async (submitImmediately: boolean) => {
    setErrorMessage(null);

    const valErr = validateForm();
    if (valErr) {
      setErrorMessage(valErr);
      return;
    }

    if (isEditMode && !controlledSyncConfirmed) {
      setErrorMessage(
        'Controlled Modification: Harap setujui sinkronisasi pembaruan referensi ke seluruh tahapan hilir (Tahap 2–8) yang terdampak.'
      );
      return;
    }

    if (submitImmediately && !torNumberPreview.isComplete && !isEditMode) {
      setErrorMessage(
        'Program, Outcome, Output, dan Activity wajib dipilih untuk menerbitkan nomor TOR resmi.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanedObjectives = specificObjectives.filter(
        (so) =>
          so.objective.trim() ||
          (so.expectedResult && so.expectedResult.trim()) ||
          (so.expectedChange && so.expectedChange.trim())
      );
      const cleanedTimelines = timelineItems.filter(
        (tl) => tl.period.trim() || tl.activity.trim()
      );
      const cleanedMonitoring = monitoringItems.filter(
        (m) => m.aspect.trim() || m.method.trim() || m.frequency.trim() || m.pic.trim()
      );

      const implementingTeamNames = rolesResponsibilities
        .map((r) => r.picName || r.nameInstitution)
        .filter(Boolean) as string[];

      const payload = {
        title: title.trim(),
        programId,
        outcomeId,
        outputId,
        activityId,
        activityCode: currentActivity?.code || torNumberPreview.hierarchyCode,
        picId,
        background: background.trim(),
        rationale: '',
        generalObjective: generalObjective.trim(),
        objectives: generalObjective.trim() || background.trim(),
        participantType: participantType.trim(),
        participantsType: participantType.trim(),
        participantsTarget:
          participantsTarget.trim() ||
          (participantRows.length > 0
            ? participantRows
                .map((r) => r.target || r.customValues?.['col-target'])
                .filter(Boolean)
                .join(', ')
            : ''),
        participantsCount:
          participantsCount !== '' &&
          participantsCount !== null &&
          !isNaN(Number(participantsCount))
            ? Number(participantsCount)
            : grandTotalParticipants > 0
            ? grandTotalParticipants
            : null,
        participantsCriteria: participantsCriteria.trim(),
        participantTableMode,
        participantRows,
        participantCustomColumns,
        goals,
        specificObjectives: cleanedObjectives,
        timelineItems: cleanedTimelines,
        monitoringItems: cleanedMonitoring,
        scopeOfActivities: scopeOfActivities.filter((s) => s.trim().length > 0),
        implementationMechanisms: implementationMechanisms.filter(
          (m) => m.trim().length > 0
        ),
        isRundownVisible,
        indicators: [],
        rolesResponsibilities,
        rolesNotes: rolesNotes.trim() || undefined,
        rolesAdditionalNotes: rolesNotes.trim() || undefined,
        mealItems: [],
        rundown,
        rundownNotes: rundownNotes.trim() || undefined,
        rundownAdditionalNotes: rundownNotes.trim() || undefined,
        challengesMitigations: [],
        activityDescription: background.trim(),
        expectedResults: '',
        location: locationSummary,
        locations: locations.filter((l) => l.villageCity.trim() || l.province.trim()),
        customPeriodId: selectedCustomPeriod?.id,
        customPeriodCode: selectedCustomPeriod?.code,
        customPeriodLabel: selectedCustomPeriod?.label,
        customPeriodStartDate: selectedCustomPeriod?.startDate,
        customPeriodEndDate: selectedCustomPeriod?.endDate,
        customPeriodAllocatedAmount: selectedCustomPeriod?.allocatedAmount,
        startDate,
        endDate,
        reportingPeriodType,
        reportingFrequency: reportingSchedule.summaryText,
        reportingDeadline: effectiveDeadline,
        additionalNotes: additionalNotes.trim() || undefined,
        implementingTeam: implementingTeamNames,
        budgetRequested:
          budgetRequestedInput !== '' &&
          budgetRequestedInput != null &&
          !isNaN(Number(budgetRequestedInput))
            ? Number(budgetRequestedInput)
            : 0,
        organizerPersonInCharge: dynamicOrganizerSummary,
      };

      if (editingTor) {
        const updatedTor = await api.updateTor(editingTor.id, payload);
        if (
          submitImmediately &&
          (editingTor.submissionStatus === 'Draft' ||
            editingTor.submissionStatus === 'Perlu Perbaikan')
        ) {
          await api.submitTor(editingTor.id);
        }
        onSuccess(updatedTor.id);
        onClose();
      } else {
        const newTor = await api.createTor(payload);
        if (submitImmediately) {
          await api.submitTor(newTor.id);
        }
        onSuccess(newTor.id);
        onClose();
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses TOR.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex justify-center items-stretch overflow-hidden">
      {/* Main Workspace Frame */}
      <div className="bg-white w-full h-full flex flex-col overflow-hidden max-w-[1200px] my-0 sm:my-2 sm:rounded-lg sm:border sm:border-stone-200/90 sm:shadow-2xl sm:h-[calc(100vh-16px)]">
        {/* ======================================================== */}
        {/* COMPACT HEADER WITH SINGLE "CLEAR SEMUA CONTOH" BUTTON   */}
        {/* ======================================================== */}
        <header className="bg-white border-b border-stone-200 px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Left Group: Status & Automatic TOR Number (Tanpa Judul) */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2 py-0.5 text-[11px] font-medium bg-stone-100 text-stone-600 rounded">
              {isEditMode ? editingTor?.submissionStatus : 'Draft'}
            </span>
            {/* Automatic WIJNA TOR Number Badge */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-xs font-mono text-stone-700">
              <span className="text-[11px] font-sans text-stone-400">No:</span>
              <span className="font-semibold text-stone-800">
                {editingTor?.torNumber || torNumberPreview.previewNumber}
              </span>
            </div>
          </div>

          {/* Right Group: Action Controls (Including Single Clear Examples Button) */}
          <div className="flex items-center gap-2 shrink-0">
            {!isEditMode && (
              <>
                {!isExampleCleared ? (
                  <button
                    type="button"
                    onClick={handleClearAllExamples}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors cursor-pointer"
                    title="Kosongkan seluruh contoh isian data dalam 1 klik"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Clear Semua Contoh</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleRestoreExamples}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors cursor-pointer"
                    title="Kembalikan contoh isian data komplementer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Isi Contoh Data</span>
                  </button>
                )}
              </>
            )}

            {/* Simpan Draft / Simpan Perubahan */}
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 border border-stone-200 rounded transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isEditMode ? 'Simpan Perubahan TOR' : 'Simpan Draft'}
            </button>

            {/* Ajukan Dokumen TOR */}
            {(!isEditMode ||
              editingTor?.submissionStatus === 'Draft' ||
              editingTor?.submissionStatus === 'Perlu Perbaikan') && (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isEditMode ? 'Simpan & Ajukan TOR' : 'Ajukan TOR'}
              </button>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors ml-1 cursor-pointer"
              title="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* ======================================================== */}
        {/* WORKSPACE BODY: SINGLE-COLUMN CLEAN DOCUMENT             */}
        {/* ======================================================== */}
        <div
          ref={documentContainerRef}
          className="relative flex-1 overflow-y-auto p-4 sm:p-8 sm:px-12 bg-white"
        >
          {/* PEMBERITAHUAN KECIL DI POJOK (HIDE & SHOW) UNTUK TIME PERIOD OTOMATIS FINANCE */}
          {selectedCustomPeriod && (
            <div className="sticky top-0 z-20 flex justify-end pointer-events-none mb-1">
              <div className="pointer-events-auto">
                {!showTimePeriodCorner ? (
                  <button
                    type="button"
                    onClick={() => setShowTimePeriodCorner(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-900/90 hover:bg-stone-900 text-white text-[11px] font-medium shadow-sm transition-all cursor-pointer"
                    title="Tampilkan info Time Period yang ditentukan Finance"
                  >
                    <Calendar className="w-3 h-3 text-blue-300" />
                    <span className="font-mono font-semibold">{selectedCustomPeriod.code}</span>
                    <span className="text-[10px] text-stone-300">Show Time Period</span>
                  </button>
                ) : (
                  <div className="w-60 sm:w-64 rounded-md border border-stone-200 bg-white/95 backdrop-blur-xs shadow-md p-2.5 text-[11px] space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-stone-800">
                        <Calendar className="w-3.5 h-3.5 text-[#1D4ED8] shrink-0" />
                        <span>Time Period</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTimePeriodCorner(false)}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium text-stone-500 hover:text-stone-900 hover:bg-stone-100 cursor-pointer"
                        title="Sembunyikan pemberitahuan Time Period"
                      >
                        Hide
                      </button>
                    </div>

                    <div className="px-2 py-1.5 rounded bg-stone-50 border border-stone-200/80">
                      <div className="font-mono font-bold text-stone-900 text-[11px]">
                        {selectedCustomPeriod.code} — {selectedCustomPeriod.label}
                      </div>
                      <div className="font-mono text-[10.5px] text-stone-600 mt-0.5">
                        {formatTanggalIndo(selectedCustomPeriod.startDate)} s/d{' '}
                        {formatTanggalIndo(selectedCustomPeriod.endDate)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="max-w-4xl mx-auto space-y-8 pb-10">
            {/* Error Notice */}
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-semibold">Harap periksa isian: </span>
                  <span>{errorMessage}</span>
                </div>
                <button
                  onClick={() => setErrorMessage(null)}
                  className="text-rose-400 hover:text-rose-600 text-sm leading-none"
                >
                  ✕
                </button>
              </div>
            )}

            {/* ======================================================== */}
            {/* INFORMASI KEGIATAN & HIERARKI PROGRAM                    */}
            {/* ======================================================== */}
            <section id="sec-info" className="space-y-4">
              <div className="pb-1.5 border-b border-stone-200">
                <h2 className="text-sm font-semibold text-stone-900">
                  Informasi Kegiatan & Hierarki Program
                </h2>
                <p className="text-xs text-stone-500">
                  Seluruh isian di bawah ini otomatis tersinkronisasi ke dalam Tabel Informasi TOR (Project Information).
                </p>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* Input Judul / Nama Acara */}
                <div>
                  <label className="block text-stone-700 font-medium mb-1">
                    Nama Acara / Judul Kegiatan TOR <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ketik nama acara / judul kegiatan TOR..."
                    className="w-full h-9 px-3 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-900 font-medium placeholder:text-stone-300 transition-colors focus:outline-none text-sm"
                  />
                </div>

                {/* Info Hak Akses RACI Output */}
                {!isEditMode && raciLoaded && (
                  <div className="px-3 py-2 rounded border border-[#EAEAEA] bg-[#FAF9F6] flex flex-wrap items-center justify-between gap-2 text-xs">
                    {outputId && getUserOutputRaciRole(outputId) ? (
                      <>
                        <span className="text-stone-600">
                          Akses Pembuatan ToR berdasarkan RACI Output (Disetujui Direktur):
                        </span>
                        <span className="font-semibold text-stone-900">
                          {getUserOutputRaciRole(outputId)}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-800">
                        Anda hanya dapat membuat ToR pada Output yang memiliki penugasan RACI Aktif (Disetujui Direktur) untuk Anda sebagai <strong>R – Responsible</strong>, <strong>A1 – Accountable Program</strong>, atau <strong>A2 – Accountable Finance</strong>.
                      </span>
                    )}
                  </div>
                )}

                {/* Grid 2 Kolom untuk Hierarki & PIC/Budget */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Program Induk */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Program Induk <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={programId}
                      onChange={(e) => setProgramId(e.target.value)}
                      className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                    >
                      {accessiblePrograms.length === 0 && (
                        <option value="">Tidak ada program dengan penugasan RACI aktif</option>
                      )}
                      {accessiblePrograms.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Outcome */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Outcome Program <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={outcomeId}
                      onChange={(e) => setOutcomeId(e.target.value)}
                      className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                    >
                      {availableOutcomes.length === 0 ? (
                        <option value="">Tidak ada outcome dengan Output tugas Anda</option>
                      ) : (
                        availableOutcomes.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Output / Produk */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Output / Produk (Sesuai Penugasan R / A) <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={outputId}
                      onChange={(e) => setOutputId(e.target.value)}
                      className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                    >
                      {availableOutputs.length === 0 ? (
                        <option value="">Tidak ada output yang ditugaskan kepada Anda</option>
                      ) : (
                        availableOutputs.map((op) => (
                          <option key={op.id} value={op.id}>
                            {op.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Activity */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Activity &amp; Kode Finance Program <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={activityId}
                      onChange={(e) => setActivityId(e.target.value)}
                      className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                    >
                      {availableActivities.length === 0 ? (
                        <option value="">Tidak ada activity pada output ini</option>
                      ) : (
                        availableActivities.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} — ${a.name}` : a.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Organizer / PIC */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Penanggung Jawab Utama (PIC) <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={picId}
                      onChange={(e) => setPicId(e.target.value)}
                      className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} — {u.role.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Estimasi Anggaran (Budget Request) */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Estimasi Kebutuhan Anggaran (IDR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={budgetRequestedInput}
                      onChange={(e) => setBudgetRequestedInput(e.target.value)}
                      placeholder="Contoh: 15000000"
                      className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 font-mono transition-colors focus:outline-none"
                    />
                  </div>
                </div>

                {/* Lokasi Pelaksanaan Kegiatan */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-stone-700 font-medium">
                        Lokasi Pelaksanaan Kegiatan <span className="text-rose-500">*</span>
                      </label>
                      <p className="text-[11px] text-stone-500">
                        Dapat menambahkan lebih dari satu lokasi (Desa/Kota, Provinsi, Negara).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddLocation}
                      className="px-2.5 py-1 text-xs font-medium text-stone-700 hover:text-stone-900 hover:bg-stone-100 border border-stone-200 rounded transition-colors"
                    >
                      + Lokasi Lain
                    </button>
                  </div>

                  <datalist id="provinsi-indonesia">
                    {PROVINSI_INDONESIA.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>

                  <div className="space-y-2">
                    {locations.map((loc, idx) => (
                      <div
                        key={loc.id}
                        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs"
                      >
                        <span className="text-[11px] font-medium text-stone-400 shrink-0 sm:w-16">
                          Lokasi {idx + 1}
                        </span>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={loc.villageCity}
                            onChange={(e) =>
                              handleUpdateLocation(loc.id, 'villageCity', e.target.value)
                            }
                            placeholder="Desa / Kelurahan / Kota..."
                            className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                          />
                        </div>
                        <div className="sm:w-44">
                          <input
                            type="text"
                            list="provinsi-indonesia"
                            value={loc.province}
                            onChange={(e) =>
                              handleUpdateLocation(loc.id, 'province', e.target.value)
                            }
                            placeholder="Provinsi..."
                            className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                          />
                        </div>
                        <div className="sm:w-32">
                          <input
                            type="text"
                            value={loc.country}
                            onChange={(e) =>
                              handleUpdateLocation(loc.id, 'country', e.target.value)
                            }
                            placeholder="Negara"
                            className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                          />
                        </div>
                        {locations.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveLocation(loc.id)}
                            className="text-stone-400 hover:text-rose-600 text-xs px-1 hover:underline self-end sm:self-center"
                            title="Hapus lokasi ini"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Periode Tanggal Kegiatan (Mengikuti Custom Period) */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                    <label className="block text-stone-700 font-medium">
                      Periode Tanggal Kegiatan (Mengikuti Custom Period){' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    {selectedCustomPeriod && (
                      <span className="text-[11px] font-mono font-semibold text-[#1D4ED8] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        Batas Custom Period {selectedCustomPeriod.code}:{' '}
                        {selectedCustomPeriod.startDate} s/d {selectedCustomPeriod.endDate}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-1.5">
                      <input
                        type="date"
                        min={selectedCustomPeriod?.startDate}
                        max={selectedCustomPeriod?.endDate}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full h-8 px-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 text-xs focus:outline-none"
                      />
                    </div>
                    <span className="text-stone-400 text-xs shrink-0">sampai</span>
                    <div className="flex-1 flex items-center gap-1.5">
                      <input
                        type="date"
                        min={startDate || selectedCustomPeriod?.startDate}
                        max={selectedCustomPeriod?.endDate}
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full h-8 px-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 text-xs focus:outline-none"
                      />
                    </div>
                    <span className="text-xs text-stone-600 bg-stone-100 px-2.5 py-1.5 rounded shrink-0 font-medium">
                      {daysDuration} hari kalender
                    </span>
                  </div>
                </div>

                {/* Frekuensi & Tanggal Pelaporan (Laporan Final 7 Hari: Executive Summary) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-stone-700 font-medium">
                      Aturan &amp; Frekuensi Pelaporan Kegiatan (Laporan Final 7 Hari: Executive Summary) <span className="text-rose-500">*</span>
                    </label>

                    {!manualOverrideDeadline ? (
                      <button
                        type="button"
                        onClick={() => {
                          setManualOverrideDeadline(true);
                          setCustomDeadline(calculatedDeadline);
                        }}
                        className="text-[11px] text-stone-500 hover:text-stone-900 hover:underline"
                      >
                        Ubah Tanggal Manual
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setManualOverrideDeadline(false)}
                        className="text-[11px] text-stone-500 hover:text-stone-900 hover:underline"
                      >
                        Kembali Otomatis
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <select
                      value={reportingPeriodType}
                      onChange={(e) => {
                        const nextVal = e.target.value as ReportingPeriodType;
                        setReportingPeriodType(nextVal);
                        if (nextVal === 'Periode Khusus') {
                          setManualOverrideDeadline(true);
                          if (!customDeadline) setCustomDeadline(calculatedDeadline);
                        } else {
                          setManualOverrideDeadline(false);
                        }
                      }}
                      className="flex-1 h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 text-xs font-medium focus:outline-none"
                    >
                      <option value="Sekali / Akhir Kegiatan">
                        Sekali / Selesai Acara (Laporan Final H+{offsetDays}: Executive Summary)
                      </option>
                      <option value="Harian">Harian (Setiap hari selama kegiatan)</option>
                      <option value="Mingguan">Mingguan (Setiap 7 hari)</option>
                      <option value="Bulanan">Bulanan (Setiap bulan)</option>
                      <option value="Setiap akhir kegiatan">Setiap akhir kegiatan</option>
                      <option value="Periode Khusus">Periode Khusus</option>
                    </select>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-stone-500 text-[11px]">Tenggat Laporan Final (H+7):</span>
                      {!manualOverrideDeadline ? (
                        <span className="h-8 px-2.5 bg-stone-100 border border-stone-200 rounded text-xs font-medium text-stone-800 flex items-center whitespace-nowrap">
                          {formatTanggalIndo(
                            reportingSchedule.milestones[0]?.rawDate || calculatedDeadline
                          )}
                          {reportingPeriodType === 'Sekali / Akhir Kegiatan' ||
                          reportingPeriodType === 'Setiap akhir kegiatan'
                            ? ` (H+${offsetDays} · Executive Summary)`
                            : ` (${reportingSchedule.milestones[0]?.title || 'Executive Summary'})`}
                        </span>
                      ) : (
                        <input
                          type="date"
                          value={customDeadline}
                          onChange={(e) => setCustomDeadline(e.target.value)}
                          className="h-8 px-2 bg-white border border-stone-300 rounded text-stone-800 text-xs focus:outline-none"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ======================================================== */}
            {/* TABEL INFORMASI TOR (PROJECT INFORMATION) — KOMPLEMENTER */}
            {/* ======================================================== */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-700">
                  Pratinjau Tabel Informasi TOR (Project Information)
                </h3>
                <span className="text-[11px] text-stone-500">
                  Tersinkronisasi otomatis dengan data yang diinput
                </span>
              </div>

              <div className="rounded-md border border-stone-200 overflow-hidden text-xs bg-white">
                <div className="bg-stone-100/80 text-stone-800 font-semibold text-xs px-3.5 py-2 border-b border-stone-200">
                  Project Information
                </div>
                <table className="w-full border-collapse">
                  <tbody className="divide-y divide-stone-200">
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Event Name
                      </td>
                      <td className="p-2.5 text-stone-900 font-semibold leading-relaxed">
                        {title.trim() || '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Program Hierarchy
                      </td>
                      <td className="p-2.5 text-stone-800 space-y-1 leading-relaxed">
                        <div>
                          <span className="text-[10.5px] font-mono uppercase text-stone-500 mr-1.5">
                            Program:
                          </span>
                          <span className="font-medium">{currentProgram?.name || '—'}</span>
                        </div>
                        <div>
                          <span className="text-[10.5px] font-mono uppercase text-stone-500 mr-1.5">
                            Outcome:
                          </span>
                          <span>{currentOutcome?.name || '—'}</span>
                        </div>
                        <div>
                          <span className="text-[10.5px] font-mono uppercase text-stone-500 mr-1.5">
                            Output:
                          </span>
                          <span>{currentOutput?.name || '—'}</span>
                        </div>
                        <div>
                          <span className="text-[10.5px] font-mono uppercase text-stone-500 mr-1.5">
                            Activity:
                          </span>
                          <span className="font-medium text-blue-900">
                            {currentActivity?.name || '—'}
                          </span>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Activity Code
                      </td>
                      <td className="p-2.5 text-stone-900 font-mono text-xs">
                        {torNumberPreview.hierarchyCode
                          ? `Outcome ${torNumberPreview.hierarchyCode.split('.')[0]} ; Activity ${torNumberPreview.hierarchyCode}`
                          : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        TOR Code
                      </td>
                      <td className="p-2.5 text-[#0f2b5c] font-mono font-bold text-xs">
                        {editingTor?.torNumber || torNumberPreview.previewNumber}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Organizer & Person in Charge
                      </td>
                      <td className="p-2.5 text-stone-800 whitespace-pre-line leading-relaxed">
                        {dynamicOrganizerSummary}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Period
                      </td>
                      <td className="p-2.5 text-stone-900 font-semibold font-mono">
                        {selectedCustomPeriod ? selectedCustomPeriod.code.split('—')[0].trim() : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Start date
                      </td>
                      <td className="p-2.5 text-stone-800">
                        {startDate ? formatTanggalIndo(startDate) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        End date
                      </td>
                      <td className="p-2.5 text-stone-800">
                        {endDate ? formatTanggalIndo(endDate) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Report date
                      </td>
                      <td className="p-2.5 text-stone-800">
                        {effectiveDeadline
                          ? `${formatTanggalIndo(effectiveDeadline)} (${reportingPeriodType})`
                          : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Location
                      </td>
                      <td className="p-2.5 text-stone-800 leading-relaxed">
                        {locationSummary || '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-44 sm:w-56 p-2.5 font-semibold text-stone-700 border-r border-stone-200 align-top bg-stone-50/50">
                        Budget request USD/IDR
                      </td>
                      <td className="p-2.5 font-semibold text-stone-900 font-mono">
                        {budgetRequestedInput !== '' &&
                        budgetRequestedInput != null &&
                        !isNaN(Number(budgetRequestedInput))
                          ? `Rp ${Number(budgetRequestedInput).toLocaleString('id-ID')}`
                          : 'Rp 0'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* ======================================================== */}
            {/* 1. LATAR BELAKANG MASALAH                                */}
            {/* ======================================================== */}
            <section id="sec-latar-belakang" className="space-y-4">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-stone-900">
                    1. Latar Belakang Masalah
                  </h2>
                  <p className="text-xs text-stone-500">
                    Uraikan konteks masalah, data temuan awal di wilayah binaan, dan situasi mendesak.
                  </p>
                </div>
                <span className="text-[11px] text-rose-600 font-medium">* Wajib diisi</span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-stone-700">
                    Uraian Latar Belakang Masalah <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[11px] text-stone-400">
                    {background.length} karakter
                  </span>
                </div>
                <textarea
                  rows={5}
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  placeholder="Ketik latar belakang masalah yang melandasi kegiatan ini..."
                  className="w-full p-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-xs sm:text-sm text-stone-800 leading-relaxed placeholder:text-stone-300 transition-colors focus:outline-none"
                />
              </div>
            </section>

            {/* ======================================================== */}
            {/* 2. TUJUAN UMUM                                           */}
            {/* ======================================================== */}
            <section id="sec-tujuan-umum" className="space-y-4">
              <div className="pb-1 border-b border-stone-200">
                <h2 className="text-sm font-semibold text-stone-900">
                  2. Tujuan Umum
                </h2>
                <p className="text-xs text-stone-500">
                  Tujuan strategis jangka panjang dan dampak utama yang diharapkan dari kegiatan ini.
                </p>
              </div>

              <div>
                <textarea
                  rows={3}
                  value={generalObjective}
                  onChange={(e) => setGeneralObjective(e.target.value)}
                  placeholder="Ketik tujuan umum kegiatan..."
                  className="w-full p-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-xs sm:text-sm text-stone-800 leading-relaxed placeholder:text-stone-300 transition-colors focus:outline-none"
                />
              </div>
            </section>

            {/* ======================================================== */}
            {/* 3. TUJUAN KHUSUS (Poin-poin & Tabel Auto-Sync)           */}
            {/* ======================================================== */}
            <section id="sec-goals" className="space-y-4">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-stone-900">
                    3. Tujuan Khusus
                  </h2>
                  <p className="text-xs text-stone-500">
                    Poin-poin capaian khusus terukur dan otomatis masuk ke tabel hasil & perubahan yang diharapkan.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddSpecificObjectivePoint}
                  className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Poin Tujuan Khusus</span>
                </button>
              </div>

              {/* A. Poin-poin Tujuan Khusus */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-stone-700">
                  Daftar Poin Tujuan Khusus
                </label>
                {specificObjectives.length === 0 ? (
                  <div className="py-4 border border-dashed border-stone-200 rounded text-center space-y-1.5 bg-stone-50/20 text-xs">
                    <p className="text-stone-500">Belum ada poin tujuan khusus.</p>
                    <button
                      type="button"
                      onClick={handleAddSpecificObjectivePoint}
                      className="px-2.5 py-1 text-xs font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded transition-colors"
                    >
                      + Tambah Poin Tujuan Khusus
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {specificObjectives.map((so, idx) => (
                      <div
                        key={so.id}
                        className="flex items-start gap-2 p-2 bg-stone-50/50 hover:bg-stone-50 rounded border border-stone-200/80 transition-colors"
                      >
                        <span className="font-semibold text-xs text-stone-700 pt-2 shrink-0 w-6">
                          {idx + 1}.
                        </span>
                        <textarea
                          rows={2}
                          value={so.objective}
                          onChange={(e) => handleUpdateObjectiveText(so.id, e.target.value)}
                          placeholder={`Ketik poin tujuan khusus ke-${idx + 1}...`}
                          className="flex-1 p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveSpecificObjective(so.id)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors shrink-0 mt-1"
                          title="Hapus poin ini"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* B. Tabel Auto-Sync: Tujuan Khusus | Hasil yang Diharapkan | Perubahan yang Diharapkan */}
              {specificObjectives.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-stone-700">
                      Tabel Capaian, Hasil & Perubahan yang Diharapkan (Auto-sync dari poin di atas)
                    </label>
                    <span className="text-[11px] text-stone-400">
                      Kolom hasil & perubahan diisi manual
                    </span>
                  </div>
                  <div className="border border-stone-200 rounded overflow-hidden text-xs bg-white">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-stone-100/80 text-stone-800 border-b border-stone-200 font-semibold">
                          <th className="p-2.5 border-r border-stone-200 w-1/3">Tujuan Khusus</th>
                          <th className="p-2.5 border-r border-stone-200 w-1/3">Hasil yang Diharapkan</th>
                          <th className="p-2.5 w-1/3">Perubahan yang Diharapkan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {specificObjectives.map((so, idx) => (
                          <tr key={so.id} className="align-top hover:bg-stone-50/40">
                            <td className="p-2.5 border-r border-stone-200 font-medium text-stone-900 bg-stone-50/30">
                              <span className="font-semibold mr-1">{idx + 1}.</span>
                              {so.objective || (
                                <span className="text-stone-400 italic">
                                  (Ketik rincian pada poin {idx + 1} di atas)
                                </span>
                              )}
                            </td>
                            <td className="p-2 border-r border-stone-200">
                              <textarea
                                rows={3}
                                value={so.expectedResult || ''}
                                onChange={(e) => handleUpdateExpectedResult(so.id, e.target.value)}
                                placeholder="Uraikan hasil yang diharapkan untuk poin ini..."
                                className="w-full p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none transition-colors"
                              />
                            </td>
                            <td className="p-2">
                              <textarea
                                rows={3}
                                value={so.expectedChange || ''}
                                onChange={(e) => handleUpdateExpectedChange(so.id, e.target.value)}
                                placeholder="Uraikan dampak / perubahan yang diharapkan..."
                                className="w-full p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none transition-colors"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* ======================================================== */}
            {/* 4. PESERTA KEGIATAN (TABEL MANDIRI)                      */}
            {/* ======================================================== */}
            <section id="sec-peserta" className="space-y-3">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-stone-900">
                    4. Peserta Kegiatan
                  </h2>
                  <p className="text-xs text-stone-500">
                    Tabel peserta kegiatan beserta jenis dan kriteria sasaran peserta.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddCustomRow}
                  className="text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                >
                  + Baris Peserta
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-stone-700 font-medium mb-1">
                    Jenis / Kategori Peserta
                  </label>
                  <input
                    type="text"
                    value={participantType}
                    onChange={(e) => setParticipantType(e.target.value)}
                    placeholder="Contoh: Pengurus POKMAIR & Perangkat Desa"
                    className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-stone-700 font-medium mb-1">
                    Kriteria Peserta
                  </label>
                  <input
                    type="text"
                    value={participantsCriteria}
                    onChange={(e) => setParticipantsCriteria(e.target.value)}
                    placeholder="Contoh: Pengurus aktif berusia 20–55 tahun..."
                    className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 focus:outline-none"
                  />
                </div>
              </div>

              {/* Toolbar Kolom Tabel Kustom */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-stone-400 text-[11px]">Kolom:</span>
                  {participantCustomColumns.map((col) => (
                    <span
                      key={col.id}
                      className="inline-flex items-center gap-1 bg-stone-100 text-stone-700 px-2 py-0.5 rounded text-[11px]"
                    >
                      <span>{col.label}</span>
                      {participantCustomColumns.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomColumn(col.id)}
                          className="text-stone-400 hover:text-rose-600 ml-0.5 leading-none"
                          title="Hapus kolom"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>

                {!showAddColumnInput ? (
                  <button
                    type="button"
                    onClick={() => setShowAddColumnInput(true)}
                    className="text-stone-600 hover:text-stone-900 text-xs font-medium hover:underline"
                  >
                    + Kolom
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs">
                    <input
                      type="text"
                      placeholder="Nama kolom..."
                      value={newCustomColumnName}
                      onChange={(e) => setNewCustomColumnName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomColumn();
                        }
                      }}
                      autoFocus
                      className="h-6 px-2 border border-stone-200 rounded bg-white text-xs text-stone-800 focus:outline-none focus:border-stone-400"
                    />
                    <select
                      value={newCustomColumnType}
                      onChange={(e) => setNewCustomColumnType(e.target.value as 'text' | 'number')}
                      className="h-6 px-1.5 border border-stone-200 rounded bg-white text-[11px] text-stone-700 focus:outline-none"
                    >
                      <option value="text">Teks</option>
                      <option value="number">Angka</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleAddCustomColumn}
                      disabled={!newCustomColumnName.trim()}
                      className="h-6 px-2 bg-stone-900 hover:bg-stone-800 text-white rounded text-[11px] font-medium disabled:opacity-50"
                    >
                      Simpan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddColumnInput(false);
                        setNewCustomColumnName('');
                      }}
                      className="text-stone-500 hover:text-stone-700 text-xs"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>

              {/* Tabel Peserta Kustom */}
              <div className="border border-stone-200 rounded overflow-hidden text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-100/80 text-stone-700 border-b border-stone-200 font-semibold">
                      <th className="py-2 px-2.5 w-10 text-center">No</th>
                      {participantCustomColumns.map((col) => (
                        <th
                          key={col.id}
                          className={`py-2 px-2.5 ${col.type === 'number' ? 'text-center' : ''}`}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="py-2 px-2 text-center w-14">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 text-stone-700">
                    {participantRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={participantCustomColumns.length + 2}
                          className="py-4 text-center text-stone-400 italic"
                        >
                          Belum ada baris peserta. Klik &quot;+ Baris Peserta&quot; di atas untuk mengisi.
                        </td>
                      </tr>
                    ) : (
                      participantRows.map((row, idx) => (
                        <tr key={row.id} className="hover:bg-stone-50/50">
                          <td className="py-1.5 px-2.5 text-center text-stone-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          {participantCustomColumns.map((col) => (
                            <td key={col.id} className="py-1.5 px-2">
                              <input
                                type={col.type === 'number' ? 'number' : 'text'}
                                min={col.type === 'number' ? '0' : undefined}
                                value={row.customValues?.[col.id] ?? ''}
                                onChange={(e) =>
                                  handleUpdateCustomValue(row.id, col.id, e.target.value)
                                }
                                placeholder={`Ketik ${col.label.toLowerCase()}...`}
                                className={`w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none transition-colors ${
                                  col.type === 'number' ? 'text-center font-mono' : ''
                                }`}
                              />
                            </td>
                          ))}
                          <td className="py-1.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteParticipantRow(row.id)}
                              className="text-stone-400 hover:text-rose-600 text-xs px-1 hover:underline"
                              title="Hapus baris"
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {participantRows.length > 0 &&
                    participantCustomColumns.some((c) => c.type === 'number') && (
                      <tfoot>
                        <tr className="bg-stone-50/80 font-medium text-stone-800 border-t border-stone-200">
                          <td className="py-2 px-2.5 text-center text-stone-400 font-mono text-[11px]">
                            Σ
                          </td>
                          {participantCustomColumns.map((col, cIdx) => {
                            if (col.type === 'number') {
                              const sum = numericColumnsTotal[col.id] || 0;
                              return (
                                <td
                                  key={col.id}
                                  className="py-2 px-2 text-center font-mono font-semibold text-stone-900"
                                >
                                  {sum} Org
                                </td>
                              );
                            }
                            return (
                              <td key={col.id} className="py-2 px-2 text-stone-500 text-[11px]">
                                {cIdx === 0 ? 'Total:' : ''}
                              </td>
                            );
                          })}
                          <td />
                        </tr>
                      </tfoot>
                    )}
                </table>
              </div>
            </section>

            {/* ======================================================== */}
            {/* 5. TIM PELAKSANA (NAMA - LEMBAGA, ROLE & RESPONSIBILITY) */}
            {/* ======================================================== */}
            <section id="sec-roles" className="space-y-3">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-stone-900">
                    5. Tim Pelaksana (Role & Responsibility)
                  </h2>
                  <p className="text-xs text-stone-500">
                    Daftar personel tim pelaksana dengan format Nama - Lembaga, Peran, serta Tugas & Tanggung Jawab.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddRoleRow(!showAddRoleRow)}
                  className="text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                >
                  + Tim Pelaksana
                </button>
              </div>

              {rolesResponsibilities.length === 0 ? (
                <div className="py-6 border border-dashed border-stone-200 rounded text-center space-y-2 bg-stone-50/20">
                  <p className="text-xs text-stone-500">
                    Belum ada data tim pelaksana atau kepanitiaan yang ditambahkan.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAddRoleRow(true)}
                    className="px-3 py-1.5 text-xs font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded transition-colors"
                  >
                    + Tim Pelaksana
                  </button>
                </div>
              ) : (
                <div className="border border-stone-200 rounded overflow-hidden text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-stone-100/80 text-stone-700 border-b border-stone-200 font-semibold">
                        <th className="py-2 px-2.5 w-1/3">Nama - Lembaga</th>
                        <th className="py-2 px-2.5 w-1/4">Role (Peran Kegiatan)</th>
                        <th className="py-2 px-2.5">Responsibility (Tugas & Tanggung Jawab)</th>
                        <th className="py-2 px-2 text-center w-12">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 text-stone-700">
                      {rolesResponsibilities.map((item) => (
                        <tr key={item.id} className="hover:bg-stone-50/50">
                          <td className="py-2 px-2.5 font-medium text-stone-900">
                            {item.nameInstitution ||
                              (item.institution
                                ? `${item.picName} — ${item.institution}`
                                : item.picName)}
                          </td>
                          <td className="py-2 px-2.5 text-stone-700 font-medium">{item.role}</td>
                          <td className="py-2 px-2.5 leading-relaxed text-stone-600">
                            {item.responsibilities}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRole(item.id)}
                              className="text-stone-400 hover:text-rose-600 text-xs px-1 hover:underline"
                              title="Hapus peran"
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {showAddRoleRow && (
                <div className="p-3 bg-white border border-stone-200 rounded space-y-2 text-xs">
                  <div className="font-semibold text-stone-800">
                    Tambah Tim Pelaksana & Tanggung Jawab
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Nama Personel (cth: Budi Santoso)"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                    />
                    <input
                      type="text"
                      placeholder="Asal Lembaga / Instansi (cth: Yayasan WIJNA)"
                      value={newRoleInstitution}
                      onChange={(e) => setNewRoleInstitution(e.target.value)}
                      className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                    />
                    <input
                      type="text"
                      placeholder="Role / Peran Kegiatan (cth: Ketua Pelaksana, Fasilitator)"
                      value={newRoleTitle}
                      onChange={(e) => setNewRoleTitle(e.target.value)}
                      className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 sm:col-span-2 focus:outline-none focus:border-stone-400"
                    />
                    <textarea
                      rows={2}
                      placeholder="Responsibility (Uraian tugas teknis dan tanggung jawab)..."
                      value={newRoleTasks}
                      onChange={(e) => setNewRoleTasks(e.target.value)}
                      className="p-2 border border-stone-200 rounded bg-white text-stone-800 sm:col-span-2 focus:outline-none focus:border-stone-400"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddRoleRow(false)}
                      className="px-2.5 py-1 text-stone-600 hover:bg-stone-100 rounded text-xs"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleAddRole}
                      disabled={!newRoleTitle.trim()}
                      className="px-3 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded text-xs font-medium disabled:opacity-50"
                    >
                      Simpan Tim Pelaksana
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-stone-700 block">
                  Keterangan Tambahan Tim Pelaksana{' '}
                  <span className="text-stone-400 font-normal">(Opsional)</span>
                </label>
                <textarea
                  rows={2}
                  value={rolesNotes}
                  onChange={(e) => setRolesNotes(e.target.value)}
                  placeholder="Contoh: Ketentuan pembagian tugas lapangan, koordinator cadangan..."
                  className="w-full p-2.5 bg-stone-50/40 hover:bg-white focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 placeholder:text-stone-300 focus:outline-none transition-colors"
                />
              </div>
            </section>

            {/* ======================================================== */}
            {/* IMPLEMENTATION TIMELINE                                  */}
            {/* ======================================================== */}
            <section id="sec-timeline" className="space-y-3">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-stone-900">
                      Implementation Timeline
                    </h2>
                    {selectedCustomPeriod && (
                      <span className="text-[11px] font-mono font-semibold text-[#1D4ED8] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        Mengikuti {selectedCustomPeriod.code}: {formatTanggalIndo(selectedCustomPeriod.startDate)} – {formatTanggalIndo(selectedCustomPeriod.endDate)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500">
                    Jadwal periode pelaksanaan dan rincian aktivitas mengikuti Custom Period yang ditentukan.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddTimelineRow}
                  className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Baris Timeline</span>
                </button>
              </div>

              <div className="border border-stone-200 rounded overflow-hidden text-xs bg-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-100/80 text-stone-800 border-b border-stone-200 font-semibold">
                      <th className="p-2.5 border-r border-stone-200 w-1/4">Period</th>
                      <th className="p-2.5 border-r border-stone-200">Activity</th>
                      <th className="p-2 text-center w-12">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {timelineItems.map((item) => (
                      <tr key={item.id} className="hover:bg-stone-50/40">
                        <td className="p-2 border-r border-stone-200">
                          <input
                            type="text"
                            value={item.period}
                            onChange={(e) =>
                              handleUpdateTimelineItem(item.id, 'period', e.target.value)
                            }
                            placeholder="Contoh: P1 (1 Jan 2026 – 30 Jun 2026)"
                            className="w-full p-1.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 border-r border-stone-200">
                          <input
                            type="text"
                            value={item.activity}
                            onChange={(e) =>
                              handleUpdateTimelineItem(item.id, 'activity', e.target.value)
                            }
                            placeholder="Uraian aktivitas..."
                            className="w-full p-1.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveTimelineRow(item.id)}
                            className="p-1 text-stone-400 hover:text-rose-600 rounded transition-colors"
                            title="Hapus baris"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ======================================================== */}
            {/* MONITORING MECHANISM (M&E)                               */}
            {/* ======================================================== */}
            <section id="sec-monitoring" className="space-y-3">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-stone-900">
                      Monitoring Mechanism
                    </h2>
                    {selectedCustomPeriod && (
                      <span className="text-[11px] font-mono font-semibold text-[#1D4ED8] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        Mengikuti {selectedCustomPeriod.code}: {selectedCustomPeriod.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500">
                    Mekanisme M&amp;E mengikuti frekuensi Custom Period dengan aspek bawaan: Implementation process, Participant attendance, Quality of materials/output, Documentation &amp; Administration, Anticipated field challenges.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddMonitoringRow}
                  className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Baris M&amp;E</span>
                </button>
              </div>

              <div className="border border-stone-200 rounded overflow-hidden text-xs bg-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-100/80 text-stone-800 border-b border-stone-200 font-semibold">
                      <th className="p-2.5 border-r border-stone-200 w-1/5">Aspect</th>
                      <th className="p-2.5 border-r border-stone-200">Method</th>
                      <th className="p-2.5 border-r border-stone-200 w-1/5">Frequency</th>
                      <th className="p-2.5 border-r border-stone-200 w-1/6">PIC</th>
                      <th className="p-2 text-center w-12">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {monitoringItems.map((item) => (
                      <tr key={item.id} className="hover:bg-stone-50/40 align-top">
                        <td className="p-2 border-r border-stone-200">
                          <input
                            type="text"
                            value={item.aspect}
                            onChange={(e) =>
                              handleUpdateMonitoringItem(item.id, 'aspect', e.target.value)
                            }
                            placeholder="Aspect..."
                            className="w-full p-1.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 font-medium focus:outline-none"
                          />
                        </td>
                        <td className="p-2 border-r border-stone-200">
                          <textarea
                            rows={2}
                            value={item.method}
                            onChange={(e) =>
                              handleUpdateMonitoringItem(item.id, 'method', e.target.value)
                            }
                            placeholder="Method..."
                            className="w-full p-1.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 border-r border-stone-200">
                          <textarea
                            rows={2}
                            value={item.frequency}
                            onChange={(e) =>
                              handleUpdateMonitoringItem(item.id, 'frequency', e.target.value)
                            }
                            placeholder="Frequency..."
                            className="w-full p-1.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 border-r border-stone-200">
                          <input
                            type="text"
                            value={item.pic}
                            onChange={(e) =>
                              handleUpdateMonitoringItem(item.id, 'pic', e.target.value)
                            }
                            placeholder="PIC..."
                            className="w-full p-1.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveMonitoringRow(item.id)}
                            className="p-1 text-stone-400 hover:text-rose-600 rounded transition-colors"
                            title="Hapus baris"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ======================================================== */}
            {/* SCOPE OF ACTIVITIES (Poin-poin)                          */}
            {/* ======================================================== */}
            <section id="sec-scope" className="space-y-3">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-stone-900">
                    Scope of Activities
                  </h2>
                  <p className="text-xs text-stone-500">
                    Batasan ruang lingkup kegiatan dalam bentuk poin-poin.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddScopePoint}
                  className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Poin Scope</span>
                </button>
              </div>

              <div className="space-y-2">
                {scopeOfActivities.map((point, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="font-semibold text-stone-400 pt-2 text-sm leading-none">
                      •
                    </span>
                    <textarea
                      rows={2}
                      value={point}
                      onChange={(e) => handleUpdateScopePoint(idx, e.target.value)}
                      placeholder={`Poin ruang lingkup ke-${idx + 1}...`}
                      className="flex-1 p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveScopePoint(idx)}
                      className="p-1.5 text-stone-400 hover:text-rose-600 rounded transition-colors shrink-0 mt-1"
                      title="Hapus poin"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* ======================================================== */}
            {/* MEKANISME PELAKSANAAN (Poin-poin)                        */}
            {/* ======================================================== */}
            <section id="sec-mekanisme" className="space-y-3">
              <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-stone-900">
                    Mekanisme Pelaksanaan
                  </h2>
                  <p className="text-xs text-stone-500">
                    Prosedur operasional pencairan, koordinasi, pelaksanaan, dan pelaporan.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddMechanismPoint}
                  className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Poin Mekanisme</span>
                </button>
              </div>

              <div className="space-y-2">
                {implementationMechanisms.map((mech, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="font-semibold text-stone-400 pt-2 text-sm leading-none">
                      •
                    </span>
                    <textarea
                      rows={2}
                      value={mech}
                      onChange={(e) => handleUpdateMechanismPoint(idx, e.target.value)}
                      placeholder={`Poin mekanisme ke-${idx + 1}...`}
                      className="flex-1 p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveMechanismPoint(idx)}
                      className="p-1.5 text-stone-400 hover:text-rose-600 rounded transition-colors shrink-0 mt-1"
                      title="Hapus poin"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* ======================================================== */}
            {/* 6. RUNDOWN KEGIATAN (OPSIONAL)                           */}
            {/* ======================================================== */}
            <section id="sec-rundown" className="space-y-3 pt-2 border-t border-stone-200">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="toggle-rundown-form"
                    checked={isRundownVisible}
                    onChange={(e) => setIsRundownVisible(e.target.checked)}
                    className="w-4 h-4 rounded text-stone-900 focus:ring-stone-400 border-stone-300 cursor-pointer"
                  />
                  <label
                    htmlFor="toggle-rundown-form"
                    className="text-sm font-semibold text-stone-900 cursor-pointer select-none"
                  >
                    6. Rundown Kegiatan{' '}
                    <span className="text-xs font-normal text-stone-500">(Opsional)</span>
                  </label>
                </div>
                {isRundownVisible && (
                  <button
                    type="button"
                    onClick={handleAddNewRundownSection}
                    className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Buat Bagian Rundown Baru</span>
                  </button>
                )}
              </div>

              {isRundownVisible && (
                <div className="space-y-3 pt-1">
                  <p className="text-xs text-stone-500">
                    Jadwal urutan waktu, agenda, target peserta, tempat, dan penanggung jawab teknis setiap sesi berdasarkan pilihan Implementation Timeline.
                  </p>

                  <datalist id="rundown-target-participants-options">
                    {participantRows.map((pRow) => (
                      <option key={pRow.id} value={pRow.target} />
                    ))}
                    <option value="Seluruh Peserta" />
                  </datalist>

                  {rundownSections.length === 0 ? (
                    <div className="py-6 border border-dashed border-stone-200 rounded text-center space-y-2 bg-stone-50/20">
                      <p className="text-xs text-stone-500">
                        Belum ada susunan jadwal atau bagian rundown acara.
                      </p>
                      <button
                        type="button"
                        onClick={handleAddNewRundownSection}
                        className="px-3 py-1.5 text-xs font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded transition-colors"
                      >
                        + Buat Bagian Rundown Baru
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {rundownSections.map((section, secIdx) => (
                        <div
                          key={section.sectionKey}
                          className="border border-stone-200 rounded overflow-hidden text-xs bg-white"
                        >
                          {/* Header Bagian Rundown + Pilihan Implementation Timeline */}
                          <div className="bg-stone-100/80 border-b border-stone-200 px-2.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs font-semibold text-stone-800 shrink-0">
                                Bagian Rundown #{secIdx + 1}
                              </span>
                              <span className="hidden sm:inline text-stone-300">|</span>
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <label className="text-xs text-stone-500 shrink-0">
                                  Implementation Timeline:
                                </label>
                                <select
                                  value={section.timelineId}
                                  onChange={(e) =>
                                    handleChangeSectionTimeline(
                                      section.timelineId,
                                      e.target.value
                                    )
                                  }
                                  className="flex-1 min-w-0 h-7 px-2 text-xs text-stone-800 bg-white border border-stone-200 hover:border-stone-300 focus:border-stone-400 rounded focus:outline-none transition-colors"
                                >
                                  {timelineItems.map((tl) => (
                                    <option key={tl.id} value={tl.id}>
                                      {formatTimelineOptionLabel(tl)}
                                    </option>
                                  ))}
                                  {!timelineItems.some((tl) => tl.id === section.timelineId) && (
                                    <option value={section.timelineId}>
                                      {section.timelineLabel.split(' · ')[0].split(' (')[0]}
                                    </option>
                                  )}
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleOpenAddSessionForSection(section.timelineId)}
                                className="text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline cursor-pointer"
                              >
                                + Tambah Sesi
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveRundownSection(section.timelineId)}
                                className="text-xs text-stone-400 hover:text-rose-600 hover:underline"
                                title="Hapus Bagian Rundown ini"
                              >
                                Hapus Bagian
                              </button>
                            </div>
                          </div>

                          {/* Tabel Sesi pada Bagian Rundown ini */}
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-stone-50/70 text-stone-700 border-b border-stone-200 font-semibold">
                                <th className="py-2 px-2.5 w-[15%]">Tanggal / Hari</th>
                                <th className="py-2 px-2.5 w-[13%]">Waktu</th>
                                <th className="py-2 px-2.5 w-[26%]">Agenda Kegiatan</th>
                                <th className="py-2 px-2.5 w-[21%]">Target Peserta</th>
                                <th className="py-2 px-2.5 w-[12%]">Tempat</th>
                                <th className="py-2 px-2.5 w-[9%]">PIC</th>
                                <th className="py-2 px-2 text-center w-12">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100 text-stone-700">
                              {section.items.map((item) => (
                                <tr key={item.id} className="hover:bg-stone-50/50 align-top">
                                  <td className="py-1.5 px-2">
                                    <input
                                      type="text"
                                      value={item.date ?? ''}
                                      onChange={(e) =>
                                        handleUpdateRundownField(item.id, 'date', e.target.value)
                                      }
                                      placeholder="Tanggal / hari..."
                                      className="w-full px-2 py-1 border border-stone-200 focus:border-stone-400 rounded bg-white text-xs text-stone-800 focus:outline-none transition-colors"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2">
                                    <input
                                      type="text"
                                      value={item.time ?? ''}
                                      onChange={(e) =>
                                        handleUpdateRundownField(item.id, 'time', e.target.value)
                                      }
                                      placeholder="Waktu..."
                                      className="w-full px-2 py-1 border border-stone-200 focus:border-stone-400 rounded bg-white font-mono text-[11px] text-stone-800 focus:outline-none transition-colors"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2">
                                    <input
                                      type="text"
                                      value={item.agenda ?? ''}
                                      onChange={(e) =>
                                        handleUpdateRundownField(item.id, 'agenda', e.target.value)
                                      }
                                      placeholder="Agenda kegiatan..."
                                      className="w-full px-2 py-1 border border-stone-200 focus:border-stone-400 rounded bg-white text-xs text-stone-800 focus:outline-none transition-colors"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2 text-stone-700">
                                    <input
                                      type="text"
                                      list="rundown-target-participants-options"
                                      value={item.targetParticipants ?? ''}
                                      onChange={(e) =>
                                        handleUpdateRundownField(
                                          item.id,
                                          'targetParticipants',
                                          e.target.value
                                        )
                                      }
                                      placeholder="Target peserta sesi..."
                                      className="w-full px-2 py-1 border border-stone-200 focus:border-stone-400 rounded bg-white text-xs text-stone-800 focus:outline-none transition-colors"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2">
                                    <input
                                      type="text"
                                      value={item.location ?? ''}
                                      onChange={(e) =>
                                        handleUpdateRundownField(
                                          item.id,
                                          'location',
                                          e.target.value
                                        )
                                      }
                                      placeholder="Tempat..."
                                      className="w-full px-2 py-1 border border-stone-200 focus:border-stone-400 rounded bg-white text-xs text-stone-800 focus:outline-none transition-colors"
                                    />
                                  </td>
                                  <td className="py-1.5 px-2">
                                    <input
                                      type="text"
                                      value={item.picName ?? ''}
                                      onChange={(e) =>
                                        handleUpdateRundownField(item.id, 'picName', e.target.value)
                                      }
                                      placeholder="PIC..."
                                      className="w-full px-2 py-1 border border-stone-200 focus:border-stone-400 rounded bg-white text-xs text-stone-800 focus:outline-none transition-colors"
                                    />
                                  </td>
                                  <td className="py-2 px-2 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveRundown(item.id)}
                                      className="text-stone-400 hover:text-rose-600 text-xs px-1 hover:underline"
                                      title="Hapus sesi"
                                    >
                                      Hapus
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Form Tambah Sesi di dalam Bagian Rundown ini */}
                          {activeAddSectionKey === section.timelineId && (
                            <div className="p-3 bg-stone-50/40 border-t border-stone-200 space-y-2 text-xs">
                              <div className="font-semibold text-stone-800">
                                Tambah Sesi Rundown (Bagian #{secIdx + 1})
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  placeholder="Tanggal / Hari"
                                  value={newRdDate}
                                  onChange={(e) => setNewRdDate(e.target.value)}
                                  className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                                />
                                <input
                                  type="text"
                                  placeholder="Waktu (cth: 09:00 - 12:00 WIB)"
                                  value={newRdTime}
                                  onChange={(e) => setNewRdTime(e.target.value)}
                                  className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                                />
                                <input
                                  type="text"
                                  placeholder="Agenda Kegiatan *"
                                  value={newRdAgenda}
                                  onChange={(e) => setNewRdAgenda(e.target.value)}
                                  className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                                />
                                <input
                                  type="text"
                                  list="rundown-target-participants-options"
                                  placeholder="Target Peserta (setelah Agenda Kegiatan)"
                                  value={newRdTargetParticipants}
                                  onChange={(e) => setNewRdTargetParticipants(e.target.value)}
                                  className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                                />
                                <input
                                  type="text"
                                  placeholder="Tempat / Ruang"
                                  value={newRdLocation}
                                  onChange={(e) => setNewRdLocation(e.target.value)}
                                  className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                                />
                                <input
                                  type="text"
                                  placeholder="PIC Sesi"
                                  value={newRdPic}
                                  onChange={(e) => setNewRdPic(e.target.value)}
                                  className="h-8 px-2 border border-stone-200 rounded bg-white text-stone-800 focus:outline-none focus:border-stone-400"
                                />
                              </div>
                              <div className="flex justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setActiveAddSectionKey(null)}
                                  className="px-2.5 py-1 text-stone-600 hover:bg-stone-100 rounded text-xs"
                                >
                                  Batal
                                </button>
                                <button
                                  type="button"
                                  onClick={handleAddRundown}
                                  disabled={!newRdAgenda.trim()}
                                  className="px-3 py-1 bg-stone-900 hover:bg-stone-800 text-white rounded text-xs font-medium disabled:opacity-50"
                                >
                                  Simpan Sesi
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={handleAddNewRundownSection}
                        className="w-full py-2 border border-dashed border-stone-200 hover:border-stone-300 bg-stone-50/30 hover:bg-stone-100/60 rounded text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors"
                      >
                        + Buat Bagian Rundown Baru
                      </button>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-stone-700 block">
                      Keterangan Tambahan Rundown Kegiatan{' '}
                      <span className="text-stone-400 font-normal">(Opsional)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={rundownNotes}
                      onChange={(e) => setRundownNotes(e.target.value)}
                      placeholder="Contoh: Jadwal istirahat fleksibel..."
                      className="w-full p-2.5 bg-stone-50/40 hover:bg-white focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 placeholder:text-stone-300 focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* ======================================================== */}
            {/* CATATAN TAMBAHAN & AKSI FINAL PENGIRIMAN                 */}
            {/* ======================================================== */}
            <section className="pt-4 border-t border-stone-200 space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Catatan Tambahan (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder="Informasi izin aparat setempat, kontak darurat, atau catatan koordinasi lainnya..."
                  className="w-full p-2.5 bg-stone-50/50 hover:bg-white focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                />
              </div>

              {isEditMode && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/70 text-xs text-amber-950 space-y-1">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={controlledSyncConfirmed}
                      onChange={(e) => setControlledSyncConfirmed(e.target.checked)}
                      className="mt-0.5 rounded border-amber-400 text-stone-900 focus:ring-stone-900"
                    />
                    <span className="font-semibold">
                      Persetujuan Controlled Modification (Sinkronisasi Tahap 1 → Tahap 2–8)
                    </span>
                  </label>
                  <p className="pl-5 text-[11px] text-amber-800">
                    Saya menyetujui perubahan pada dokumen Master TOR Tahap 1 ini dan mengizinkan sistem memperbarui referensi secara otomatis pada seluruh tahapan hilir yang terdampak (Tahap 2 Cash Advance, Tahap 3 Ringkasan CA, Tahap 4 Notulen, hingga Tahap 8 Laporan Keuangan).
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="text-xs text-stone-500">
                  {title.trim() && background.trim() && locationSummary ? (
                    <span className="text-stone-600">
                      Field utama terisi. Siap disimpan atau diajukan.
                    </span>
                  ) : (
                    <span className="text-stone-400">
                      Lengkapi judul, lokasi, dan latar belakang untuk mengajukan TOR.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => handleSubmit(false)}
                    disabled={isSubmitting}
                    className="flex-1 sm:flex-none px-3.5 py-1.5 text-xs font-medium text-stone-700 bg-white hover:bg-stone-50 border border-stone-200 rounded transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isEditMode ? 'Simpan Perubahan TOR' : 'Simpan Draft'}
                  </button>
                  {(!isEditMode ||
                    editingTor?.submissionStatus === 'Draft' ||
                    editingTor?.submissionStatus === 'Perlu Perbaikan') && (
                    <button
                      type="button"
                      onClick={() => handleSubmit(true)}
                      disabled={isSubmitting}
                      className="flex-1 sm:flex-none px-4 py-1.5 text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 rounded transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isEditMode ? 'Simpan & Ajukan TOR' : 'Ajukan TOR'}
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
