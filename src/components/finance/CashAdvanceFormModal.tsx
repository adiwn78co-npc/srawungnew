import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  CheckCircle,
  Save,
  Send,
  Building2,
  HelpCircle,
  FileSpreadsheet,
  AlertTriangle,
  Info,
  Calendar,
  Wallet,
  Landmark,
  Lock,
  RefreshCw,
  Zap,
  ChevronDown,
  ChevronUp,
  Eye,
  Edit3,
  Download,
} from 'lucide-react';
import {
  Tor,
  User,
  Program,
  Outcome,
  Output,
  Activity,
  CashAdvanceRecord,
  CashAdvanceItem,
  CashAdvanceStatus,
} from '../../types/index.js';
import {
  getOrCreateProgramBudgetDataset,
  getRegisteredProgramBudgetCodes,
  hydrateProgramBudgetDatasetsFromServer,
  getActivePeriods,
  ProgramBudgetDataset,
  ProgramMasterBudgetCode,
} from '../../lib/programBudgetStorage.js';
import { angkaKeTerbilangRupiah, formatRupiah } from '../../lib/terbilang.js';
import { api } from '../../lib/api.js';
import { getOrganizationSettings } from '../../lib/organizationSettings.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';

interface CashAdvanceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (savedRecord: CashAdvanceRecord) => void;
  existingRecord?: CashAdvanceRecord | null;
  initialTorId?: string;
  tors: Tor[];
  programs?: Program[];
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  currentUser: User | null;
  sequenceNumber?: number;
}

/**
 * Format Nomor Pengajuan Kasbon otomatis dari Nomor Dokumen TOR
 * Sama seperti nama referensi dokumen TOR hanya saja depannya ditambahkan CA dan otomatis.
 * Contoh:
 * - TOR/001/WIJNA/PALKL/1.2.1/X/2026 -> CA/001/WIJNA/PALKL/1.2.1/X/2026
 * - TOR/2026/09/001 -> CA/2026/09/001
 * - TOR-2026-001 -> CA-2026-001
 * - TOR_2026_001 -> CA_2026_001
 * - TOR.2026.001 -> CA.2026.001
 * - WIJNA/2026/01 -> CA/WIJNA/2026/01
 */
export function formatCashAdvanceNumberFromTor(
  torNumber?: string,
  sequenceNumber: number = 1
): string {
  const seqSuffix = `.${String(sequenceNumber).padStart(2, '0')}`; // e.g. .01, .02, .03

  if (!torNumber || !torNumber.trim()) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    return `CA/WIJNA/${year}/${month}/001${seqSuffix}`;
  }
  const clean = torNumber.trim();
  let baseCa = '';
  // Jika format diawali dengan TOR/
  if (/^TOR\//i.test(clean)) {
    baseCa = clean.replace(/^TOR\//i, 'CA/');
  } else if (/^TOR\-/i.test(clean)) {
    baseCa = clean.replace(/^TOR\-/i, 'CA-');
  } else if (/^TOR\_/i.test(clean)) {
    baseCa = clean.replace(/^TOR\_/i, 'CA_');
  } else if (/^TOR\./i.test(clean)) {
    baseCa = clean.replace(/^TOR\./i, 'CA.');
  } else if (/^TOR/i.test(clean)) {
    baseCa = clean.replace(/^TOR/i, 'CA/');
  } else {
    baseCa = `CA/${clean}`;
  }

  // Format nomor dengan menambahkan 001."01", 001."02", dst.
  // Contoh: CA/001/WIJNA/PALKL/1.2.1/X/2026 -> CA/001.01/WIJNA/PALKL/1.2.1/X/2026
  if (/CA\/(\d+)\//.test(baseCa)) {
    return baseCa.replace(/CA\/(\d+)\//, `CA/$1${seqSuffix}/`);
  } else if (/CA\-(\d+)\-/.test(baseCa)) {
    return baseCa.replace(/CA\-(\d+)\-/, `CA-$1${seqSuffix}-`);
  } else if (/(\d{3,})/.test(baseCa)) {
    return baseCa.replace(/(\d{3,})/, `$1${seqSuffix}`);
  }
  return `${baseCa}${seqSuffix}`;
}

/**
 * Preset Master Deskripsi Otomatis untuk setiap Kode Budget
 * Setiap kali kode budget dipilih di form, deskripsi dan estimasi satuan muncul otomatis
 */
export const BUDGET_CODE_DESCRIPTIONS: Record<
  string,
  {
    code: string;
    label: string;
    category: string;
    defaultDescription: string;
    defaultUnit: string;
    defaultUnitPrice: number;
    defaultNotes: string;
  }
> = {
  '1.1.1': {
    code: '1.1.1',
    label: '1.1.1 - Baseline Assessment & Field Survey',
    category: 'Asesmen & Riset',
    defaultDescription: 'Survei teknis geolistrik & pemetaan asesmen sumber air desa',
    defaultUnit: 'Paket',
    defaultUnitPrice: 2500000,
    defaultNotes: 'Survei geolistrik lapangan',
  },
  '1.1.2': {
    code: '1.1.2',
    label: '1.1.2 - Community Water Committee Establishment',
    category: 'Pemberdayaan Masyarakat',
    defaultDescription: 'Konsumsi & fasilitasi musyawarah pembentukan komite swadaya warga',
    defaultUnit: 'Orang',
    defaultUnitPrice: 65000,
    defaultNotes: 'Pertemuan komite air desa',
  },
  '1.1.3': {
    code: '1.1.3',
    label: '1.1.3 - Participatory Sanitation Mapping',
    category: 'Pemberdayaan Masyarakat',
    defaultDescription: 'Fasilitasi pemetaan partisipatif sanitasi & sosialisasi komite warga',
    defaultUnit: 'Kegiatan',
    defaultUnitPrice: 1800000,
    defaultNotes: 'Sosialisasi & koordinasi desa',
  },
  '1.2.1': {
    code: '1.2.1',
    label: '1.2.1 - Technical Pump Training & Capacity Building',
    category: 'Pelatihan & Kapasitas',
    defaultDescription: 'Pelatihan teknis pemeliharaan pompa air & pembukuan iuran swadaya warga',
    defaultUnit: 'Paket',
    defaultUnitPrice: 3500000,
    defaultNotes: 'Pelatihan teknis 3 hari',
  },
  '1.2.4': {
    code: '1.2.4',
    label: '1.2.4 - Logistics, SOP & Institutional Compliance',
    category: 'Operasional Lapangan',
    defaultDescription: 'BBM & transportasi operasional tim fasilitator lapangan',
    defaultUnit: 'Hari',
    defaultUnitPrice: 250000,
    defaultNotes: 'Operasional kendaraan dinas lapangan',
  },
  '1.4.1': {
    code: '1.4.1',
    label: '1.4.1 - PSEAH & GEDSI / Technical Workshop Training',
    category: 'Narasumber & Pelatihan',
    defaultDescription: 'Honorarium narasumber teknis & fasilitator pelatihan',
    defaultUnit: 'Orang',
    defaultUnitPrice: 1250000,
    defaultNotes: 'Honorarium narasumber ahli',
  },
  '2.1.1': {
    code: '2.1.1',
    label: '2.1.1 - Filtration Hardware & Piping Procurement',
    category: 'Pengadaan Fisik',
    defaultDescription: 'Pengadaan komponen filtrasi air, pipa sambungan, & perkakas percontohan',
    defaultUnit: 'Paket',
    defaultUnitPrice: 1500000,
    defaultNotes: 'Pengadaan komponen fisik',
  },
  '2.2.1': {
    code: '2.2.1',
    label: '2.2.1 - Environmental Sanitation Education',
    category: 'Edukasi & Kampanye',
    defaultDescription: 'Penyelenggaraan workshop edukasi sanitasi lingkungan & higiene warga',
    defaultUnit: 'Paket',
    defaultUnitPrice: 500000,
    defaultNotes: 'Modul & alat peraga edukasi',
  },
  '3.1.1': {
    code: '3.1.1',
    label: '3.1.1 - Quarterly Water Quality Lab Testing',
    category: 'Pengujian Mutu Lab',
    defaultDescription: 'Retribusi uji sampel kualitas air minum laboratorium terakreditasi',
    defaultUnit: 'Sampel',
    defaultUnitPrice: 750000,
    defaultNotes: 'Uji parameter bakteriologis & kimiawi',
  },
  '3.1.2': {
    code: '3.1.2',
    label: '3.1.2 - Water Sampling & Field Monitoring',
    category: 'Monitoring Berkala',
    defaultDescription: 'Inspeksi berkala sampling kualitas air & monitoring debit air desa',
    defaultUnit: 'Titik',
    defaultUnitPrice: 450000,
    defaultNotes: 'Sampling debit & pH air',
  },
  '4.1.1': {
    code: '4.1.1',
    label: '4.1.1 - Stakeholder Coordination & Project Field Operations',
    category: 'Koordinasi & Tata Kelola',
    defaultDescription: 'Koordinasi lintas dinas teknis & pemantauan berkala lapangan',
    defaultUnit: 'Bulan',
    defaultUnitPrice: 2000000,
    defaultNotes: 'Koordinasi pemangku kepentingan',
  },
  '4.2.1': {
    code: '4.2.1',
    label: '4.2.1 - Financial LPJ & Compliance Documentation',
    category: 'Pelaporan & LPJ',
    defaultDescription: 'Penyusunan berkas bukti transaksi sah, kuitansi riil, & dokumentasi LPJ kasbon',
    defaultUnit: 'Paket',
    defaultUnitPrice: 850000,
    defaultNotes: 'Pertanggungjawaban LPJ keuangan',
  },
};

/**
 * Daftar opsi kode budget unik untuk dropdown form
 */
export const BUDGET_CODE_OPTIONS = Object.values(BUDGET_CODE_DESCRIPTIONS);

/**
 * Rekomendasi item otomatis berdasarkan TOR yang dipilih
 */
export function generateRecommendedItemsForTor(tor?: Tor): CashAdvanceItem[] {
  if (!tor) {
    return [
      {
        id: `cai-${Date.now()}-1`,
        itemNo: 1,
        budgetCode: '1.4.1',
        description: BUDGET_CODE_DESCRIPTIONS['1.4.1'].defaultDescription,
        volume: 2,
        unit: BUDGET_CODE_DESCRIPTIONS['1.4.1'].defaultUnit,
        frequency: 2,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['1.4.1'].defaultUnitPrice,
        totalAmount: 5000000,
        notes: BUDGET_CODE_DESCRIPTIONS['1.4.1'].defaultNotes,
      },
    ];
  }

  const code = tor.hierarchyCode || tor.activityCode || '';

  if (code.includes('1.2') || tor.title.toLowerCase().includes('pompa') || tor.title.toLowerCase().includes('pelatihan')) {
    return [
      {
        id: `cai-${Date.now()}-1`,
        itemNo: 1,
        budgetCode: '1.4.1',
        description: BUDGET_CODE_DESCRIPTIONS['1.4.1'].defaultDescription,
        volume: 2,
        unit: BUDGET_CODE_DESCRIPTIONS['1.4.1'].defaultUnit,
        frequency: 2,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['1.4.1'].defaultUnitPrice,
        totalAmount: 5000000,
        notes: 'Honor narasumber ahli pompa & pembukuan (2 orang x 2 hari)',
      },
      {
        id: `cai-${Date.now()}-2`,
        itemNo: 2,
        budgetCode: '1.1.2',
        description: BUDGET_CODE_DESCRIPTIONS['1.1.2'].defaultDescription,
        volume: 30,
        unit: BUDGET_CODE_DESCRIPTIONS['1.1.2'].defaultUnit,
        frequency: 2,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['1.1.2'].defaultUnitPrice,
        totalAmount: 3900000,
        notes: 'Makan siang & snack musyawarah warga x 2 hari',
      },
      {
        id: `cai-${Date.now()}-3`,
        itemNo: 3,
        budgetCode: '2.1.1',
        description: BUDGET_CODE_DESCRIPTIONS['2.1.1'].defaultDescription,
        volume: 2,
        unit: BUDGET_CODE_DESCRIPTIONS['2.1.1'].defaultUnit,
        frequency: 1,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['2.1.1'].defaultUnitPrice,
        totalAmount: 3000000,
        notes: 'Alat peraga perbaikan pompa & komponen percontohan',
      },
      {
        id: `cai-${Date.now()}-4`,
        itemNo: 4,
        budgetCode: '1.2.4',
        description: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultDescription,
        volume: 3,
        unit: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultUnit,
        frequency: 1,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultUnitPrice,
        totalAmount: 750000,
        notes: 'BBM & transportasi operasional fasilitator lapangan',
      },
      {
        id: `cai-${Date.now()}-5`,
        itemNo: 5,
        budgetCode: '4.2.1',
        description: BUDGET_CODE_DESCRIPTIONS['4.2.1'].defaultDescription,
        volume: 1,
        unit: BUDGET_CODE_DESCRIPTIONS['4.2.1'].defaultUnit,
        frequency: 1,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['4.2.1'].defaultUnitPrice,
        totalAmount: 850000,
        notes: 'Pencetakan modul panduan, kuitansi riil & pelaporan LPJ',
      },
    ];
  }

  if (code.includes('1.1.1') || tor.title.toLowerCase().includes('survei') || tor.title.toLowerCase().includes('geolistrik')) {
    return [
      {
        id: `cai-${Date.now()}-1`,
        itemNo: 1,
        budgetCode: '1.1.1',
        description: BUDGET_CODE_DESCRIPTIONS['1.1.1'].defaultDescription,
        volume: 2,
        unit: BUDGET_CODE_DESCRIPTIONS['1.1.1'].defaultUnit,
        frequency: 1,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['1.1.1'].defaultUnitPrice,
        totalAmount: 5000000,
        notes: 'Survei geolistrik titik pengeboran (2 desa)',
      },
      {
        id: `cai-${Date.now()}-2`,
        itemNo: 2,
        budgetCode: '1.2.4',
        description: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultDescription,
        volume: 4,
        unit: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultUnit,
        frequency: 1,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultUnitPrice,
        totalAmount: 1000000,
        notes: 'Transportasi operasional tim survei lapangan',
      },
      {
        id: `cai-${Date.now()}-3`,
        itemNo: 3,
        budgetCode: '3.1.1',
        description: BUDGET_CODE_DESCRIPTIONS['3.1.1'].defaultDescription,
        volume: 2,
        unit: BUDGET_CODE_DESCRIPTIONS['3.1.1'].defaultUnit,
        frequency: 1,
        unitPrice: BUDGET_CODE_DESCRIPTIONS['3.1.1'].defaultUnitPrice,
        totalAmount: 1500000,
        notes: 'Pengujian sampel awal laboratorium terakreditasi',
      },
    ];
  }

  // Default fallback items
  return [
    {
      id: `cai-${Date.now()}-1`,
      itemNo: 1,
      budgetCode: '1.1.2',
      description: BUDGET_CODE_DESCRIPTIONS['1.1.2'].defaultDescription,
      volume: 25,
      unit: BUDGET_CODE_DESCRIPTIONS['1.1.2'].defaultUnit,
      frequency: 1,
      unitPrice: BUDGET_CODE_DESCRIPTIONS['1.1.2'].defaultUnitPrice,
      totalAmount: 1625000,
      notes: 'Konsumsi kegiatan lapangan',
    },
    {
      id: `cai-${Date.now()}-2`,
      itemNo: 2,
      budgetCode: '1.2.4',
      description: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultDescription,
      volume: 2,
      unit: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultUnit,
      frequency: 1,
      unitPrice: BUDGET_CODE_DESCRIPTIONS['1.2.4'].defaultUnitPrice,
      totalAmount: 500000,
      notes: 'Transportasi tim lapangan',
    },
  ];
}

const DEFAULT_COMPLIANCE_NOTES = [
  '1. Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana disertai lampiran link PDF Expensify pada menu Ringkasan Cash Advance.',
  '2. Tidak dapat mengajukan Cash Advance baru apabila masih terdapat 2 (dua) Cash Advance yang belum dilaporkan (belum tutup laporan).',
  '3. Sisa saldo kasbon yang tidak terpakai wajib disetor/dikembalikan ke rekening kas organisasi saat proses rekonsiliasi.',
  '4. Kelebihan pengeluaran yang tidak tercantum dalam rincian yang disetujui tidak dapat diganti tanpa persetujuan tertulis Finance & Director.',
];

const BANK_OPTIONS = [
  'Bank Mandiri',
  'Bank Central Asia (BCA)',
  'Bank Rakyat Indonesia (BRI)',
  'Bank Negara Indonesia (BNI)',
  'Bank Syariah Indonesia (BSI)',
  'Bank CIMB Niaga',
  'Kas Tunai (Petty Cash)',
];

function getComplementaryTimelineForTor(tor?: Tor) {
  if (tor?.timelineItems && tor.timelineItems.length > 0) {
    return tor.timelineItems;
  }
  return [];
}

export const CashAdvanceFormModal: React.FC<CashAdvanceFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingRecord,
  initialTorId,
  tors,
  outcomes = [],
  outputs = [],
  activities = [],
  currentUser,
  sequenceNumber,
}) => {
  // Pilih TOR awal: prioritas TOR aktif/terpilih atau yang berstatus Disetujui
  const [selectedTorId, setSelectedTorId] = useState<string>(() => {
    if (existingRecord?.torId) return existingRecord.torId;
    if (initialTorId) return initialTorId;
    const approved = tors.find((t) => t.submissionStatus === 'Disetujui');
    return approved?.id || tors[0]?.id || '';
  });

  const selectedTor = tors.find((t) => t.id === selectedTorId);
  const torTimelineItems = getComplementaryTimelineForTor(selectedTor);

  // Implementation Timeline Mode: 'all' (Langsung Semua) or 'single' (Satu Persatu / Pilih Tahap Implementasi)
  const [implementationMode, setImplementationMode] = useState<'all' | 'single'>(
    existingRecord?.implementationMode || 'all'
  );
  const [selectedTimelineIds, setSelectedTimelineIds] = useState<string[]>(() => {
    if (existingRecord?.implementationTimelineIds && existingRecord.implementationTimelineIds.length > 0) {
      return existingRecord.implementationTimelineIds;
    }
    return torTimelineItems.map((t) => t.id);
  });

  // 7-Day Reporting Commitment Option (Otomatis centang sesuai SOP)
  const [reportingCommitmentConfirmed, setReportingCommitmentConfirmed] = useState<boolean>(true);
  const [showHierarchyInfo, setShowHierarchyInfo] = useState<boolean>(false);
  const [existingTorAdvances, setExistingTorAdvances] = useState<CashAdvanceRecord[]>([]);

  // Nomor Kasbon otomatis: persis sama seperti nama TOR namun dengan awalan CA
  const [advanceNumber, setAdvanceNumber] = useState<string>(() => {
    if (existingRecord?.advanceNumber) return existingRecord.advanceNumber;
    const targetTor = tors.find(
      (t) => t.id === (initialTorId || tors.find((x) => x.submissionStatus === 'Disetujui')?.id || tors[0]?.id)
    );
    return targetTor ? formatCashAdvanceNumberFromTor(targetTor.torNumber, sequenceNumber || 1) : '';
  });

  const [requestDate, setRequestDate] = useState<string>(
    existingRecord?.requestDate || new Date().toISOString().slice(0, 10)
  );

  // Calculate H+7 reporting deadline from requestDate
  const reportingDeadlineDate = (() => {
    const base = new Date(requestDate);
    if (isNaN(base.getTime())) {
      const fallback = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      return fallback.toISOString().slice(0, 10);
    }
    const d = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  })();

  const [organizationName] = useState<string>(
    getOrganizationSettings().organizationName ||
      existingRecord?.organizationName ||
      'Yayasan Inti Muda Indonesia (WIJNA)'
  );

  const [requesterName, setRequesterName] = useState<string>(
    existingRecord?.requesterName || currentUser?.name || 'Siti Rahmawati, S.T.'
  );
  const [requesterRole, setRequesterRole] = useState<string>(
    existingRecord?.requesterRole || currentUser?.roleTitle || 'Field Officer'
  );
  const [department, setDepartment] = useState<string>(
    existingRecord?.department || currentUser?.department || 'Program & Implementasi Lapangan'
  );

  const [location, setLocation] = useState<string>(
    existingRecord?.location || selectedTor?.location || ''
  );

  // Bank Disbursement details
  const [bankName, setBankName] = useState<string>(
    existingRecord?.bankName || 'Bank Mandiri'
  );
  const [bankAccountNumber, setBankAccountNumber] = useState<string>(
    existingRecord?.bankAccountNumber || '132-00-9821455-1'
  );
  const [bankAccountHolder, setBankAccountHolder] = useState<string>(
    existingRecord?.bankAccountHolder || currentUser?.name || ''
  );

  // Table items - diinisialisasi kosong tanpa harga
  const [items, setItems] = useState<CashAdvanceItem[]>(() => {
    if (existingRecord?.items && existingRecord.items.length > 0) {
      return existingRecord.items;
    }
    const firstTl = torTimelineItems[0];
    return [
      {
        id: `cai-${Date.now()}-1`,
        itemNo: 1,
        budgetCode: '',
        description: '',
        volume: 1,
        unit: '',
        frequency: 1,
        unitPrice: 0,
        totalAmount: 0,
        notes: '',
        timelineItemId: firstTl?.id || 'tl-1',
        timelinePeriod: firstTl?.period || '',
        timelineActivity: firstTl?.activity || '',
      },
    ];
  });

  const [complianceNotes] = useState<string[]>(
    existingRecord?.complianceNotes || DEFAULT_COMPLIANCE_NOTES
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewPrint, setPreviewPrint] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const formPrintSheetRef = React.useRef<HTMLElement>(null);

  const handleDownloadFormPreviewPdf = async () => {
    if (!formPrintSheetRef.current) return;
    setIsDownloadingPdf(true);
    try {
      await downloadElementAsPdf({
        element: formPrintSheetRef.current,
        filename: `Cash_Advance_${advanceNumber || 'Draft'}`,
        paperFormat: 'a4',
        orientation: 'portrait',
        marginMm: 8,
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // Unreported Cash Advances count for this TOR (excluding current editing record and rejected ones)
  const unreportedAdvances = existingTorAdvances.filter(
    (c) => !c.isReported && c.status !== 'Ditolak' && c.id !== existingRecord?.id
  );
  const isBlockedByUnreportedLimit = !existingRecord && unreportedAdvances.length >= 2;

  // Ketika pilihan Dokumen TOR berubah, otomatis update Nomor Kasbon (CA + No TOR), lokasi, daftar timeline, dan reset kode finance yang tidak terdaftar pada Program baru
  const handleTorSelectionChange = async (newTorId: string) => {
    setSelectedTorId(newTorId);
    const targetTor = tors.find((t) => t.id === newTorId);
    if (targetTor) {
      setLocation(targetTor.location || '');
      const tlList = getComplementaryTimelineForTor(targetTor);
      setImplementationMode('all');
      setSelectedTimelineIds(tlList.map((t) => t.id));

      const targetFy =
        Number((requestDate || targetTor.startDate || new Date().toISOString()).slice(0, 4)) ||
        new Date().getFullYear();
      const targetProgramCodes = getRegisteredProgramBudgetCodes({
        programId: targetTor.programId,
        programName: targetTor.programName,
        fiscalYear: targetFy,
        outcomes,
        outputs,
        activities,
        tors,
      });
      const allowedSet = new Set(
        targetProgramCodes.map((c) => c.code.trim().toLowerCase())
      );

      // Pastikan item yang sudah ada tidak membawa kode dari Program lain
      setItems((prev) =>
        prev.map((it) => {
          const currentCode = (it.budgetCode || '').trim().toLowerCase();
          if (currentCode && !allowedSet.has(currentCode)) {
            return {
              ...it,
              budgetCode: '',
              description: '',
              notes: '',
            };
          }
          return it;
        })
      );

      try {
        const existingList = await api.getCashAdvances({ torId: newTorId });
        setExistingTorAdvances(existingList);
        const seq = sequenceNumber !== undefined ? sequenceNumber : existingList.length + 1;
        setAdvanceNumber(formatCashAdvanceNumberFromTor(targetTor.torNumber, seq));
      } catch {
        setAdvanceNumber(formatCashAdvanceNumberFromTor(targetTor.torNumber, sequenceNumber || 1));
      }
    }
  };

  // Sinkronisasi otomatis saat komponen dimuat atau targetTor berubah
  useEffect(() => {
    if (selectedTor) {
      let isMounted = true;
      api
        .getCashAdvances({ torId: selectedTor.id })
        .then((existingList) => {
          if (!isMounted) return;
          setExistingTorAdvances(existingList);
          if (!existingRecord) {
            const seq = sequenceNumber !== undefined ? sequenceNumber : existingList.length + 1;
            setAdvanceNumber(formatCashAdvanceNumberFromTor(selectedTor.torNumber, seq));
          }
        })
        .catch(() => {
          if (!isMounted || existingRecord) return;
          setAdvanceNumber(formatCashAdvanceNumberFromTor(selectedTor.torNumber, sequenceNumber || 1));
        });
      if (!location && !existingRecord) {
        setLocation(selectedTor.location || '');
      }
      return () => {
        isMounted = false;
      };
    }
  }, [selectedTorId, selectedTor, existingRecord, sequenceNumber]);

  const handleSelectImplementationMode = (mode: 'all' | 'single') => {
    setImplementationMode(mode);
    if (mode === 'all') {
      const allIds = torTimelineItems.map((t) => t.id);
      setSelectedTimelineIds(allIds);
    } else {
      // Default to first timeline item when switching to single/step-by-step mode
      const firstId = torTimelineItems[0]?.id ? [torTimelineItems[0].id] : [];
      setSelectedTimelineIds(firstId);
      if (torTimelineItems[0]) {
        setItems((prev) =>
          prev.map((it) => ({
            ...it,
            timelineItemId: torTimelineItems[0].id,
            timelinePeriod: torTimelineItems[0].period,
            timelineActivity: torTimelineItems[0].activity,
          }))
        );
      }
    }
  };

  const handleToggleTimelineId = (tlId: string) => {
    setSelectedTimelineIds((prev) => {
      const currentList =
        implementationMode === 'all' ? torTimelineItems.map((t) => t.id) : prev;
      const exists = currentList.includes(tlId);
      const nextList = exists
        ? currentList.length > 1
          ? currentList.filter((x) => x !== tlId)
          : currentList
        : [...currentList, tlId];

      if (nextList.length === torTimelineItems.length) {
        setImplementationMode('all');
      } else {
        setImplementationMode('single');
      }

      const firstSelected = torTimelineItems.find((t) => nextList.includes(t.id));
      if (firstSelected) {
        setItems((prevItems) =>
          prevItems.map((it) =>
            nextList.includes(it.timelineItemId || '')
              ? it
              : {
                  ...it,
                  timelineItemId: firstSelected.id,
                  timelinePeriod: firstSelected.period,
                  timelineActivity: firstSelected.activity,
                }
          )
        );
      }

      return nextList;
    });
  };

  // Compute total amount
  const grandTotal = items.reduce((acc, curr) => acc + (Number(curr.totalAmount) || 0), 0);
  const amountInWords = angkaKeTerbilangRupiah(grandTotal);

  // Program-scoped Finance Dataset (Program -> Outcome -> Output -> Activity -> ToR -> Finance Code / Cash Advance Code)
  const caFiscalYear = Number(
    (requestDate || selectedTor?.startDate || new Date().toISOString()).slice(0, 4)
  ) || new Date().getFullYear();

  const [programBudgetDataset, setProgramBudgetDataset] = useState<ProgramBudgetDataset | null>(
    () => {
      if (!selectedTor?.programId && !selectedTor?.programName) return null;
      return getOrCreateProgramBudgetDataset(
        selectedTor.programId || selectedTor.programName || 'program',
        selectedTor.programName || '',
        caFiscalYear,
        { outcomes, outputs, activities, tors }
      );
    }
  );

  useEffect(() => {
    let isMounted = true;
    const refreshProgramFinance = () => {
      if (!isMounted) return;
      if (selectedTor?.programId || selectedTor?.programName) {
        setProgramBudgetDataset(
          getOrCreateProgramBudgetDataset(
            selectedTor.programId || selectedTor.programName || 'program',
            selectedTor.programName || '',
            caFiscalYear,
            { outcomes, outputs, activities, tors }
          )
        );
      } else {
        setProgramBudgetDataset(null);
      }
    };

    refreshProgramFinance();
    api
      .getFinanceProgramBudgets()
      .then((remote) => {
        if (isMounted && remote && typeof remote === 'object') {
          hydrateProgramBudgetDatasetsFromServer(remote);
          refreshProgramFinance();
        }
      })
      .catch(() => {});

    window.addEventListener('program-budget-updated', refreshProgramFinance);
    window.addEventListener('program-budget-dataset-updated', refreshProgramFinance);
    return () => {
      isMounted = false;
      window.removeEventListener('program-budget-updated', refreshProgramFinance);
      window.removeEventListener('program-budget-dataset-updated', refreshProgramFinance);
    };
  }, [selectedTor, caFiscalYear, outcomes, outputs, activities, tors]);

  // Eksklusif hanya menampilkan dan mengizinkan kode finance yang terdaftar pada Program terpilih
  const programBudgetCodes: ProgramMasterBudgetCode[] =
    programBudgetDataset?.masterBudgetCodes && programBudgetDataset.masterBudgetCodes.length > 0
      ? programBudgetDataset.masterBudgetCodes
      : getRegisteredProgramBudgetCodes({
          programId: selectedTor?.programId,
          programName: selectedTor?.programName,
          fiscalYear: caFiscalYear,
          outcomes,
          outputs,
          activities,
          tors,
        });

  const activeProgramPeriods = programBudgetDataset
    ? getActivePeriods(programBudgetDataset)
    : [];

  const matchedBudgetPeriod =
    activeProgramPeriods.find(
      (p) => requestDate >= p.startDate && requestDate <= p.endDate
    ) || activeProgramPeriods[0] || null;

  // Handlers for item modifications
  const handleItemChange = (
    id: string,
    field: keyof CashAdvanceItem,
    value: string | number
  ) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const updated = { ...item, [field]: value };

        if (field === 'timelineItemId') {
          const foundTl = torTimelineItems.find((t) => t.id === String(value));
          if (foundTl) {
            updated.timelinePeriod = foundTl.period;
            updated.timelineActivity = foundTl.activity;
          }
        }

        // EKSKLUSIF: Setiap kode finance terhubung langsung dengan pengaturan finance pada Program yang dipilih / tercantum dalam ToR
        if (field === 'budgetCode') {
          const codeStr = String(value);
          const prevCodeItem = programBudgetCodes.find(
            (b) => b.code.trim().toLowerCase() === (item.budgetCode || '').trim().toLowerCase()
          );
          const progCodeItem = programBudgetCodes.find(
            (b) => b.code.trim().toLowerCase() === codeStr.trim().toLowerCase()
          );

          if (progCodeItem) {
            const shouldReplaceDesc =
              !updated.description.trim() ||
              (prevCodeItem &&
                updated.description.trim().toLowerCase() ===
                  prevCodeItem.budgetCategory.trim().toLowerCase());
            if (shouldReplaceDesc) {
              updated.description = progCodeItem.budgetCategory;
            }
            updated.notes = progCodeItem.budgetCategory;
          }
        }

        // Recalculate totalAmount if volume, frequency, or unitPrice changed
        const vol = updated.volume !== undefined ? Number(updated.volume) : 1;
        const freq = updated.frequency !== undefined ? Number(updated.frequency) : 1;
        const price = updated.unitPrice !== undefined ? Number(updated.unitPrice) : 0;
        updated.totalAmount = vol * freq * price;

        return updated;
      })
    );
  };

  // Tambah baris: baris kosong dengan tahap implementasi aktif
  const handleAddItem = () => {
    const nextNo = items.length + 1;
    const defaultTl =
      torTimelineItems.find((t) => selectedTimelineIds.includes(t.id)) || torTimelineItems[0];
    const newItem: CashAdvanceItem = {
      id: `cai-${Date.now()}-${nextNo}`,
      itemNo: nextNo,
      budgetCode: '',
      description: '',
      volume: 1,
      unit: '',
      frequency: 1,
      unitPrice: 0,
      totalAmount: 0,
      notes: '',
      timelineItemId: defaultTl?.id || '',
      timelinePeriod: defaultTl?.period || '',
      timelineActivity: defaultTl?.activity || '',
    };
    setItems((prev) => [...prev, newItem]);
  };

  // Buat 1 baris otomatis untuk setiap tahap Implementation Timeline
  const handleGenerateRowsFromTimeline = () => {
    const targetTimelines =
      implementationMode === 'all'
        ? torTimelineItems
        : torTimelineItems.filter((t) => selectedTimelineIds.includes(t.id));

    if (targetTimelines.length === 0) return;

    const generated: CashAdvanceItem[] = targetTimelines.map((tl, idx) => ({
      id: `cai-${Date.now()}-${idx + 1}`,
      itemNo: idx + 1,
      budgetCode: '',
      description: `${tl.period} — ${tl.activity}`,
      volume: 1,
      unit: 'Paket',
      frequency: 1,
      frequencyUnit: 'Kegiatan',
      unitPrice: 0,
      totalAmount: 0,
      notes: `Implementasi: ${tl.period}`,
      timelineItemId: tl.id,
      timelinePeriod: tl.period,
      timelineActivity: tl.activity,
    }));
    setItems(generated);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      setErrorMsg('Formulir Cash Advance harus memiliki minimal 1 item rincian anggaran.');
      return;
    }
    setItems((prev) =>
      prev
        .filter((item) => item.id !== id)
        .map((item, index) => ({ ...item, itemNo: index + 1 }))
    );
  };

  const handleSave = async (submitStatus: 'Draft' | 'Diajukan') => {
    if (!selectedTor) {
      setErrorMsg('Pilih Dokumen TOR yang menjadi dasar pengajuan Cash Advance.');
      return;
    }

    if (isBlockedByUnreportedLimit) {
      setErrorMsg(
        'Tidak dapat mengajukan Cash Advance baru karena masih terdapat 2 Cash Advance yang belum dilaporkan. Silakan tutup laporan pada menu Ringkasan Cash Advance terlebih dahulu.'
      );
      return;
    }

    if (!reportingCommitmentConfirmed) {
      setErrorMsg(
        'Anda wajib menyetujui ketentuan pelaporan paling lambat 7 (tujuh) hari setelah pengajuan dana.'
      );
      return;
    }

    if (torTimelineItems.length === 0) {
      setErrorMsg(
        'Not Available in Source TOR: Dokumen TOR Tahap 1 belum memiliki rincian Implementation Timeline. Silakan lengkapi Implementation Timeline pada TOR Tahap 1 terlebih dahulu.'
      );
      return;
    }

    if (selectedTimelineIds.length === 0) {
      setErrorMsg('Pilih minimal 1 tahap Implementation Timeline sebagai dasar pengajuan Cash Advance.');
      return;
    }

    if (programBudgetCodes.length === 0) {
      setErrorMsg(
        `Program "${selectedTor.programName || '-'}" belum memiliki Master Budget Code terdaftar pada Pengaturan Finance Program. Silakan daftarkan Master Budget Code pada Program ini terlebih dahulu.`
      );
      return;
    }

    const allowedProgramCodeSet = new Set(
      programBudgetCodes.map((c) => c.code.trim().toLowerCase())
    );
    const invalidCodeRow = items.find(
      (it) =>
        !it.budgetCode ||
        !it.budgetCode.trim() ||
        !allowedProgramCodeSet.has(it.budgetCode.trim().toLowerCase())
    );
    if (invalidCodeRow) {
      setErrorMsg(
        `Baris #${invalidCodeRow.itemNo}: Wajib memilih Kode Finance yang terdaftar pada Program "${
          selectedTor.programName || '-'
        }" (${programBudgetCodes
          .map((c) => c.code)
          .join(', ')}). Penggunaan kode dari Program lain tidak diizinkan.`
      );
      return;
    }

    if (items.some((it) => !it.description.trim() || it.totalAmount <= 0)) {
      setErrorMsg('Seluruh item pengeluaran harus memiliki uraian kebutuhan dan nominal > 0.');
      return;
    }

    if (!bankAccountNumber.trim() || !bankAccountHolder.trim()) {
      setErrorMsg('Informasi rekening bank penerima transfer wajib diisi lengkap.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const chosenTimelines =
      implementationMode === 'all'
        ? torTimelineItems
        : torTimelineItems.filter((t) => selectedTimelineIds.includes(t.id));

    const timelineSummary =
      implementationMode === 'all'
        ? `Langsung Semua Implementasi (${torTimelineItems.length} Tahap)`
        : chosenTimelines.map((t) => t.activity).join(' | ');

    // Pastikan setiap item memiliki referensi timeline
    const normalizedItems = items.map((it) => {
      const matchedTl =
        torTimelineItems.find((t) => t.id === it.timelineItemId) ||
        chosenTimelines[0] ||
        torTimelineItems[0];
      return {
        ...it,
        timelineItemId: matchedTl?.id || it.timelineItemId || 'tl-1',
        timelinePeriod: matchedTl?.period || it.timelinePeriod || '',
        timelineActivity: matchedTl?.activity || it.timelineActivity || '',
      };
    });

    try {
      const payload: Partial<CashAdvanceRecord> = {
        advanceNumber,
        requestDate,
        organizationName,
        requesterId: currentUser?.id || 'user-staff',
        requesterName,
        requesterRole,
        department,
        torId: selectedTor.id,
        torNumber: selectedTor.torNumber,
        activityTitle: selectedTor.title,
        programName: selectedTor.programName || 'Program Yayasan Inti Muda Indonesia',
        activityStartDate: selectedTor.startDate,
        activityEndDate: selectedTor.endDate,
        location,
        bankName,
        bankAccountNumber,
        bankAccountHolder,
        items: normalizedItems,
        totalAmount: grandTotal,
        amountInWords,
        complianceNotes,
        implementationMode,
        implementationTimelineIds:
          implementationMode === 'all' ? torTimelineItems.map((t) => t.id) : selectedTimelineIds,
        implementationTimelineSummary: timelineSummary,
        reportingCommitment: 'Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana',
        reportingDeadlineDate,
        status: submitStatus as CashAdvanceStatus,
      };

      let result: CashAdvanceRecord;
      if (existingRecord) {
        result = await api.updateCashAdvance(existingRecord.id, payload);
        if (submitStatus === 'Diajukan' && existingRecord.status === 'Draft') {
          result = await api.submitCashAdvance(existingRecord.id);
        }
      } else {
        result = await api.createCashAdvance(payload);
      }

      onSuccess(result);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan formulir Cash Advance');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg border border-[#EDEDEC] shadow-2xl max-w-[96vw] xl:max-w-[1440px] w-full max-h-[96vh] flex flex-col overflow-hidden my-auto">
        {/* ================= MODAL TOP ACTION BAR ================= */}
        <div className="px-6 py-3.5 border-b border-[#EDEDEC] bg-[#FAFAF9] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#1E3A8A] text-white flex items-center justify-center shadow-2xs shrink-0 font-bold text-xs">
              CA
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-[#1E3A8A] uppercase tracking-wider">
                  Modul Keuangan WIJNA · Formulir Kasbon Berbasis Implementasi
                </span>
                <span className="text-slate-300">|</span>
                <span className="text-[11px] font-mono text-slate-500">
                  {advanceNumber || 'Draf Otomatis'}
                </span>
              </div>
              <h1 className="text-base font-bold text-[#1F2937] leading-tight">
                {existingRecord ? 'Edit Formulir Cash Advance' : 'Form Pengajuan Cash Advance'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewPrint(!previewPrint)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
                previewPrint
                  ? 'bg-stone-900 text-white border-stone-900 hover:bg-stone-800'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {previewPrint ? <Edit3 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{previewPrint ? 'Kembali ke Form' : 'Preview Dokumen'}</span>
            </button>
            {previewPrint && (
              <button
                type="button"
                disabled={isDownloadingPdf}
                onClick={handleDownloadFormPreviewPdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#1E3A8A] hover:bg-[#1E40AF] text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isDownloadingPdf ? 'Mengunduh PDF...' : 'Download PDF'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              aria-label="Tutup Formulir"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ================= BLOCKING BANNER IF >= 2 UNREPORTED CASH ADVANCES ================= */}
        {isBlockedByUnreportedLimit && (
          <div className="px-6 py-3 bg-rose-50 border-b border-rose-300 text-rose-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <div className="font-bold text-rose-900">
                  Pengajuan Cash Advance Baru Terkunci (Masih Ada {unreportedAdvances.length} Cash Advance Belum Dilaporkan)
                </div>
                <p className="text-rose-800 mt-0.5 leading-relaxed">
                  Sesuai ketentuan, tidak dapat mengajukan Cash Advance baru apabila masih ada{' '}
                  <strong>2 Cash Advance yang belum dilaporkan</strong> (
                  {unreportedAdvances.map((c) => c.advanceNumber).join(', ')}). Silakan lakukan{' '}
                  <strong>Tutup Laporan</strong> beserta lampiran <strong>Link PDF Expensify</strong> pada tab{' '}
                  <strong>03. Ringkasan Cash Advance</strong> terlebih dahulu.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL ERROR BANNER ================= */}
        {errorMsg && (
          <div className="px-6 py-2.5 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ================= MODAL CONTENT (DOCUMENT SURFACE) ================= */}
        {previewPrint ? (
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-[#F7F7F5]">
            <article
              ref={formPrintSheetRef}
              className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-8 py-8 sm:px-14 sm:py-12 shadow-xs space-y-5 text-[14px] leading-[1.38] text-black max-w-4xl mx-auto"
              style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
            >
              <div className="text-center pb-1">
                <h1 className="text-[18px] font-bold text-black tracking-normal leading-snug uppercase">
                  FORMULIR PENGAJUAN CASH ADVANCE (UANG MUKA KEGIATAN)
                </h1>
                <div className="text-[15px] font-bold text-black mt-0.5 leading-snug">
                  {selectedTor?.title || '-'}
                </div>
              </div>

              <section>
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  1. Informasi Pengajuan &amp; Referensi Kegiatan (Cash Advance Information)
                </div>
                <table className="w-full text-left border-collapse border border-black text-[13.5px]">
                  <tbody>
                    <tr>
                      <td className="py-1.5 px-2.5 w-[28%] border border-black font-bold align-top">
                        Organisasi / Lembaga
                      </td>
                      <td className="py-1.5 px-2.5 w-[72%] border border-black align-top" colSpan={3}>
                        {organizationName}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 w-[28%] border border-black font-bold align-top">
                        Nomor Cash Advance
                      </td>
                      <td className="py-1.5 px-2.5 w-[25%] border border-black font-bold align-top">
                        {advanceNumber || '-'}
                      </td>
                      <td className="py-1.5 px-2.5 w-[22%] border border-black font-bold align-top">
                        Tanggal Pengajuan
                      </td>
                      <td className="py-1.5 px-2.5 w-[25%] border border-black align-top">
                        {requestDate}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Referensi Nomor TOR
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top">
                        {selectedTor?.torNumber || '-'}
                      </td>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Program
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top">
                        {selectedTor?.programName || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Judul Kegiatan
                      </td>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top" colSpan={3}>
                        {selectedTor?.title || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Periode Pelaksanaan
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top">
                        {selectedTor ? `${selectedTor.startDate} s/d ${selectedTor.endDate}` : '-'}
                      </td>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Lokasi Kegiatan
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top">
                        {location || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Nama Pemohon (PIC)
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top">
                        {requesterName} ({requesterRole})
                      </td>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Divisi / Unit Kerja
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top">
                        {department}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Rekening Penerima Dana
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top" colSpan={3}>
                        <strong>{bankName}</strong> — No. Rekening: <strong>{bankAccountNumber}</strong> a.n.{' '}
                        <strong>{bankAccountHolder}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black font-bold align-top">
                        Komitmen Pelaporan (H+7)
                      </td>
                      <td className="py-1.5 px-2.5 border border-black align-top" colSpan={3}>
                        Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana — Batas Lapor:{' '}
                        <strong>{reportingDeadlineDate}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section>
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  2. Rincian Kebutuhan Anggaran Kasbon (Budget Breakdown)
                </div>
                <table className="w-full text-left border-collapse border border-black text-[13px]">
                  <thead>
                    <tr className="bg-[#EFEFEF] text-black font-bold">
                      <th className="py-1.5 px-2 w-[6%] text-center border border-black">No</th>
                      <th className="py-1.5 px-2 w-[14%] text-left border border-black">Kode</th>
                      <th className="py-1.5 px-2.5 w-[34%] border border-black">
                        Deskripsi / Uraian Kebutuhan
                      </th>
                      <th className="py-1.5 px-2 w-[14%] text-center border border-black">
                        Vol / Satuan
                      </th>
                      <th className="py-1.5 px-2 w-[15%] text-right border border-black">
                        Harga Satuan (Rp)
                      </th>
                      <th className="py-1.5 px-2 w-[17%] text-right border border-black">
                        Total (Rp)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id || idx} className="align-top">
                        <td className="py-1.5 px-2 text-center border border-black">{idx + 1}</td>
                        <td className="py-1.5 px-2 text-left font-bold border border-black">
                          {it.budgetCode || '-'}
                        </td>
                        <td className="py-1.5 px-2.5 border border-black">
                          <div>{it.description || '-'}</div>
                          {(it.timelineActivity || it.timelinePeriod) && (
                            <div className="text-[11.5px] italic mt-0.5">
                              Tahap: {it.timelineActivity || it.timelinePeriod}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center border border-black">
                          {it.volume} {it.unit || 'Unit'} × {it.frequency || 1} {it.frequencyUnit || 'Kali'}
                        </td>
                        <td className="py-1.5 px-2 text-right border border-black">
                          {formatRupiah(it.unitPrice)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-bold border border-black">
                          {formatRupiah(it.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#EFEFEF] font-bold text-black">
                      <td colSpan={5} className="py-1.5 px-2.5 text-right border border-black uppercase">
                        Total Pengajuan Cash Advance
                      </td>
                      <td className="py-1.5 px-2 text-right border border-black">
                        {formatRupiah(grandTotal)}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={6} className="py-1.5 px-2.5 border border-black italic text-[13px]">
                        <strong>Terbilang:</strong> &ldquo;{amountInWords}&rdquo;
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </section>

              <section className="pt-2">
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  3. Otorisasi &amp; Persetujuan Dokumen (Signatures &amp; Verification)
                </div>
                <table className="w-full text-center border-collapse border border-black text-[13px]">
                  <thead>
                    <tr className="bg-[#EFEFEF] font-bold">
                      <th className="py-1.5 px-2 w-1/4 border border-black">1. Diajukan Oleh</th>
                      <th className="py-1.5 px-2 w-1/4 border border-black">2. Diperiksa Oleh</th>
                      <th className="py-1.5 px-2 w-1/4 border border-black">3. Disetujui Oleh</th>
                      <th className="py-1.5 px-2 w-1/4 border border-black">4. Dicairkan Oleh</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="align-top">
                      <td className="py-2.5 px-2 border border-black">
                        <div className="my-1.5 flex justify-center">
                          <ApprovalBarcodeStamp
                            compact
                            documentNumber={advanceNumber || 'CA-DRAFT'}
                            roleCode="PIC"
                            signerName={requesterName}
                            signDate={requestDate}
                            statusLabel="TELAH DIAJUKAN"
                          />
                        </div>
                        <div className="font-bold underline">{requesterName}</div>
                        <div className="text-[11.5px]">{requesterRole}</div>
                      </td>
                      <td className="py-2.5 px-2 border border-black">
                        <div className="my-1.5 flex justify-center">
                          <ApprovalBarcodeStamp
                            compact
                            variant={
                              existingRecord?.signatures?.verifiedBy?.status === 'Terverifikasi'
                                ? 'authorized'
                                : 'pending'
                            }
                            documentNumber={advanceNumber || 'CA'}
                            roleCode="FIN"
                            signerName={
                              existingRecord?.signatures?.verifiedBy?.name || 'Budi Hartono, S.E.'
                            }
                            signDate={existingRecord?.signatures?.verifiedBy?.date || requestDate}
                            statusLabel={
                              existingRecord?.signatures?.verifiedBy?.status || 'MENUNGGU VERIFIKASI'
                            }
                          />
                        </div>
                        <div className="font-bold underline">
                          {existingRecord?.signatures?.verifiedBy?.name || 'Budi Hartono, S.E.'}
                        </div>
                        <div className="text-[11.5px]">Finance Specialist</div>
                      </td>
                      <td className="py-2.5 px-2 border border-black">
                        <div className="my-1.5 flex justify-center">
                          <ApprovalBarcodeStamp
                            compact
                            variant={
                              existingRecord?.signatures?.approvedBy?.status === 'Disetujui'
                                ? 'authorized'
                                : 'pending'
                            }
                            documentNumber={advanceNumber || 'CA'}
                            roleCode="DIR"
                            signerName={
                              existingRecord?.signatures?.approvedBy?.name || 'Dr. Hendra Wijaya'
                            }
                            signDate={existingRecord?.signatures?.approvedBy?.date || requestDate}
                            statusLabel={
                              existingRecord?.signatures?.approvedBy?.status || 'MENUNGGU APPROVAL'
                            }
                          />
                        </div>
                        <div className="font-bold underline">
                          {existingRecord?.signatures?.approvedBy?.name || 'Dr. Hendra Wijaya'}
                        </div>
                        <div className="text-[11.5px]">Executive Director</div>
                      </td>
                      <td className="py-2.5 px-2 border border-black">
                        <div className="my-1.5 flex justify-center">
                          <ApprovalBarcodeStamp
                            compact
                            variant={
                              existingRecord?.signatures?.disbursedBy?.isDisbursed
                                ? 'authorized'
                                : 'pending'
                            }
                            documentNumber={advanceNumber || 'CA'}
                            roleCode="CSH"
                            signerName={existingRecord?.signatures?.disbursedBy?.name || 'Ratna Sari'}
                            signDate={existingRecord?.signatures?.disbursedBy?.date || requestDate}
                            statusLabel={
                              existingRecord?.signatures?.disbursedBy?.isDisbursed
                                ? 'TELAH DICAIRKAN'
                                : 'BELUM DICAIRKAN'
                            }
                          />
                        </div>
                        <div className="font-bold underline">
                          {existingRecord?.signatures?.disbursedBy?.name || 'Ratna Sari'}
                        </div>
                        <div className="text-[11.5px]">Kasir / Finance Officer</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </article>
          </div>
        ) : (
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-[#2F3437] bg-white">
          {/* ================= HEADER SECTION: NGO OFFICIAL DOCUMENT BANNER ================= */}
          <div className="border border-[#1E3A8A]/30 rounded-t-lg bg-white overflow-hidden shadow-2xs">
            {/* Top Navy Bar / Organization Header */}
            <div className="bg-[#1E3A8A] text-white px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded bg-white text-[#1E3A8A] flex items-center justify-center font-bold text-lg shadow-xs shrink-0">
                  <Building2 className="w-6 h-6 text-[#1E3A8A]" />
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-wide uppercase">
                    {organizationName}
                  </h2>
                  <p className="text-[11px] text-blue-100">
                    Lembaga Swadaya Masyarakat · Non-Governmental Organization (NGO)
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="inline-block px-2.5 py-1 rounded bg-white/10 text-white text-[11px] font-mono font-medium border border-white/20">
                  KODE FORM: FORM-FIN-02 / REV.01
                </span>
                <p className="text-[10px] text-blue-200 mt-1">Standar Prosedur Operasional Keuangan</p>
              </div>
            </div>

            {/* Document Title Banner */}
            <div className="bg-[#F8FAFC] px-6 py-3 border-b border-slate-200 text-center">
              <h3 className="text-base font-extrabold text-[#0F172A] tracking-wider uppercase">
                FORM PENGAJUAN CASH ADVANCE
              </h3>
              <p className="text-[11.5px] text-slate-500 font-medium">
                (CASH ADVANCE REQUEST FORMULIR / UANG MUKA OPERASIONAL BERBASIS IMPLEMENTASI TOR)
              </p>
            </div>

            {/* ================= SECTION A: METADATA INFORMASI PEMOHON & TOR ================= */}
            <div className="p-5 bg-white space-y-5 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {/* Left column */}
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Referensi Dokumen TOR *
                      </label>
                      <span className="text-[10px] text-blue-600 font-medium">
                        Kuota Aktif: {unreportedAdvances.length} / 2 CA Belum Dilaporkan
                      </span>
                    </div>
                    <select
                      value={selectedTorId}
                      onChange={(e) => handleTorSelectionChange(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded border border-slate-300 bg-white font-medium focus:ring-1 focus:ring-[#1E3A8A] focus:outline-none"
                    >
                      {tors.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.torNumber} - {t.title.slice(0, 50)}... ({t.submissionStatus})
                        </option>
                      ))}
                    </select>
                    {selectedTor && (() => {
                      const approvedTorBudget = Number(
                        selectedTor.budgetApproved ?? selectedTor.budgetRequested ?? 0
                      );
                      const reportedCaTotal = existingTorAdvances
                        .filter((c) => Boolean(c.isReported) && c.status !== 'Ditolak')
                        .reduce(
                          (sum, c) => sum + (Number(c.realizedAmount ?? c.totalAmount) || 0),
                          0
                        );
                      const remainingTorBudget = approvedTorBudget - reportedCaTotal;
                      return (
                        <div className="mt-1.5 space-y-1.5">
                          {/* Compact Bar with Hide & Show Toggle for Hierarchy & Finance Code */}
                          <div className="px-2.5 py-1.5 rounded border border-blue-200 bg-blue-50/50 flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
                            <div className="flex flex-wrap items-center gap-1.5 text-slate-600">
                              <span>Anggaran TOR (Sisa):</span>
                              <strong className="text-emerald-700 font-mono font-bold">
                                {formatRupiah(remainingTorBudget)}
                              </strong>
                              <span className="text-slate-300">•</span>
                              <span>Kode:</span>
                              <strong className="font-mono text-[#1E3A8A]">
                                {selectedTor.activityCode || selectedTor.hierarchyCode || '-'}
                              </strong>
                              <span className="text-slate-300">•</span>
                              <span className="font-mono font-semibold text-[#1E3A8A]">
                                {programBudgetCodes.length} Kode Finance
                              </span>
                            </div>
                          <button
                            type="button"
                            onClick={() => setShowHierarchyInfo((prev) => !prev)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-blue-100/70 text-[#1E3A8A] border border-blue-200 font-semibold text-[10px] transition-colors cursor-pointer shrink-0"
                          >
                            <span>{showHierarchyInfo ? 'Sembunyikan Hirarki' : 'Lihat Hirarki & Kode'}</span>
                            {showHierarchyInfo ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                        </div>

                        {/* Collapsible Program -> Outcome -> Output -> Activity -> ToR -> Finance Code / Cash Advance Code */}
                        {showHierarchyInfo && (
                          <div className="p-2.5 rounded border border-blue-200 bg-blue-50/40 text-[10.5px] space-y-1.5 animate-in fade-in duration-150">
                            <div className="font-mono font-bold text-[#1E3A8A] uppercase tracking-wider text-[9.5px]">
                              Program → Outcome → Output → Activity → ToR → Finance Code / Cash Advance Code
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-slate-700">
                              <div>
                                <span className="text-slate-500">Program:</span>{' '}
                                <strong className="text-slate-900">{selectedTor.programName || '-'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-500">Outcome:</span>{' '}
                                <strong className="text-slate-900">{selectedTor.outcomeName || '-'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-500">Output:</span>{' '}
                                <strong className="text-slate-900">{selectedTor.outputName || '-'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-500">Activity:</span>{' '}
                                <strong className="text-slate-900">{selectedTor.activityName || '-'}</strong>
                              </div>
                              <div>
                                <span className="text-slate-500">Kode ToR / Activity:</span>{' '}
                                <strong className="font-mono text-[#1E3A8A]">
                                  {selectedTor.activityCode || selectedTor.hierarchyCode || '-'}
                                </strong>
                              </div>
                              <div>
                                <span className="text-slate-500">Budget Period &amp; Pagu FY {caFiscalYear}:</span>{' '}
                                <strong className="font-mono text-slate-900">
                                  {matchedBudgetPeriod ? matchedBudgetPeriod.code : '-'} •{' '}
                                  {programBudgetDataset && programBudgetDataset.annualApprovedBudget > 0
                                    ? formatRupiah(programBudgetDataset.annualApprovedBudget)
                                    : 'Belum Diisi'}
                                </strong>
                              </div>
                              <div className="sm:col-span-2 pt-1 border-t border-blue-200/60">
                                <span className="text-slate-500">
                                  Kode Finance Terdaftar Eksklusif Program Ini:
                                </span>{' '}
                                <strong className="font-mono text-[#1E3A8A]">
                                  {programBudgetCodes.length > 0
                                    ? `${programBudgetCodes.length} Kode (${programBudgetCodes
                                        .map((c) => c.code)
                                        .join(', ')})`
                                    : 'Belum ada Budget Code pada Program ini'}
                                </strong>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })()}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-semibold text-slate-700">
                          No. Pengajuan Kasbon *
                        </label>
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={advanceNumber}
                          onChange={(e) => setAdvanceNumber(e.target.value)}
                          placeholder="CA/001.01/WIJNA/PALKL/1.2.1/X/2026"
                          className="w-full px-2.5 py-1.5 text-xs rounded border border-blue-300 bg-blue-50/20 font-mono font-bold text-[#1E3A8A] focus:ring-1 focus:ring-[#1E3A8A] focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Tanggal Pengajuan *
                      </label>
                      <input
                        type="date"
                        value={requestDate}
                        onChange={(e) => setRequestDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 focus:ring-1 focus:ring-[#1E3A8A] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Judul Kegiatan
                    </label>
                    <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-slate-800 leading-snug">
                      {selectedTor?.title || '-'}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Periode Pelaksanaan
                      </label>
                      <div className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 font-mono">
                        {selectedTor ? `${selectedTor.startDate} s/d ${selectedTor.endDate}` : '-'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Lokasi Kegiatan *
                      </label>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Lokasi desa / kecamatan"
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 focus:ring-1 focus:ring-[#1E3A8A] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Right column: Pemohon, Rekening Bank & Komitmen Pelaporan H+7 */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Disiapkan Oleh
                      </label>
                      <input
                        type="text"
                        value={requesterName}
                        onChange={(e) => setRequesterName(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 focus:ring-1 focus:ring-[#1E3A8A] focus:outline-none font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Jabatan / Posisi
                      </label>
                      <input
                        type="text"
                        value={requesterRole}
                        onChange={(e) => setRequesterRole(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 focus:ring-1 focus:ring-[#1E3A8A] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Divisi / Program Kerja
                    </label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 focus:ring-1 focus:ring-[#1E3A8A] focus:outline-none"
                    />
                  </div>

                  {/* Bank Details Box */}
                  <div className="p-3 bg-[#F0FDF4] border border-[#86EFAC] rounded-md space-y-2">
                    <div className="flex items-center gap-1.5 text-emerald-900 font-bold text-[11.5px]">
                      <Landmark className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Rekening Penerima Dana Kasbon (Transfer Tujuan) *</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-medium text-emerald-800 mb-0.5">
                          Nama Bank
                        </label>
                        <select
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          className="w-full px-2 py-1 text-[11px] rounded border border-emerald-300 bg-white focus:outline-none"
                        >
                          {BANK_OPTIONS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-emerald-800 mb-0.5">
                          Nomor Rekening *
                        </label>
                        <input
                          type="text"
                          value={bankAccountNumber}
                          onChange={(e) => setBankAccountNumber(e.target.value)}
                          placeholder="Nomor rekening"
                          className="w-full px-2 py-1 text-[11px] rounded border border-emerald-300 bg-white font-mono focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-emerald-800 mb-0.5">
                          Atas Nama
                        </label>
                        <input
                          type="text"
                          value={bankAccountHolder}
                          onChange={(e) => setBankAccountHolder(e.target.value)}
                          placeholder="Nama pemilik buku tabungan"
                          className="w-full px-2 py-1 text-[11px] rounded border border-emerald-300 bg-white focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Pilihan Pelaporan Paling Lambat 7 Hari Setelah Pengajuan Dana (Otomatis Centang) */}
                  <div className="p-3 bg-amber-50/90 border border-amber-300 rounded-md space-y-1.5">
                    <label className="flex items-start gap-2 select-none">
                      <input
                        type="checkbox"
                        checked={true}
                        readOnly
                        onChange={() => setReportingCommitmentConfirmed(true)}
                        className="mt-0.5 rounded border-amber-400 text-[#1D4ED8] accent-[#1D4ED8] focus:ring-[#1E3A8A] pointer-events-none"
                      />
                      <span className="text-[11.5px] font-bold text-amber-950 leading-snug">
                        Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana *
                      </span>
                    </label>
                    <div className="pl-5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900">
                      <span>
                        Batas Maksimal Pelaporan (H+7):{' '}
                        <strong className="font-mono text-rose-700">{reportingDeadlineDate}</strong>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-white border border-amber-300 text-[10px] font-semibold">
                        Wajib Tutup Laporan + Link PDF Expensify
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ================= SECTION A.2: DASAR IMPLEMENTATION TIMELINE (GAMBAR 2) ================= */}
              <div className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50/50">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-900 text-xs">
                      Dasar Pengajuan Berdasarkan Implementation Timeline TOR (Pilih Cakupan Implementasi)
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Setiap pengajuan Cash Advance mengikuti Implementation Timeline pada TOR: dapat diajukan{' '}
                      <strong>Langsung Semua Implementasi</strong> atau <strong>Satu Persatu per Tahap Implementasi</strong>.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSelectImplementationMode('all')}
                      className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors cursor-pointer ${
                        implementationMode === 'all'
                          ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Langsung Semua Implementasi ({torTimelineItems.length} Tahap)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectImplementationMode('single')}
                      className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors cursor-pointer ${
                        implementationMode === 'single'
                          ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Satu Persatu (Pilih Tahap)
                    </button>
                  </div>
                </div>

                {/* Tabel Pilihan Implementation Timeline (Eksklusif dari TOR Tahap 1) */}
                <div className="p-3 bg-white">
                  {torTimelineItems.length === 0 ? (
                    <div className="p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-bold uppercase text-[11px] px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 mr-2">
                          Not Available in Source TOR
                        </span>
                        <span>
                          Bagian <strong>Implementation Timeline</strong> belum tersedia pada TOR Tahap 1 ({selectedTor?.torNumber}). Sistem tidak membuat asumsi jadwal otomatis — silakan tambahkan Implementation Timeline pada dokumen TOR Tahap 1.
                        </span>
                      </div>
                    </div>
                  ) : (
                  <table className="w-full text-left border border-slate-200 text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/90 text-slate-900 border-b border-slate-200 font-bold">
                        <th className="py-2 px-3 w-12 text-center border-r border-slate-200">Pilih</th>
                        <th className="py-2 px-3 w-48 border-r border-slate-200">Period</th>
                        <th className="py-2 px-3">Activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {torTimelineItems.map((tl) => {
                        const isSelected =
                          implementationMode === 'all' || selectedTimelineIds.includes(tl.id);
                        return (
                          <tr
                            key={tl.id}
                            onClick={() => handleToggleTimelineId(tl.id)}
                            className={`transition-colors cursor-pointer hover:bg-blue-50/40 ${
                              isSelected ? 'bg-blue-50/30' : 'bg-white text-slate-500'
                            }`}
                          >
                            <td
                              className="py-2 px-3 text-center border-r border-slate-200"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                name="implementation-timeline-choice"
                                checked={isSelected}
                                onChange={() => handleToggleTimelineId(tl.id)}
                                className="rounded border-slate-400 text-[#1E3A8A] focus:ring-[#1E3A8A] cursor-pointer"
                              />
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-900 border-r border-slate-200">
                              {tl.period}
                            </td>
                            <td className="py-2 px-3 text-slate-800 leading-relaxed">
                              {tl.activity}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                    <div>
                      Mode Terpilih:{' '}
                      <strong className="text-[#1E3A8A]">
                        {implementationMode === 'all'
                          ? `Langsung Semua Implementasi (${torTimelineItems.length} Tahap)`
                          : `Satu Persatu — ${
                              torTimelineItems.find((t) => selectedTimelineIds.includes(t.id))
                                ?.activity || 'Pilih Aktivitas Implementasi'
                            }`}
                      </strong>
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateRowsFromTimeline}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-[#1E3A8A] border border-blue-200 font-semibold transition-colors cursor-pointer"
                    >
                      <span>Isi Baris Rincian Sesuai Tahap Implementasi</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ================= SECTION B: RINCIAN ANGGARAN (EXACT TABLE FROM IMAGE) ================= */}
            <div className="border-t border-slate-200">
              <div className="px-5 py-3 bg-[#0F172A] text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-blue-300" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Rincian Kebutuhan Anggaran Kasbon (Budget Breakdown)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-300">
                    Jumlah Item: <strong className="text-white font-mono">{items.length}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAddItem()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Baris</span>
                  </button>
                </div>
              </div>

              {/* Responsive Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#1E293B] text-white font-semibold text-[11px] uppercase tracking-wider border-b border-slate-700">
                      <th className="py-2 px-1.5 w-9 text-center border-r border-slate-700">No</th>
                      <th className="py-2 px-2 w-48 min-w-[180px] border-r border-slate-700">
                        Tahap Implementasi
                      </th>
                      <th className="py-2 px-2.5 w-80 min-w-[310px] text-left border-r border-slate-700">
                        Kode &amp; Kategori Budget
                      </th>
                      <th className="py-2 px-3 min-w-[280px] border-r border-slate-700">
                        Deskripsi / Uraian Kebutuhan *
                      </th>
                      <th className="py-2 px-1 w-14 text-center border-r border-slate-700">VOL</th>
                      <th className="py-2 px-1 w-16 text-center border-r border-slate-700">SATUAN</th>
                      <th className="py-2 px-1 w-14 text-center border-r border-slate-700">FREK</th>
                      <th className="py-2 px-1 w-16 text-center border-r border-slate-700">SATUAN</th>
                      <th className="py-2 px-2 w-28 text-right border-r border-slate-700">
                        Biaya Satuan (Rp)
                      </th>
                      <th className="py-2 px-2 w-28 text-right border-r border-slate-700">
                        Total (Rp)
                      </th>
                      <th className="py-2 px-1 w-9 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {items.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-1.5 text-center font-mono text-slate-500 font-semibold border-r border-slate-200">
                          {idx + 1}
                        </td>

                        {/* Aktivitas Implementasi */}
                        <td className="py-2 px-1.5 border-r border-slate-200 w-48 min-w-[180px]">
                          <select
                            value={item.timelineItemId || torTimelineItems[0]?.id || ''}
                            onChange={(e) =>
                              handleItemChange(item.id, 'timelineItemId', e.target.value)
                            }
                            className="w-full px-2 py-1 text-[11px] font-medium rounded border border-slate-300 bg-slate-50 text-slate-800 text-left focus:outline-none focus:border-[#1E3A8A]"
                          >
                            {(implementationMode === 'all'
                              ? torTimelineItems
                              : torTimelineItems.filter((t) => selectedTimelineIds.includes(t.id))
                            ).map((tl, tlIdx) => (
                              <option key={tl.id} value={tl.id} className="text-left">
                                Tahap {tlIdx + 1}: {tl.activity}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Kode Budget (Eksklusif Terhubung ke Master Budget Code Program pada ToR - Rata Kiri & Lebih Panjang) */}
                        <td className="py-2 px-2 border-r border-slate-200 w-80 min-w-[310px] text-left">
                          <select
                            value={
                              programBudgetCodes.some(
                                (c) =>
                                  c.code.trim().toLowerCase() ===
                                  (item.budgetCode || '').trim().toLowerCase()
                              )
                                ? item.budgetCode
                                : ''
                            }
                            onChange={(e) => handleItemChange(item.id, 'budgetCode', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded border border-blue-300 bg-blue-50/40 text-[#1E3A8A] text-left focus:outline-none focus:ring-1 focus:ring-[#1E3A8A]"
                            style={{ textAlign: 'left', textAlignLast: 'left' }}
                            title={`Hanya menampilkan kode finance yang terdaftar pada Program: ${
                              selectedTor?.programName || '-'
                            }`}
                          >
                            <option value="" className="text-left" style={{ textAlign: 'left' }}>
                              Pilih Kode
                            </option>
                            {programBudgetCodes.map((mc) => (
                              <option
                                key={mc.id}
                                value={mc.code}
                                className="text-left"
                                style={{ textAlign: 'left' }}
                              >
                                {mc.code} — {mc.budgetCategory}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Deskripsi Kebutuhan */}
                        <td className="py-2 px-2 border-r border-slate-200 min-w-[280px]">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                            placeholder="Pilih kode atau ketik uraian kebutuhan..."
                            className="w-full px-2.5 py-1.5 text-xs text-slate-800 font-medium rounded border border-slate-200 focus:border-[#1E3A8A] focus:outline-none"
                          />
                        </td>

                        {/* 1. Volume */}
                        <td className="py-2 px-1.5 border-r border-slate-200 w-16">
                          <input
                            type="number"
                            min="1"
                            value={item.volume === 0 ? '' : item.volume}
                            onChange={(e) => handleItemChange(item.id, 'volume', e.target.value === '' ? 0 : Number(e.target.value))}
                            placeholder="1"
                            className="w-full px-1 py-1 text-xs text-center font-mono rounded border border-slate-300 focus:outline-none"
                          />
                        </td>

                        {/* 2. Satuan (Volume) */}
                        <td className="py-2 px-1.5 border-r border-slate-200 w-20">
                          <input
                            type="text"
                            value={item.unit}
                            onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                            placeholder="Paket"
                            className="w-full px-1 py-1 text-xs text-center rounded border border-slate-300 focus:outline-none"
                          />
                        </td>

                        {/* 3. Frek. */}
                        <td className="py-2 px-1.5 border-r border-slate-200 w-16">
                          <input
                            type="number"
                            min="1"
                            value={item.frequency === 0 ? '' : item.frequency}
                            onChange={(e) => handleItemChange(item.id, 'frequency', e.target.value === '' ? 0 : Number(e.target.value))}
                            placeholder="1"
                            className="w-full px-1 py-1 text-xs text-center font-mono rounded border border-slate-300 focus:outline-none"
                          />
                        </td>

                        {/* 4. Satuan (Frekuensi) */}
                        <td className="py-2 px-1.5 border-r border-slate-200 w-20">
                          <input
                            type="text"
                            value={item.frequencyUnit || ''}
                            onChange={(e) => handleItemChange(item.id, 'frequencyUnit', e.target.value)}
                            placeholder="Hari/Kali"
                            className="w-full px-1 py-1 text-xs text-center rounded border border-slate-300 focus:outline-none"
                          />
                        </td>

                        {/* Biaya Satuan */}
                        <td className="py-2 px-2 border-r border-slate-200 w-28">
                          <input
                            type="number"
                            min="0"
                            step="1000"
                            value={item.unitPrice === 0 ? '' : item.unitPrice}
                            onChange={(e) => handleItemChange(item.id, 'unitPrice', e.target.value === '' ? 0 : Number(e.target.value))}
                            placeholder="0"
                            className="w-full px-2 py-1 text-xs text-right font-mono rounded border border-slate-300 focus:outline-none"
                          />
                        </td>

                        {/* Total Amount */}
                        <td className="py-2 px-2.5 text-right font-mono font-semibold text-xs text-slate-800 border-r border-slate-200 w-28 whitespace-nowrap">
                          {formatRupiah(item.totalAmount)}
                        </td>

                        {/* Delete Action */}
                        <td className="py-2 px-1 text-center w-10">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Hapus baris ini"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* ================= SUMMARY FOOTER ROW ================= */}
                  <tfoot>
                    <tr className="bg-[#F8FAFC] border-t-2 border-slate-300 font-semibold text-xs">
                      <td colSpan={9} className="py-2 px-3 text-right text-[11px] uppercase tracking-wider text-slate-600">
                        Total Diajukan:
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono font-bold text-xs text-[#1E3A8A] bg-blue-50/50 border-x border-slate-300 whitespace-nowrap">
                        {formatRupiah(grandTotal)}
                      </td>
                      <td className="py-2 px-1 text-center text-slate-400 text-[10px]">
                        IDR
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* ================= TERBILANG BANNER ================= */}
              <div className="p-4 bg-[#F1F5F9] border-t border-slate-200">
                <div className="text-xs">
                  <span className="font-bold text-slate-700 block text-[11px] uppercase tracking-wide">
                    Terbilang (Amount in Words):
                  </span>
                  <div className="italic text-slate-900 font-semibold mt-0.5 bg-white px-3 py-1.5 rounded border border-slate-300 shadow-2xs">
                    "{amountInWords}"
                  </div>
                </div>
              </div>
            </div>

            {/* ================= SECTION C: KETENTUAN PENGGUNAAN KASBON ================= */}
            <div className="p-4 bg-white border-t border-slate-200 text-xs space-y-2">
              <div className="font-bold text-slate-800 flex items-center gap-1.5 text-[11.5px]">
                <Info className="w-3.5 h-3.5 text-blue-600" />
                <span>Ketentuan Pertanggungjawaban Keuangan (Compliance & Guidelines):</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600 text-[11px] leading-relaxed">
                {complianceNotes.map((note, nIdx) => (
                  <li key={nIdx}>{note}</li>
                ))}
              </ul>
            </div>

            {/* ================= SECTION D: 4-COLUMN SIGNATURE GRID (EXACT LAYOUT FROM IMAGE) ================= */}
            <div className="border-t-2 border-slate-300 bg-white p-5">
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-3">
                Otorisasi & Persetujuan Dokumen (Signatures & Verification)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {/* 1. Diajukan Oleh */}
                <div className="border border-slate-300 rounded p-3 flex flex-col justify-between bg-slate-50/50">
                  <div>
                    <div className="font-bold text-slate-700 text-[11px] uppercase tracking-wide border-b border-slate-200 pb-1 mb-2">
                      1. Diajukan Oleh:
                    </div>
                    <div className="text-[11px] text-slate-500">Pemohon / PIC Kegiatan</div>
                    <div className="font-bold text-slate-800 mt-1">{requesterName}</div>
                    <div className="text-[10px] text-slate-500">{requesterRole}</div>
                  </div>
                  <div className="pt-3 border-t border-dashed border-slate-200 mt-3 text-[10px] text-slate-500 flex flex-col items-center text-center">
                    <div className="mb-1.5">
                      <ApprovalBarcodeStamp
                        compact
                        documentNumber={advanceNumber || 'CA-DRAFT'}
                        roleCode="PIC"
                        signerName={requesterName}
                        signDate={requestDate}
                        statusLabel="TELAH DIAJUKAN"
                      />
                    </div>
                    <div>Tgl: {requestDate}</div>
                  </div>
                </div>

                {/* 2. Diperiksa Oleh */}
                <div className="border border-slate-300 rounded p-3 flex flex-col justify-between bg-slate-50/50">
                  <div>
                    <div className="font-bold text-slate-700 text-[11px] uppercase tracking-wide border-b border-slate-200 pb-1 mb-2">
                      2. Diperiksa Oleh:
                    </div>
                    <div className="text-[11px] text-slate-500">Finance Specialist</div>
                    <div className="font-bold text-slate-800 mt-1">
                      {existingRecord?.signatures?.verifiedBy?.name || 'Budi Hartono, S.E.'}
                    </div>
                    <div className="text-[10px] text-slate-500">Verifikator Anggaran</div>
                  </div>
                  <div className="pt-3 border-t border-dashed border-slate-200 mt-3 text-[10px] text-slate-500 flex flex-col items-center text-center">
                    {existingRecord?.signatures?.verifiedBy?.status === 'Terverifikasi' ? (
                      <div className="mb-1.5">
                        <ApprovalBarcodeStamp
                          compact
                          documentNumber={advanceNumber || 'CA'}
                          roleCode="FIN"
                          signerName={
                            existingRecord?.signatures?.verifiedBy?.name || 'Budi Hartono, S.E.'
                          }
                          signDate={existingRecord?.signatures?.verifiedBy?.date || requestDate}
                          statusLabel="TERVERIFIKASI"
                        />
                      </div>
                    ) : (
                      <span className="inline-block mb-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-amber-100 text-amber-800">
                        {existingRecord?.signatures?.verifiedBy?.status || 'Menunggu Verifikasi'}
                      </span>
                    )}
                    <div>
                      Tgl: {existingRecord?.signatures?.verifiedBy?.date || 'Saat Verifikasi'}
                    </div>
                  </div>
                </div>

                {/* 3. Disetujui Oleh */}
                <div className="border border-slate-300 rounded p-3 flex flex-col justify-between bg-slate-50/50">
                  <div>
                    <div className="font-bold text-slate-700 text-[11px] uppercase tracking-wide border-b border-slate-200 pb-1 mb-2">
                      3. Disetujui Oleh:
                    </div>
                    <div className="text-[11px] text-slate-500">Executive Director</div>
                    <div className="font-bold text-slate-800 mt-1">
                      {existingRecord?.signatures?.approvedBy?.name || 'Dr. Hendra Wijaya'}
                    </div>
                    <div className="text-[10px] text-slate-500">Otorisasi Pencairan</div>
                  </div>
                  <div className="pt-3 border-t border-dashed border-slate-200 mt-3 text-[10px] text-slate-500 flex flex-col items-center text-center">
                    {existingRecord?.signatures?.approvedBy?.status === 'Disetujui' ? (
                      <div className="mb-1.5">
                        <ApprovalBarcodeStamp
                          compact
                          documentNumber={advanceNumber || 'CA'}
                          roleCode="DIR"
                          signerName={
                            existingRecord?.signatures?.approvedBy?.name || 'Dr. Hendra Wijaya'
                          }
                          signDate={existingRecord?.signatures?.approvedBy?.date || requestDate}
                          statusLabel="DISETUJUI"
                        />
                      </div>
                    ) : (
                      <span className="inline-block mb-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-slate-200 text-slate-700">
                        {existingRecord?.signatures?.approvedBy?.status || 'Menunggu Approval'}
                      </span>
                    )}
                    <div>Tgl: {existingRecord?.signatures?.approvedBy?.date || 'Saat Otorisasi'}</div>
                  </div>
                </div>

                {/* 4. Dicairkan Oleh */}
                <div className="border border-slate-300 rounded p-3 flex flex-col justify-between bg-slate-50/50">
                  <div>
                    <div className="font-bold text-slate-700 text-[11px] uppercase tracking-wide border-b border-slate-200 pb-1 mb-2">
                      4. Dicairkan Oleh:
                    </div>
                    <div className="text-[11px] text-slate-500">Kasir / Finance Officer</div>
                    <div className="font-bold text-slate-800 mt-1">
                      {existingRecord?.signatures?.disbursedBy?.name || 'Ratna Sari'}
                    </div>
                    <div className="text-[10px] text-slate-500">Penyalur Dana</div>
                  </div>
                  <div className="pt-3 border-t border-dashed border-slate-200 mt-3 text-[10px] text-slate-500 flex flex-col items-center text-center">
                    {existingRecord?.signatures?.disbursedBy?.isDisbursed ? (
                      <div className="mb-1.5">
                        <ApprovalBarcodeStamp
                          compact
                          documentNumber={advanceNumber || 'CA'}
                          roleCode="CSH"
                          signerName={existingRecord?.signatures?.disbursedBy?.name || 'Ratna Sari'}
                          signDate={existingRecord?.signatures?.disbursedBy?.date || requestDate}
                          statusLabel="DICAIRKAN"
                        />
                      </div>
                    ) : (
                      <span className="inline-block mb-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-slate-100 text-slate-500">
                        Belum Dicairkan
                      </span>
                    )}
                    <div>
                      Ref: {existingRecord?.signatures?.disbursedBy?.transferReference || '-'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ================= MODAL FOOTER ACTIONS ================= */}
        <div className="px-6 py-4 border-t border-[#EDEDEC] bg-[#F7F7F5] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500">
            <span>Total Pengajuan: </span>
            <strong className="text-slate-900 font-mono text-sm font-bold">
              {formatRupiah(grandTotal)}
            </strong>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer"
            >
              Batal
            </button>

            <button
              type="button"
              onClick={() => handleSave('Draft')}
              disabled={isSubmitting || isBlockedByUnreportedLimit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5 text-slate-600" />
              <span>Simpan Draf</span>
            </button>

            <button
              type="button"
              onClick={() => handleSave('Diajukan')}
              disabled={isSubmitting || isBlockedByUnreportedLimit}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#1E40AF] transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5 text-blue-200" />
              <span>{isSubmitting ? 'Memproses...' : 'Ajukan ke Finance'}</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};
