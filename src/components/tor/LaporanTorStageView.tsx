import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Printer,
  Download,
  FileText,
  RefreshCw,
  BookOpen,
  Eye,
  ExternalLink,
  X,
  CheckCircle2,
} from 'lucide-react';
import {
  Tor,
  CashAdvanceRecord,
  MeetingMinutesRecord,
  ActivityDocumentationRecord,
  MonitoringReportItem,
  MonitoringReportSections,
  MonitoringReportStatus,
  TorSpecificObjectiveItem,
  TorTimelineItem,
  TorMonitoringItem,
} from '../../types/index.js';
import { api } from '../../lib/api.js';
import { formatIndonesianDate } from '../../lib/dateUtils.js';
import { formatRupiah } from '../../lib/terbilang.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';

interface LaporanTorStageViewProps {
  tor: Tor;
  cashAdvances: CashAdvanceRecord[];
  onNavigateStage: (stageIndex: number) => void;
}

type SectionKey = keyof MonitoringReportSections;

interface CaMonitoringEntry {
  key: string;
  timelineId: string;
  stageNumber: number;
  period: string;
  activity: string;
  cashAdvanceId: string;
  cashAdvanceNumber: string;
  monitoringItems: MonitoringReportItem[];
  executiveSummaryItem: MonitoringReportItem | null;
}

const MONITORING_SECTIONS_META: {
  key: SectionKey;
  title: string;
  quote: string;
}[] = [
  {
    key: 'baseline',
    title: 'Baseline / Masalah Sebelum Intervensi',
    quote: 'Understand the challenge before seeking the solution.',
  },
  {
    key: 'intervention',
    title: 'Bagaimana Ditangani (Intervention)',
    quote: 'Every action should create value.',
  },
  {
    key: 'results',
    title: 'Hasil Setelah Ditangani / Intervensi',
    quote: 'Turning work into meaningful impact.',
  },
  {
    key: 'contextLearning',
    title: 'Context Learning',
    quote: 'Every context offers a lesson.',
  },
  {
    key: 'reflectionLearning',
    title: 'Reflection & Learning',
    quote: 'Reflect today, improve tomorrow.',
  },
  {
    key: 'keySuccessParticipation',
    title: 'Key Success Participation',
    quote: 'Identify the moments that kept participants connected.',
  },
  {
    key: 'nextImplementationProposal',
    title: 'Usulan untuk Implementasi Selanjutnya',
    quote: 'Capture the next steps for lasting impact, action completes the journey.',
  },
];

// Legal Paper Dimensions at 96 DPI:
// 8.5 in x 14 in -> 816px x 1344px
// Printable vertical height per Legal page (~1180px)
const LEGAL_PRINTABLE_PAGE_HEIGHT_PX = 1180;

function resolveActionPointStatus(ap: { status?: string; deadline?: string }): string {
  if (ap.status === 'Done' || ap.status === 'Selesai') return 'Done';
  if (ap.deadline) {
    const today = new Date().toISOString().slice(0, 10);
    if (ap.deadline < today) return 'Overdue';
  }
  return ap.status || 'Open';
}

export const LaporanTorStageView: React.FC<LaporanTorStageViewProps> = ({
  tor,
  cashAdvances,
  onNavigateStage,
}) => {
  const [notulenRecords, setNotulenRecords] = useState<MeetingMinutesRecord[]>([]);
  const [docRecords, setDocRecords] = useState<ActivityDocumentationRecord[]>([]);
  const [monitoringItems, setMonitoringItems] = useState<MonitoringReportItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [exportingDocx, setExportingDocx] = useState<boolean>(false);

  // Refs for automatic Table of Contents page calculation
  const documentContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const [tocPages, setTocPages] = useState<Record<string, number>>({
    tor: 1,
    cashAdvance: 2,
    notulen: 3,
    dokumentasi: 4,
    monitoring: 5,
  });
  const [totalPages, setTotalPages] = useState<number>(5);
  const [activePreviewSection, setActivePreviewSection] = useState<
    'tor' | 'cashAdvance' | 'notulen' | 'dokumentasi' | 'monitoring' | null
  >(null);

  const handleDownloadSectionPdf = (
    sectionKey: 'tor' | 'cashAdvance' | 'notulen' | 'dokumentasi' | 'monitoring',
    filenameLabel: string
  ) => {
    setActivePreviewSection(sectionKey);
    setTimeout(() => {
      const targetEl = sectionRefs.current[sectionKey] || documentContainerRef.current;
      downloadElementAsPdf({
        element: targetEl,
        filename: `${filenameLabel}_${tor.torNumber}`,
        paperFormat: 'legal',
      });
    }, 180);
  };

  const loadAllSources = useCallback(async () => {
    setLoading(true);
    try {
      const [notulens, docsList, singleDoc, monRes] = await Promise.all([
        api.getMeetingMinutes(tor.id).catch(() => []),
        api.getDocumentationList(tor.id).catch(() => []),
        api.getDocumentation(tor.id).catch(() => null),
        api.getMonitoringReports(tor.id).catch(() => ({ items: [] as MonitoringReportItem[] })),
      ]);

      setNotulenRecords(Array.isArray(notulens) ? notulens : []);

      if (Array.isArray(docsList) && docsList.length > 0) {
        setDocRecords(docsList);
      } else if (singleDoc && singleDoc.id) {
        setDocRecords([singleDoc]);
      } else {
        setDocRecords([]);
      }

      setMonitoringItems(Array.isArray(monRes?.items) ? monRes.items : []);
    } finally {
      setLoading(false);
    }
  }, [tor.id]);

  useEffect(() => {
    loadAllSources();
  }, [loadAllSources]);

  // Active Cash Advances for this TOR
  const activeCashAdvances = useMemo(() => {
    return (cashAdvances || []).filter(
      (ca) => ca.torId === tor.id && ca.status !== 'Ditolak'
    );
  }, [cashAdvances, tor.id]);

  // Stage 06 Monitoring Implementation Entries — identical to MonitoringStageView.tsx
  const implementationEntries = useMemo<CaMonitoringEntry[]>(() => {
    const timelineItems = Array.isArray(tor.timelineItems) ? tor.timelineItems : [];
    const result: CaMonitoringEntry[] = [];

    timelineItems.forEach((tl, idx) => {
      if (!tl) return;
      const connectedCas = activeCashAdvances.filter((ca) => {
        if (ca.implementationMode === 'all') return true;
        if (
          Array.isArray(ca.implementationTimelineIds) &&
          ca.implementationTimelineIds.includes(tl.id)
        ) {
          return true;
        }
        if (Array.isArray(ca.items) && ca.items.some((it) => it?.timelineItemId === tl.id)) {
          return true;
        }
        return false;
      });

      connectedCas.forEach((ca) => {
        const key = `${ca.id}__${tl.id}`;
        const allMatched = monitoringItems.filter(
          (m) =>
            m.cashAdvanceId === ca.id &&
            (m.timelineItemId === tl.id || (!m.timelineItemId && result.length === 0))
        );
        const toolItems = allMatched.filter((m) => m.toolId !== 'EXEC-SUMMARY');
        const execItem = allMatched.find((m) => m.toolId === 'EXEC-SUMMARY') || null;

        result.push({
          key,
          timelineId: tl.id,
          stageNumber: idx + 1,
          period: tl.period || '-',
          activity: tl.activity,
          cashAdvanceId: ca.id,
          cashAdvanceNumber: ca.advanceNumber,
          monitoringItems: toolItems,
          executiveSummaryItem: execItem,
        });
      });
    });

    if (result.length === 0 && activeCashAdvances.length > 0) {
      activeCashAdvances.forEach((ca, idx) => {
        const key = `${ca.id}__ca-tl-${ca.id}`;
        const allMatched = monitoringItems.filter((m) => m.cashAdvanceId === ca.id);
        const toolItems = allMatched.filter((m) => m.toolId !== 'EXEC-SUMMARY');
        const execItem = allMatched.find((m) => m.toolId === 'EXEC-SUMMARY') || null;
        result.push({
          key,
          timelineId: `ca-tl-${ca.id}`,
          stageNumber: idx + 1,
          period: ca.activityStartDate
            ? formatIndonesianDate(ca.activityStartDate)
            : tor.startDate || '-',
          activity: ca.implementationTimelineSummary || ca.activityTitle || tor.activityName,
          cashAdvanceId: ca.id,
          cashAdvanceNumber: ca.advanceNumber,
          monitoringItems: toolItems,
          executiveSummaryItem: execItem,
        });
      });
    }

    return result;
  }, [activeCashAdvances, tor.timelineItems, tor.startDate, tor.activityName, monitoringItems]);

  const resolveCaRequesterName = useCallback(
    (cashAdvanceId?: string, fallbackName?: string): string => {
      const matchedCa = activeCashAdvances.find((c) => c.id === cashAdvanceId);
      return (
        matchedCa?.requesterName ||
        matchedCa?.signatures?.requestedBy?.name ||
        fallbackName ||
        tor.picName ||
        '-'
      );
    },
    [activeCashAdvances, tor.picName]
  );

  // Recalculate automatic page numbers based on actual DOM layout
  const recalculatePageNumbers = useCallback(() => {
    const container = documentContainerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const nextPages: Record<string, number> = {};

    (['tor', 'cashAdvance', 'notulen', 'dokumentasi', 'monitoring'] as const).forEach((key) => {
      const el = sectionRefs.current[key];
      if (el) {
        const elRect = el.getBoundingClientRect();
        const offsetTop = Math.max(0, elRect.top - containerRect.top);
        const pageNum = Math.floor(offsetTop / LEGAL_PRINTABLE_PAGE_HEIGHT_PX) + 1;
        nextPages[key] = Math.max(1, pageNum);
      } else {
        nextPages[key] = 1;
      }
    });

    const totalHeight =
      container.scrollHeight || containerRect.height || LEGAL_PRINTABLE_PAGE_HEIGHT_PX;
    const computedTotal = Math.max(
      1,
      Math.ceil(totalHeight / LEGAL_PRINTABLE_PAGE_HEIGHT_PX),
      ...Object.values(nextPages)
    );

    setTocPages(nextPages);
    setTotalPages(computedTotal);
  }, []);

  useEffect(() => {
    const timer = setTimeout(recalculatePageNumbers, 120);
    window.addEventListener('resize', recalculatePageNumbers);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', recalculatePageNumbers);
    };
  }, [
    recalculatePageNumbers,
    notulenRecords,
    docRecords,
    implementationEntries,
    activeCashAdvances,
    loading,
  ]);

  // ============================================================================
  // STAGE 01 (TOR PREVIEW) DERIVED DATA — IDENTICAL TO TorDetailView.tsx
  // ============================================================================
  const complementaryObjectives: TorSpecificObjectiveItem[] = useMemo(() => {
    const hasForeign = tor.specificObjectives?.some((s) =>
      /PIPKA|GKMI|masker KN95/i.test(s.objective || '')
    );
    if (tor.specificObjectives && tor.specificObjectives.length > 0 && !hasForeign) {
      return tor.specificObjectives;
    }
    if (tor.goals && tor.goals.length > 0) {
      return tor.goals.map((g, i) => ({
        id: g.id || `so-${i + 1}`,
        objective: g.goal,
        expectedResult: g.indicator || g.mov || '',
        expectedChange: '',
      }));
    }
    return [];
  }, [tor]);

  const complementaryTimeline: TorTimelineItem[] = useMemo(() => {
    const hasForeign = tor.timelineItems?.some((t) =>
      /PIPKA|GKMI|masker KN95/i.test(t.activity || '')
    );
    if (tor.timelineItems && tor.timelineItems.length > 0 && !hasForeign) {
      return tor.timelineItems;
    }
    return [];
  }, [tor]);

  const complementaryMonitoring: TorMonitoringItem[] = useMemo(() => {
    const hasForeign = tor.monitoringItems?.some((m) =>
      /PIPKA|GKMI|masker KN95/i.test(m.method || '')
    );
    if (tor.monitoringItems && tor.monitoringItems.length > 0 && !hasForeign) {
      return tor.monitoringItems;
    }
    return [];
  }, [tor]);

  const complementaryScope: string[] = useMemo(() => {
    const hasForeign = tor.scopeOfActivities?.some((s) =>
      /PIPKA|GKMI|masker KN95/i.test(s || '')
    );
    if (tor.scopeOfActivities && tor.scopeOfActivities.length > 0 && !hasForeign) {
      return tor.scopeOfActivities;
    }
    return [];
  }, [tor]);

  const complementaryMechanisms: string[] = useMemo(() => {
    const hasForeign = tor.implementationMechanisms?.some((m) =>
      /PIPKA|GKMI|masker KN95/i.test(m || '')
    );
    if (
      tor.implementationMechanisms &&
      tor.implementationMechanisms.length > 0 &&
      !hasForeign
    ) {
      return tor.implementationMechanisms;
    }
    return [];
  }, [tor]);

  const complementaryOrganizerInfo = useMemo(() => {
    const hasForeign = /PIPKA|GKMI|air purifier/i.test(tor.organizerPersonInCharge || '');
    if (tor.organizerPersonInCharge && tor.organizerPersonInCharge.trim() && !hasForeign) {
      return tor.organizerPersonInCharge;
    }
    const lines: string[] = [
      `Penyelenggara: Yayasan WIJNA (${tor.programName || 'Program Lapangan WIJNA'})`,
      `PIC Utama Kegiatan: ${tor.picName || 'Budi Santoso'}`,
      `Pembuat Dokumen TOR: ${tor.createdByName || tor.picName || 'Budi Santoso'} (${tor.createdByRole || 'Staff'})`,
    ];
    if (tor.implementingTeam && tor.implementingTeam.length > 0) {
      lines.push(`Tim Pelaksana: ${tor.implementingTeam.join(', ')}`);
    }
    if (tor.rolesResponsibilities && tor.rolesResponsibilities.length > 0) {
      lines.push('Pembagian Peran Tim:');
      tor.rolesResponsibilities.forEach((r, idx) => {
        const personLabel =
          r.nameInstitution || (r.institution ? `${r.picName} — ${r.institution}` : r.picName);
        lines.push(`  ${idx + 1}. ${personLabel} (${r.role})`);
      });
    }
    return lines.join('\n');
  }, [tor]);

  const participantRowsData =
    tor.participantRows && tor.participantRows.length > 0 ? tor.participantRows : [];

  const participantColumns =
    tor.participantCustomColumns && tor.participantCustomColumns.length > 0
      ? tor.participantCustomColumns
      : [
          { id: 'col-target', label: 'Target Peserta', type: 'text' as const },
          { id: 'col-male', label: 'Est. Laki-laki', type: 'number' as const },
          { id: 'col-female', label: 'Est. Perempuan', type: 'number' as const },
          { id: 'col-note', label: 'Keterangan', type: 'text' as const },
        ];

  const rolesData =
    tor.rolesResponsibilities && tor.rolesResponsibilities.length > 0
      ? tor.rolesResponsibilities
      : [];

  const rundownData = tor.rundown && tor.rundown.length > 0 ? tor.rundown : [];

  const activityCodeDisplay = useMemo(() => {
    const codeStr = tor.activityCode || tor.hierarchyCode || '1.1.1';
    const firstNum = codeStr.split('.')[0] || '1';
    return `Outcome ${firstNum} ; Activity ${codeStr}`;
  }, [tor.activityCode, tor.hierarchyCode]);

  const totalCaRequested = useMemo(
    () => activeCashAdvances.reduce((sum, c) => sum + (Number(c.totalAmount) || 0), 0),
    [activeCashAdvances]
  );

  const effectiveBudgetRequested =
    activeCashAdvances.length > 0 ? totalCaRequested : tor.budgetRequested;

  const compactBudget =
    effectiveBudgetRequested != null && !isNaN(Number(effectiveBudgetRequested))
      ? `Rp${Number(effectiveBudgetRequested).toLocaleString('id-ID')}`
      : 'Data belum tersedia';

  const scrollToSection = (sectionKey: string) => {
    const el = sectionRefs.current[sectionKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Export DOCX (Legal size 8.5 x 14 inches) using the rendered Legal sheet HTML
  const handleExportDocx = () => {
    setExportingDocx(true);
    try {
      const sheetHtml = documentContainerRef.current?.innerHTML || '';
      const htmlContent = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
          <meta charset="utf-8">
          <title>Laporan_Kontribusi_${tor.torNumber}</title>
          <style>
            @page {
              size: 8.5in 14in;
              margin: 0.7in 0.7in;
            }
            body {
              font-family: "Times New Roman", Times, serif;
              font-size: 11.5pt;
              color: #000000;
              line-height: 1.38;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
            }
            td, th {
              border: 1px solid #000000;
              padding: 5px 8px;
              vertical-align: top;
              font-size: 11pt;
            }
          </style>
        </head>
        <body>
          ${sheetHtml}
        </body>
        </html>
      `;

      const blob = new Blob(['\ufeff', htmlContent], {
        type: 'application/msword',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_Kontribusi_${tor.torNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.doc`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingDocx(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Legal Page Print Rules */}
      <style>{`
        @media print {
          @page {
            size: 8.5in 14in;
            margin: 0.65in 0.7in;
          }
          body {
            background: #ffffff !important;
          }
          .laporan-kontribusi-legal-sheet {
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
        }
      `}</style>

      {/* Top Header: 07. Laporan TOR — Daftar Link Preview & Download Tahapan */}
      <div className="bg-white rounded-lg border border-stone-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1D4ED8]">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-stone-900">
                07. Laporan TOR — Daftar Link Preview Tahapan Kegiatan
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-blue-50 text-[#1D4ED8] rounded border border-blue-200">
                {tor.torNumber}
              </span>
            </div>
            <p className="text-xs text-stone-500">
              Daftar link sederhana untuk melihat <strong>Preview</strong> dan <strong>Download PDF</strong> dari tahapan-tahapan yang ada pada TOR ini.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadAllSources}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sinkronkan Data</span>
          </button>
        </div>
      </div>

      {/* SIMPLE LIST OF STAGE PREVIEW LINKS WITH PREVIEW & DOWNLOAD BUTTONS (Gambar 3 & 4 replacement) */}
      <div className="bg-white rounded-lg border border-stone-200 overflow-hidden print:hidden">
        <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-200 flex items-center justify-between text-xs font-bold text-stone-700">
          <span>Daftar Link Preview dari Tahapan-Tahapan yang Ada</span>
          <span className="text-[11px] font-normal text-stone-500">
            Klik link atau tombol untuk Preview maupun Download dokumen per tahap
          </span>
        </div>

        <div className="divide-y divide-stone-200 text-xs">
          {[
            {
              stageNum: '01',
              stageIndex: 1,
              sectionKey: 'tor' as const,
              title: 'Tahap 01 — Term of Reference (ToR)',
              subtitle: `${tor.torNumber} · ${tor.title}`,
              countLabel: '1 Dokumen ToR',
              isAvailable: true,
              subLinks: [
                {
                  id: tor.id,
                  label: `${tor.torNumber} — ${tor.title}`,
                  meta: `Status: ${tor.submissionStatus}`,
                },
              ],
            },
            {
              stageNum: '02',
              stageIndex: 2,
              sectionKey: 'cashAdvance' as const,
              title: 'Tahap 02 — Cash Advance (Uang Muka Operasional)',
              subtitle:
                activeCashAdvances.length > 0
                  ? `${activeCashAdvances.length} dokumen pengajuan uang muka`
                  : 'Belum ada dokumen Cash Advance',
              countLabel: `${activeCashAdvances.length} Dokumen`,
              isAvailable: activeCashAdvances.length > 0,
              subLinks: activeCashAdvances.map((ca) => ({
                id: ca.id,
                label: `${ca.advanceNumber} — ${ca.activityTitle || tor.title}`,
                meta: `${formatRupiah(ca.totalAmount)} · ${ca.status}`,
              })),
            },
            {
              stageNum: '03',
              stageIndex: 3,
              sectionKey: null,
              title: 'Tahap 03 — Ringkasan Cash Advance & Tutup Laporan',
              subtitle: `Rekapitulasi realisasi anggaran per Implementation Timeline (${
                activeCashAdvances.filter((c) => c.isReported).length
              }/${activeCashAdvances.length} dilaporkan)`,
              countLabel: `${activeCashAdvances.filter((c) => c.isReported).length}/${activeCashAdvances.length} CA Dilaporkan`,
              isAvailable: activeCashAdvances.length > 0,
              subLinks: [],
            },
            {
              stageNum: '04',
              stageIndex: 4,
              sectionKey: 'notulen' as const,
              title: 'Tahap 04 — Notulen Rapat / Meeting Minutes',
              subtitle:
                notulenRecords.length > 0
                  ? `${notulenRecords.length} dokumen notulen kegiatan tercatat`
                  : 'Belum ada dokumen Notulen',
              countLabel: `${notulenRecords.length} Dokumen`,
              isAvailable: notulenRecords.length > 0,
              subLinks: notulenRecords.map((m, idx) => ({
                id: m.id || `not-${idx}`,
                label: `${m.documentNumber || `Notulen #${idx + 1}`} — ${m.title || tor.title}`,
                meta: `${formatIndonesianDate(m.meetingDate)} · ${m.meetingLocation || tor.location || '-'}`,
              })),
            },
            {
              stageNum: '05',
              stageIndex: 5,
              sectionKey: 'dokumentasi' as const,
              title: 'Tahap 05 — Dokumentasi Kegiatan',
              subtitle:
                docRecords.length > 0
                  ? `${docRecords.length} paket dokumentasi (Five Best Photos, HIS & General Link)`
                  : 'Belum ada paket Dokumentasi',
              countLabel: `${docRecords.length} Dokumen`,
              isAvailable: docRecords.length > 0,
              subLinks: docRecords.map((d, idx) => ({
                id: d.id || `doc-${idx}`,
                label: `${d.documentNumber || `Dokumentasi #${idx + 1}`} — ${d.activityTitle || tor.title}`,
                meta: `${formatIndonesianDate(d.updatedAt || tor.startDate)} · ${tor.location || '-'}`,
              })),
            },
            {
              stageNum: '06',
              stageIndex: 6,
              sectionKey: 'monitoring' as const,
              title: 'Tahap 06 — Monitoring Kegiatan & Evidence',
              subtitle:
                implementationEntries.length > 0
                  ? `${implementationEntries.length} tahapan implementasi termonitor`
                  : 'Belum ada laporan Monitoring',
              countLabel: `${implementationEntries.length} Implementasi`,
              isAvailable: implementationEntries.length > 0,
              subLinks: implementationEntries.map((ent) => ({
                id: ent.key,
                label: `Tahap ${ent.stageNumber}: ${ent.activity}`,
                meta: `Ref CA: ${ent.cashAdvanceNumber} · ${ent.period}`,
              })),
            },
            {
              stageNum: '08',
              stageIndex: 8,
              sectionKey: null,
              title: 'Tahap 08 — Laporan Keuangan Akhir',
              subtitle: `Akumulasi kode budget & penutupan laporan keuangan akhir (${tor.torNumber})`,
              countLabel: activeCashAdvances.length > 0 ? 'Tersedia' : 'Menunggu CA',
              isAvailable: activeCashAdvances.length > 0,
              subLinks: [],
            },
          ].map((row) => (
            <div
              key={row.stageNum}
              className="px-4 py-3 hover:bg-stone-50/80 transition-colors flex flex-col gap-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-[#1E3A8A]/10 text-[#1E3A8A] font-mono font-bold text-xs shrink-0 mt-0.5">
                    {row.stageNum}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          row.sectionKey
                            ? setActivePreviewSection(row.sectionKey)
                            : onNavigateStage(row.stageIndex)
                        }
                        className="font-bold text-[#1D4ED8] hover:underline text-left cursor-pointer inline-flex items-center gap-1"
                      >
                        <span>{row.title}</span>
                        <ExternalLink className="w-3 h-3 opacity-75" />
                      </button>
                      <span
                        className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border ${
                          row.isAvailable
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-stone-100 text-stone-500 border-stone-200'
                        }`}
                      >
                        {row.countLabel}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-stone-600 mt-0.5 truncate">
                      {row.subtitle}
                    </div>
                  </div>
                </div>

                {/* Action Buttons: Preview & Download */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      row.sectionKey
                        ? setActivePreviewSection(row.sectionKey)
                        : onNavigateStage(row.stageIndex)
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-blue-200 bg-blue-50/70 hover:bg-blue-100/80 text-[#1D4ED8] font-semibold text-xs transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (row.sectionKey) {
                        handleDownloadSectionPdf(row.sectionKey, `Tahap_${row.stageNum}`);
                      } else {
                        onNavigateStage(row.stageIndex);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigateStage(row.stageIndex)}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-stone-200 bg-white hover:bg-stone-100 text-stone-600 text-[11px] font-medium transition-colors cursor-pointer"
                    title={`Buka Halaman Tahap ${row.stageNum}`}
                  >
                    <span>Buka Tahap</span>
                  </button>
                </div>
              </div>

              {/* Sub-list of document links inside this stage */}
              {row.subLinks.length > 0 && (
                <div className="pl-10 space-y-1">
                  {row.subLinks.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1 rounded bg-stone-50 border border-stone-200/80 text-[11px]"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          row.sectionKey
                            ? setActivePreviewSection(row.sectionKey)
                            : onNavigateStage(row.stageIndex)
                        }
                        className="font-medium text-[#1D4ED8] hover:underline text-left truncate cursor-pointer"
                      >
                        • {sub.label}
                      </button>
                      <span className="text-stone-500 font-mono text-[10.5px] shrink-0">
                        {sub.meta}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MODAL PREVIEW DOKUMEN PER TAHAP (HANYA MUNCUL JIKA KLIK PREVIEW)     */}
      {/* ==================================================================== */}
      <div
        className={
          activePreviewSection
            ? 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-2xs flex flex-col items-center justify-start p-3 sm:p-5 overflow-y-auto'
            : 'hidden print:block'
        }
      >
        {activePreviewSection && (
          <div className="w-full max-w-[8.8in] bg-slate-900 text-white rounded-t-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-10 print:hidden">
            <div className="flex items-center gap-2 text-xs font-bold">
              <Eye className="w-4 h-4 text-sky-400" />
              <span>
                Preview Dokumen —{' '}
                {activePreviewSection === 'tor'
                  ? 'Tahap 01: Term of Reference (ToR)'
                  : activePreviewSection === 'cashAdvance'
                  ? 'Tahap 02: Cash Advance'
                  : activePreviewSection === 'notulen'
                  ? 'Tahap 04: Notulen Rapat'
                  : activePreviewSection === 'dokumentasi'
                  ? 'Tahap 05: Dokumentasi Kegiatan'
                  : 'Tahap 06: Monitoring Kegiatan'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleDownloadSectionPdf(
                    activePreviewSection,
                    `Preview_${activePreviewSection.toUpperCase()}`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setActivePreviewSection(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Tutup Preview</span>
              </button>
            </div>
          </div>
        )}
        <article
          ref={documentContainerRef}
          className="laporan-kontribusi-legal-sheet tor-formal-print-sheet bg-white border border-stone-400 shadow-md text-[14px] leading-[1.38] text-black w-full max-w-[8.5in] px-8 py-8 sm:px-[0.75in] sm:py-[0.65in] space-y-8"
          style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
        >
          {/* ================================================================ */}
          {/* TAHAP 01: PREVIEW TERM OF REFERENCE (SAMA PERSIS DENGAN TAHAP 1) */}
          {/* ================================================================ */}
          <section
            ref={(el) => {
              sectionRefs.current.tor = el;
            }}
            className={
              !activePreviewSection || activePreviewSection === 'tor'
                ? 'space-y-5'
                : 'hidden'
            }
          >
            <div className="flex items-center justify-between border-b border-black pb-1">
              <span className="text-[12px] font-bold uppercase tracking-wider text-black">
                PREVIEW TAHAP 01: TERM OF REFERENCE (ToR)
              </span>
              <span className="text-[12px] font-bold text-black">
                Halaman {tocPages.tor || 1}
              </span>
            </div>

            <h1 className="text-center font-bold uppercase text-[15px] tracking-normal mb-2 text-black">
              TERM OF REFERENCE
            </h1>

            {/* Project Information */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Project Information
              </div>
              <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                <tbody>
                  <tr>
                    <td className="w-[26%] border border-black px-2.5 py-1 font-bold align-top">
                      Event Name
                    </td>
                    <td className="w-[74%] border border-black px-2.5 py-1 align-top">
                      {tor.title}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      Activity Code
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {activityCodeDisplay}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      TOR Code
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {tor.torNumber}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      Organizer &amp; Person in Charge
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top whitespace-pre-wrap leading-[1.38]">
                      {complementaryOrganizerInfo}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      Start date
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {formatIndonesianDate(tor.startDate)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      End date
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {formatIndonesianDate(tor.endDate)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      Report date
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {formatIndonesianDate(tor.reportingDeadline)}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      Location
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {tor.location || 'Data belum tersedia'}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      Budget request USD/IDR
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {compactBudget}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Background & Objectives */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Background
              </div>
              <div className="space-y-2.5 text-black">
                {tor.background ? (
                  tor.background.split(/\n\s*\n/).map((para, idx) => (
                    <p key={idx} className="whitespace-pre-line leading-[1.38]">
                      {para.trim()}
                    </p>
                  ))
                ) : (
                  <p className="italic">Data Background belum tersedia pada ToR.</p>
                )}
                {tor.rationale && (
                  <p className="whitespace-pre-line leading-[1.38]">{tor.rationale.trim()}</p>
                )}
              </div>

              {/* Tujuan Umum */}
              <div className="mt-3">
                <div className="font-bold text-black">Tujuan Umum</div>
                {tor.generalObjective || tor.objectives ? (
                  <p className="text-black leading-[1.38] whitespace-pre-line">
                    {tor.generalObjective || tor.objectives}
                  </p>
                ) : (
                  <p className="italic">Data Tujuan Umum belum tersedia pada ToR.</p>
                )}
              </div>

              {/* Tujuan Khusus */}
              <div className="mt-2.5">
                <div className="font-bold text-black">Tujuan Khusus</div>
                {complementaryObjectives.length === 0 ? (
                  <p className="italic mt-1">Data Tujuan Khusus belum tersedia pada ToR.</p>
                ) : (
                  <>
                    <ol className="list-decimal pl-8 space-y-1 text-black leading-[1.38] mt-0.5">
                      {complementaryObjectives.map((item) => (
                        <li key={item.id} className="pl-1">
                          {item.objective}
                        </li>
                      ))}
                    </ol>

                    <table className="w-full text-left border-collapse border border-black text-[14px] text-black mt-3">
                      <thead>
                        <tr>
                          <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                            Tujuan Khusus
                          </th>
                          <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                            Hasil yang Diharapkan
                          </th>
                          <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                            Perubahan yang Diharapkan
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {complementaryObjectives.map((item, idx) => (
                          <tr key={item.id} className="align-top">
                            <td className="border border-black px-2.5 py-1 leading-[1.38]">
                              {idx + 1}. {item.objective}
                            </td>
                            <td className="border border-black px-2.5 py-1 leading-[1.38] whitespace-pre-line">
                              {item.expectedResult || 'Data belum tersedia'}
                            </td>
                            <td className="border border-black px-2.5 py-1 leading-[1.38] whitespace-pre-line">
                              {item.expectedChange || 'Data belum tersedia'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>

            {/* Implementation Timeline */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Implementation Timeline
              </div>
              {complementaryTimeline.length === 0 ? (
                <p className="italic">Data Implementation Timeline belum tersedia pada ToR.</p>
              ) : (
                <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                  <thead>
                    <tr>
                      <th className="w-[28%] border border-black px-2.5 py-1 font-bold">Period</th>
                      <th className="w-[72%] border border-black px-2.5 py-1 font-bold">
                        Activity
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {complementaryTimeline.map((item) => (
                      <tr key={item.id} className="align-top">
                        <td className="border border-black px-2.5 py-1">{item.period}</td>
                        <td className="border border-black px-2.5 py-1 leading-[1.38]">
                          {item.activity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Monitoring Mechanism */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Monitoring Mechanism
              </div>
              {complementaryMonitoring.length === 0 ? (
                <p className="italic">Data Monitoring Mechanism belum tersedia pada ToR.</p>
              ) : (
                <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                  <thead>
                    <tr>
                      <th className="w-[22%] border border-black px-2.5 py-1 font-bold">Aspect</th>
                      <th className="w-[40%] border border-black px-2.5 py-1 font-bold">Method</th>
                      <th className="w-[20%] border border-black px-2.5 py-1 font-bold">
                        Frequency
                      </th>
                      <th className="w-[18%] border border-black px-2.5 py-1 font-bold">PIC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complementaryMonitoring.map((item) => (
                      <tr key={item.id} className="align-top">
                        <td className="border border-black px-2.5 py-1 leading-[1.38]">
                          {item.aspect}
                        </td>
                        <td className="border border-black px-2.5 py-1 leading-[1.38]">
                          {item.method}
                        </td>
                        <td className="border border-black px-2.5 py-1 leading-[1.38]">
                          {item.frequency}
                        </td>
                        <td className="border border-black px-2.5 py-1 leading-[1.38]">
                          {item.pic}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Scope of Activities */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Scope of Activities
              </div>
              {complementaryScope.length === 0 ? (
                <p className="italic">Data Scope of Activities belum tersedia pada ToR.</p>
              ) : (
                <ul className="list-disc pl-8 space-y-1 text-black leading-[1.38]">
                  {complementaryScope.map((point, idx) => (
                    <li key={idx} className="pl-1">
                      {point}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Mekanisme Pelaksanaan */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Mekanisme Pelaksanaan
              </div>
              {complementaryMechanisms.length === 0 ? (
                <p className="italic">Data Mekanisme Pelaksanaan belum tersedia pada ToR.</p>
              ) : (
                <ul className="list-disc pl-8 space-y-1 text-black leading-[1.38]">
                  {complementaryMechanisms.map((mech, idx) => {
                    const periodIdx = mech.indexOf('.');
                    const hasBoldPrefix = periodIdx > 0 && periodIdx < 45;
                    const prefix = hasBoldPrefix ? mech.substring(0, periodIdx + 1) : '';
                    const body = hasBoldPrefix ? mech.substring(periodIdx + 1) : mech;
                    return (
                      <li key={idx} className="pl-1">
                        {hasBoldPrefix ? (
                          <>
                            <strong className="font-bold text-black">{prefix}</strong>
                            {body}
                          </>
                        ) : (
                          mech
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Peserta Kegiatan */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Peserta Kegiatan ({tor.participantType || tor.participantsType || 'Umum'})
              </div>
              {participantRowsData.length === 0 ? (
                <div className="space-y-1">
                  {tor.participantsTarget ? (
                    <div>
                      <strong>Target Peserta:</strong> {tor.participantsTarget}{' '}
                      {tor.participantsCount != null ? `(${tor.participantsCount} Org)` : ''}
                    </div>
                  ) : (
                    <p className="italic">Data Tabel Peserta Kegiatan belum tersedia pada ToR.</p>
                  )}
                </div>
              ) : (
                <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                  <thead>
                    <tr>
                      <th className="w-10 border border-black px-2 py-1 text-center font-bold">
                        No
                      </th>
                      {participantColumns.map((col) => (
                        <th
                          key={col.id}
                          className={`border border-black px-2.5 py-1 font-bold ${
                            col.type === 'number' ? 'text-center w-32' : 'text-left'
                          }`}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {participantRowsData.map((row: any, idx: number) => (
                      <tr key={row.id || idx} className="align-top">
                        <td className="border border-black px-2 py-1 text-center">{idx + 1}</td>
                        {participantColumns.map((col) => {
                          let val = row.customValues?.[col.id];
                          if (val === undefined || val === '') {
                            if (col.id === 'col-target') val = row.target;
                            else if (col.id === 'col-male')
                              val = row.maleCount != null ? String(row.maleCount) : '';
                            else if (col.id === 'col-female')
                              val = row.femaleCount != null ? String(row.femaleCount) : '';
                            else if (col.id === 'col-note') val = row.note;
                          }
                          return (
                            <td
                              key={col.id}
                              className={`border border-black px-2.5 py-1 ${
                                col.type === 'number' ? 'text-center' : 'leading-[1.38]'
                              }`}
                            >
                              {val !== undefined && val !== ''
                                ? col.type === 'number'
                                  ? `${val} Org`
                                  : val
                                : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  {participantColumns.some((c) => c.type === 'number') && (
                    <tfoot>
                      <tr className="font-bold">
                        <td className="border border-black px-2 py-1 text-center">Σ</td>
                        {participantColumns.map((col, cIdx) => {
                          if (col.type === 'number') {
                            const total = participantRowsData.reduce((sum: number, r: any) => {
                              const raw =
                                r.customValues?.[col.id] ??
                                (col.id === 'col-male'
                                  ? r.maleCount
                                  : col.id === 'col-female'
                                  ? r.femaleCount
                                  : 0);
                              const n = Number(raw);
                              return sum + (isNaN(n) ? 0 : n);
                            }, 0);
                            return (
                              <td
                                key={col.id}
                                className="border border-black px-2.5 py-1 text-center font-bold"
                              >
                                {total} Org
                              </td>
                            );
                          }
                          return (
                            <td key={col.id} className="border border-black px-2.5 py-1">
                              {cIdx === 0 ? 'Total Estimasi Peserta:' : ''}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
              {tor.participantsCriteria && (
                <div className="mt-1.5 text-black">
                  <strong>Kriteria Peserta:</strong> {tor.participantsCriteria}
                </div>
              )}
            </div>

            {/* Role & Responsibility */}
            <div>
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Role &amp; Responsibility
              </div>
              {rolesData.length === 0 ? (
                <p className="italic">Data Role &amp; Responsibility belum tersedia pada ToR.</p>
              ) : (
                <table className="w-full text-left border-collapse border border-black text-[14px] text-black">
                  <thead>
                    <tr>
                      <th className="w-1/3 border border-black px-2.5 py-1 font-bold">
                        Nama - Lembaga
                      </th>
                      <th className="w-1/4 border border-black px-2.5 py-1 font-bold">
                        Role (Peran Kegiatan)
                      </th>
                      <th className="border border-black px-2.5 py-1 font-bold">
                        Responsibility (Tanggung Jawab &amp; Tugas)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolesData.map((r: any, idx: number) => (
                      <tr key={r.id || idx} className="align-top">
                        <td className="border border-black px-2.5 py-1">
                          {r.nameInstitution ||
                            (r.institution ? `${r.picName} — ${r.institution}` : r.picName)}
                        </td>
                        <td className="border border-black px-2.5 py-1">{r.role}</td>
                        <td className="border border-black px-2.5 py-1 leading-[1.38]">
                          {r.responsibilities}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(tor.rolesNotes || tor.rolesAdditionalNotes) && (
                <div className="mt-1.5 text-black">
                  <strong>Catatan Tim Pelaksana:</strong>{' '}
                  {tor.rolesNotes || tor.rolesAdditionalNotes}
                </div>
              )}
            </div>

            {/* Rundown Kegiatan */}
            {tor.isRundownVisible !== false && rundownData.length > 0 && (
              <div>
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  Rundown Kegiatan (Opsional)
                </div>
                <div className="space-y-3">
                  {(() => {
                    const timelineList = tor.timelineItems || [];
                    const groups: {
                      key: string;
                      timelineLabel: string;
                      items: { rd: any; originalIdx: number }[];
                    }[] = [];

                    rundownData.forEach((rd: any, idx: number) => {
                      const matchedTl = rd.timelineId
                        ? timelineList.find((t: any) => t.id === rd.timelineId)
                        : timelineList.find((t: any) => rd.date?.includes(t.period)) ||
                          timelineList[idx];
                      const resolvedKey =
                        rd.timelineId ||
                        rd.timelineLabel ||
                        matchedTl?.id ||
                        `group-${idx}`;
                      const resolvedLabel =
                        rd.timelineLabel ||
                        (matchedTl
                          ? `${matchedTl.period} — ${matchedTl.activity}`
                          : rd.date || `Bagian Rundown ${idx + 1}`);

                      const existing = groups.find((g) => g.key === resolvedKey);
                      if (existing) {
                        existing.items.push({ rd, originalIdx: idx });
                      } else {
                        groups.push({
                          key: resolvedKey,
                          timelineLabel: resolvedLabel,
                          items: [{ rd, originalIdx: idx }],
                        });
                      }
                    });

                    return groups.map((group) => (
                      <div key={group.key} className="border border-black break-inside-avoid">
                        <div
                          className="bg-[#EFEFEF] border-b border-black px-2.5 py-1.5 text-[13px] text-black"
                          style={{
                            WebkitPrintColorAdjust: 'exact',
                            printColorAdjust: 'exact',
                          }}
                        >
                          <span className="font-bold">{group.timelineLabel}</span>
                        </div>
                        <table className="w-full table-fixed text-left border-collapse text-[14px] text-black">
                          <thead>
                            <tr>
                              <th className="w-[15%] border-b border-r border-black px-2.5 py-1 font-bold">
                                Tanggal / Hari
                              </th>
                              <th className="w-[12%] border-b border-r border-black px-2.5 py-1 font-bold">
                                Waktu
                              </th>
                              <th className="w-[27%] border-b border-r border-black px-2.5 py-1 font-bold">
                                Agenda Kegiatan
                              </th>
                              <th className="w-[20%] border-b border-r border-black px-2.5 py-1 font-bold">
                                Target Peserta
                              </th>
                              <th className="w-[14%] border-b border-r border-black px-2.5 py-1 font-bold">
                                Tempat
                              </th>
                              <th className="w-[12%] border-b border-black px-2.5 py-1 font-bold">
                                PIC
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map(({ rd, originalIdx }, itemIdx) => {
                              const isLastRow = itemIdx === group.items.length - 1;
                              const rowBorder = isLastRow ? '' : 'border-b border-black';
                              return (
                                <tr key={rd.id || originalIdx} className="align-top">
                                  <td
                                    className={`${rowBorder} border-r border-black px-2.5 py-1`}
                                  >
                                    {rd.date}
                                  </td>
                                  <td
                                    className={`${rowBorder} border-r border-black px-2.5 py-1`}
                                  >
                                    {rd.time}
                                  </td>
                                  <td
                                    className={`${rowBorder} border-r border-black px-2.5 py-1 leading-[1.38]`}
                                  >
                                    {rd.agenda}
                                  </td>
                                  <td
                                    className={`${rowBorder} border-r border-black px-2.5 py-1 leading-[1.38]`}
                                  >
                                    {rd.targetParticipants ||
                                      participantRowsData[originalIdx]?.target ||
                                      tor.participantsTarget ||
                                      'Seluruh Peserta'}
                                  </td>
                                  <td
                                    className={`${rowBorder} border-r border-black px-2.5 py-1`}
                                  >
                                    {rd.location}
                                  </td>
                                  <td className={`${rowBorder} px-2.5 py-1`}>{rd.picName}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ));
                  })()}
                </div>
                {(tor.rundownNotes || tor.rundownAdditionalNotes) && (
                  <div className="mt-1.5 text-black">
                    <strong>Catatan Rundown:</strong>{' '}
                    {tor.rundownNotes || tor.rundownAdditionalNotes}
                  </div>
                )}
              </div>
            )}

            {/* Catatan Tambahan & Logistik */}
            {tor.additionalNotes && (
              <div>
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  Catatan Tambahan &amp; Logistik
                </div>
                <p className="text-black whitespace-pre-line leading-[1.38]">
                  {tor.additionalNotes}
                </p>
              </div>
            )}
          </section>

          {/* ================================================================ */}
          {/* TAHAP 02: PREVIEW CASH ADVANCE (SAMA PERSIS DENGAN TAHAP 2)      */}
          {/* ================================================================ */}
          <section
            ref={(el) => {
              sectionRefs.current.cashAdvance = el;
            }}
            className={
              !activePreviewSection || activePreviewSection === 'cashAdvance'
                ? 'space-y-6'
                : 'hidden'
            }
          >
            <div className="flex items-center justify-between border-b border-black pb-1">
              <span className="text-[12px] font-bold uppercase tracking-wider text-black">
                BAGIAN II — PREVIEW TAHAP 02: CASH ADVANCE (UANG MUKA OPERASIONAL)
              </span>
              <span className="text-[12px] font-bold text-black">
                Halaman {tocPages.cashAdvance || 2}
              </span>
            </div>

            {activeCashAdvances.length === 0 ? (
              <div className="border border-black p-4 italic text-black">
                Data pengajuan Cash Advance untuk aktivitas [{tor.activityCode}] {tor.title} belum tersedia pada Tahap 02.
              </div>
            ) : (
              activeCashAdvances.map((record, caIdx) => (
                <div
                  key={record.id || caIdx}
                  className="space-y-5 border border-black p-4"
                >
                  <div className="text-center pb-2">
                    <div className="text-[16px] font-bold uppercase tracking-wide text-black">
                      FORM PENGAJUAN CASH ADVANCE (UANG MUKA OPERASIONAL)
                    </div>
                    <div className="text-[15px] font-bold uppercase text-black mt-0.5">
                      {record.activityTitle}
                    </div>
                  </div>

                  {/* 1. Informasi Pengajuan & Kegiatan */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      1. Informasi Pengajuan &amp; Kegiatan (Cash Advance Information)
                    </div>
                    <table className="w-full text-left border-collapse border border-black text-[14px]">
                      <tbody>
                        <tr className="align-top">
                          <td className="w-64 font-bold py-1.5 px-2.5 border border-black">
                            Nomor Cash Advance
                          </td>
                          <td className="py-1.5 px-2.5 border border-black font-bold">
                            {record.advanceNumber}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Tanggal Pengajuan
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            {formatIndonesianDate(record.requestDate)}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Referensi TOR (Master Source)
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            <strong>{record.torNumber}</strong> — {record.activityTitle}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Tahapan Implementasi TOR
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            {record.implementationTimelineSummary ||
                              (record.implementationMode === 'single'
                                ? 'Satu Tahap Implementasi TOR'
                                : 'Seluruh Tahapan Implementasi TOR')}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Periode Pelaksanaan
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            {formatIndonesianDate(record.activityStartDate)} –{' '}
                            {formatIndonesianDate(record.activityEndDate)}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Batas Maksimal Pelaporan (H+7)
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            {formatIndonesianDate(record.reportingDeadlineDate || record.requestDate)}{' '}
                            ({record.isReported ? 'Laporan Telah Ditutup' : 'Belum Dilaporkan'})
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Lokasi Pelaksanaan
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">{record.location}</td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Nama Pemohon (PIC)
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            <strong>{record.requesterName}</strong> ({record.requesterRole} ·{' '}
                            {record.department})
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Rekening Transfer Tujuan Kasbon
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            <strong>{record.bankName}</strong> · No. Rekening:{' '}
                            <strong>{record.bankAccountNumber}</strong> a.n.{' '}
                            <strong>{record.bankAccountHolder}</strong>
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Status Otorisasi Dokumen
                          </td>
                          <td className="py-1.5 px-2.5 border border-black font-bold">
                            {record.status}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* 2. Rincian Anggaran Kasbon */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      2. Rincian Anggaran Kasbon (Budget Breakdown)
                    </div>
                    <table className="w-full text-left border-collapse border border-black text-[13.5px]">
                      <thead>
                        <tr>
                          <th className="w-9 border border-black px-1.5 py-1 text-center font-bold">
                            No
                          </th>
                          <th className="w-20 border border-black px-1.5 py-1 text-center font-bold">
                            Kode
                          </th>
                          <th className="border border-black px-2 py-1 font-bold">
                            Deskripsi Kebutuhan (Berdasarkan Tahapan Implementasi TOR)
                          </th>
                          <th className="w-12 border border-black px-1 py-1 text-center font-bold">
                            Vol
                          </th>
                          <th className="w-16 border border-black px-1 py-1 text-center font-bold">
                            Satuan
                          </th>
                          <th className="w-12 border border-black px-1 py-1 text-center font-bold">
                            Frek
                          </th>
                          <th className="w-16 border border-black px-1 py-1 text-center font-bold">
                            Satuan
                          </th>
                          <th className="w-28 border border-black px-2 py-1 text-right font-bold">
                            Biaya Satuan (Rp)
                          </th>
                          <th className="w-28 border border-black px-2 py-1 text-right font-bold">
                            Total (Rp)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(record.items || []).map((item, idx) => (
                          <tr key={item.id || idx} className="align-top">
                            <td className="border border-black px-1.5 py-1.5 text-center">
                              {idx + 1}
                            </td>
                            <td className="border border-black px-1.5 py-1.5 text-center">
                              {item.budgetCode || '-'}
                            </td>
                            <td className="border border-black px-2 py-1.5 leading-[1.38]">
                              <div>{item.description}</div>
                              {item.notes && (
                                <div className="text-[12px] italic mt-0.5">
                                  Catatan: {item.notes}
                                </div>
                              )}
                            </td>
                            <td className="border border-black px-1 py-1.5 text-center">
                              {item.volume}
                            </td>
                            <td className="border border-black px-1 py-1.5 text-center">
                              {item.unit || 'Paket'}
                            </td>
                            <td className="border border-black px-1 py-1.5 text-center">
                              {item.frequency || 1}
                            </td>
                            <td className="border border-black px-1 py-1.5 text-center">
                              {item.frequencyUnit || 'Kegiatan'}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-right whitespace-nowrap">
                              {formatRupiah(item.unitPrice)}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-right font-bold whitespace-nowrap">
                              {formatRupiah(item.totalAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td
                            colSpan={8}
                            className="border border-black px-2.5 py-1.5 text-right font-bold"
                          >
                            Total Cash Advance Diajukan
                          </td>
                          <td className="border border-black px-2 py-1.5 text-right font-bold whitespace-nowrap">
                            {formatRupiah(record.totalAmount)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={9} className="border border-black px-2.5 py-1.5">
                            <strong>Terbilang (Amount in Words):</strong>{' '}
                            <span className="italic">&ldquo;{record.amountInWords}&rdquo;</span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* 3. Ketentuan & Regulasi Pertanggungjawaban Keuangan */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      3. Ketentuan &amp; Regulasi Pertanggungjawaban Keuangan
                    </div>
                    <ol className="list-decimal pl-6 space-y-1">
                      {(record.complianceNotes && record.complianceNotes.length > 0
                        ? record.complianceNotes
                        : [
                            'Dana Cash Advance wajib dipertanggungjawabkan paling lambat 7 (tujuh) hari kalender setelah pengajuan dana.',
                            'Penutupan laporan Cash Advance wajib menyertakan lampiran Link PDF Expensify dan bukti transaksi asli pada Tahap 03 (Ringkasan Cash Advance).',
                            'Pengajuan Cash Advance baru tidak dapat diproses apabila masih terdapat 2 (dua) Cash Advance aktif yang belum ditutup laporannya.',
                          ]
                      ).map((note, idx) => (
                        <li key={idx} className="leading-[1.38]">
                          {note}
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* 4. Otorisasi & Persetujuan Dokumen */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      4. Otorisasi &amp; Persetujuan Dokumen (Signatures &amp; Verification)
                    </div>
                    <table className="w-full text-left border-collapse border border-black text-[13.5px]">
                      <thead>
                        <tr>
                          <th className="w-1/4 border border-black px-2 py-1.5 font-bold text-center">
                            1. Diajukan Oleh (Pemohon / PIC)
                          </th>
                          <th className="w-1/4 border border-black px-2 py-1.5 font-bold text-center">
                            2. Diperiksa Oleh (Finance)
                          </th>
                          <th className="w-1/4 border border-black px-2 py-1.5 font-bold text-center">
                            3. Disetujui Oleh (Executive Director)
                          </th>
                          <th className="w-1/4 border border-black px-2 py-1.5 font-bold text-center">
                            4. Dicairkan Oleh (Kasir / Finance)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="align-top">
                          <td className="border border-black px-2 py-2 text-center">
                            <div className="min-h-[60px] flex items-center justify-center italic text-[12px] py-1">
                              {record.status !== 'Draft' ? (
                                <ApprovalBarcodeStamp
                                  compact
                                  documentNumber={record.advanceNumber}
                                  roleCode="PIC"
                                  signerName={
                                    record.signatures?.requestedBy?.name || record.requesterName
                                  }
                                  signDate={
                                    record.signatures?.requestedBy?.date || record.requestDate
                                  }
                                  statusLabel="TELAH DIAJUKAN"
                                />
                              ) : (
                                '[Draft]'
                              )}
                            </div>
                            <div className="font-bold underline">
                              {record.signatures?.requestedBy?.name || record.requesterName}
                            </div>
                            <div className="text-[12px]">
                              {record.signatures?.requestedBy?.roleTitle || record.requesterRole}
                            </div>
                            <div className="text-[11.5px] mt-1">
                              Tanggal:{' '}
                              {formatIndonesianDate(
                                record.signatures?.requestedBy?.date || record.requestDate
                              )}
                            </div>
                          </td>

                          <td className="border border-black px-2 py-2 text-center">
                            <div className="min-h-[60px] flex items-center justify-center italic text-[12px] py-1">
                              {record.signatures?.verifiedBy?.status === 'Terverifikasi' ||
                              record.status === 'Diverifikasi Finance' ||
                              record.status === 'Disetujui' ||
                              record.status === 'Dicairkan' ? (
                                <ApprovalBarcodeStamp
                                  compact
                                  documentNumber={record.advanceNumber}
                                  roleCode="FIN"
                                  signerName={
                                    record.signatures?.verifiedBy?.name || 'Budi Hartono, S.E.'
                                  }
                                  signDate={
                                    record.signatures?.verifiedBy?.date || record.requestDate
                                  }
                                  statusLabel="TERVERIFIKASI"
                                />
                              ) : (
                                `[${
                                  record.signatures?.verifiedBy?.status ||
                                  'Menunggu Verifikasi Finance'
                                }]`
                              )}
                            </div>
                            <div className="font-bold underline">
                              {record.signatures?.verifiedBy?.name || 'Budi Hartono, S.E.'}
                            </div>
                            <div className="text-[12px]">Finance Specialist</div>
                            <div className="text-[11.5px] mt-1">
                              Tanggal:{' '}
                              {record.signatures?.verifiedBy?.date
                                ? formatIndonesianDate(record.signatures.verifiedBy.date)
                                : '-'}
                            </div>
                          </td>

                          <td className="border border-black px-2 py-2 text-center">
                            <div className="min-h-[60px] flex items-center justify-center italic text-[12px] py-1">
                              {record.signatures?.approvedBy?.status === 'Disetujui' ||
                              record.status === 'Disetujui' ||
                              record.status === 'Dicairkan' ? (
                                <ApprovalBarcodeStamp
                                  compact
                                  documentNumber={record.advanceNumber}
                                  roleCode="DIR"
                                  signerName={
                                    record.signatures?.approvedBy?.name || 'Dr. Hendra Wijaya'
                                  }
                                  signDate={
                                    record.signatures?.approvedBy?.date || record.requestDate
                                  }
                                  statusLabel="DISETUJUI"
                                />
                              ) : (
                                `[${
                                  record.signatures?.approvedBy?.status ||
                                  'Pending'
                                }]`
                              )}
                            </div>
                            <div className="font-bold underline">
                              {record.signatures?.approvedBy?.name || 'Dr. Hendra Wijaya'}
                            </div>
                            <div className="text-[12px]">Executive Director</div>
                            <div className="text-[11.5px] mt-1">
                              Tanggal:{' '}
                              {record.signatures?.approvedBy?.date
                                ? formatIndonesianDate(record.signatures.approvedBy.date)
                                : '-'}
                            </div>
                          </td>

                          <td className="border border-black px-2 py-2 text-center">
                            <div className="min-h-[60px] flex items-center justify-center italic text-[12px] py-1">
                              {record.signatures?.disbursedBy?.isDisbursed ||
                              record.status === 'Dicairkan' ? (
                                <ApprovalBarcodeStamp
                                  compact
                                  documentNumber={record.advanceNumber}
                                  roleCode="CSH"
                                  signerName={
                                    record.signatures?.disbursedBy?.name || 'Ratna Sari'
                                  }
                                  signDate={
                                    record.signatures?.disbursedBy?.date || record.requestDate
                                  }
                                  statusLabel="DICAIRKAN"
                                />
                              ) : (
                                '[Belum Dicairkan]'
                              )}
                            </div>
                            <div className="font-bold underline">
                              {record.signatures?.disbursedBy?.name || 'Ratna Sari'}
                            </div>
                            <div className="text-[12px]">Kasir / Finance Officer</div>
                            <div className="text-[11.5px] mt-1">
                              Tanggal:{' '}
                              {record.signatures?.disbursedBy?.date
                                ? formatIndonesianDate(record.signatures.disbursedBy.date)
                                : '-'}
                            </div>
                            {record.signatures?.disbursedBy?.transferReference && (
                              <div className="text-[11.5px] mt-0.5">
                                Ref: {record.signatures.disbursedBy.transferReference}
                              </div>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* ================================================================ */}
          {/* TAHAP 04: PREVIEW NOTULEN RAPAT (SAMA PERSIS DENGAN TAHAP 4)     */}
          {/* ================================================================ */}
          <section
            ref={(el) => {
              sectionRefs.current.notulen = el;
            }}
            className={
              !activePreviewSection || activePreviewSection === 'notulen'
                ? 'space-y-6'
                : 'hidden'
            }
          >
            <div className="flex items-center justify-between border-b border-black pb-1">
              <span className="text-[12px] font-bold uppercase tracking-wider text-black">
                BAGIAN III — PREVIEW TAHAP 04: NOTULEN RAPAT / MEETING MINUTES
              </span>
              <span className="text-[12px] font-bold text-black">
                Halaman {tocPages.notulen || 3}
              </span>
            </div>

            {notulenRecords.length === 0 ? (
              <div className="border border-black p-4 italic text-black">
                Data Notulen untuk aktivitas [{tor.activityCode}] {tor.title} belum tersedia pada Tahap 04.
              </div>
            ) : (
              notulenRecords.map((formData, nIdx) => (
                <div key={formData.id || nIdx} className="space-y-5 border border-black p-4">
                  <div className="text-center font-bold uppercase tracking-wide text-black text-[15px]">
                    NOTULEN RAPAT / MEETING MINUTES
                  </div>

                  {/* 1. Meeting Information */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      1. Meeting Information
                    </div>
                    <table className="w-full border-collapse border border-black text-[14px] text-black">
                      <tbody>
                        <tr>
                          <td className="w-[28%] border border-black px-2.5 py-1 font-bold align-top">
                            Judul Notulen
                          </td>
                          <td className="w-[72%] border border-black px-2.5 py-1 align-top font-bold">
                            {formData.title || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="w-[28%] border border-black px-2.5 py-1 font-bold align-top">
                            Nomor Notulen
                          </td>
                          <td className="w-[72%] border border-black px-2.5 py-1 align-top font-bold break-all">
                            {formData.documentNumber || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Implementation / Project
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formData.implementationProject || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Recorder / Notulis
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formData.recorderName || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Meeting Date
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formatIndonesianDate(formData.meetingDate)}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Meeting Time
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formData.startTime || '—'} – {formData.endTime || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Meeting Location
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formData.meetingLocation || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Meeting Room / Platform
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formData.meetingRoomPlatform || '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <div className="mt-3">
                      <div className="font-bold text-black mb-1">Participants:</div>
                      <table className="w-full border-collapse border border-black text-[14px] text-black">
                        <thead>
                          <tr>
                            <th className="w-10 border border-black px-2 py-1 text-center font-bold">
                              No
                            </th>
                            <th className="border border-black px-2.5 py-1 text-left font-bold">
                              Nama Peserta
                            </th>
                            <th className="border border-black px-2.5 py-1 text-left font-bold">
                              Organisasi / Partner
                            </th>
                            <th className="border border-black px-2.5 py-1 text-left font-bold">
                              Peran / Jabatan
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(formData.participants || []).filter((p) => p.name.trim()).length > 0 ? (
                            formData.participants
                              .filter((p) => p.name.trim())
                              .map((p, i) => (
                                <tr key={p.id || i}>
                                  <td className="border border-black px-2 py-1 text-center">
                                    {i + 1}
                                  </td>
                                  <td className="border border-black px-2.5 py-1">
                                    {p.name || '—'}
                                  </td>
                                  <td className="border border-black px-2.5 py-1">
                                    {p.organization || '—'}
                                  </td>
                                  <td className="border border-black px-2.5 py-1">
                                    {p.role || '—'}
                                  </td>
                                </tr>
                              ))
                          ) : (
                            <tr>
                              <td
                                colSpan={4}
                                className="border border-black px-2.5 py-2 text-center"
                              >
                                —
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 2. Meeting Agenda & Discussion */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      2. Meeting Agenda &amp; Discussion
                    </div>
                    <div className="space-y-3">
                      {(formData.discussions || []).map((d, idx) => (
                        <table
                          key={d.id || idx}
                          className="w-full border-collapse border border-black text-[14px] text-black"
                        >
                          <thead>
                            <tr>
                              <th
                                colSpan={2}
                                className="border border-black px-2.5 py-1 text-left font-bold"
                              >
                                {idx + 1}. Discussion Topic: {d.topic || '—'}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="w-[28%] border border-black px-2.5 py-1 font-bold align-top">
                                Description / Summary
                              </td>
                              <td className="w-[72%] border border-black px-2.5 py-1 align-top whitespace-pre-line">
                                {d.summary || '—'}
                              </td>
                            </tr>
                            <tr>
                              <td className="border border-black px-2.5 py-1 font-bold align-top">
                                Key Findings
                              </td>
                              <td className="border border-black px-2.5 py-1 align-top whitespace-pre-line">
                                {d.keyFindings || '—'}
                              </td>
                            </tr>
                            <tr>
                              <td className="border border-black px-2.5 py-1 font-bold align-top">
                                Issues / Challenges
                              </td>
                              <td className="border border-black px-2.5 py-1 align-top whitespace-pre-line">
                                {d.issuesChallenges || '—'}
                              </td>
                            </tr>
                            <tr>
                              <td className="border border-black px-2.5 py-1 font-bold align-top">
                                Responses / Clarifications
                              </td>
                              <td className="border border-black px-2.5 py-1 align-top whitespace-pre-line">
                                {d.responsesClarifications || '—'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      ))}
                    </div>
                  </div>

                  {/* 3. Key Decisions */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      3. Key Decisions
                    </div>
                    <table className="w-full border-collapse border border-black text-[14px] text-black">
                      <thead>
                        <tr>
                          <th className="w-10 border border-black px-2 py-1 text-center font-bold">
                            No
                          </th>
                          <th className="w-[34%] border border-black px-2.5 py-1 text-left font-bold">
                            Decision Statement
                          </th>
                          <th className="w-[24%] border border-black px-2.5 py-1 text-left font-bold">
                            Background / Reason
                          </th>
                          <th className="w-[18%] border border-black px-2.5 py-1 text-left font-bold">
                            Responsible Party
                          </th>
                          <th className="w-[20%] border border-black px-2.5 py-1 text-left font-bold">
                            Related Program / Activity
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(formData.decisions || []).map((dec, idx) => (
                          <tr key={dec.id || idx}>
                            <td className="border border-black px-2 py-1 text-center align-top">
                              {idx + 1}
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top font-bold">
                              {dec.statement || '—'}
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top">
                              {dec.backgroundReason || '—'}
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top">
                              {dec.responsibleParty || '—'}
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top">
                              {dec.relatedProgramActivity || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 4. Action Points / Follow-up */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      4. Action Points / Follow-up
                    </div>
                    <table className="w-full border-collapse border border-black text-[14px] text-black">
                      <thead>
                        <tr>
                          <th className="w-10 border border-black px-2 py-1 text-center font-bold">
                            No
                          </th>
                          <th className="border border-black px-2.5 py-1 text-left font-bold">
                            Follow-up Action
                          </th>
                          <th className="w-[24%] border border-black px-2.5 py-1 text-left font-bold">
                            Person in Charge (PIC)
                          </th>
                          <th className="w-[18%] border border-black px-2.5 py-1 text-center font-bold">
                            Deadline
                          </th>
                          <th className="w-[16%] border border-black px-2.5 py-1 text-center font-bold">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(formData.actionPoints || []).map((ap, idx) => {
                          const st = resolveActionPointStatus(ap);
                          return (
                            <tr key={ap.id || idx}>
                              <td className="border border-black px-2 py-1 text-center align-top">
                                {idx + 1}
                              </td>
                              <td className="border border-black px-2.5 py-1 align-top">
                                {ap.action || '—'}
                              </td>
                              <td className="border border-black px-2.5 py-1 align-top">
                                {ap.pic || '—'}
                              </td>
                              <td className="border border-black px-2.5 py-1 text-center align-top">
                                {formatIndonesianDate(ap.deadline)}
                              </td>
                              <td className="border border-black px-2.5 py-1 text-center align-top font-bold">
                                {st}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 5. Additional Notes */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      5. Additional Notes
                    </div>
                    <table className="w-full border-collapse border border-black text-[14px] text-black">
                      <tbody>
                        <tr>
                          <td className="w-[28%] border border-black px-2.5 py-1 font-bold align-top">
                            Catatan Tambahan
                          </td>
                          <td className="w-[72%] border border-black px-2.5 py-1 align-top whitespace-pre-line">
                            {formData.additionalNotes || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Agenda Rapat Berikutnya
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formData.nextMeetingAgenda || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Jadwal Pertemuan Selanjutnya
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top">
                            {formData.nextMeetingSchedule || '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-black px-2.5 py-1 font-bold align-top">
                            Informasi / Dokumen Persiapan
                          </td>
                          <td className="border border-black px-2.5 py-1 align-top whitespace-pre-line">
                            {formData.preparationDocuments || '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* ================================================================ */}
          {/* TAHAP 05: PREVIEW DOKUMENTASI KEGIATAN (SAMA PERSIS TAHAP 5)     */}
          {/* ================================================================ */}
          <section
            ref={(el) => {
              sectionRefs.current.dokumentasi = el;
            }}
            className={
              !activePreviewSection || activePreviewSection === 'dokumentasi'
                ? 'space-y-6'
                : 'hidden'
            }
          >
            <div className="flex items-center justify-between border-b border-black pb-1">
              <span className="text-[12px] font-bold uppercase tracking-wider text-black">
                BAGIAN IV — PREVIEW TAHAP 05: DOCUMENTATION / DOKUMENTASI KEGIATAN PROGRAM
              </span>
              <span className="text-[12px] font-bold text-black">
                Halaman {tocPages.dokumentasi || 4}
              </span>
            </div>

            {docRecords.length === 0 ? (
              <div className="border border-black p-4 italic text-black">
                Data Dokumentasi Kegiatan untuk aktivitas [{tor.activityCode}] {tor.title} belum tersedia pada Tahap 05.
              </div>
            ) : (
              docRecords.map((docRec, dIdx) => (
                <div key={docRec.id || dIdx} className="space-y-5 border border-black p-4">
                  <div className="text-center pb-2">
                    <div className="text-[16px] font-bold uppercase tracking-wide text-black">
                      DOCUMENTATION / DOKUMENTASI KEGIATAN PROGRAM
                    </div>
                    <div className="text-[15px] font-bold uppercase text-black mt-0.5">
                      {tor.title}
                    </div>
                  </div>

                  {/* Informasi Referensi Kegiatan */}
                  <table className="w-full text-left border-collapse border border-black text-[14px]">
                    <tbody>
                      <tr className="align-top">
                        <td className="w-56 font-bold py-1.5 px-2.5 border border-black">
                          Nomor Dokumen Dokumentasi
                        </td>
                        <td className="py-1.5 px-2.5 border border-black font-bold">
                          {docRec.documentNumber || '001/DOC/WIJNA/X/2026'}
                        </td>
                      </tr>
                      <tr className="align-top">
                        <td className="font-bold py-1.5 px-2.5 border border-black">
                          Nama Topik Cerita / Angle
                        </td>
                        <td className="py-1.5 px-2.5 border border-black font-bold">
                          {docRec.bestPhotosStoryTopic || '-'}
                        </td>
                      </tr>
                      <tr className="align-top">
                        <td className="font-bold py-1.5 px-2.5 border border-black">
                          Referensi TOR (Master Source)
                        </td>
                        <td className="py-1.5 px-2.5 border border-black">
                          <strong>{tor.torNumber}</strong> — {tor.title}
                        </td>
                      </tr>
                      <tr className="align-top">
                        <td className="font-bold py-1.5 px-2.5 border border-black">
                          Program Terkait
                        </td>
                        <td className="py-1.5 px-2.5 border border-black">{tor.programName}</td>
                      </tr>
                      <tr className="align-top">
                        <td className="font-bold py-1.5 px-2.5 border border-black">
                          Lokasi &amp; Periode Kegiatan
                        </td>
                        <td className="py-1.5 px-2.5 border border-black">
                          {tor.location} ({formatIndonesianDate(tor.startDate)} –{' '}
                          {formatIndonesianDate(tor.endDate)})
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* 1. Five Best Photos */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      1. Five Best Photos (5 Foto Terbaik &amp; 1 Topik Cerita/Angle)
                    </div>
                    <div className="mb-2.5">
                      <strong>Topik Cerita / Angle (1 Topik Cerita untuk 5 Foto Terbaik):</strong>{' '}
                      {docRec.bestPhotosStoryTopic || '-'}
                    </div>
                    <table className="w-full text-left border-collapse border border-black text-[14px]">
                      <thead>
                        <tr>
                          <th className="w-16 border border-black px-2 py-1 text-center font-bold">
                            Slot
                          </th>
                          <th className="border border-black px-2.5 py-1 font-bold">
                            Photo Name / Title (Setiap orang yang ada di foto tersebut)
                          </th>
                          <th className="w-56 border border-black px-2.5 py-1 font-bold">
                            Photo Link (URL)
                          </th>
                          <th className="w-40 border border-black px-2.5 py-1 font-bold">
                            Photo Location
                          </th>
                          <th className="w-36 border border-black px-2.5 py-1 font-bold">
                            Photographer
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(docRec.bestPhotos || []).map((slot) => (
                          <tr key={slot.slotNumber} className="align-top">
                            <td className="border border-black px-2 py-1.5 text-center font-bold">
                              Foto #{slot.slotNumber}
                            </td>
                            <td className="border border-black px-2.5 py-1.5">
                              {slot.photoNameTitle || '-'}
                            </td>
                            <td className="border border-black px-2.5 py-1.5 break-all">
                              {slot.photoLink ? (
                                <a
                                  href={slot.photoLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline text-black"
                                >
                                  {slot.photoLink}
                                </a>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="border border-black px-2.5 py-1.5">
                              {slot.photoLocation || '-'}
                            </td>
                            <td className="border border-black px-2.5 py-1.5">
                              {slot.photographer || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 2. Human Interest Story */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      2. Human Interest Story dengan 5 Foto Tadi (Opsional)
                    </div>
                    <table className="w-full text-left border-collapse border border-black text-[14px]">
                      <thead>
                        <tr>
                          <th className="w-12 border border-black px-2 py-1 text-center font-bold">
                            No
                          </th>
                          <th className="border border-black px-2.5 py-1 font-bold">
                            Story Title (Cerita Individu, Komunitas, Pengalaman, atau Dampak Program)
                          </th>
                          <th className="w-72 border border-black px-2.5 py-1 font-bold">
                            Story Link (URL Cerita)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(docRec.humanInterestStories || []).filter(
                          (s) => s.storyTitle?.trim() || s.storyLink?.trim()
                        ).length === 0 ? (
                          <tr>
                            <td
                              colSpan={3}
                              className="border border-black px-2.5 py-2 text-center italic"
                            >
                              - (Opsional / Tidak ada Human Interest Story)
                            </td>
                          </tr>
                        ) : (
                          (docRec.humanInterestStories || [])
                            .filter((s) => s.storyTitle?.trim() || s.storyLink?.trim())
                            .map((story, idx) => (
                              <tr key={story.id || idx} className="align-top">
                                <td className="border border-black px-2 py-1.5 text-center">
                                  {idx + 1}
                                </td>
                                <td className="border border-black px-2.5 py-1.5">
                                  {story.storyTitle || '-'}
                                </td>
                                <td className="border border-black px-2.5 py-1.5 break-all">
                                  {story.storyLink ? (
                                    <a
                                      href={story.storyLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline text-black"
                                    >
                                      {story.storyLink}
                                    </a>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* 3. General Photo Documentation */}
                  <div>
                    <div
                      className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      3. General Photo Documentation
                    </div>
                    <table className="w-full text-left border-collapse border border-black text-[14px]">
                      <thead>
                        <tr>
                          <th className="w-12 border border-black px-2 py-1 text-center font-bold">
                            No
                          </th>
                          <th className="border border-black px-2.5 py-1 font-bold">
                            General Photo Link (URL Folder Dokumentasi Foto Keseluruhan Kegiatan)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(docRec.generalPhotoLinks || []).length === 0 ? (
                          <tr>
                            <td
                              colSpan={2}
                              className="border border-black px-2.5 py-2 text-center italic"
                            >
                              -
                            </td>
                          </tr>
                        ) : (
                          (docRec.generalPhotoLinks || []).map((gpl, idx) => (
                            <tr key={gpl.id || idx} className="align-top">
                              <td className="border border-black px-2 py-1.5 text-center">
                                {idx + 1}
                              </td>
                              <td className="border border-black px-2.5 py-1.5 break-all">
                                {gpl.url ? (
                                  <a
                                    href={gpl.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline text-black"
                                  >
                                    {gpl.url}
                                  </a>
                                ) : (
                                  '-'
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* ================================================================ */}
          {/* TAHAP 06: PREVIEW LAPORAN MONITORING (SAMA PERSIS TAHAP 6)       */}
          {/* ================================================================ */}
          <section
            ref={(el) => {
              sectionRefs.current.monitoring = el;
            }}
            className={
              !activePreviewSection || activePreviewSection === 'monitoring'
                ? 'space-y-6'
                : 'hidden'
            }
          >
            <div className="flex items-center justify-between border-b border-black pb-1">
              <span className="text-[12px] font-bold uppercase tracking-wider text-black">
                BAGIAN V — PREVIEW TAHAP 06: LAPORAN MONITORING KEGIATAN &amp; EVIDENCE DOCUMENTATION
              </span>
              <span className="text-[12px] font-bold text-black">
                Halaman {tocPages.monitoring || 5}
              </span>
            </div>

            {implementationEntries.length === 0 ? (
              <div className="border border-black p-4 italic text-black">
                Data Monitoring untuk aktivitas [{tor.activityCode}] {tor.title} belum tersedia pada Tahap 06.
              </div>
            ) : (
              implementationEntries.map((entry, gIdx) => {
                const execItem = entry.executiveSummaryItem;
                const activeSections = execItem?.sections;
                const responsibleDisplay = resolveCaRequesterName(
                  entry.cashAdvanceId,
                  execItem?.responsibleName
                );
                const statusDisplay: MonitoringReportStatus = execItem?.status || 'Planned';

                return (
                  <div key={entry.key || gIdx} className="space-y-5 border border-black p-4">
                    <div className="text-center pb-2 border-b border-black">
                      <div className="text-[15px] font-bold uppercase tracking-wide text-black">
                        LAPORAN MONITORING KEGIATAN &amp; EVIDENCE DOCUMENTATION
                      </div>
                      <div className="text-[14px] font-bold uppercase text-black mt-0.5">
                        [{execItem?.toolId || 'EXEC-SUMMARY'}] {execItem?.toolName || 'Executive Summary Monitoring'} — {tor.activityName || tor.title}
                      </div>
                    </div>

                    {/* Tabel Referensi Utama (Persis Preview Tahap 06) */}
                    <table className="w-full text-left border-collapse border border-black text-[13.5px]">
                      <tbody>
                        <tr className="align-top">
                          <td className="w-52 font-bold py-1.5 px-2.5 border border-black">
                            Nomor Cash Advance
                          </td>
                          <td className="py-1.5 px-2.5 border border-black font-bold">
                            {entry.cashAdvanceNumber}
                          </td>
                          <td className="w-44 font-bold py-1.5 px-2.5 border border-black">
                            Tanggal Monitoring
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            {formatIndonesianDate(execItem?.monitoringDate || tor.endDate)}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Referensi ToR
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            <strong>{tor.torNumber}</strong>
                          </td>
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Responsible
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            {responsibleDisplay}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Jenis Implementasi
                          </td>
                          <td className="py-1.5 px-2.5 border border-black">
                            <div className="font-bold">
                              [{tor.activityCode}] {tor.activityName || tor.title}
                            </div>
                            <div className="mt-0.5">
                              {entry.period} — {entry.activity}
                            </div>
                          </td>
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Status Monitoring
                          </td>
                          <td className="py-1.5 px-2.5 border border-black font-bold">
                            {statusDisplay}
                          </td>
                        </tr>
                        <tr className="align-top">
                          <td className="font-bold py-1.5 px-2.5 border border-black">
                            Jenis Laporan
                          </td>
                          <td colSpan={3} className="py-1.5 px-2.5 border border-black">
                            <strong>Executive Summary (7 Bagian)</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Monitoring Tools & Metode Pelaporan Table */}
                    {entry.monitoringItems.length > 0 && (
                      <div>
                        <div className="font-bold text-black mb-1 text-[13.5px]">
                          Monitoring Tools &amp; Metode Pelaporan:
                        </div>
                        <table className="w-full text-left border-collapse border border-black text-[13px]">
                          <thead>
                            <tr>
                              <th className="w-10 border border-black px-2 py-1 text-center font-bold">
                                No
                              </th>
                              <th className="border border-black px-2.5 py-1 font-bold">
                                Metode Monitoring
                              </th>
                              <th className="w-28 border border-black px-2.5 py-1 font-bold">
                                Status
                              </th>
                              <th className="w-36 border border-black px-2.5 py-1 font-bold">
                                Responsible
                              </th>
                              <th className="w-60 border border-black px-2.5 py-1 font-bold">
                                Link Dokumen Monitoring
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.monitoringItems.map((m, mIdx) => {
                              const toolUrl = m.mainEvidenceFolderUrl || m.plannedToolUrl || '';
                              return (
                                <tr key={m.id || mIdx} className="align-top">
                                  <td className="border border-black px-2 py-1 text-center">
                                    {mIdx + 1}
                                  </td>
                                  <td className="border border-black px-2.5 py-1 font-bold">
                                    [{m.toolId}] {m.toolName}
                                  </td>
                                  <td className="border border-black px-2.5 py-1">{m.status}</td>
                                  <td className="border border-black px-2.5 py-1">
                                    {resolveCaRequesterName(m.cashAdvanceId, m.responsibleName)}
                                  </td>
                                  <td className="border border-black px-2.5 py-1 break-all">
                                    {toolUrl ? (
                                      <a
                                        href={toolUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline text-black"
                                      >
                                        {toolUrl}
                                      </a>
                                    ) : (
                                      <span className="italic">Belum tersedia</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* 7 Bagian Monitoring — Tanpa Huruf A/B/C, Persis Preview Tahap 06 */}
                    <div className="space-y-4">
                      {MONITORING_SECTIONS_META.map((meta) => {
                        const sec = activeSections?.[meta.key];
                        return (
                          <div key={meta.key} className="border border-black">
                            <div
                              className="bg-[#E5E5E3] text-black font-bold px-2.5 py-1 border-b border-black flex flex-wrap items-center justify-between gap-2 text-[13px]"
                              style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                            >
                              <span>{meta.title}</span>
                              <span className="font-normal italic text-[12px]">
                                &ldquo;{meta.quote}&rdquo;
                              </span>
                            </div>
                            <div className="p-3 text-[13.5px]">
                              <div className="whitespace-pre-line">
                                {sec?.narrative?.trim() || (
                                  <span className="italic text-stone-500">Belum diisi.</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* ================================================================ */}
          {/* CONSISTENT DOCUMENT FOOTER                                       */}
          {/* ================================================================ */}
          <footer className="pt-4 border-t-2 border-black flex flex-wrap items-center justify-between gap-2 text-[12px] text-black">
            <div>
              <strong>Laporan Kontribusi (Gabungan Preview Tahap 01–06)</strong> · [{tor.activityCode}]{' '}
              {tor.torNumber}
            </div>
            <div>
              Dicetak Otomatis dari Sistem Manajemen Kegiatan WIJNA · Total Estimasi:{' '}
              <strong>{totalPages} Halaman (Ukuran Legal 8.5 × 14 Inci)</strong>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
};
