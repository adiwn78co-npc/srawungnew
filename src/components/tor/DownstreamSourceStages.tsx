import React, { useEffect, useMemo, useState } from 'react';
import {
  Tor,
  CashAdvanceRecord,
  MeetingMinutesRecord,
  ActivityDocumentationRecord,
  BestPhotoSlot,
  HumanInterestStoryItem,
  GeneralPhotoLinkItem,
} from '../../types/index.js';
import { formatIndonesianDate } from '../../lib/dateUtils.js';
import { formatRupiah } from '../../lib/terbilang.js';
import { api } from '../../lib/api.js';
import { MonitoringStageView } from './MonitoringStageView.js';
import { LaporanTorStageView } from './LaporanTorStageView.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { resolveMasterBudgetByCode } from '../../lib/masterBudgetStorage.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';
import { useOrganizationSettings } from '../../lib/organizationSettings.js';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Edit,
  ArrowUpRight,
  ShieldCheck,
  Plus,
  Trash2,
  Save,
  ExternalLink,
  Printer,
  Download,
  Eye,
  Edit3,
  Search,
  FileText,
  FolderOpen,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export interface MissingTorInfoBlockProps {
  fieldName: string;
  torSection: string;
  onRequestTorUpdate?: () => void;
  compact?: boolean;
}

export const MissingTorInfoBlock: React.FC<MissingTorInfoBlockProps> = ({
  fieldName,
  torSection,
  onRequestTorUpdate,
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="inline-flex flex-wrap items-center gap-2 px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs font-sans">
        <span className="font-mono font-semibold text-[11px] uppercase tracking-wide text-amber-800">
          Not Available in Source TOR
        </span>
        <span className="text-amber-700">({torSection})</span>
        {onRequestTorUpdate && (
          <button
            type="button"
            onClick={onRequestTorUpdate}
            className="underline font-medium text-amber-900 hover:text-amber-950 cursor-pointer"
          >
            Lengkapi di TOR Tahap 1 →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200/90 bg-[#FAF8F5] px-4 py-3 text-xs font-sans text-[#2F3437] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 font-mono font-semibold text-[11px]">
              Not Available in Source TOR
            </span>
            <span className="font-semibold text-[#2F3437]">{fieldName}</span>
          </div>
          <p className="text-[#787774]">
            Bagian <strong>{torSection}</strong> belum tersedia pada dokumen Master Source (TOR Tahap 1). Sistem tidak membuat asumsi otomatis — silakan konfirmasi atau tambahkan input pada TOR Tahap 1.
          </p>
        </div>
      </div>
      {onRequestTorUpdate && (
        <button
          type="button"
          onClick={onRequestTorUpdate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-300 bg-white hover:bg-amber-50 text-amber-900 font-medium shrink-0 transition-colors cursor-pointer"
        >
          <Edit className="w-3.5 h-3.5" />
          <span>Input di TOR Tahap 1</span>
        </button>
      )}
    </div>
  );
};

interface SourceTraceabilityBannerProps {
  stageNumber: number;
  tor: Tor;
  cashAdvances: CashAdvanceRecord[];
  onNavigateToTor: () => void;
  onRequestTorUpdate: () => void;
}

const STAGE_HIERARCHY_MAP: Record<
  number,
  {
    stageName: string;
    primarySource: string;
    torComponents: string[];
  }
> = {
  2: {
    stageName: '02. Cash Advance',
    primarySource: 'Tahap 01: Master TOR (Sumber Eksklusif)',
    torComponents: [
      'Project Information (Kode TOR, Judul, Lokasi, Tanggal)',
      'Budget Request / Approved Pagu',
      'Implementation Timeline',
      'Peserta Kegiatan & Role Tim',
    ],
  },
  3: {
    stageName: '03. Ringkasan Cash Advance',
    primarySource: 'Tahap 01: Master TOR → Tahap 02: Cash Advance Resmi',
    torComponents: [
      'Implementation Timeline TOR',
      'Pagu Anggaran TOR',
      'Rincian Item Tahap 02 Cash Advance',
    ],
  },
  4: {
    stageName: '04. Notulen (MOM)',
    primarySource: 'Tahap 01: Master TOR → Tahap 02: Cash Advance Aktif',
    torComponents: [
      'Implementation Timeline TOR',
      'Tujuan Khusus & Hasil yang Diharapkan',
      'Role & Responsibility Tim Pelaksana',
    ],
  },
  5: {
    stageName: '05. Dokumentasi Kegiatan (Five Best Photos, HIS & General)',
    primarySource: 'Tahap 01: Master TOR → Tahap 02: Cash Advance & Tahap 04: Notulen',
    torComponents: [
      'Five Best Photos (5 Slot Link & 1 Topik Cerita/Angle)',
      'Human Interest Story dengan 5 Foto Tadi',
      'General Photo Documentation (Folder Dokumentasi Kegiatan)',
    ],
  },
  6: {
    stageName: '06. Monitoring',
    primarySource: 'Tahap 01: Master TOR → Tahap 02: Cash Advance & Monitoring Tools Activity',
    torComponents: [
      'Referensi ToR & Activity Terkait',
      'Nomor Cash Advance yang Masuk',
      'Jenis Monitoring Tools yang Direncanakan pada Activity (7 Bagian A–G & Evidence)',
    ],
  },
  7: {
    stageName: '07. Laporan TOR (Laporan Kontribusi)',
    primarySource: 'Tahap 01: Master TOR → Tahap 04: Notulen → Tahap 05: Dokumentasi → Tahap 06: Monitoring',
    torComponents: [
      'Executive Summary & Terms of Reference (ToR)',
      'Notulen Kegiatan & Dokumentasi Kegiatan',
      'Monitoring, Hasil, Pembelajaran & Rekomendasi',
    ],
  },
  8: {
    stageName: '08. Laporan Keuangan',
    primarySource: 'Tahap 01: Master TOR → Tahap 02: Cash Advance → Tahap 03: Ringkasan CA',
    torComponents: [
      'Budget Request & Budget Approved TOR',
      'Implementation Timeline TOR',
      'Rekonsiliasi Kasbon Tahap 02 & Tahap 03',
    ],
  },
};

export const SourceTraceabilityBanner: React.FC<SourceTraceabilityBannerProps> = ({
  stageNumber,
  tor,
  cashAdvances,
  onNavigateToTor,
  onRequestTorUpdate,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const meta = STAGE_HIERARCHY_MAP[stageNumber];
  if (!meta) return null;

  const totalCaAmount = cashAdvances
    .filter((c) => c.status !== 'Ditolak')
    .reduce((acc, c) => acc + (Number(c.totalAmount) || 0), 0);
  const torCeiling = Number(tor.budgetApproved ?? tor.budgetRequested ?? 0);
  const isOverBudget = torCeiling > 0 && totalCaAmount > torCeiling;

  const missingFields: string[] = [];
  if (!tor.timelineItems || tor.timelineItems.length === 0) {
    missingFields.push('Implementation Timeline');
  }
  if (!tor.specificObjectives || tor.specificObjectives.length === 0) {
    missingFields.push('Tujuan Khusus');
  }
  if (!tor.monitoringItems || tor.monitoringItems.length === 0) {
    missingFields.push('Monitoring Mechanism');
  }

  return (
    <div className="bg-white rounded-lg border border-[#EAEAEA] px-4 sm:px-5 py-2.5 text-xs text-[#2F3437] flex flex-col gap-2 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F7F7F5] border border-[#EAEAEA] font-mono text-[11px] font-medium text-[#2F3437]">
            <GitBranch className="w-3 h-3 text-[#787774]" />
            Master Source: Tahap 01 TOR ({tor.torNumber})
          </span>
          {!isOverBudget && missingFields.length === 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              Traceable &amp; Konsisten dengan TOR Tahap 1
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium">
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              {missingFields.length > 0
                ? `${missingFields.length} komponen: Not Available in Source TOR`
                : 'Periksa konsistensi pagu TOR'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded border border-[#EAEAEA] bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#2F3437] text-[11px] font-medium transition-colors cursor-pointer"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3 h-3 text-[#787774]" />
                <span>Sembunyikan Info Sumber</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3 text-[#787774]" />
                <span>Tampilkan Info Sumber</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onNavigateToTor}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#EAEAEA] bg-white hover:bg-[#F7F7F5] text-[#2F3437] text-[11px] font-medium transition-colors cursor-pointer"
          >
            <span>Lihat Sumber TOR</span>
            <ArrowUpRight className="w-3 h-3 text-[#787774]" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="pt-2 border-t border-[#F1F1EF] space-y-2">
          <div className="text-[11px] text-[#787774]">
            Hierarki: <strong className="text-[#2F3437] font-medium">{meta.primarySource}</strong>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#787774]">
            <span>Komponen Referensi TOR Tahap 1:</span>
            {meta.torComponents.map((comp, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 rounded bg-[#F7F7F5] text-[#2F3437] border border-[#EAEAEA]"
              >
                {comp}
              </span>
            ))}
            {missingFields.length > 0 && (
              <button
                type="button"
                onClick={onRequestTorUpdate}
                className="ml-auto text-amber-800 hover:text-amber-950 underline font-medium cursor-pointer"
              >
                + Lengkapi Data Sumber di TOR Tahap 1 ({missingFields.join(', ')})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface DownstreamStagesViewProps {
  stageNumber: 5 | 6 | 7 | 8;
  tor: Tor;
  cashAdvances: CashAdvanceRecord[];
  onNavigateStage: (stage: number) => void;
  onRequestTorUpdate: () => void;
  initialTargetId?: string;
  initialViewMode?: 'form' | 'preview';
  onRefresh?: () => void;
}

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function formatDocumentationNumber(sequence: number): string {
  const now = new Date();
  const roman = ROMAN_MONTHS[now.getMonth()] || 'X';
  const year = now.getFullYear();
  return `${String(sequence).padStart(3, '0')}/DOC/WIJNA/${roman}/${year}`;
}

const createEmptyBestPhotoSlots = (
  defaultLocation: string,
  defaultPhotographer: string
): BestPhotoSlot[] =>
  [1, 2, 3, 4, 5].map((slotNumber) => ({
    slotNumber,
    photoNameTitle: '',
    photoLink: '',
    photoLocation: defaultLocation,
    photographer: defaultPhotographer,
  }));

export const DownstreamStagesView: React.FC<DownstreamStagesViewProps> = ({
  stageNumber,
  tor,
  cashAdvances,
  onNavigateStage,
  onRequestTorUpdate,
  initialTargetId,
  initialViewMode,
  onRefresh,
}) => {
  const [minutes, setMinutes] = useState<MeetingMinutesRecord[]>([]);
  const { organizationName } = useOrganizationSettings();
  const [summaryData, setSummaryData] = useState<any>(null);

  // Documentation List & Editor State (Stage 05 & Linked in Stage 06)
  const [docList, setDocList] = useState<ActivityDocumentationRecord[]>(() =>
    tor.documentation ? [tor.documentation] : []
  );
  const [loadingDocList, setLoadingDocList] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [docViewMode, setDocViewMode] = useState<'list' | 'form' | 'preview'>('list');
  const [stage8ViewMode, setStage8ViewMode] = useState<'work' | 'preview'>(
    initialViewMode === 'preview' ? 'preview' : 'work'
  );
  const [isApprovingFinalSummary, setIsApprovingFinalSummary] = useState(false);

  const handleApproveFinalSummary = async (stage: 'report' | 'finance' | 'director') => {
    setIsApprovingFinalSummary(true);
    try {
      const res = await api.approveCashAdvanceSummary(tor.id, { stage });
      if (res?.summary) {
        setSummaryData(res.summary);
      }
      if (onRefresh) onRefresh();
    } catch {
      // ignore
    } finally {
      setIsApprovingFinalSummary(false);
    }
  };

  // Active Record being edited / previewed
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocNumber, setEditingDocNumber] = useState<string>('001/DOC/WIJNA/X/2026');
  const [docRecord, setDocRecord] = useState<ActivityDocumentationRecord | null>(
    tor.documentation || null
  );
  const [bestPhotosStoryTopic, setBestPhotosStoryTopic] = useState<string>('');
  const [bestPhotos, setBestPhotos] = useState<BestPhotoSlot[]>(() =>
    createEmptyBestPhotoSlots(tor.location || '', tor.picName || '')
  );
  const [humanInterestStories, setHumanInterestStories] = useState<HumanInterestStoryItem[]>([
    { id: 'his-1', storyTitle: '', storyLink: '' },
  ]);
  const [generalPhotoLinks, setGeneralPhotoLinks] = useState<GeneralPhotoLinkItem[]>([
    { id: 'gpl-1', url: '' },
  ]);
  const [isSavingDoc, setIsSavingDoc] = useState(false);
  const [docSaveMessage, setDocSaveMessage] = useState<string | null>(null);
  const [docErrorMessage, setDocErrorMessage] = useState<string | null>(null);

  const hydrateDocumentationState = (rec: ActivityDocumentationRecord) => {
    setDocRecord(rec);
    setEditingDocId(rec.id);
    setEditingDocNumber(rec.documentNumber || '001/DOC/WIJNA/X/2026');
    setBestPhotosStoryTopic(rec.bestPhotosStoryTopic || '');
    const normalizedFive: BestPhotoSlot[] = [1, 2, 3, 4, 5].map((num) => {
      const found = (rec.bestPhotos || []).find(
        (p: BestPhotoSlot) => Number(p.slotNumber) === num
      );
      return {
        slotNumber: num,
        photoNameTitle: found?.photoNameTitle || '',
        photoLink: found?.photoLink || '',
        photoLocation: found?.photoLocation || tor.location || '',
        photographer: found?.photographer || tor.picName || '',
      };
    });
    setBestPhotos(normalizedFive);
    setHumanInterestStories(
      rec.humanInterestStories && rec.humanInterestStories.length > 0
        ? rec.humanInterestStories
        : [{ id: 'his-1', storyTitle: '', storyLink: '' }]
    );
    setGeneralPhotoLinks(
      rec.generalPhotoLinks && rec.generalPhotoLinks.length > 0
        ? rec.generalPhotoLinks
        : [{ id: 'gpl-1', url: '' }]
    );
  };

  const handleStartCreateDocumentation = (presetTopic = '') => {
    const nextSeq = docList.length + 1;
    const nextDocNum = formatDocumentationNumber(nextSeq);
    setEditingDocId(null);
    setEditingDocNumber(nextDocNum);
    setDocRecord(null);
    setBestPhotosStoryTopic(presetTopic);
    setBestPhotos(createEmptyBestPhotoSlots(tor.location || '', tor.picName || ''));
    setHumanInterestStories([{ id: `his-${Date.now()}-1`, storyTitle: '', storyLink: '' }]);
    setGeneralPhotoLinks([{ id: `gpl-${Date.now()}-1`, url: '' }]);
    setDocSaveMessage(null);
    setDocErrorMessage(null);
    setDocViewMode('form');
  };

  const handleOpenDocumentationRecord = (
    rec: ActivityDocumentationRecord,
    targetMode: 'form' | 'preview'
  ) => {
    hydrateDocumentationState(rec);
    setDocSaveMessage(null);
    setDocErrorMessage(null);
    setDocViewMode(targetMode);
  };

  const handleDeleteDocumentationRecord = async (rec: ActivityDocumentationRecord) => {
    try {
      await api.deleteDocumentationItem(rec.id);
      setDocList((prev) => prev.filter((d) => d.id !== rec.id));
      if (onRefresh) onRefresh();
      setDocSaveMessage(
        `Dokumentasi "${rec.bestPhotosStoryTopic || rec.documentNumber || rec.id}" berhasil dihapus.`
      );
    } catch (err: any) {
      setDocErrorMessage(err.message || 'Gagal menghapus dokumentasi.');
    }
  };

  useEffect(() => {
    let active = true;
    api
      .getMeetingMinutes(tor.id)
      .then((res) => {
        if (active && Array.isArray(res)) {
          setMinutes(res);
        }
      })
      .catch(() => {});

    api
      .getCashAdvanceSummary(tor.id)
      .then((res) => {
        if (active && res?.summary) {
          setSummaryData(res.summary);
        }
      })
      .catch(() => {});

    setLoadingDocList(true);
    api
      .getDocumentationList(tor.id)
      .then((listRes) => {
        if (!active) return;
        if (Array.isArray(listRes) && listRes.length > 0) {
          setDocList(listRes);
          const matchedDoc =
            (initialTargetId && listRes.find((d) => d.id === initialTargetId)) || listRes[0];
          hydrateDocumentationState(matchedDoc);
          if (stageNumber === 5 && initialViewMode) {
            setDocViewMode(initialViewMode);
          }
        } else {
          api
            .getDocumentation(tor.id)
            .then((singleRes) => {
              if (!active) return;
              if (singleRes && singleRes.torId && singleRes.bestPhotosStoryTopic) {
                setDocList([singleRes]);
                hydrateDocumentationState(singleRes);
                if (stageNumber === 5 && initialViewMode) {
                  setDocViewMode(initialViewMode);
                }
              } else {
                setDocList([]);
                if (stageNumber === 5 && initialViewMode === 'form') {
                  setDocViewMode('form');
                }
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingDocList(false);
      });

    return () => {
      active = false;
    };
  }, [tor.id]);

  const timelineItems = tor.timelineItems || [];
  const specificObjectives = tor.specificObjectives || [];
  const participantRows = tor.participantRows || [];
  const roles = tor.rolesResponsibilities || [];

  // Existing story topic names for quick selection / grouping
  const existingStoryTopics = useMemo(() => {
    const set = new Set<string>();
    docList.forEach((d) => {
      const t = (d.bestPhotosStoryTopic || '').trim();
      if (t) set.add(t);
    });
    return Array.from(set);
  }, [docList]);

  // Filtered & Grouped Documentation List by Nama Topik Cerita (bestPhotosStoryTopic)
  const filteredDocList = useMemo(() => {
    const q = docSearchQuery.trim().toLowerCase();
    if (!q) return docList;
    return docList.filter((item) => {
      const inTopic = (item.bestPhotosStoryTopic || '').toLowerCase().includes(q);
      const inDocNum = (item.documentNumber || '').toLowerCase().includes(q);
      const inStories = (item.humanInterestStories || []).some((s) =>
        (s.storyTitle || '').toLowerCase().includes(q)
      );
      const inPhotos = (item.bestPhotos || []).some(
        (p) =>
          (p.photoNameTitle || '').toLowerCase().includes(q) ||
          (p.photographer || '').toLowerCase().includes(q) ||
          (p.photoLocation || '').toLowerCase().includes(q)
      );
      return inTopic || inDocNum || inStories || inPhotos;
    });
  }, [docList, docSearchQuery]);

  const groupedDocumentationByTopic = useMemo(() => {
    const map = new Map<string, ActivityDocumentationRecord[]>();
    filteredDocList.forEach((item) => {
      const key =
        (item.bestPhotosStoryTopic || '').trim() || 'Topik Cerita Belum Ditentukan';
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(item);
    });
    return Array.from(map.entries()).map(([topicName, items]) => ({
      topicName,
      items,
    }));
  }, [filteredDocList]);

  // Handlers for Stage 05 Documentation
  const handleUpdateBestPhoto = (
    slotNumber: number,
    field: keyof Omit<BestPhotoSlot, 'slotNumber'>,
    value: string
  ) => {
    setBestPhotos((prev) =>
      prev.map((slot) =>
        slot.slotNumber === slotNumber ? { ...slot, [field]: value } : slot
      )
    );
  };

  const handleAddHumanInterestStory = () => {
    setHumanInterestStories((prev) => [
      ...prev,
      {
        id: `his-${Date.now()}-${prev.length + 1}`,
        storyTitle: '',
        storyLink: '',
      },
    ]);
  };

  const handleRemoveHumanInterestStory = (id: string) => {
    setHumanInterestStories((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateHumanInterestStory = (
    id: string,
    field: 'storyTitle' | 'storyLink',
    value: string
  ) => {
    setHumanInterestStories((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleAddGeneralPhotoLink = () => {
    setGeneralPhotoLinks((prev) => [
      ...prev,
      {
        id: `gpl-${Date.now()}-${prev.length + 1}`,
        url: '',
      },
    ]);
  };

  const handleRemoveGeneralPhotoLink = (id: string) => {
    if (generalPhotoLinks.length <= 1) return;
    setGeneralPhotoLinks((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateGeneralPhotoLink = (id: string, value: string) => {
    setGeneralPhotoLinks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, url: value } : item))
    );
  };

  const handleSaveDocumentation = async () => {
    if (!bestPhotosStoryTopic.trim()) {
      setDocErrorMessage(
        'Mohon isi Nama Topik Cerita / Angle terlebih dahulu.'
      );
      return;
    }
    setIsSavingDoc(true);
    setDocSaveMessage(null);
    setDocErrorMessage(null);
    try {
      const cleanedStories = humanInterestStories.filter(
        (s) => s.storyTitle.trim() !== '' || s.storyLink.trim() !== ''
      );
      const res = await api.saveDocumentationItem(tor.id, {
        id: editingDocId || undefined,
        documentNumber: editingDocNumber,
        bestPhotosStoryTopic: bestPhotosStoryTopic.trim(),
        bestPhotos,
        humanInterestStories: cleanedStories,
        generalPhotoLinks,
      });
      if (res && res.torId) {
        hydrateDocumentationState(res);
        setDocList((prev) => {
          const exists = prev.some((d) => d.id === res.id);
          if (exists) {
            return prev.map((d) => (d.id === res.id ? res : d));
          }
          return [res, ...prev];
        });
      }
      if (onRefresh) onRefresh();
      setDocSaveMessage(
        `Dokumentasi "${res.bestPhotosStoryTopic}" (${res.documentNumber || ''}) berhasil disimpan.`
      );
      setDocViewMode('list');
    } catch (err: any) {
      setDocErrorMessage(err.message || 'Gagal menyimpan dokumentasi kegiatan.');
    } finally {
      setIsSavingDoc(false);
    }
  };

  const handleExportDocumentationDocx = () => {
    const bestPhotosRows = bestPhotos
      .map(
        (slot) => `
        <tr>
          <td style="border:1px solid #000; padding:6px; text-align:center; font-weight:bold;">Foto #${slot.slotNumber}</td>
          <td style="border:1px solid #000; padding:6px;">${slot.photoNameTitle || '-'}</td>
          <td style="border:1px solid #000; padding:6px;">${slot.photoLink || '-'}</td>
          <td style="border:1px solid #000; padding:6px;">${slot.photoLocation || '-'}</td>
          <td style="border:1px solid #000; padding:6px;">${slot.photographer || '-'}</td>
        </tr>`
      )
      .join('');

    const filledStories = humanInterestStories.filter(
      (s) => s.storyTitle.trim() !== '' || s.storyLink.trim() !== ''
    );
    const hisRows =
      filledStories.length > 0
        ? filledStories
            .map(
              (story, idx) => `
        <tr>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #000; padding:6px;">${story.storyTitle || '-'}</td>
          <td style="border:1px solid #000; padding:6px;">${story.storyLink || '-'}</td>
        </tr>`
            )
            .join('')
        : `<tr><td colspan="3" style="border:1px solid #000; padding:6px; text-align:center;">- (Opsional / Tidak ada Human Interest Story)</td></tr>`;

    const generalRows = generalPhotoLinks
      .map(
        (link, idx) => `
        <tr>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #000; padding:6px;">${link.url || '-'}</td>
        </tr>`
      )
      .join('');

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset="utf-8">
        <title>DOKUMENTASI_${editingDocNumber || tor.torNumber}</title>
        <style>
          body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000000; line-height: 1.38; }
          .section-bar { background-color: #CCCCCC; font-weight: bold; padding: 4px 8px; margin-top: 14px; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          td, th { border: 1px solid #000000; padding: 6px 8px; vertical-align: top; font-size: 11pt; }
        </style>
      </head>
      <body>
        <div style="text-align:center; font-weight:bold; font-size:14pt; text-transform:uppercase; margin-bottom:14px;">
          DOKUMENTASI KEGIATAN (DOCUMENTATION)<br/>
          ${tor.title}
        </div>
        <table>
          <tr><td style="width:30%; font-weight:bold;">Nomor Dokumentasi</td><td><strong>${editingDocNumber || '001/DOC/WIJNA/X/2026'}</strong></td></tr>
          <tr><td style="font-weight:bold;">Nama Topik Cerita / Angle</td><td><strong>${bestPhotosStoryTopic || '-'}</strong></td></tr>
          <tr><td style="font-weight:bold;">Referensi TOR</td><td>${tor.torNumber} — ${tor.title}</td></tr>
          <tr><td style="font-weight:bold;">Program Terkait</td><td>${tor.programName}</td></tr>
          <tr><td style="font-weight:bold;">Lokasi &amp; Periode</td><td>${tor.location} (${formatIndonesianDate(tor.startDate)} – ${formatIndonesianDate(tor.endDate)})</td></tr>
        </table>
        <div class="section-bar">1. Five Best Photos (5 Foto Terbaik &amp; 1 Topik Cerita/Angle)</div>
        <p><strong>Topik Cerita / Angle (1 Topik untuk 5 Foto Terbaik):</strong> ${bestPhotosStoryTopic || '-'}</p>
        <table>
          <thead>
            <tr>
              <th>Slot</th>
              <th>Photo Name / Title (Setiap orang yang ada di foto tersebut)</th>
              <th>Photo Link (URL)</th>
              <th>Photo Location</th>
              <th>Photographer</th>
            </tr>
          </thead>
          <tbody>${bestPhotosRows}</tbody>
        </table>
        <div class="section-bar">2. Human Interest Story dengan 5 Foto Tadi (Opsional)</div>
        <table>
          <thead>
            <tr><th>No</th><th>Story Title</th><th>Story Link (URL Cerita)</th></tr>
          </thead>
          <tbody>${hisRows}</tbody>
        </table>
        <div class="section-bar">3. General Photo Documentation</div>
        <table>
          <thead>
            <tr><th>No</th><th>General Photo Link (URL Folder Dokumentasi Keseluruhan Kegiatan)</th></tr>
          </thead>
          <tbody>${generalRows}</tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/msword;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DOKUMENTASI_${(editingDocNumber || tor.torNumber).replace(/[^a-zA-Z0-9-_]/g, '_')}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ============================================================================
  // STAGE 05: DOCUMENTATION (SIMPLE LIST LIKE TOR / NOTULEN + FORM + PREVIEW)
  // ============================================================================
  if (stageNumber === 5) {
    const filledBestPhotosCount = bestPhotos.filter(
      (s) => s.photoNameTitle.trim() && s.photoLink.trim()
    ).length;

    return (
      <div className="space-y-4">
        {docSaveMessage && (
          <div className="px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-2 print:hidden">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{docSaveMessage}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onNavigateStage(6)}
                className="underline font-medium text-emerald-900 hover:text-emerald-950 cursor-pointer"
              >
                Lihat di 06. Monitoring →
              </button>
              <button
                type="button"
                onClick={() => setDocSaveMessage(null)}
                className="p-0.5 hover:opacity-75 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {docErrorMessage && (
          <div className="px-4 py-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2 print:hidden">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{docErrorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setDocErrorMessage(null)}
              className="p-0.5 hover:opacity-75 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* VIEW 1: DAFTAR DOKUMENTASI SEDERHANA (SAMA SEPERTI TOR & NOTULEN) */}
        {/* ================================================================ */}
        {docViewMode === 'list' && (
          <div className="space-y-3 print:hidden">
            {/* Top Bar: Search + Total Counter + Buat Dokumentasi */}
            <div className="bg-white rounded-lg border border-[#EAEAEA] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative flex-1 min-w-[240px] max-w-md">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={docSearchQuery}
                    onChange={(e) => setDocSearchQuery(e.target.value)}
                    placeholder="Cari nama topik cerita atau nomor dokumen..."
                    className="w-full h-8 pl-8 pr-3 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                  />
                </div>
                <span className="text-xs text-stone-500">
                  Total <strong className="text-stone-900">{filteredDocList.length}</strong> Dokumentasi
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleStartCreateDocumentation('')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Buat Dokumentasi</span>
              </button>
            </div>

            {/* Simple Flat List Container (Mirip Daftar TOR & Notulen) */}
            <div className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
              {loadingDocList ? (
                <div className="py-16 text-center text-stone-500 text-xs">
                  Memuat daftar dokumentasi kegiatan...
                </div>
              ) : filteredDocList.length === 0 ? (
                <div className="py-16 text-center text-stone-500 space-y-2">
                  <FileText className="w-7 h-7 text-stone-300 mx-auto" />
                  <p className="font-medium text-stone-800 text-sm">Belum ada dokumen Dokumentasi Kegiatan</p>
                  <p className="text-xs text-stone-500">
                    Klik tombol &quot;+ Buat Dokumentasi&quot; untuk menambahkan dokumentasi kegiatan.
                  </p>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => handleStartCreateDocumentation('')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Buat Dokumentasi</span>
                    </button>
                  </div>
                </div>
              ) : (
                filteredDocList.map((item, idx) => {
                  const docNum = item.documentNumber || formatDocumentationNumber(idx + 1);
                  const topicTitle =
                    item.bestPhotosStoryTopic?.trim() ||
                    item.humanInterestStories?.find((s) => s.storyTitle?.trim())?.storyTitle ||
                    `Dokumentasi Kegiatan ${tor.title}`;
                  const formattedDate = formatIndonesianDate(
                    (item.updatedAt || item.createdAt || '').slice(0, 10)
                  ).toUpperCase();

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleOpenDocumentationRecord(item, 'preview')}
                      className="px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-[#F7F7F5] transition-colors cursor-pointer group"
                    >
                      {/* Left Column: Dot, Nama Topik Cerita, Nomor Dokumen */}
                      <div className="flex-1 flex items-start gap-3 min-w-0 pr-3">
                        <div className="pt-1.5 shrink-0">
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[15px] font-medium text-[#2F3437] group-hover:text-[#1D4ED8] transition-colors leading-snug break-words">
                            {topicTitle}
                          </h3>
                          <div className="text-[12px] text-[#1D4ED8] font-mono font-semibold mt-1 break-all">
                            {docNum}
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Tanggal Dibuat & Simple Actions (Lihat, Edit, Hapus) */}
                      <div
                        className="flex items-center justify-between sm:justify-end gap-3.5 shrink-0 pl-5 sm:pl-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="w-[2px] h-7 rounded-full bg-[#EDEDEC] hidden sm:block shrink-0" />

                        <div className="text-left sm:text-right leading-tight min-w-[110px]">
                          <div className="text-[12px] font-semibold tracking-wider text-[#2F3437] uppercase font-sans">
                            {formattedDate}
                          </div>
                          <div className="text-[11px] text-[#787774] mt-0.5">
                            Tanggal Dibuat
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenDocumentationRecord(item, 'preview')}
                            className="px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-xs font-medium transition-colors cursor-pointer"
                            title="Lihat / Cetak Dokumentasi"
                          >
                            Lihat
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDocumentationRecord(item, 'form')}
                            className="px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-xs font-medium transition-colors cursor-pointer"
                            title="Edit Dokumentasi"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDocumentationRecord(item)}
                            className="p-1.5 text-stone-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Hapus Dokumentasi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* VIEW 2: PREVIEW DOKUMEN RESMI (SAMA SEPERTI TOR & NOTULEN)       */}
        {/* ================================================================ */}
        {docViewMode === 'preview' && (
          <div className="space-y-4">
            <div className="bg-white rounded-md border border-stone-200/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 print:hidden">
              <button
                type="button"
                onClick={() => setDocViewMode('list')}
                className="text-xs font-medium text-stone-600 hover:text-stone-900 cursor-pointer"
              >
                ← Kembali ke Daftar Dokumentasi
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDocViewMode('form')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Dokumentasi</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportDocumentationDocx}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export DOCX</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadElementAsPdf({
                      filename: `${editingDocNumber || 'Dokumentasi_Kegiatan'}_${tor.title}`,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Simpan / Download PDF</span>
                </button>
              </div>
            </div>

            <article
              className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-8 py-8 sm:px-14 sm:py-12 shadow-xs space-y-5 text-[14px] leading-[1.38] text-black"
              style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
            >
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
                      {editingDocNumber || '001/DOC/WIJNA/X/2026'}
                    </td>
                  </tr>
                  <tr className="align-top">
                    <td className="font-bold py-1.5 px-2.5 border border-black">
                      Nama Topik Cerita / Angle
                    </td>
                    <td className="py-1.5 px-2.5 border border-black font-bold">
                      {bestPhotosStoryTopic || '-'}
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
              <section>
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  1. Five Best Photos (5 Foto Terbaik &amp; 1 Topik Cerita/Angle)
                </div>
                <div className="mb-2.5">
                  <strong>Topik Cerita / Angle (1 Topik Cerita untuk 5 Foto Terbaik):</strong>{' '}
                  {bestPhotosStoryTopic || '-'}
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
                    {bestPhotos.map((slot) => (
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
              </section>

              {/* 2. Human Interest Story dengan 5 foto tadi (Opsional) */}
              <section>
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
                    {humanInterestStories.filter(
                      (s) => s.storyTitle.trim() !== '' || s.storyLink.trim() !== ''
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
                      humanInterestStories
                        .filter((s) => s.storyTitle.trim() !== '' || s.storyLink.trim() !== '')
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
              </section>

              {/* 3. General Photo Documentation */}
              <section>
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
                    {generalPhotoLinks.map((gpl, idx) => (
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
                    ))}
                  </tbody>
                </table>
              </section>
            </article>
          </div>
        )}

        {/* ================================================================ */}
        {/* VIEW 3: EDITOR FORM DOKUMENTASI                                  */}
        {/* ================================================================ */}
        {docViewMode === 'form' && (
          <div className="bg-white rounded-lg border border-stone-200 overflow-hidden print:hidden">
            {/* Compact Header Matching NotulenStage & TorFormModal */}
            <header className="bg-white border-b border-stone-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setDocViewMode('list')}
                  className="text-xs font-medium text-stone-600 hover:text-stone-900 mr-1 cursor-pointer"
                >
                  ← Daftar Dokumentasi
                </button>
                <span className="px-2 py-0.5 text-[11px] font-medium bg-stone-100 text-stone-600 rounded shrink-0">
                  {editingDocId ? 'Edit Dokumentasi' : 'Draft Dokumentasi Baru'}
                </span>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-xs font-mono text-stone-700 truncate">
                  <span className="text-[11px] font-sans text-stone-400">No:</span>
                  <span className="font-semibold text-stone-800 truncate">
                    {editingDocNumber}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setDocViewMode('preview')}
                  className="px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 border border-stone-200 rounded transition-colors cursor-pointer"
                >
                  Preview Dokumen
                </button>
                <button
                  type="button"
                  onClick={handleSaveDocumentation}
                  disabled={isSavingDoc}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 rounded transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSavingDoc ? 'Menyimpan...' : 'Simpan Dokumentasi'}
                </button>
                <button
                  type="button"
                  onClick={() => setDocViewMode('list')}
                  className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors ml-1 cursor-pointer"
                  title="Kembali ke Daftar Dokumentasi"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            <div className="p-4 sm:p-6 space-y-5 bg-[#FAF9F6]/50">
              {/* ============================================================ */}
              {/* KOMPONEN 1: 1. FIVE BEST PHOTOS                              */}
              {/* ============================================================ */}
              <section className="bg-white rounded-lg border border-[#EAEAEA] overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-[#EAEAEA] bg-[#F7F7F5] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#2F3437]">
                      1. Five Best Photos
                    </h4>
                    <p className="text-xs text-[#787774] mt-0.5">
                      5 slot link foto terbaik (URL Google Drive atau sumber lainnya, tanpa upload file atau preview foto). Kelima foto mengandung <strong>satu topik cerita/angle</strong>.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-white border border-[#EAEAEA] text-[#2F3437] shrink-0">
                    5 Slot Wajib ({filledBestPhotosCount}/5 Terisi)
                  </span>
                </div>

                <div className="p-4 sm:p-5 space-y-4 text-xs">
                  {/* Satu Topik Cerita / Angle untuk 5 Best Foto */}
                  <div className="p-3.5 rounded-md bg-[#FAF9F6] border border-stone-200 space-y-2">
                    <label className="block font-semibold text-stone-800">
                      Nama Topik Cerita / Angle (Judul Daftar Dokumentasi &amp; 5 Foto Terbaik){' '}
                      <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={bestPhotosStoryTopic}
                      onChange={(e) => setBestPhotosStoryTopic(e.target.value)}
                      placeholder="Contoh: Kemandirian Teknisi Desa Cibuluh Mengelola Krisis Air Bersih Melalui Pemeliharaan Pompa Submersible..."
                      className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-400 focus:outline-none"
                    />
                    {existingStoryTopics.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-stone-500">
                          Pilih Topik Cerita yang sudah ada:
                        </span>
                        {existingStoryTopics.map((topic, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setBestPhotosStoryTopic(topic)}
                            className={`px-2 py-0.5 rounded border text-[11px] transition-colors cursor-pointer ${
                              bestPhotosStoryTopic === topic
                                ? 'bg-stone-900 text-white border-stone-900'
                                : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'
                            }`}
                          >
                            {topic.length > 65 ? `${topic.slice(0, 65)}...` : topic}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 5 Slots Cards */}
                  <div className="space-y-3">
                    {bestPhotos.map((slot) => (
                      <div
                        key={slot.slotNumber}
                        className="p-3.5 rounded-md border border-stone-200 bg-white space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                          <span className="font-semibold text-stone-800">
                            Best Photo #{slot.slotNumber}
                          </span>
                          {slot.photoLink.trim() && (
                            <a
                              href={slot.photoLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-stone-600 hover:text-stone-900 underline"
                            >
                              <span>Buka Link Foto</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="md:col-span-2">
                            <label className="block text-stone-700 font-medium mb-1">
                              Photo Name / Title (Setiap orang yang ada di foto tersebut){' '}
                              <span className="text-rose-600">*</span>
                            </label>
                            <input
                              type="text"
                              value={slot.photoNameTitle}
                              onChange={(e) =>
                                handleUpdateBestPhoto(
                                  slot.slotNumber,
                                  'photoNameTitle',
                                  e.target.value
                                )
                              }
                              placeholder="Sebutkan nama/judul foto beserta nama setiap orang yang ada di foto tersebut..."
                              className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-stone-700 font-medium mb-1">
                              Photo Link (URL Google Drive / Sumber Lainnya){' '}
                              <span className="text-rose-600">*</span>
                            </label>
                            <input
                              type="url"
                              value={slot.photoLink}
                              onChange={(e) =>
                                handleUpdateBestPhoto(
                                  slot.slotNumber,
                                  'photoLink',
                                  e.target.value
                                )
                              }
                              placeholder="https://drive.google.com/file/d/..."
                              className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded font-mono text-stone-800 placeholder:text-stone-300 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-stone-700 font-medium mb-1">
                              Photo Location <span className="text-rose-600">*</span>
                            </label>
                            <input
                              type="text"
                              value={slot.photoLocation}
                              onChange={(e) =>
                                handleUpdateBestPhoto(
                                  slot.slotNumber,
                                  'photoLocation',
                                  e.target.value
                                )
                              }
                              placeholder="Lokasi pengambilan foto..."
                              className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-stone-700 font-medium mb-1">
                              Photographer (Nama Pengambil Foto){' '}
                              <span className="text-rose-600">*</span>
                            </label>
                            <input
                              type="text"
                              value={slot.photographer}
                              onChange={(e) =>
                                handleUpdateBestPhoto(
                                  slot.slotNumber,
                                  'photographer',
                                  e.target.value
                                )
                              }
                              placeholder="Nama pengambil foto..."
                              className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* ============================================================ */}
              {/* KOMPONEN 2: 2. HUMAN INTEREST STORY DENGAN 5 FOTO TADI (OPSIONAL) */}
              {/* ============================================================ */}
              <section className="bg-white rounded-lg border border-[#EAEAEA] overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-[#EAEAEA] bg-[#F7F7F5] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#2F3437]">
                        2. Human Interest Story dengan 5 Foto Tadi
                      </h4>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-white border border-[#EAEAEA] text-[#787774]">
                        Opsional
                      </span>
                    </div>
                    <p className="text-xs text-[#787774] mt-0.5">
                      Opsional — cerita tentang individu, komunitas, pengalaman, atau dampak program yang merujuk pada rangkaian 5 foto terbaik di atas.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddHumanInterestStory}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Cerita</span>
                  </button>
                </div>

                <div className="p-4 sm:p-5 space-y-3 text-xs">
                  {humanInterestStories.length === 0 ? (
                    <div className="py-4 px-3 rounded border border-dashed border-stone-200 text-center text-stone-500">
                      Belum ada Human Interest Story (opsional). Klik tombol &quot;+ Tambah Cerita&quot; jika ingin menambahkan cerita.
                    </div>
                  ) : (
                    humanInterestStories.map((story, idx) => (
                      <div
                        key={story.id}
                        className="p-3.5 rounded-md border border-stone-200 bg-white space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-stone-800">
                            Human Interest Story #{idx + 1}{' '}
                            <span className="text-stone-400 font-normal">(Opsional)</span>
                          </span>
                          <div className="flex items-center gap-2">
                            {story.storyLink.trim() && (
                              <a
                                href={story.storyLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-stone-600 hover:text-stone-900 underline"
                              >
                                <span>Buka Link Cerita</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveHumanInterestStory(story.id)}
                              className="text-stone-400 hover:text-rose-600 p-1 cursor-pointer"
                              title="Hapus cerita"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-stone-700 font-medium mb-1">
                              Story Title <span className="text-stone-400 font-normal">(Opsional)</span>
                            </label>
                            <input
                              type="text"
                              value={story.storyTitle}
                              onChange={(e) =>
                                handleUpdateHumanInterestStory(
                                  story.id,
                                  'storyTitle',
                                  e.target.value
                                )
                              }
                              placeholder="Judul cerita tentang individu, komunitas, pengalaman, atau dampak program..."
                              className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-stone-700 font-medium mb-1">
                              Story Link (URL Cerita){' '}
                              <span className="text-stone-400 font-normal">(Opsional)</span>
                            </label>
                            <input
                              type="url"
                              value={story.storyLink}
                              onChange={(e) =>
                                handleUpdateHumanInterestStory(
                                  story.id,
                                  'storyLink',
                                  e.target.value
                                )
                              }
                              placeholder="https://docs.google.com/document/d/..."
                              className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded font-mono text-stone-800 placeholder:text-stone-300 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* ============================================================ */}
              {/* KOMPONEN 3: 3. GENERAL PHOTO DOCUMENTATION                   */}
              {/* ============================================================ */}
              <section className="bg-white rounded-lg border border-[#EAEAEA] overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-[#EAEAEA] bg-[#F7F7F5] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#2F3437]">
                      3. General Photo Documentation
                    </h4>
                    <p className="text-xs text-[#787774] mt-0.5">
                      General Photo Link (URL folder dokumentasi foto keseluruhan kegiatan). Dapat menambahkan lebih dari satu link.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddGeneralPhotoLink}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Link Folder</span>
                  </button>
                </div>

                <div className="p-4 sm:p-5 space-y-3 text-xs">
                  {generalPhotoLinks.map((gpl, idx) => (
                    <div
                      key={gpl.id}
                      className="p-3.5 rounded-md border border-stone-200 bg-white space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-stone-800">
                          General Photo Link #{idx + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          {gpl.url.trim() && (
                            <a
                              href={gpl.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-stone-600 hover:text-stone-900 underline"
                            >
                              <span>Buka Folder Dokumentasi</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {generalPhotoLinks.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveGeneralPhotoLink(gpl.id)}
                              className="text-stone-400 hover:text-rose-600 p-1 cursor-pointer"
                              title="Hapus link"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-stone-700 font-medium mb-1">
                          General Photo Link (URL Folder Dokumentasi Keseluruhan Kegiatan){' '}
                          <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="url"
                          value={gpl.url}
                          onChange={(e) => handleUpdateGeneralPhotoLink(gpl.id, e.target.value)}
                          placeholder="https://drive.google.com/drive/folders/..."
                          className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded font-mono text-stone-800 placeholder:text-stone-300 focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Bottom Save Bar */}
              <div className="bg-white rounded-lg border border-[#EAEAEA] px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-[#787774]">
                  {docRecord?.updatedAt ? (
                    <span>
                      Terakhir disimpan oleh{' '}
                      <strong>{docRecord.updatedByName || tor.picName}</strong> pada{' '}
                      {formatIndonesianDate(docRecord.updatedAt.slice(0, 10))}
                    </span>
                  ) : (
                    <span>
                      Pastikan Nama Topik Cerita dan ketiga komponen dokumentasi telah diisi sebelum menyimpan.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDocViewMode('list')}
                    className="px-3 py-1.5 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocViewMode('preview')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Preview Dokumen</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveDocumentation}
                    disabled={isSavingDoc}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#2F3437] hover:bg-stone-800 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingDoc ? 'Menyimpan...' : 'Simpan Dokumentasi'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // STAGE 06: MONITORING (INTEGRASI OTOMATIS TOR, CASH ADVANCE & MONITORING TOOLS)
  // ============================================================================
  if (stageNumber === 6) {
    return (
      <MonitoringStageView
        tor={tor}
        cashAdvances={cashAdvances}
        onNavigateStage={onNavigateStage}
        initialReportId={initialTargetId}
        initialViewMode={initialViewMode}
        onRefresh={onRefresh}
      />
    );
  }

  // ============================================================================
  // STAGE 07: LAPORAN TOR / LAPORAN KONTRIBUSI (GABUNGAN DOKUMEN UKURAN LEGAL)
  // ============================================================================
  if (stageNumber === 7) {
    return (
      <LaporanTorStageView
        tor={tor}
        cashAdvances={cashAdvances}
        onNavigateStage={onNavigateStage}
        onRefresh={onRefresh}
      />
    );
  }

  // ============================================================================
  // STAGE 08: LAPORAN KEUANGAN (AKUMULASI DANA BERDASARKAN KODE & MASTER KODE)
  // ============================================================================
  const budgetRequested = tor.budgetRequested != null ? Number(tor.budgetRequested) : null;
  const budgetApproved = tor.budgetApproved != null ? Number(tor.budgetApproved) : null;
  const activeCas = cashAdvances.filter((c) => c.status !== 'Ditolak');

  const summaryRows: any[] = Array.isArray(summaryData?.summaryRows)
    ? summaryData.summaryRows
    : [];

  // Akumulasi dana berdasarkan Kode Budget & Master Kode (tanpa pemecahan Tahap 1, 2, dst.)
  interface AccumulatedBudgetCodeRow {
    code: string;
    masterName: string;
    activityCode: string;
    outcomeName: string;
    outputName: string;
    activityDescription: string;
    advanceAmount: number;
    actualSpent: number;
    remaining: number;
    shortage: number;
    percentUsed: number;
    itemCount: number;
    caNumbers: string[];
    notesList: string[];
  }

  // Hanya Cash Advance yang TELAH DITUTUP (isReported === true) yang masuk ke dalam tabel Laporan Keuangan Tahap 08
  const closedCas = activeCas.filter((c) => Boolean(c.isReported));
  const accumulatedMap = new Map<string, AccumulatedBudgetCodeRow>();

  closedCas.forEach((ca) => {
    const items = ca.items && ca.items.length > 0 ? ca.items : [];
    if (items.length > 0) {
      items.forEach((item, idx) => {
        const rowKey = `${ca.id}-${item.id || idx}`;
        const matchedSummaryRow = summaryRows.find((sr) => sr.id === rowKey);
        const rawCode =
          matchedSummaryRow?.budgetCode ||
          item.budgetCode ||
          tor.activityCode ||
          tor.hierarchyCode ||
          '-';
        const resolved = resolveMasterBudgetByCode(rawCode, tor);
        const key = resolved.code;

        const advAmt = Number(item.totalAmount) || 0;
        const spentAmt =
          matchedSummaryRow?.actualSpent !== undefined
            ? Number(matchedSummaryRow.actualSpent)
            : item.actualSpent !== undefined
            ? Number(item.actualSpent)
            : ca.isReported && ca.realizedAmount !== undefined && items.length === 1
            ? Number(ca.realizedAmount)
            : advAmt;

        const existing = accumulatedMap.get(key);
        const noteText = (matchedSummaryRow?.notes || item.notes || '').trim();

        if (existing) {
          existing.advanceAmount += advAmt;
          existing.actualSpent += spentAmt;
          existing.itemCount += 1;
          if (!existing.caNumbers.includes(ca.advanceNumber)) {
            existing.caNumbers.push(ca.advanceNumber);
          }
          if (noteText && !existing.notesList.includes(noteText)) {
            existing.notesList.push(noteText);
          }
        } else {
          accumulatedMap.set(key, {
            code: resolved.code,
            masterName: resolved.masterName,
            activityCode: resolved.activityCode,
            outcomeName: resolved.outcomeName,
            outputName: resolved.outputName,
            activityDescription: resolved.activityDescription,
            advanceAmount: advAmt,
            actualSpent: spentAmt,
            remaining: 0,
            shortage: 0,
            percentUsed: 0,
            itemCount: 1,
            caNumbers: [ca.advanceNumber],
            notesList: noteText ? [noteText] : [],
          });
        }
      });
    } else {
      const rowKey = `${ca.id}-main`;
      const matchedSummaryRow = summaryRows.find((sr) => sr.id === rowKey);
      const resolved = resolveMasterBudgetByCode(
        tor.activityCode || tor.hierarchyCode || '-',
        tor
      );
      const key = resolved.code;
      const advAmt = Number(ca.totalAmount) || 0;
      const spentAmt =
        matchedSummaryRow?.actualSpent !== undefined
          ? Number(matchedSummaryRow.actualSpent)
          : ca.realizedAmount !== undefined
          ? Number(ca.realizedAmount)
          : advAmt;

      const existing = accumulatedMap.get(key);
      if (existing) {
        existing.advanceAmount += advAmt;
        existing.actualSpent += spentAmt;
        existing.itemCount += 1;
        if (!existing.caNumbers.includes(ca.advanceNumber)) {
          existing.caNumbers.push(ca.advanceNumber);
        }
      } else {
        accumulatedMap.set(key, {
          code: resolved.code,
          masterName: resolved.masterName,
          activityCode: resolved.activityCode,
          outcomeName: resolved.outcomeName,
          outputName: resolved.outputName,
          activityDescription: resolved.activityDescription,
          advanceAmount: advAmt,
          actualSpent: spentAmt,
          remaining: 0,
          shortage: 0,
          percentUsed: 0,
          itemCount: 1,
          caNumbers: [ca.advanceNumber],
          notesList: [],
        });
      }
    }
  });

  const accumulatedRows: AccumulatedBudgetCodeRow[] = Array.from(
    accumulatedMap.values()
  ).map((row) => {
    const remaining = Math.max(0, row.advanceAmount - row.actualSpent);
    const shortage = Math.max(0, row.actualSpent - row.advanceAmount);
    const percentUsed =
      row.advanceAmount > 0
        ? Math.round((row.actualSpent / row.advanceAmount) * 100)
        : 0;
    return {
      ...row,
      remaining,
      shortage,
      percentUsed,
    };
  });

  const totalCashAdvance =
    accumulatedRows.length > 0
      ? accumulatedRows.reduce((sum, r) => sum + r.advanceAmount, 0)
      : closedCas.reduce((sum, c) => sum + (Number(c.totalAmount) || 0), 0);
  const totalRealizedSpent =
    accumulatedRows.length > 0
      ? accumulatedRows.reduce((sum, r) => sum + r.actualSpent, 0)
      : closedCas.reduce(
          (sum, c) =>
            sum +
            (c.realizedAmount !== undefined
              ? Number(c.realizedAmount)
              : Number(c.totalAmount) || 0),
          0
        );
  const totalRemaining = accumulatedRows.reduce((sum, r) => sum + r.remaining, 0);
  const totalShortage = accumulatedRows.reduce((sum, r) => sum + r.shortage, 0);
  const totalPercentUsed =
    totalCashAdvance > 0
      ? Math.round((totalRealizedSpent / totalCashAdvance) * 100)
      : 0;
  const effectiveTorCeiling = budgetApproved ?? budgetRequested ?? 0;
  const varianceVsTor = effectiveTorCeiling - totalRealizedSpent;

  const formatAccountingCell = (val: number) => {
    if (!val || val === 0) return '-';
    return formatRupiah(val);
  };

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="bg-white rounded-lg border border-[#EAEAEA] px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <div>
          <h3 className="text-sm font-semibold text-[#2F3437]">
            08. Laporan Keuangan &amp; Rekonsiliasi Akumulasi Kode Budget
          </h3>
          <p className="text-xs text-[#787774] mt-0.5">
            Rekapitulasi laporan keuangan berdasarkan akumulasi <strong>Kode Budget</strong> &amp;{' '}
            <strong>Master Kode (Outcome / Jenis Kegiatan)</strong> dari{' '}
            <strong>TOR ({tor.torNumber})</strong>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigateStage(3)}
            className="px-3 py-1.5 rounded border border-[#EAEAEA] bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#2F3437] text-xs font-medium transition-colors cursor-pointer"
          >
            Buka Tahap 03 Ringkasan CA →
          </button>
          <button
            type="button"
            onClick={() =>
              setStage8ViewMode((prev) => (prev === 'preview' ? 'work' : 'preview'))
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-semibold transition-colors cursor-pointer ${
              stage8ViewMode === 'preview'
                ? 'border-[#1E3A8A] bg-blue-50 text-[#1E3A8A] hover:bg-blue-100'
                : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
            }`}
          >
            {stage8ViewMode === 'preview' ? (
              <>
                <Edit3 className="w-3.5 h-3.5" />
                <span>Tampilan Rekonsiliasi</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>Preview Dokumen</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              downloadElementAsPdf({
                filename: `Laporan_Keuangan_${tor.torNumber}`,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#2F3437] hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Simpan PDF Laporan Keuangan</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* FORMAL DOCUMENT PREVIEW MODE (SAMA SEPERTI PREVIEW DOKUMEN LAINNYA)       */}
      {/* ========================================================================= */}
      {stage8ViewMode === 'preview' ? (
        (() => {
          const reportedAdvances = activeCas.filter((c) => c.isReported);
          const closedRowList: { adv: number; sp: number }[] = [];
          reportedAdvances.forEach((ca) => {
            if (ca.items && ca.items.length > 0) {
              ca.items.forEach((item, idx) => {
                const rowKey = `${ca.id}-${item.id || idx}`;
                const matched = summaryRows.find((sr) => sr.id === rowKey);
                const adv = Number(item.totalAmount) || 0;
                const sp =
                  matched !== undefined
                    ? Number(matched.actualSpent) || 0
                    : item.actualSpent !== undefined
                    ? Number(item.actualSpent)
                    : ca.realizedAmount !== undefined && ca.items.length === 1
                    ? Number(ca.realizedAmount)
                    : adv;
                closedRowList.push({ adv, sp });
              });
            } else {
              const rowKey = `${ca.id}-main`;
              const matched = summaryRows.find((sr) => sr.id === rowKey);
              const adv = Number(ca.totalAmount) || 0;
              const sp =
                matched !== undefined
                  ? Number(matched.actualSpent) || 0
                  : ca.realizedAmount !== undefined
                  ? Number(ca.realizedAmount)
                  : adv;
              closedRowList.push({ adv, sp });
            }
          });

          const closedTotalAdvance = closedRowList.reduce((s, r) => s + r.adv, 0);
          const closedTotalSpent = closedRowList.reduce((s, r) => s + r.sp, 0);
          const closedTotalRemaining = closedRowList.reduce(
            (s, r) => s + Math.max(0, r.adv - r.sp),
            0
          );
          const closedTotalShortage = closedRowList.reduce(
            (s, r) => s + Math.max(0, r.sp - r.adv),
            0
          );
          const closedPercentUsed =
            closedTotalAdvance > 0
              ? Math.round((closedTotalSpent / closedTotalAdvance) * 100)
              : 0;

          const finalStatusText = (() => {
            if (reportedAdvances.length === 0) {
              return 'Belum ada laporan Cash Advance yang telah ditutup';
            }
            if (closedTotalRemaining > 0 && closedTotalShortage > 0) {
              return 'Sisa telah dikembalikan ke kas & kekurangan telah dibayarkan ke pemohon';
            }
            if (closedTotalRemaining > 0) return 'Telah dikembalikan ke kas';
            if (closedTotalShortage > 0) return 'Telah dibayarkan ke pemohon';
            return 'Tidak ada sisa / kurang (Nihil)';
          })();

          const summaryMeta = summaryData || {};
          const effectiveSignDate =
            summaryMeta.reportDate || new Date().toISOString().slice(0, 10);

          const timelineItems = tor.timelineItems || [];
          const coveredStageCount =
            timelineItems.length === 0
              ? activeCas.length > 0
                ? 1
                : 0
              : timelineItems.filter(
                  (tl) =>
                    summaryRows.some((sr: any) => sr.timelineItemId === tl.id) ||
                    activeCas.some(
                      (c) =>
                        c.implementationMode === 'all' ||
                        (c.implementationTimelineIds || []).includes(tl.id) ||
                        (c.items || []).some((it) => it.timelineItemId === tl.id)
                    )
                ).length;
          const totalStageCount = Math.max(1, timelineItems.length);
          const allStagesHaveCa =
            activeCas.length > 0 && coveredStageCount >= totalStageCount;
          const allCasReported =
            activeCas.length > 0 && activeCas.every((c) => Boolean(c.isReported));
          const canTriggerFinalFinancialClosure = allStagesHaveCa && allCasReported;

          const lastReportedCa =
            reportedAdvances.length > 0
              ? reportedAdvances[reportedAdvances.length - 1]
              : null;

          const isFinalReported =
            Boolean(summaryMeta.summaryReportedAt) ||
            (canTriggerFinalFinancialClosure && Boolean(lastReportedCa?.isReported));
          const isFinalVerifiedByFinance =
            Boolean(summaryMeta.summaryVerifiedAt) ||
            summaryMeta.summaryApprovalStatus === 'Menunggu Persetujuan Director' ||
            summaryMeta.summaryApprovalStatus === 'Telah Disetujui' ||
            (canTriggerFinalFinancialClosure &&
              reportedAdvances.length > 0 &&
              reportedAdvances.every(
                (c) =>
                  Boolean(c.reportVerifiedAt) ||
                  c.reportApprovalStatus === 'Menunggu Persetujuan Director' ||
                  c.reportApprovalStatus === 'Telah Disetujui'
              ));
          const isFinalApprovedByDirector =
            Boolean(summaryMeta.summaryApprovedAt) ||
            summaryMeta.summaryApprovalStatus === 'Telah Disetujui' ||
            (canTriggerFinalFinancialClosure &&
              reportedAdvances.length > 0 &&
              reportedAdvances.every(
                (c) =>
                  Boolean(c.reportApprovedAt) ||
                  c.reportApprovalStatus === 'Telah Disetujui'
              ));

          return (
            <article
              className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-8 py-8 sm:px-14 sm:py-12 shadow-xs space-y-5 text-[13.5px] leading-[1.38] text-black"
              style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
            >
              {/* Judul Dokumen Resmi */}
              <div className="text-center pb-1">
                <h1 className="text-[16px] font-bold uppercase tracking-normal text-black leading-snug">
                  LAPORAN KEUANGAN &amp; REKAPITULASI AKUMULASI DANA PER KODE BUDGET
                </h1>
                <div className="text-[14px] font-bold uppercase text-black mt-0.5 leading-snug">
                  {organizationName} — {tor.title}
                </div>
              </div>

              {/* Informasi Referensi TOR & Cakupan Laporan */}
              <table className="w-full text-left border-collapse border border-black text-[13px]">
                <tbody>
                  <tr className="align-top">
                    <td className="w-56 font-bold py-1.5 px-2.5 border border-black">
                      Nomor Referensi TOR
                    </td>
                    <td className="py-1.5 px-2.5 border border-black font-bold">
                      {tor.torNumber}
                    </td>
                    <td className="w-52 font-bold py-1.5 px-2.5 border border-black">
                      Cakupan Tahap Implementasi
                    </td>
                    <td className="py-1.5 px-2.5 border border-black">
                      {coveredStageCount} / {totalStageCount} Tahap Memiliki CA
                    </td>
                  </tr>
                  <tr className="align-top">
                    <td className="font-bold py-1.5 px-2.5 border border-black">
                      Program &amp; Kegiatan
                    </td>
                    <td className="py-1.5 px-2.5 border border-black">
                      <strong>{tor.programName || organizationName}</strong> — {tor.title}
                    </td>
                    <td className="font-bold py-1.5 px-2.5 border border-black">
                      Laporan Cash Advance Ditutup
                    </td>
                    <td className="py-1.5 px-2.5 border border-black font-bold">
                      {reportedAdvances.length} / {activeCas.length} Cash Advance
                    </td>
                  </tr>
                  <tr className="align-top">
                    <td className="font-bold py-1.5 px-2.5 border border-black">
                      Pemohon / Pelaksana Kegiatan
                    </td>
                    <td className="py-1.5 px-2.5 border border-black">
                      {summaryMeta.summaryReportedByName ||
                        lastReportedCa?.reportedByName ||
                        activeCas[0]?.requesterName ||
                        tor.picName ||
                        tor.createdByName}
                    </td>
                    <td className="font-bold py-1.5 px-2.5 border border-black">
                      Tanggal Laporan
                    </td>
                    <td className="py-1.5 px-2.5 border border-black">
                      {formatIndonesianDate(effectiveSignDate)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* 1. Rekapitulasi Akumulasi Dana per Kode Budget */}
              <section>
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  1. Rekapitulasi Akumulasi Dana per Kode Budget &amp; Master Kode Outcome
                </div>
                <table className="w-full table-fixed text-left border-collapse border border-black text-[12px]">
                  <thead>
                    <tr className="bg-[#EFEFEF] text-black font-bold">
                      <th className="py-1.5 px-1.5 w-[4.5%] text-center border border-black">
                        No
                      </th>
                      <th className="py-1.5 px-2 w-[9.5%] text-center border border-black">
                        Kode Budget
                      </th>
                      <th className="py-1.5 px-2.5 w-[27%] border border-black">
                        Jenis Kegiatan (berdasarkan Budget / Outcome)
                      </th>
                      <th className="py-1.5 px-2 w-[12%] text-right border border-black">
                        Uang Muka Diterima (Rp)
                      </th>
                      <th className="py-1.5 px-2 w-[12%] text-right border border-black">
                        Realisasi Belanja (Rp)
                      </th>
                      <th className="py-1.5 px-2 w-[10.5%] text-right border border-black">
                        Sisa Uang Muka (Rp)
                      </th>
                      <th className="py-1.5 px-2 w-[8.5%] text-right border border-black">
                        Minus (Rp)
                      </th>
                      <th className="py-1.5 px-1.5 w-[6%] text-center border border-black">
                        %
                      </th>
                      <th className="py-1.5 px-2 w-[10%] text-center border border-black">
                        Keterangan
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {accumulatedRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="py-4 px-3 text-center italic border border-black text-black"
                        >
                          Belum ada laporan Cash Advance yang telah ditutup pada Tahap 03 (Ringkasan Cash Advance). Data pada tabel ini hanya menampilkan data dari Cash Advance yang laporannya telah ditutup.
                        </td>
                      </tr>
                    ) : (
                      accumulatedRows.map((row, idx) => {
                        const statusNote =
                          row.remaining === 0 && row.shortage === 0
                            ? 'Sesuai anggaran'
                            : row.remaining > 0
                            ? 'Sisa kembali ke kas'
                            : 'Kurang bayar';
                        return (
                          <tr key={row.code} className="align-top">
                            <td className="py-1.5 px-1.5 text-center border border-black">
                              {idx + 1}
                            </td>
                            <td className="py-1.5 px-2 text-center font-bold border border-black break-words">
                              {row.code}
                            </td>
                            <td className="py-1.5 px-2.5 border border-black leading-snug break-words">
                              <div>
                                <strong>{row.masterName}</strong> —{' '}
                                <strong>{row.activityCode}:</strong>{' '}
                                {row.outcomeName || row.activityDescription}
                              </div>
                              {row.activityDescription &&
                                row.outcomeName &&
                                row.activityDescription !== row.outcomeName && (
                                  <div className="text-[11px] mt-0.5">
                                    {row.activityDescription}
                                  </div>
                                )}
                            </td>
                            <td className="py-1.5 px-2 text-right border border-black break-words">
                              {formatAccountingCell(row.advanceAmount)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-bold border border-black break-words">
                              {formatAccountingCell(row.actualSpent)}
                            </td>
                            <td className="py-1.5 px-2 text-right border border-black break-words">
                              {formatAccountingCell(row.remaining)}
                            </td>
                            <td className="py-1.5 px-2 text-right border border-black break-words">
                              {formatAccountingCell(row.shortage)}
                            </td>
                            <td className="py-1.5 px-1.5 text-center font-bold border border-black">
                              {row.percentUsed}%
                            </td>
                            <td className="py-1.5 px-2 text-center border border-black text-[11px] break-words">
                              <div className="font-bold">{statusNote}</div>
                              <div>({row.itemCount} pos)</div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#EFEFEF] font-bold text-black">
                      <td
                        colSpan={3}
                        className="py-1.5 px-2.5 text-right uppercase border border-black"
                      >
                        TOTAL AKUMULASI DANA SELURUH KODE BUDGET
                      </td>
                      <td className="py-1.5 px-2 text-right border border-black break-words">
                        {formatAccountingCell(totalCashAdvance)}
                      </td>
                      <td className="py-1.5 px-2 text-right border border-black break-words">
                        {formatAccountingCell(totalRealizedSpent)}
                      </td>
                      <td className="py-1.5 px-2 text-right border border-black break-words">
                        {formatAccountingCell(totalRemaining)}
                      </td>
                      <td className="py-1.5 px-2 text-right border border-black break-words">
                        {formatAccountingCell(totalShortage)}
                      </td>
                      <td className="py-1.5 px-1.5 text-center border border-black">
                        {totalPercentUsed}%
                      </td>
                      <td className="py-1.5 px-2 text-center border border-black">
                        {accumulatedRows.length} Kode
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </section>

              {/* 2. Ringkasan Akhir (Akumulasi Laporan yang Telah Ditutup) */}
              <section className="space-y-2">
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  2. Ringkasan Akhir (Akumulasi Laporan yang Telah Ditutup)
                </div>
                <table className="w-full table-fixed text-[12.5px] border-collapse border border-black">
                  <tbody>
                    <tr>
                      <td className="py-1.5 px-2.5 w-[39%] border border-black text-black">
                        Total Uang Muka yang Telah Diterima
                      </td>
                      <td className="py-1.5 px-3 w-[42.5%] border border-black text-right font-bold text-black">
                        {formatAccountingCell(closedTotalAdvance)}
                      </td>
                      <td className="py-1.5 px-3 w-[18.5%] border border-black text-center font-bold text-black">
                        {closedTotalAdvance > 0 ? '100%' : '0%'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black text-black">
                        Total Realisasi Belanja yang Telah Dilaporkan
                      </td>
                      <td className="py-1.5 px-3 border border-black text-right font-bold text-black">
                        {formatAccountingCell(closedTotalSpent)}
                      </td>
                      <td className="py-1.5 px-3 border border-black text-center font-bold text-black">
                        {closedPercentUsed}%
                      </td>
                    </tr>
                    <tr className="bg-[#EFEFEF] font-bold">
                      <td className="py-1.5 px-2.5 border border-black text-black">
                        SISA uang muka (telah dikembalikan ke kas)
                      </td>
                      <td className="py-1.5 px-3 border border-black text-right text-black">
                        {formatAccountingCell(closedTotalRemaining)}
                      </td>
                      <td className="py-1.5 px-3 border border-black text-center text-black">
                        {closedTotalAdvance > 0 && closedTotalRemaining > 0
                          ? `${Math.round((closedTotalRemaining / closedTotalAdvance) * 100)}%`
                          : '0%'}
                      </td>
                    </tr>
                    <tr className="bg-[#EFEFEF] font-bold">
                      <td className="py-1.5 px-2.5 border border-black text-black">
                        MINUS (telah dibayarkan kepada pemohon)
                      </td>
                      <td className="py-1.5 px-3 border border-black text-right text-black">
                        {formatAccountingCell(closedTotalShortage)}
                      </td>
                      <td className="py-1.5 px-3 border border-black text-center text-black">
                        {closedTotalAdvance > 0 && closedTotalShortage > 0
                          ? `+${Math.round((closedTotalShortage / closedTotalAdvance) * 100)}%`
                          : '0%'}
                      </td>
                    </tr>
                    <tr className="font-bold">
                      <td className="py-1.5 px-2.5 border border-black text-black">
                        Status Laporan yang Telah Ditutup
                      </td>
                      <td
                        colSpan={2}
                        className="py-1.5 px-3 border border-black text-center text-black font-bold"
                      >
                        {finalStatusText}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="grid grid-cols-1 sm:grid-cols-12 pt-1 text-[12px] italic text-black">
                  <div className="sm:col-span-5 pr-2">Cek uang muka form vs laporan</div>
                  <div className="sm:col-span-7">
                    {reportedAdvances.length > 0
                      ? 'OK – seluruh uang muka pada Form Permintaan Dana & Form Tambahan yang telah ditutup laporan telah tercakup di ringkasan akhir'
                      : 'Menunggu penutupan laporan Cash Advance beserta lampiran Link PDF Expensify'}
                  </div>
                </div>
              </section>

              {/* 3. Lembar Pengesahan & Otorisasi Laporan Keuangan Akhir */}
              <section className="pt-2">
                <div
                  className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]"
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                >
                  3. Lembar Pengesahan &amp; Otorisasi Laporan Keuangan Akhir
                </div>
                <table className="w-full text-center border-collapse border border-black text-[12.5px]">
                  <thead>
                    <tr className="bg-[#EFEFEF] font-bold text-black">
                      <th className="py-1.5 px-2 w-1/3 border border-black">
                        Telah Dilaporkan oleh,
                      </th>
                      <th className="py-1.5 px-2 w-1/3 border border-black">
                        Telah Diperiksa oleh,
                      </th>
                      <th className="py-1.5 px-2 w-1/3 border border-black">
                        Telah Disetujui oleh,
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="align-top">
                      <td className="py-3 px-2 border border-black">
                        <div className="my-2 flex justify-center">
                          <ApprovalBarcodeStamp
                            variant={isFinalReported ? 'authorized' : 'pending'}
                            documentNumber={lastReportedCa?.advanceNumber || tor.torNumber}
                            roleCode="REP"
                            signerName={
                              summaryMeta.summaryReportedByName ||
                              lastReportedCa?.reportedByName ||
                              activeCas[0]?.requesterName ||
                              tor.picName ||
                              tor.createdByName
                            }
                            signDate={
                              summaryMeta.summaryReportedAt ||
                              lastReportedCa?.reportedAt ||
                              effectiveSignDate
                            }
                            statusLabel={
                              isFinalReported
                                ? `TELAH DILAPORKAN (${reportedAdvances.length}/${activeCas.length} CA)`
                                : 'BELUM ADA LAPORAN DITUTUP'
                            }
                          />
                        </div>
                        <div className="font-bold underline">
                          {summaryMeta.summaryReportedByName ||
                            lastReportedCa?.reportedByName ||
                            activeCas[0]?.requesterName ||
                            tor.picName ||
                            tor.createdByName}
                        </div>
                        <div className="text-[11px]">Pemohon / Pelaksana Kegiatan</div>
                      </td>

                      <td className="py-3 px-2 border border-black">
                        <div className="my-2 flex justify-center">
                          <ApprovalBarcodeStamp
                            variant={isFinalVerifiedByFinance ? 'authorized' : 'pending'}
                            documentNumber={lastReportedCa?.advanceNumber || tor.torNumber}
                            roleCode="FIN"
                            signerName={
                              summaryMeta.summaryVerifiedByName ||
                              lastReportedCa?.reportVerifiedByName ||
                              activeCas[0]?.signatures?.verifiedBy?.name ||
                              'Ratna Kusuma, S.E.'
                            }
                            signDate={
                              summaryMeta.summaryVerifiedAt ||
                              lastReportedCa?.reportVerifiedAt ||
                              effectiveSignDate
                            }
                            statusLabel={
                              isFinalVerifiedByFinance
                                ? 'TERVERIFIKASI FINANCE'
                                : isFinalReported
                                ? 'MENUNGGU PEMERIKSAAN FINANCE'
                                : 'MENUNGGU LAPORAN DITUTUP'
                            }
                          />
                        </div>
                        <div className="font-bold underline">
                          {summaryMeta.summaryVerifiedByName ||
                            lastReportedCa?.reportVerifiedByName ||
                            activeCas[0]?.signatures?.verifiedBy?.name ||
                            'Ratna Kusuma, S.E.'}
                        </div>
                        <div className="text-[11px]">Finance &amp; Compliance</div>
                      </td>

                      <td className="py-3 px-2 border border-black">
                        <div className="my-2 flex justify-center">
                          <ApprovalBarcodeStamp
                            variant={isFinalApprovedByDirector ? 'authorized' : 'pending'}
                            documentNumber={lastReportedCa?.advanceNumber || tor.torNumber}
                            roleCode="DIR"
                            signerName={
                              summaryMeta.summaryApprovedByName ||
                              lastReportedCa?.reportApprovedByName ||
                              activeCas[0]?.signatures?.approvedBy?.name ||
                              'Dr. Hendra Wijaya'
                            }
                            signDate={
                              summaryMeta.summaryApprovedAt ||
                              lastReportedCa?.reportApprovedAt ||
                              effectiveSignDate
                            }
                            statusLabel={
                              isFinalApprovedByDirector
                                ? 'DISETUJUI DIRECTOR (FINAL)'
                                : isFinalVerifiedByFinance
                                ? 'MENUNGGU PERSETUJUAN DIRECTOR'
                                : 'MENUNGGU PEMERIKSAAN FINANCE'
                            }
                          />
                        </div>
                        <div className="font-bold underline">
                          {summaryMeta.summaryApprovedByName ||
                            lastReportedCa?.reportApprovedByName ||
                            activeCas[0]?.signatures?.approvedBy?.name ||
                            'Dr. Hendra Wijaya'}
                        </div>
                        <div className="text-[11px]">Executive Director</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </article>
          );
        })()
      ) : (
        /* ========================================================================= */
        /* TABEL LAPORAN KEUANGAN AKUMULASI PER KODE BUDGET & MASTER KODE (GAMBAR 2 & 3) */
        /* ========================================================================= */
        <div className="tor-formal-print-sheet bg-white rounded-lg border border-[#EAEAEA] p-4 sm:p-6 space-y-4">
        <div className="border-b-2 border-slate-900 pb-2 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-extrabold tracking-wide uppercase text-slate-900">
              LAPORAN KEUANGAN &amp; REKAPITULASI AKUMULASI DANA PER KODE BUDGET
            </h2>
            <p className="text-xs text-slate-600">
              {organizationName} — Akumulasi Uang Muka &amp; Realisasi Belanja Berdasarkan Kode Budget dan Master Kode Outcome
            </p>
          </div>
          <div className="text-xs font-mono text-slate-700">
            No. TOR: <strong className="text-slate-900">{tor.torNumber}</strong>
          </div>
        </div>

        {accumulatedRows.length === 0 ? (
          <div className="p-6 text-center text-[#787774] border border-slate-300 rounded text-xs space-y-2">
            <p className="font-medium text-slate-700">
              Belum ada laporan Cash Advance yang telah ditutup pada Tahap 03 (Ringkasan Cash Advance).
            </p>
            <p className="text-[11px] text-slate-500">
              Data pada tabel Laporan Keuangan &amp; Rekapitulasi Akumulasi Dana per Kode Budget ini hanya menampilkan data dari Cash Advance yang laporannya telah ditutup.
            </p>
          </div>
        ) : (
          <div className="w-full overflow-hidden border border-slate-800">
            <table className="w-full table-fixed text-left text-[11.5px] border-collapse">
              <thead>
                <tr className="bg-[#1B365D] text-white font-bold border-b border-slate-800">
                  <th className="py-2.5 px-1.5 w-[4%] text-center border-r border-slate-700 align-middle">
                    No
                  </th>
                  <th className="py-2.5 px-1.5 w-[8.5%] text-center border-r border-slate-700 align-middle">
                    Kode Budget
                  </th>
                  <th className="py-2.5 px-2.5 w-[26.5%] border-r border-slate-700 align-middle">
                    Jenis Kegiatan (berdasarkan Budget / Outcome)
                  </th>
                  <th className="py-2.5 px-2 w-[12%] text-right border-r border-slate-700 align-middle">
                    Uang Muka Diterima (Rp)
                  </th>
                  <th className="py-2.5 px-2 w-[12%] text-right border-r border-slate-700 align-middle">
                    Realisasi Belanja (Rp)
                  </th>
                  <th className="py-2.5 px-2 w-[10%] text-right border-r border-slate-700 align-middle">
                    Sisa Uang Muka (Rp)
                  </th>
                  <th className="py-2.5 px-2 w-[8.5%] text-right border-r border-slate-700 align-middle">
                    Minus (Rp)
                  </th>
                  <th className="py-2.5 px-1.5 w-[7.5%] text-center border-r border-slate-700 align-middle leading-tight">
                    % Terpakai
                  </th>
                  <th className="py-2.5 px-2 w-[11%] text-center align-middle leading-tight">
                    Keterangan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-400 bg-white">
                {accumulatedRows.map((row, idx) => {
                  const statusNote =
                    row.remaining === 0 && row.shortage === 0
                      ? 'Sesuai anggaran'
                      : row.remaining > 0
                      ? 'Sisa kembali ke kas'
                      : 'Kurang bayar';

                  return (
                    <tr
                      key={row.code}
                      className="hover:bg-slate-50/80 transition-colors align-top"
                    >
                      <td className="py-2.5 px-1.5 text-center font-mono text-slate-800 border-r border-slate-400">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-1.5 text-center font-mono font-bold text-emerald-700 border-r border-slate-400 break-words">
                        {row.code}
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-900 border-r border-slate-400 leading-snug break-words">
                        <div>
                          <span className="font-semibold text-slate-900">
                            {row.masterName}
                          </span>{' '}
                          —{' '}
                          <span className="font-mono font-semibold text-[#1E3A8A]">
                            {row.activityCode}:
                          </span>{' '}
                          <span className="text-slate-800">
                            {row.outcomeName || row.activityDescription}
                          </span>
                        </div>
                        {row.activityDescription &&
                          row.outcomeName &&
                          row.activityDescription !== row.outcomeName && (
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              {row.activityDescription}
                            </div>
                          )}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900 border-r border-slate-400 break-words">
                        {formatAccountingCell(row.advanceAmount)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900 border-r border-slate-400 break-words">
                        {formatAccountingCell(row.actualSpent)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-semibold text-emerald-800 bg-[#D9E1F2]/30 border-r border-slate-400 break-words">
                        {formatAccountingCell(row.remaining)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-semibold text-rose-700 bg-[#D9E1F2]/30 border-r border-slate-400 break-words">
                        {formatAccountingCell(row.shortage)}
                      </td>
                      <td className="py-2.5 px-1.5 text-center font-mono font-bold text-slate-900 border-r border-slate-400">
                        {row.percentUsed}%
                      </td>
                      <td className="py-2.5 px-2 text-[11px] text-slate-800 bg-[#FFF3CD]/45 break-words text-center">
                        <div className="font-medium">{statusNote}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {row.itemCount} pos pengeluaran
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[#D9E1F2] font-bold text-slate-900 border-t-2 border-slate-800">
                  <td
                    colSpan={3}
                    className="py-2.5 px-2.5 text-right uppercase tracking-wide border-r border-slate-800"
                  >
                    TOTAL AKUMULASI DANA SELURUH KODE BUDGET
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono border-r border-slate-800 break-words">
                    {formatAccountingCell(totalCashAdvance)}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono border-r border-slate-800 break-words">
                    {formatAccountingCell(totalRealizedSpent)}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-emerald-900 border-r border-slate-800 break-words">
                    {formatAccountingCell(totalRemaining)}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-rose-800 border-r border-slate-800 break-words">
                    {formatAccountingCell(totalShortage)}
                  </td>
                  <td className="py-2.5 px-1.5 text-center font-mono border-r border-slate-800">
                    {totalPercentUsed}%
                  </td>
                  <td className="py-2.5 px-2 text-center text-[11px] font-semibold">
                    {accumulatedRows.length} Kode
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ========================================================================= */}
        {/* RINGKASAN AKHIR (AKUMULASI LAPORAN YANG TELAH DITUTUP) + APPROVAL BARCODE */}
        {/* ========================================================================= */}
        {(() => {
          const reportedAdvances = activeCas.filter((c) => c.isReported);
          const closedRowList: { adv: number; sp: number }[] = [];
          reportedAdvances.forEach((ca) => {
            if (ca.items && ca.items.length > 0) {
              ca.items.forEach((item, idx) => {
                const rowKey = `${ca.id}-${item.id || idx}`;
                const matched = summaryRows.find((sr) => sr.id === rowKey);
                const adv = Number(item.totalAmount) || 0;
                const sp =
                  matched !== undefined
                    ? Number(matched.actualSpent) || 0
                    : item.actualSpent !== undefined
                    ? Number(item.actualSpent)
                    : ca.realizedAmount !== undefined && ca.items.length === 1
                    ? Number(ca.realizedAmount)
                    : adv;
                closedRowList.push({ adv, sp });
              });
            } else {
              const rowKey = `${ca.id}-main`;
              const matched = summaryRows.find((sr) => sr.id === rowKey);
              const adv = Number(ca.totalAmount) || 0;
              const sp =
                matched !== undefined
                  ? Number(matched.actualSpent) || 0
                  : ca.realizedAmount !== undefined
                  ? Number(ca.realizedAmount)
                  : adv;
              closedRowList.push({ adv, sp });
            }
          });

          const closedTotalAdvance = closedRowList.reduce((s, r) => s + r.adv, 0);
          const closedTotalSpent = closedRowList.reduce((s, r) => s + r.sp, 0);
          const closedTotalRemaining = closedRowList.reduce(
            (s, r) => s + Math.max(0, r.adv - r.sp),
            0
          );
          const closedTotalShortage = closedRowList.reduce(
            (s, r) => s + Math.max(0, r.sp - r.adv),
            0
          );
          const closedPercentUsed =
            closedTotalAdvance > 0
              ? Math.round((closedTotalSpent / closedTotalAdvance) * 100)
              : 0;

          const finalStatusText = (() => {
            if (reportedAdvances.length === 0) {
              return 'Belum ada laporan Cash Advance yang telah ditutup';
            }
            if (closedTotalRemaining > 0 && closedTotalShortage > 0) {
              return 'Sisa telah dikembalikan ke kas & kekurangan telah dibayarkan ke pemohon';
            }
            if (closedTotalRemaining > 0) return 'Telah dikembalikan ke kas';
            if (closedTotalShortage > 0) return 'Telah dibayarkan ke pemohon';
            return 'Tidak ada sisa / kurang (Nihil)';
          })();

          const summaryMeta = summaryData || {};
          const effectiveSignDate =
            summaryMeta.reportDate || new Date().toISOString().slice(0, 10);

          const timelineItems = tor.timelineItems || [];
          const coveredStageCount =
            timelineItems.length === 0
              ? activeCas.length > 0
                ? 1
                : 0
              : timelineItems.filter(
                  (tl) =>
                    summaryRows.some((sr: any) => sr.timelineItemId === tl.id) ||
                    activeCas.some(
                      (c) =>
                        c.implementationMode === 'all' ||
                        (c.implementationTimelineIds || []).includes(tl.id) ||
                        (c.items || []).some((it) => it.timelineItemId === tl.id)
                    )
                ).length;
          const totalStageCount = Math.max(1, timelineItems.length);
          const allStagesHaveCa =
            activeCas.length > 0 && coveredStageCount >= totalStageCount;
          const allCasReported =
            activeCas.length > 0 && activeCas.every((c) => Boolean(c.isReported));
          const canTriggerFinalFinancialClosure = allStagesHaveCa && allCasReported;

          const lastReportedCa =
            reportedAdvances.length > 0
              ? reportedAdvances[reportedAdvances.length - 1]
              : null;

          // Complement & upgrade from last financial report approval or summaryMeta
          const isFinalReported =
            Boolean(summaryMeta.summaryReportedAt) ||
            (canTriggerFinalFinancialClosure && Boolean(lastReportedCa?.isReported));
          const isFinalVerifiedByFinance =
            Boolean(summaryMeta.summaryVerifiedAt) ||
            summaryMeta.summaryApprovalStatus === 'Menunggu Persetujuan Director' ||
            summaryMeta.summaryApprovalStatus === 'Telah Disetujui' ||
            (canTriggerFinalFinancialClosure &&
              reportedAdvances.length > 0 &&
              reportedAdvances.every(
                (c) =>
                  Boolean(c.reportVerifiedAt) ||
                  c.reportApprovalStatus === 'Menunggu Persetujuan Director' ||
                  c.reportApprovalStatus === 'Telah Disetujui'
              ));
          const isFinalApprovedByDirector =
            Boolean(summaryMeta.summaryApprovedAt) ||
            summaryMeta.summaryApprovalStatus === 'Telah Disetujui' ||
            (canTriggerFinalFinancialClosure &&
              reportedAdvances.length > 0 &&
              reportedAdvances.every(
                (c) =>
                  Boolean(c.reportApprovedAt) ||
                  c.reportApprovalStatus === 'Telah Disetujui'
              ));

          return (
            <div className="pt-4 space-y-2.5 border-t border-slate-200 w-full">
              <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                <div className="text-sm font-bold text-black uppercase tracking-wide">
                  RINGKASAN AKHIR (AKUMULASI LAPORAN YANG TELAH DITUTUP)
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-medium">
                    Tahap Implementasi Memiliki CA:{' '}
                    <strong className="font-mono text-[#1E3A8A]">
                      {coveredStageCount}/{totalStageCount}
                    </strong>
                  </span>
                  <span className="font-semibold text-slate-700">
                    Laporan yang Telah Ditutup:{' '}
                    <strong className="font-mono text-[#1E3A8A]">
                      {reportedAdvances.length} / {activeCas.length} Cash Advance
                    </strong>
                  </span>
                </div>
              </div>

              {/* Fitur Tutup Laporan & Laporkan Lap. Keuangan Akhir (Gambar 5 & 6) */}
              <div
                className={`p-3 rounded-md border flex flex-wrap items-center justify-between gap-2.5 text-xs print:hidden ${
                  isFinalApprovedByDirector
                    ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                    : canTriggerFinalFinancialClosure
                    ? 'bg-blue-50/80 border-blue-300 text-[#1E3A8A]'
                    : 'bg-amber-50/60 border-amber-200 text-amber-900'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>
                      {isFinalApprovedByDirector
                        ? 'Laporan Keuangan Akhir Telah Ditutup, Diperiksa Finance & Disetujui Director'
                        : canTriggerFinalFinancialClosure
                        ? 'Seluruh Tahap Implementasi Memiliki Cash Advance & Telah Dilaporkan — Fitur Tutup Laporan Keuangan Akhir Aktif'
                        : 'Syarat Tutup Laporan Keuangan Akhir: Semua Tahap Implementasi Memiliki Cash Advance & Seluruh CA Telah Dilaporkan'}
                    </span>
                  </div>
                  <p className="text-[11px] opacity-90">
                    {canTriggerFinalFinancialClosure
                      ? 'Klik tombol untuk melaporkan Laporan Keuangan Akhir, diperiksa oleh Finance, dan disetujui oleh Director (stempel resmi & complement upgrade dari approval laporan keuangan terakhir).'
                      : `Saat ini ${coveredStageCount}/${totalStageCount} tahap implementasi memiliki CA dan ${reportedAdvances.length}/${activeCas.length} CA telah dilaporkan.`}
                  </p>
                </div>

                {canTriggerFinalFinancialClosure && (
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {!summaryMeta.summaryReportedAt && (
                      <button
                        type="button"
                        disabled={isApprovingFinalSummary}
                        onClick={() => handleApproveFinalSummary('report')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1E3A8A] hover:bg-[#1E40AF] text-white font-semibold text-xs shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Tutup Laporan &amp; Laporkan Lap. Keuangan Akhir</span>
                      </button>
                    )}
                    {isFinalReported && !isFinalVerifiedByFinance && (
                      <button
                        type="button"
                        disabled={isApprovingFinalSummary}
                        onClick={() => handleApproveFinalSummary('finance')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Periksa Lap. Keuangan Akhir (Finance)</span>
                      </button>
                    )}
                    {isFinalVerifiedByFinance && !isFinalApprovedByDirector && (
                      <button
                        type="button"
                        disabled={isApprovingFinalSummary}
                        onClick={() => handleApproveFinalSummary('director')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Setujui Lap. Keuangan Akhir (Director)</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="w-full overflow-hidden">
                <table className="w-full table-fixed text-xs border-collapse">
                  <tbody>
                    <tr>
                      <td className="py-1.5 px-2.5 w-[39%] border border-black text-black font-normal bg-white">
                        Total Uang Muka yang Telah Diterima
                      </td>
                      <td className="py-1.5 px-3 w-[42.5%] border border-black text-right font-mono text-black bg-white">
                        {formatAccountingCell(closedTotalAdvance)}
                      </td>
                      <td className="py-1.5 px-3 w-[18.5%] border border-black text-center font-mono font-semibold text-slate-700 bg-white">
                        {closedTotalAdvance > 0 ? '100%' : '0%'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2.5 border border-black text-black font-normal bg-white">
                        Total Realisasi Belanja yang Telah Dilaporkan
                      </td>
                      <td className="py-1.5 px-3 border border-black text-right font-mono text-black bg-white">
                        {formatAccountingCell(closedTotalSpent)}
                      </td>
                      <td className="py-1.5 px-3 border border-black text-center font-mono font-bold text-[#1E3A8A] bg-white">
                        {closedPercentUsed}%
                      </td>
                    </tr>
                    <tr className="bg-[#D9E1F2] font-bold">
                      <td className="py-1.5 px-2.5 border border-black text-black">
                        SISA uang muka (telah dikembalikan ke kas)
                      </td>
                      <td className="py-1.5 px-3 border border-black text-right font-mono text-emerald-900">
                        {formatAccountingCell(closedTotalRemaining)}
                      </td>
                      <td className="py-1.5 px-3 border border-black text-center font-mono text-emerald-900">
                        {closedTotalAdvance > 0 && closedTotalRemaining > 0
                          ? `${Math.round((closedTotalRemaining / closedTotalAdvance) * 100)}%`
                          : '0%'}
                      </td>
                    </tr>
                    <tr className="bg-[#D9E1F2] font-bold">
                      <td className="py-1.5 px-2.5 border border-black text-black">
                        MINUS (telah dibayarkan kepada pemohon)
                      </td>
                      <td className="py-1.5 px-3 border border-black text-right font-mono text-rose-800">
                        {formatAccountingCell(closedTotalShortage)}
                      </td>
                      <td className="py-1.5 px-3 border border-black text-center font-mono text-rose-800">
                        {closedTotalAdvance > 0 && closedTotalShortage > 0
                          ? `+${Math.round((closedTotalShortage / closedTotalAdvance) * 100)}%`
                          : '0%'}
                      </td>
                    </tr>
                    <tr className="font-bold bg-white">
                      <td className="py-1.5 px-2.5 border border-black text-black">
                        Status Laporan yang Telah Ditutup
                      </td>
                      <td
                        colSpan={2}
                        className="py-1.5 px-3 border border-black text-center text-black font-bold"
                      >
                        {finalStatusText}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Cek uang muka form vs laporan */}
              <div className="grid grid-cols-1 sm:grid-cols-12 pt-1 text-xs italic text-black w-full">
                <div className="sm:col-span-5 pr-2">
                  Cek uang muka form vs laporan
                </div>
                <div className="sm:col-span-7">
                  {reportedAdvances.length > 0
                    ? 'OK – seluruh uang muka pada Form Permintaan Dana & Form Tambahan yang telah ditutup laporan telah tercakup di ringkasan akhir'
                    : 'Menunggu penutupan laporan Cash Advance beserta lampiran Link PDF Expensify'}
                </div>
              </div>

              {/* 3-Column Stamp Block (Telah Dilaporkan -> Telah Diperiksa Finance -> Telah Disetujui Director) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-5 pb-2 text-center text-xs text-black w-full">
                {/* 1. Telah Dilaporkan oleh */}
                <div className="flex flex-col items-center justify-between min-h-[145px] p-3 rounded border border-slate-200 bg-slate-50/40">
                  <div className="font-bold">Telah Dilaporkan oleh,</div>
                  <div className="my-2 space-y-1.5 flex flex-col items-center justify-center">
                    <ApprovalBarcodeStamp
                      variant={isFinalReported ? 'authorized' : 'pending'}
                      documentNumber={lastReportedCa?.advanceNumber || tor.torNumber}
                      roleCode="REP"
                      signerName={
                        summaryMeta.summaryReportedByName ||
                        lastReportedCa?.reportedByName ||
                        activeCas[0]?.requesterName ||
                        tor.picName ||
                        tor.createdByName
                      }
                      signDate={
                        summaryMeta.summaryReportedAt ||
                        lastReportedCa?.reportedAt ||
                        effectiveSignDate
                      }
                      statusLabel={
                        isFinalReported
                          ? `TELAH DILAPORKAN (${reportedAdvances.length}/${activeCas.length} CA)`
                          : 'BELUM ADA LAPORAN DITUTUP'
                      }
                    />
                    {canTriggerFinalFinancialClosure && !summaryMeta.summaryReportedAt && (
                      <button
                        type="button"
                        disabled={isApprovingFinalSummary}
                        onClick={() => handleApproveFinalSummary('report')}
                        className="px-2.5 py-1 rounded bg-[#1E3A8A] hover:bg-[#1E40AF] text-white text-[10.5px] font-semibold cursor-pointer shadow-2xs print:hidden"
                      >
                        ✓ Laporkan Lap. Keuangan Akhir
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold underline">
                      {summaryMeta.summaryReportedByName ||
                        lastReportedCa?.reportedByName ||
                        activeCas[0]?.requesterName ||
                        tor.picName ||
                        tor.createdByName}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Pemohon / Pelaksana Kegiatan
                    </div>
                  </div>
                </div>

                {/* 2. Telah Diperiksa oleh (Finance) */}
                <div className="flex flex-col items-center justify-between min-h-[145px] p-3 rounded border border-slate-200 bg-slate-50/40">
                  <div className="font-bold">Telah Diperiksa oleh,</div>
                  <div className="my-2 space-y-1.5 flex flex-col items-center justify-center">
                    <ApprovalBarcodeStamp
                      variant={isFinalVerifiedByFinance ? 'authorized' : 'pending'}
                      documentNumber={lastReportedCa?.advanceNumber || tor.torNumber}
                      roleCode="FIN"
                      signerName={
                        summaryMeta.summaryVerifiedByName ||
                        lastReportedCa?.reportVerifiedByName ||
                        activeCas[0]?.signatures?.verifiedBy?.name ||
                        'Ratna Kusuma, S.E.'
                      }
                      signDate={
                        summaryMeta.summaryVerifiedAt ||
                        lastReportedCa?.reportVerifiedAt ||
                        effectiveSignDate
                      }
                      statusLabel={
                        isFinalVerifiedByFinance
                          ? 'TERVERIFIKASI FINANCE'
                          : isFinalReported
                          ? 'MENUNGGU PEMERIKSAAN FINANCE'
                          : 'MENUNGGU LAPORAN DITUTUP'
                      }
                    />
                    {isFinalReported && !isFinalVerifiedByFinance && (
                      <button
                        type="button"
                        disabled={isApprovingFinalSummary}
                        onClick={() => handleApproveFinalSummary('finance')}
                        className="px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[10.5px] font-semibold cursor-pointer shadow-2xs print:hidden"
                      >
                        ✓ Periksa &amp; Verifikasi (Finance)
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold underline">
                      {summaryMeta.summaryVerifiedByName ||
                        lastReportedCa?.reportVerifiedByName ||
                        activeCas[0]?.signatures?.verifiedBy?.name ||
                        'Ratna Kusuma, S.E.'}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Finance &amp; Compliance
                    </div>
                  </div>
                </div>

                {/* 3. Telah Disetujui oleh (Director) */}
                <div className="flex flex-col items-center justify-between min-h-[145px] p-3 rounded border border-slate-200 bg-slate-50/40">
                  <div className="font-bold">Telah Disetujui oleh,</div>
                  <div className="my-2 space-y-1.5 flex flex-col items-center justify-center">
                    <ApprovalBarcodeStamp
                      variant={isFinalApprovedByDirector ? 'authorized' : 'pending'}
                      documentNumber={lastReportedCa?.advanceNumber || tor.torNumber}
                      roleCode="DIR"
                      signerName={
                        summaryMeta.summaryApprovedByName ||
                        lastReportedCa?.reportApprovedByName ||
                        activeCas[0]?.signatures?.approvedBy?.name ||
                        'Dr. Hendra Wijaya'
                      }
                      signDate={
                        summaryMeta.summaryApprovedAt ||
                        lastReportedCa?.reportApprovedAt ||
                        effectiveSignDate
                      }
                      statusLabel={
                        isFinalApprovedByDirector
                          ? 'DISETUJUI DIRECTOR (FINAL)'
                          : isFinalVerifiedByFinance
                          ? 'MENUNGGU PERSETUJUAN DIRECTOR'
                          : 'MENUNGGU PEMERIKSAAN FINANCE'
                      }
                    />
                    {isFinalVerifiedByFinance && !isFinalApprovedByDirector && (
                      <button
                        type="button"
                        disabled={isApprovingFinalSummary}
                        onClick={() => handleApproveFinalSummary('director')}
                        className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10.5px] font-semibold cursor-pointer shadow-2xs print:hidden"
                      >
                        ✓ Setujui Lap. Keuangan Akhir (Director)
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold underline">
                      {summaryMeta.summaryApprovedByName ||
                        lastReportedCa?.reportApprovedByName ||
                        activeCas[0]?.signatures?.approvedBy?.name ||
                        'Dr. Hendra Wijaya'}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Executive Director
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      )}
    </div>
  );
};


