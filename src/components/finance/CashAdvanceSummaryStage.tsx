import React, { useState, useEffect } from 'react';
import {
  Printer,
  Send,
  History,
  CheckCircle2,
  Save,
  User as UserIcon,
  Clock,
  FileSpreadsheet,
  RefreshCw,
  AlertTriangle,
  Link2,
  ExternalLink,
  Lock,
  FileCheck2,
  Calendar,
  Layers,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Tor, CashAdvanceRecord, User } from '../../types/index.js';
import { formatRupiah } from '../../lib/terbilang.js';
import { api } from '../../lib/api.js';
import { useOrganizationSettings } from '../../lib/organizationSettings.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { resolveMasterBudgetByCode } from '../../lib/masterBudgetStorage.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';

interface SummaryRowState {
  id: string;
  advanceId: string;
  advanceNumber: string;
  requestDate: string;
  timelineItemId: string;
  timelinePeriod: string;
  timelineActivity: string;
  budgetCode: string;
  description: string;
  advanceAmount: number;
  actualSpent: number;
  notes: string;
}

interface CashAdvanceAuditEntry {
  id: string;
  torId: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  details: string;
  totalAdvance: number;
  totalSpent: number;
  totalRemaining: number;
  totalShortage: number;
  percentUsed: number;
  itemCount: number;
}

interface CashAdvanceSummaryStageProps {
  tor: Tor;
  cashAdvances: CashAdvanceRecord[];
  onOpenCreateCa: () => void;
  onNavigateStage: (stageIndex: number) => void;
  currentUser?: User | null;
  onRefreshCashAdvances?: () => void;
}

function getEffectiveTimelineItems(tor: Tor) {
  if (tor.timelineItems && tor.timelineItems.length > 0) {
    return tor.timelineItems;
  }
  return [];
}

function computeDeadlinePlus7(dateStr?: string): string {
  if (!dateStr) return '-';
  const base = new Date(dateStr);
  if (isNaN(base.getTime())) return dateStr;
  const d = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export const CashAdvanceSummaryStage: React.FC<CashAdvanceSummaryStageProps> = ({
  tor,
  cashAdvances,
  onOpenCreateCa,
  onNavigateStage,
  onRefreshCashAdvances,
}) => {
  const { organizationName } = useOrganizationSettings();
  const [reportDate, setReportDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [rows, setRows] = useState<SummaryRowState[]>([]);
  const [auditLogs, setAuditLogs] = useState<CashAdvanceAuditEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updateNote, setUpdateNote] = useState<string>('');

  // State for "Tutup Laporan" modal per Cash Advance
  const [closingCa, setClosingCa] = useState<CashAdvanceRecord | null>(null);
  const [expensifyLinkInput, setExpensifyLinkInput] = useState<string>('');
  const [closeNotesInput, setCloseNotesInput] = useState<string>('');
  const [itemSpentMap, setItemSpentMap] = useState<Record<string, number>>({});
  const [isClosingReport, setIsClosingReport] = useState<boolean>(false);
  const [summaryMeta, setSummaryMeta] = useState<Record<string, any>>({});
  const [isApprovingStage, setIsApprovingStage] = useState<boolean>(false);
  const [showClosurePanel, setShowClosurePanel] = useState<boolean>(false);

  const timelineItems = getEffectiveTimelineItems(tor);

  const buildBaseRowsFromCashAdvances = (
    advances: CashAdvanceRecord[],
    savedMap?: Record<string, { actualSpent: number; notes: string; timelineItemId?: string }>
  ): SummaryRowState[] => {
    const built: SummaryRowState[] = [];
    const defaultTl = timelineItems[0];

    advances.forEach((ca, caIndex) => {
      // Determine fallback timeline for this CA
      const fallbackTlId =
        ca.implementationTimelineIds && ca.implementationTimelineIds.length > 0
          ? ca.implementationTimelineIds[0]
          : timelineItems[caIndex % timelineItems.length]?.id || defaultTl?.id || 'tl-1';
      const fallbackTl =
        timelineItems.find((t) => t.id === fallbackTlId) || defaultTl;

      if (ca.items && ca.items.length > 0) {
        ca.items.forEach((item, itemIdx) => {
          const rowKey = `${ca.id}-${item.id || itemIdx}`;
          const saved = savedMap?.[rowKey];

          // Match item's timelineItemId or distribute across selected timelines if mode === 'all'
          const itemTlId =
            saved?.timelineItemId ||
            item.timelineItemId ||
            (ca.implementationMode === 'all'
              ? timelineItems[itemIdx % timelineItems.length]?.id
              : fallbackTl?.id) ||
            defaultTl?.id ||
            'tl-1';

          const resolvedTl =
            timelineItems.find((t) => t.id === itemTlId) || fallbackTl || defaultTl;

          const initialSpent =
            saved !== undefined
              ? saved.actualSpent
              : item.actualSpent !== undefined
              ? Number(item.actualSpent)
              : ca.isReported && ca.realizedAmount !== undefined && ca.items.length === 1
              ? Number(ca.realizedAmount)
              : Number(item.totalAmount) || 0;

          built.push({
            id: rowKey,
            advanceId: ca.id,
            advanceNumber: ca.advanceNumber,
            requestDate: ca.requestDate,
            timelineItemId: resolvedTl?.id || 'tl-1',
            timelinePeriod: resolvedTl?.period || item.timelinePeriod || 'Tahap Implementasi',
            timelineActivity: resolvedTl?.activity || item.timelineActivity || ca.activityTitle,
            budgetCode: item.budgetCode || '-',
            description: item.description || ca.activityTitle,
            advanceAmount: Number(item.totalAmount) || 0,
            actualSpent: initialSpent,
            notes:
              saved !== undefined
                ? saved.notes
                : item.notes ||
                  `${item.volume} ${item.unit} x ${item.frequency} ${item.frequencyUnit || 'Kali'}`,
          });
        });
      } else {
        const rowKey = `${ca.id}-main`;
        const saved = savedMap?.[rowKey];
        built.push({
          id: rowKey,
          advanceId: ca.id,
          advanceNumber: ca.advanceNumber,
          requestDate: ca.requestDate,
          timelineItemId: fallbackTl?.id || 'tl-1',
          timelinePeriod: fallbackTl?.period || 'Tahap Implementasi',
          timelineActivity: fallbackTl?.activity || ca.activityTitle,
          budgetCode: '-',
          description: ca.activityTitle,
          advanceAmount: Number(ca.totalAmount) || 0,
          actualSpent:
            saved !== undefined
              ? saved.actualSpent
              : ca.realizedAmount !== undefined
              ? Number(ca.realizedAmount)
              : Number(ca.totalAmount) || 0,
          notes: saved !== undefined ? saved.notes : 'Pengajuan Uang Muka Kegiatan',
        });
      }
    });
    return built;
  };

  // Load saved summary & dedicated Cash Advance Summary Audit Trail from backend
  useEffect(() => {
    let isMounted = true;
    const loadSummaryAndAudit = async () => {
      try {
        const res = await api.getCashAdvanceSummary(tor.id);
        if (!isMounted) return;

        const savedMap: Record<
          string,
          { actualSpent: number; notes: string; timelineItemId?: string }
        > = {};
        if (res.summary && Array.isArray(res.summary.summaryRows)) {
          res.summary.summaryRows.forEach((sr: any) => {
            if (sr.id) {
              savedMap[sr.id] = {
                actualSpent: Number(sr.actualSpent) || 0,
                notes: sr.notes || '',
                timelineItemId: sr.timelineItemId,
              };
            }
          });
          if (res.summary.reportDate) {
            setReportDate(res.summary.reportDate);
          }
          setSummaryMeta(res.summary);
        }

        setRows(buildBaseRowsFromCashAdvances(cashAdvances, savedMap));
        if (Array.isArray(res.auditLogs)) {
          setAuditLogs(res.auditLogs);
        }
      } catch {
        if (!isMounted) return;
        setRows(buildBaseRowsFromCashAdvances(cashAdvances));
      }
    };

    loadSummaryAndAudit();
    return () => {
      isMounted = false;
    };
  }, [tor.id, cashAdvances]);

  const handleSpentChange = (id: string, valStr: string) => {
    const cleaned = valStr === '' ? 0 : Math.max(0, Number(valStr));
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, actualSpent: cleaned } : r))
    );
  };

  const handleTimelineReassign = (id: string, newTimelineId: string) => {
    const foundTl = timelineItems.find((t) => t.id === newTimelineId);
    if (!foundTl) return;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              timelineItemId: foundTl.id,
              timelinePeriod: foundTl.period,
              timelineActivity: foundTl.activity,
            }
          : r
      )
    );
  };

  const handleNoteChange = (id: string, val: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, notes: val } : r))
    );
  };

  // Save summary & log to dedicated Audit Trail
  const handleSaveSummary = async (customActionLabel?: string) => {
    setIsSaving(true);
    setSaveMessage(null);
    setErrorMessage(null);
    try {
      const res = await api.updateCashAdvanceSummary(tor.id, {
        summaryRows: rows,
        reportDate,
        note: updateNote.trim() || undefined,
        actionType: customActionLabel || 'Penyimpanan Realisasi Ringkasan Cash Advance',
      });
      if (Array.isArray(res.auditLogs)) {
        setAuditLogs(res.auditLogs);
      }
      setUpdateNote('');
      setSaveMessage('Ringkasan realisasi Cash Advance berhasil disimpan.');
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menyimpan ringkasan Cash Advance.');
    } finally {
      setIsSaving(false);
    }
  };

  // Open "Tutup Laporan" modal for a specific Cash Advance
  const handleOpenCloseModal = (ca: CashAdvanceRecord) => {
    setErrorMessage(null);
    setClosingCa(ca);
    setExpensifyLinkInput(ca.expensifyPdfLink || '');
    setCloseNotesInput(ca.reportNotes || '');

    const initialMap: Record<string, number> = {};
    (ca.items || []).forEach((it, idx) => {
      const rowKey = `${ca.id}-${it.id || idx}`;
      const matchedRow = rows.find((r) => r.id === rowKey);
      initialMap[it.id] =
        matchedRow !== undefined
          ? matchedRow.actualSpent
          : it.actualSpent !== undefined
          ? Number(it.actualSpent)
          : Number(it.totalAmount) || 0;
    });
    setItemSpentMap(initialMap);
  };

  const handleConfirmCloseReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingCa) return;

    const trimmedLink = expensifyLinkInput.trim();
    if (!trimmedLink) {
      setErrorMessage(
        'Kewajiban melampirkan Link PDF Expensify wajib diisi sebelum menutup laporan Cash Advance.'
      );
      return;
    }

    setIsClosingReport(true);
    setErrorMessage(null);

    try {
      const totalRealizedForCa = Object.values(itemSpentMap).reduce(
        (acc, val) => acc + (Number(val) || 0),
        0
      );

      await api.closeCashAdvanceReport(closingCa.id, {
        expensifyPdfLink: trimmedLink,
        realizedAmount: totalRealizedForCa,
        reportNotes: closeNotesInput.trim(),
        itemRealizations: itemSpentMap,
      });

      // Sync rows state with the closed realization values
      const updatedRows = rows.map((r) => {
        if (r.advanceId !== closingCa.id) return r;
        const matchedItem = (closingCa.items || []).find(
          (it, idx) => `${closingCa.id}-${it.id || idx}` === r.id
        );
        if (matchedItem && itemSpentMap[matchedItem.id] !== undefined) {
          return { ...r, actualSpent: Number(itemSpentMap[matchedItem.id]) || 0 };
        }
        return r;
      });
      setRows(updatedRows);

      // Save summary rows as well so Ringkasan Akhir is persisted
      const sumRes = await api.updateCashAdvanceSummary(tor.id, {
        summaryRows: updatedRows,
        reportDate,
        note: `Tutup Laporan ${closingCa.advanceNumber} — Link PDF Expensify: ${trimmedLink}`,
        actionType: `Tutup Laporan Cash Advance (${closingCa.advanceNumber})`,
      });
      if (Array.isArray(sumRes.auditLogs)) {
        setAuditLogs(sumRes.auditLogs);
      }
      if (sumRes.summary) {
        setSummaryMeta(sumRes.summary);
      }

      setClosingCa(null);
      setSaveMessage(
        `Laporan ${closingCa.advanceNumber} telah ditutup dengan lampiran Link PDF Expensify (Menunggu Pemeriksaan Finance).`
      );
      if (onRefreshCashAdvances) {
        onRefreshCashAdvances();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menutup laporan Cash Advance.');
    } finally {
      setIsClosingReport(false);
    }
  };

  // Sequential Approval for individual Cash Advance closed report (Finance -> Director)
  const handleApproveCaReport = async (
    caId: string,
    stage: 'finance' | 'director',
    action: 'approve' | 'revision' = 'approve'
  ) => {
    setIsApprovingStage(true);
    setErrorMessage(null);
    try {
      const updatedCa = await api.approveCashAdvanceReport(caId, { stage, action });
      if (closingCa && closingCa.id === caId) {
        setClosingCa(updatedCa);
      }
      const sumRes = await api.getCashAdvanceSummary(tor.id);
      if (Array.isArray(sumRes.auditLogs)) {
        setAuditLogs(sumRes.auditLogs);
      }
      setSaveMessage(
        stage === 'finance'
          ? `Laporan ${updatedCa.advanceNumber} telah diperiksa oleh Finance & diteruskan ke Director.`
          : `Laporan ${updatedCa.advanceNumber} telah disetujui secara resmi oleh Executive Director.`
      );
      if (onRefreshCashAdvances) {
        onRefreshCashAdvances();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memproses persetujuan laporan.');
    } finally {
      setIsApprovingStage(false);
    }
  };

  // Sequential Approval for RINGKASAN AKHIR (Pemohon -> Finance -> Director)
  const handleApproveSummary = async (stage: 'report' | 'finance' | 'director') => {
    setIsApprovingStage(true);
    setErrorMessage(null);
    try {
      const res = await api.approveCashAdvanceSummary(tor.id, { stage });
      if (res.summary) {
        setSummaryMeta(res.summary);
      }
      if (Array.isArray(res.auditLogs)) {
        setAuditLogs(res.auditLogs);
      }
      setSaveMessage(
        stage === 'report'
          ? 'Ringkasan Akhir telah dilaporkan dan menunggu pemeriksaan Finance.'
          : stage === 'finance'
          ? 'Ringkasan Akhir telah diperiksa oleh Finance dan menunggu persetujuan Director.'
          : 'Ringkasan Akhir telah disetujui oleh Executive Director.'
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memproses persetujuan Ringkasan Akhir.');
    } finally {
      setIsApprovingStage(false);
    }
  };

  const unreportedAdvances = cashAdvances.filter(
    (c) => !c.isReported && c.status !== 'Ditolak'
  );
  const reportedAdvances = cashAdvances.filter((c) => Boolean(c.isReported));
  const isBlockedNewCa = unreportedAdvances.length >= 2;

  // Calculations for overall table (all items across implementation stages)
  const grandTotalAdvance = rows.reduce(
    (sum, r) => sum + (Number(r.advanceAmount) || 0),
    0
  );
  const grandTotalSpent = rows.reduce(
    (sum, r) => sum + (Number(r.actualSpent) || 0),
    0
  );
  // Accumulate Sisa Uang Muka and Kekurangan across rows
  const grandTotalRemaining = rows.reduce(
    (sum, r) => sum + Math.max(0, (Number(r.advanceAmount) || 0) - (Number(r.actualSpent) || 0)),
    0
  );
  const grandTotalShortage = rows.reduce(
    (sum, r) => sum + Math.max(0, (Number(r.actualSpent) || 0) - (Number(r.advanceAmount) || 0)),
    0
  );
  const grandPercentUsed =
    grandTotalAdvance > 0
      ? Math.round((grandTotalSpent / grandTotalAdvance) * 100)
      : 0;

  // Calculations for GAMBAR 3: RINGKASAN AKHIR (Akumulasi dari Laporan yang TELAH Ditutup)
  const closedAdvanceIds = new Set(reportedAdvances.map((c) => c.id));
  const closedRows = rows.filter((r) => closedAdvanceIds.has(r.advanceId));
  const closedTotalAdvance = closedRows.reduce(
    (sum, r) => sum + (Number(r.advanceAmount) || 0),
    0
  );
  const closedTotalSpent = closedRows.reduce(
    (sum, r) => sum + (Number(r.actualSpent) || 0),
    0
  );
  const closedTotalRemaining = closedRows.reduce(
    (sum, r) => sum + Math.max(0, (Number(r.advanceAmount) || 0) - (Number(r.actualSpent) || 0)),
    0
  );
  const closedTotalShortage = closedRows.reduce(
    (sum, r) => sum + Math.max(0, (Number(r.actualSpent) || 0) - (Number(r.advanceAmount) || 0)),
    0
  );
  const closedPercentUsed =
    closedTotalAdvance > 0
      ? Math.round((closedTotalSpent / closedTotalAdvance) * 100)
      : 0;

  // Status formula with the word "telah" for closed reports accumulation (Gambar 3)
  const finalStatusText = (() => {
    if (closedRows.length === 0 || closedTotalAdvance === 0) {
      return 'Belum ada laporan Cash Advance yang telah ditutup';
    }
    if (closedTotalRemaining > 0 && closedTotalShortage > 0) {
      return 'Sisa uang muka telah dikembalikan ke kas & kekurangan telah dibayarkan kepada pemohon';
    }
    if (closedTotalRemaining > 0) {
      return 'Sisa uang muka telah dikembalikan ke kas';
    }
    if (closedTotalShortage > 0) {
      return 'Kekurangan telah dibayarkan kepada pemohon';
    }
    return 'Telah sesuai (tidak ada sisa / kurang)';
  })();

  const formatAccountingCell = (val: number) => {
    if (!val || val === 0) return '-';
    return formatRupiah(val);
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <section className="bg-white rounded-lg border border-[#EAEAEA] p-5 sm:p-7 space-y-6 text-[#2F3437] print:border-none print:p-0 print:shadow-none">
      {/* Top Action Bar (Notion-toned, Concise, Hidden on Print) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EAEAEA] print:hidden">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#2F3437]">
            Ringkasan &amp; Penutupan Laporan Cash Advance
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#787774] mt-0.5">
            <span>Dikelompokkan per Implementation Timeline</span>
            <span aria-hidden="true">·</span>
            <span className={isBlockedNewCa ? 'text-amber-700 font-medium' : ''}>
              {unreportedAdvances.length}/2 belum dilaporkan
            </span>
            <span aria-hidden="true">·</span>
            <span>Wajib Link PDF Expensify (H+7)</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleSaveSummary('Simpan & Rekam Realisasi Ringkasan')}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#2F3437] hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Realisasi'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              downloadElementAsPdf({
                filename: `Ringkasan_Cash_Advance_${tor.torNumber}`,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#2F3437] bg-[#F7F7F5] hover:bg-[#EFEFED] border border-[#EAEAEA] transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-[#787774]" />
            <span>Simpan PDF Ringkasan</span>
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {saveMessage && (
        <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2 print:hidden">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveMessage}</span>
          </div>
          <button onClick={() => setSaveMessage(null)}>
            <X className="w-4 h-4 text-emerald-700" />
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2 print:hidden">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)}>
            <X className="w-4 h-4 text-rose-700" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PANEL PENUTUPAN LAPORAN CASH ADVANCE (DEFAULT HIDDEN, WITH HIDE/SHOW)     */}
      {/* ========================================================================= */}
      <div className="border border-[#EAEAEA] rounded-lg overflow-hidden bg-white print:hidden">
        <div
          onClick={() => setShowClosurePanel((prev) => !prev)}
          className="bg-[#F7F7F5] hover:bg-[#F1F1EF] transition-colors px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-[#2F3437]">Penutupan Laporan Cash Advance</span>
            <span className="text-[#787774]">·</span>
            <span className="text-[#787774]">
              Selesai dilaporkan {reportedAdvances.length}/{cashAdvances.length}
            </span>
          </div>

          <div
            className="flex flex-wrap items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {!isBlockedNewCa && tor.submissionStatus === 'Disetujui' && (
              <button
                type="button"
                onClick={onOpenCreateCa}
                className="text-xs font-medium text-[#2F3437] hover:underline cursor-pointer mr-1"
              >
                + Buat Cash Advance Baru
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowClosurePanel((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#EAEAEA] bg-white hover:bg-[#F7F7F5] text-[#2F3437] text-[11px] font-medium transition-colors cursor-pointer"
            >
              {showClosurePanel ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Sembunyikan</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 text-[#787774]" />
                  <span>Tampilkan ({cashAdvances.length})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {showClosurePanel && (
          <div className="p-4 border-t border-[#EAEAEA]">
          {cashAdvances.length === 0 ? (
            <div className="text-center py-6 text-xs text-[#787774] space-y-2">
              <p>Belum ada pengajuan Cash Advance untuk TOR ini.</p>
              {tor.submissionStatus === 'Disetujui' && (
                <button
                  type="button"
                  onClick={onOpenCreateCa}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2F3437] text-white font-medium hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  <span>+ Buat Cash Advance</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cashAdvances.map((ca) => {
                const deadlineStr =
                  ca.reportingDeadlineDate || computeDeadlinePlus7(ca.requestDate);
                const isClosed = Boolean(ca.isReported);

                return (
                  <div
                    key={ca.id}
                    className={`rounded-lg border p-3.5 bg-white flex flex-col justify-between gap-3 ${
                      isClosed
                        ? 'border-emerald-300 bg-emerald-50/20'
                        : 'border-amber-300 bg-amber-50/20'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-xs text-[#1E3A8A] block">
                            {ca.advanceNumber}
                          </span>
                          <span className="text-[11px] text-slate-600 font-medium">
                            Cakupan:{' '}
                            <strong className="text-slate-800">
                              {ca.implementationTimelineSummary ||
                                (ca.implementationMode === 'single'
                                  ? 'Satu Tahap Implementasi'
                                  : 'Seluruh Tahapan Implementasi')}
                            </strong>
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${
                            isClosed
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : 'bg-amber-100 text-amber-900 border-amber-300'
                          }`}
                        >
                          {isClosed ? 'Laporan Ditutup' : 'Belum Dilaporkan'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] bg-white p-2 rounded border border-slate-200">
                        <div>
                          <span className="text-slate-500 block">Uang Muka Diajukan:</span>
                          <span className="font-mono font-bold text-slate-900">
                            {formatRupiah(ca.totalAmount)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">
                            Batas Lapor (Maks. H+7):
                          </span>
                          <span className="font-mono font-bold text-rose-700">
                            {deadlineStr}
                          </span>
                        </div>
                      </div>

                      {isClosed && ca.expensifyPdfLink && (
                        <div className="p-2.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] space-y-1.5">
                          <div className="flex items-center justify-between text-emerald-900 font-semibold">
                            <span>Telah Direalisasi: {formatRupiah(ca.realizedAmount ?? ca.totalAmount)}</span>
                            <a
                              href={ca.expensifyPdfLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[#1E3A8A] hover:underline font-bold"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>Buka PDF Expensify</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                          <div className="text-[10px] text-emerald-800 font-mono truncate">
                            {ca.expensifyPdfLink}
                          </div>

                          {/* Status Approval Laporan: Terpusat di Menu Approval */}
                          <div className="pt-1.5 border-t border-emerald-200/80 flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-[10.5px] font-bold text-slate-700">
                              Status Approval:{' '}
                              <span className="text-[#1E3A8A]">
                                {ca.reportApprovalStatus || 'Menunggu Pemeriksaan Finance'}
                              </span>
                            </span>
                            <span className="text-[10px] text-slate-500 italic">
                              Diproses melalui menu Approval
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
                      <span className="text-[10.5px] text-slate-500">
                        Tgl Pengajuan: <strong className="font-mono">{ca.requestDate}</strong>
                      </span>

                      <button
                        type="button"
                        onClick={() => handleOpenCloseModal(ca)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                          isClosed
                            ? 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                            : 'bg-[#1E3A8A] text-white hover:bg-[#1E40AF] shadow-2xs'
                        }`}
                      >
                        <FileCheck2 className="w-3.5 h-3.5" />
                        <span>
                          {isClosed ? 'Lihat Detail Tutup Laporan' : 'Tutup Laporan (Lampirkan Expensify)'}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL TUTUP LAPORAN CASH ADVANCE + KEWAJIBAN LINK PDF EXPENSIFY           */}
      {/* ========================================================================= */}
      {closingCa && (() => {
        const modalItems = closingCa.items || [];
        const modalTotalAdvance =
          modalItems.length > 0
            ? modalItems.reduce((sum, it) => sum + (Number(it.totalAmount) || 0), 0)
            : Number(closingCa.totalAmount) || 0;
        const modalTotalSpent =
          modalItems.length > 0
            ? modalItems.reduce(
                (sum, it) => sum + (Number(itemSpentMap[it.id] ?? it.actualSpent ?? it.totalAmount) || 0),
                0
              )
            : Object.values(itemSpentMap).reduce((sum, v) => sum + (Number(v) || 0), 0);
        // Accumulate per-item Sisa Uang Muka and Kekurangan
        const modalTotalRemaining =
          modalItems.length > 0
            ? modalItems.reduce((sum, it) => {
                const adv = Number(it.totalAmount) || 0;
                const sp = Number(itemSpentMap[it.id] ?? it.actualSpent ?? it.totalAmount) || 0;
                return sum + Math.max(0, adv - sp);
              }, 0)
            : Math.max(0, modalTotalAdvance - modalTotalSpent);
        const modalTotalShortage =
          modalItems.length > 0
            ? modalItems.reduce((sum, it) => {
                const adv = Number(it.totalAmount) || 0;
                const sp = Number(itemSpentMap[it.id] ?? it.actualSpent ?? it.totalAmount) || 0;
                return sum + Math.max(0, sp - adv);
              }, 0)
            : Math.max(0, modalTotalSpent - modalTotalAdvance);
        const modalPercentUsed =
          modalTotalAdvance > 0
            ? Math.round((modalTotalSpent / modalTotalAdvance) * 100)
            : 0;
        const modalRemainingPct =
          modalTotalAdvance > 0
            ? Math.round((modalTotalRemaining / modalTotalAdvance) * 100)
            : 0;
        const modalShortagePct =
          modalTotalAdvance > 0
            ? Math.round((modalTotalShortage / modalTotalAdvance) * 100)
            : 0;

        const modalStatusText = (() => {
          if (modalTotalAdvance === 0) return 'Belum ada uang muka diisi';
          if (modalTotalRemaining > 0 && modalTotalShortage > 0) {
            return 'Kembalikan sisa ke kas & bayarkan kekurangan ke pemohon';
          }
          if (modalTotalRemaining > 0) return 'Kembalikan ke kas';
          if (modalTotalShortage > 0) return 'Bayarkan ke pemohon';
          return 'Tidak ada sisa / kurang';
        })();

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden my-auto">
              <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-sky-400" />
                  <div>
                    <h4 className="text-sm font-bold">
                      Tutup Laporan Cash Advance — {closingCa.advanceNumber}
                    </h4>
                    <p className="text-[11px] text-slate-300">
                      Dilaporkan paling lambat 7 hari setelah pengajuan dana (Batas: {closingCa.reportingDeadlineDate || computeDeadlinePlus7(closingCa.requestDate)})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setClosingCa(null)}
                  className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmCloseReport} className="p-5 space-y-5 text-xs overflow-y-auto">
                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-[#1E3A8A]">
                      Dasar Implementasi: {closingCa.implementationTimelineSummary || 'Seluruh Tahapan Implementasi'}
                    </div>
                    <div className="text-slate-700 mt-0.5">
                      Total Uang Muka Diterima:{' '}
                      <strong className="font-mono text-slate-900">
                        {formatRupiah(modalTotalAdvance)}
                      </strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded bg-white border border-blue-200 font-mono font-bold text-[#1E3A8A]">
                      Serapan: {modalPercentUsed}%
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded font-bold border ${
                        modalTotalRemaining > 0
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : modalTotalShortage > 0
                          ? 'bg-rose-50 text-rose-800 border-rose-300'
                          : 'bg-slate-100 text-slate-800 border-slate-300'
                      }`}
                    >
                      {modalStatusText}
                    </span>
                  </div>
                </div>

                {/* 1. Rincian Realisasi Belanja Aktual per Item (Read-Only & Proporsional + Kode Master) */}
                <div className="space-y-2">
                  <label className="block font-bold text-slate-800">
                    1. Rincian Realisasi Belanja Aktual per Item
                  </label>
                  <div className="border border-slate-400 rounded overflow-hidden">
                    <table className="w-full table-fixed text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#D9E1F2] border-b border-slate-500 font-bold text-slate-900">
                          <th className="py-2 px-1.5 w-[4.5%] text-center border-r border-slate-400 align-middle">
                            No
                          </th>
                          <th className="py-2 px-2 w-[16.5%] border-r border-slate-400 align-middle">
                            Kode &amp; Nama Master
                          </th>
                          <th className="py-2 px-2.5 w-[27%] border-r border-slate-400 align-middle">
                            Uraian Item
                          </th>
                          <th className="py-2 px-2 w-[13%] text-right border-r border-slate-400 align-middle">
                            Uang Muka (Rp)
                          </th>
                          <th className="py-2 px-2 w-[13%] text-right border-r border-slate-400 align-middle">
                            Realisasi Belanja (Rp)
                          </th>
                          <th className="py-2 px-2 w-[10.5%] text-right border-r border-slate-400 bg-[#D9E1F2] align-middle">
                            Sisa Uang Muka
                          </th>
                          <th className="py-2 px-2 w-[10%] text-right border-r border-slate-400 bg-[#D9E1F2] align-middle">
                            Minus
                          </th>
                          <th className="py-2 px-1.5 w-[5.5%] text-center bg-[#D9E1F2] align-middle">
                            %
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300">
                        {modalItems.map((it, itemIdx) => {
                          const itemAdv = Number(it.totalAmount) || 0;
                          const itemSpent =
                            itemSpentMap[it.id] === undefined
                              ? Number(it.actualSpent ?? it.totalAmount) || 0
                              : Number(itemSpentMap[it.id]) || 0;
                          const itemRem = Math.max(0, itemAdv - itemSpent);
                          const itemShort = Math.max(0, itemSpent - itemAdv);
                          const itemPct =
                            itemAdv > 0 ? Math.round((itemSpent / itemAdv) * 100) : 0;
                          const masterInfo = resolveMasterBudgetByCode(it.budgetCode, tor);

                          return (
                            <tr key={it.id || itemIdx} className="hover:bg-slate-50/70 align-top">
                              <td className="py-2 px-1.5 text-center font-mono text-slate-700 border-r border-slate-300">
                                {itemIdx + 1}
                              </td>
                              <td className="py-2 px-2 border-r border-slate-300 break-words">
                                <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 font-mono font-bold text-[11px] text-emerald-800">
                                  {masterInfo.code}
                                </span>
                                <div className="font-semibold text-slate-800 text-[11px] mt-1 leading-snug">
                                  {masterInfo.masterName}
                                </div>
                              </td>
                              <td className="py-2 px-2.5 border-r border-slate-300 break-words">
                                <div className="font-semibold text-slate-900 leading-snug">
                                  {it.description}
                                </div>
                                {(it.timelineActivity || it.timelinePeriod) && (
                                  <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">
                                    Implementasi: {it.timelineActivity || it.timelinePeriod}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-slate-900 border-r border-slate-300">
                                {formatRupiah(itemAdv)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono font-bold text-slate-900 border-r border-slate-300 bg-slate-50/70">
                                {formatRupiah(itemSpent)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono font-semibold text-emerald-800 bg-[#D9E1F2]/35 border-r border-slate-300">
                                {formatAccountingCell(itemRem)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono font-semibold text-rose-700 bg-[#D9E1F2]/35 border-r border-slate-300">
                                {formatAccountingCell(itemShort)}
                              </td>
                              <td className="py-2 px-1.5 text-center font-mono font-bold text-slate-900 bg-[#D9E1F2]/20">
                                {itemPct}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#D9E1F2] font-bold text-slate-900 border-t-2 border-slate-500">
                          <td
                            colSpan={3}
                            className="py-2 px-2.5 text-right uppercase border-r border-slate-400"
                          >
                            Total Cash Advance Ini
                          </td>
                          <td className="py-2 px-2 text-right font-mono border-r border-slate-400">
                            {formatAccountingCell(modalTotalAdvance)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono border-r border-slate-400">
                            {formatAccountingCell(modalTotalSpent)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-900 border-r border-slate-400">
                            {formatAccountingCell(modalTotalRemaining)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-rose-800 border-r border-slate-400">
                            {formatAccountingCell(modalTotalShortage)}
                          </td>
                          <td className="py-2 px-1.5 text-center font-mono">
                            {modalPercentUsed}%
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* ===================================================================== */}
                {/* GAMBAR 2 DI DALAM GAMBAR 1: RINGKASAN AKHIR OTOMATIS + PERSENTASE     */}
                {/* ===================================================================== */}
                <div className="p-4 rounded-md border border-slate-300 bg-white space-y-2">
                  <div className="text-xs font-bold text-black uppercase tracking-wide">
                    RINGKASAN AKHIR
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <tbody>
                        <tr>
                          <td className="py-1.5 px-2.5 w-72 border border-black text-black font-normal bg-white">
                            Total Uang Muka Diterima
                          </td>
                          <td className="py-1.5 px-3 w-56 border border-black text-right font-mono text-black bg-white">
                            {formatAccountingCell(modalTotalAdvance)}
                          </td>
                          <td className="py-1.5 px-3 w-28 border border-black text-center font-mono font-semibold text-slate-700 bg-white">
                            100%
                          </td>
                        </tr>
                        <tr>
                          <td className="py-1.5 px-2.5 border border-black text-black font-normal bg-white">
                            Total Realisasi Belanja
                          </td>
                          <td className="py-1.5 px-3 border border-black text-right font-mono text-black bg-white">
                            {formatAccountingCell(modalTotalSpent)}
                          </td>
                          <td className="py-1.5 px-3 border border-black text-center font-mono font-bold text-[#1E3A8A] bg-white">
                            {modalPercentUsed}%
                          </td>
                        </tr>
                        <tr className="bg-[#D9E1F2] font-bold">
                          <td className="py-1.5 px-2.5 border border-black text-black">
                            SISA uang muka (dikembalikan ke kas)
                          </td>
                          <td className="py-1.5 px-3 border border-black text-right font-mono text-emerald-900">
                            {formatAccountingCell(modalTotalRemaining)}
                          </td>
                          <td className="py-1.5 px-3 border border-black text-center font-mono text-emerald-900">
                            {modalTotalRemaining > 0 ? `${modalRemainingPct}%` : '0%'}
                          </td>
                        </tr>
                        <tr className="bg-[#D9E1F2] font-bold">
                          <td className="py-1.5 px-2.5 border border-black text-black">
                            KEKURANGAN (dibayarkan kepada pemohon)
                          </td>
                          <td className="py-1.5 px-3 border border-black text-right font-mono text-rose-800">
                            {formatAccountingCell(modalTotalShortage)}
                          </td>
                          <td className="py-1.5 px-3 border border-black text-center font-mono text-rose-800">
                            {modalTotalShortage > 0 ? `+${modalShortagePct}%` : '0%'}
                          </td>
                        </tr>
                        <tr className="font-bold bg-white">
                          <td className="py-1.5 px-2.5 border border-black text-black">
                            Status
                          </td>
                          <td
                            colSpan={2}
                            className="py-1.5 px-3 border border-black text-center text-black font-bold"
                          >
                            {modalStatusText}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 pt-1 text-[11px] italic text-black">
                    <div className="sm:col-span-4 pr-2">
                      Cek uang muka form vs laporan
                    </div>
                    <div className="sm:col-span-8">
                      OK – seluruh uang muka pada Form Permintaan Dana &amp; Form Tambahan sudah tercakup di laporan
                    </div>
                  </div>

                  {/* GAMBAR 2: 3-Column Stamp Block inside Tutup Laporan Modal (Pemohon -> Finance -> Director) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 pb-1 text-center text-xs text-black border-t border-slate-200 mt-3">
                    {/* 1. Dilaporkan oleh */}
                    <div className="flex flex-col items-center justify-between min-h-[132px] p-2.5 rounded border border-slate-200 bg-slate-50/40">
                      <div className="font-bold">Dilaporkan oleh,</div>
                      <div className="my-1.5 flex flex-col items-center justify-center">
                        <ApprovalBarcodeStamp
                          compact
                          variant={closingCa.isReported ? 'authorized' : 'pending'}
                          documentNumber={closingCa.advanceNumber}
                          roleCode="REP"
                          signerName={
                            closingCa.reportedByName ||
                            closingCa.requesterName ||
                            tor.picName ||
                            tor.createdByName
                          }
                          signDate={closingCa.reportedAt || closingCa.requestDate}
                          statusLabel={
                            closingCa.isReported
                              ? 'TELAH DILAPORKAN'
                              : 'MENUNGGU TUTUP LAPORAN'
                          }
                        />
                      </div>
                      <div>
                        <div className="font-semibold underline">
                          {closingCa.reportedByName || closingCa.requesterName || tor.picName || tor.createdByName}
                        </div>
                        <div className="text-[10.5px] text-slate-600">
                          Pemohon / Pelaksana Kegiatan
                        </div>
                      </div>
                    </div>

                    {/* 2. Diperiksa oleh (Finance) */}
                    <div className="flex flex-col items-center justify-between min-h-[132px] p-2.5 rounded border border-slate-200 bg-slate-50/40">
                      <div className="font-bold">Diperiksa oleh,</div>
                      <div className="my-1.5 space-y-1.5 flex flex-col items-center justify-center">
                        {(() => {
                          const isFinVerified =
                            Boolean(closingCa.reportVerifiedAt) ||
                            closingCa.reportApprovalStatus === 'Menunggu Persetujuan Director' ||
                            closingCa.reportApprovalStatus === 'Telah Disetujui';
                          return (
                            <>
                              <ApprovalBarcodeStamp
                                compact
                                variant={isFinVerified ? 'authorized' : 'pending'}
                                documentNumber={closingCa.advanceNumber}
                                roleCode="FIN"
                                signerName={
                                  closingCa.reportVerifiedByName ||
                                  closingCa.signatures?.verifiedBy?.name ||
                                  'Ratna Kusuma, S.E.'
                                }
                                signDate={closingCa.reportVerifiedAt || closingCa.reportedAt || closingCa.requestDate}
                                statusLabel={
                                  isFinVerified
                                    ? 'TERVERIFIKASI FINANCE'
                                    : closingCa.isReported
                                    ? 'MENUNGGU PEMERIKSAAN FINANCE'
                                    : 'MENUNGGU LAPORAN DITUTUP'
                                }
                              />
                              {closingCa.isReported && !isFinVerified && (
                                <button
                                  type="button"
                                  disabled={isApprovingStage}
                                  onClick={() => handleApproveCaReport(closingCa.id, 'finance', 'approve')}
                                  className="px-2.5 py-1 rounded bg-[#1E3A8A] hover:bg-[#1E40AF] text-white text-[10px] font-semibold cursor-pointer shadow-2xs disabled:opacity-50"
                                >
                                  ✓ Periksa &amp; Verifikasi (Finance)
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      <div>
                        <div className="font-semibold underline">
                          {closingCa.reportVerifiedByName || closingCa.signatures?.verifiedBy?.name || 'Ratna Kusuma, S.E.'}
                        </div>
                        <div className="text-[10.5px] text-slate-600">
                          Finance &amp; Compliance
                        </div>
                      </div>
                    </div>

                    {/* 3. Disetujui oleh (Director) */}
                    <div className="flex flex-col items-center justify-between min-h-[132px] p-2.5 rounded border border-slate-200 bg-slate-50/40">
                      <div className="font-bold">Disetujui oleh,</div>
                      <div className="my-1.5 space-y-1.5 flex flex-col items-center justify-center">
                        {(() => {
                          const isFinVerified =
                            Boolean(closingCa.reportVerifiedAt) ||
                            closingCa.reportApprovalStatus === 'Menunggu Persetujuan Director' ||
                            closingCa.reportApprovalStatus === 'Telah Disetujui';
                          const isDirApproved =
                            Boolean(closingCa.reportApprovedAt) ||
                            closingCa.reportApprovalStatus === 'Telah Disetujui';
                          return (
                            <>
                              <ApprovalBarcodeStamp
                                compact
                                variant={isDirApproved ? 'authorized' : 'pending'}
                                documentNumber={closingCa.advanceNumber}
                                roleCode="DIR"
                                signerName={
                                  closingCa.reportApprovedByName ||
                                  closingCa.signatures?.approvedBy?.name ||
                                  'Dr. Hendra Wijaya'
                                }
                                signDate={
                                  closingCa.reportApprovedAt ||
                                  closingCa.reportVerifiedAt ||
                                  closingCa.requestDate
                                }
                                statusLabel={
                                  isDirApproved
                                    ? 'DISETUJUI DIRECTOR'
                                    : isFinVerified
                                    ? 'MENUNGGU PERSETUJUAN DIRECTOR'
                                    : 'MENUNGGU PEMERIKSAAN FINANCE'
                                }
                              />
                              {isFinVerified && !isDirApproved && (
                                <button
                                  type="button"
                                  disabled={isApprovingStage}
                                  onClick={() => handleApproveCaReport(closingCa.id, 'director', 'approve')}
                                  className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-semibold cursor-pointer shadow-2xs disabled:opacity-50"
                                >
                                  ✓ Setujui Laporan (Director)
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      <div>
                        <div className="font-semibold underline">
                          {closingCa.reportApprovedByName || closingCa.signatures?.approvedBy?.name || 'Dr. Hendra Wijaya'}
                        </div>
                        <div className="text-[10.5px] text-slate-600">
                          Executive Director
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mandatory Expensify PDF Link */}
                <div className="p-3.5 bg-amber-50/80 border border-amber-300 rounded-md space-y-2">
                  <label className="block font-bold text-amber-950">
                    2. Lampiran Link PDF Expensify (Wajib Diisi untuk Tutup Laporan) *
                  </label>
                  <div className="relative">
                    <input
                      type="url"
                      required
                      value={expensifyLinkInput}
                      onChange={(e) => setExpensifyLinkInput(e.target.value)}
                      placeholder="https://www.expensify.com/report.pdf?param=..."
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-amber-400 rounded focus:border-[#1E3A8A] focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-amber-900">
                    Pastikan tautan dokumen laporan PDF dari <strong>Expensify</strong> dapat diakses oleh bagian Finance &amp; Auditor untuk verifikasi bukti transaksi.
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    3. Catatan Penutupan Laporan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={closeNotesInput}
                    onChange={(e) => setCloseNotesInput(e.target.value)}
                    placeholder="Contoh: Sisa dana telah ditransfer kembali ke rekening kas..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:border-[#1E3A8A] focus:outline-none"
                  />
                </div>

                <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setClosingCa(null)}
                    className="px-4 py-2 rounded border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isClosingReport}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded bg-[#1E3A8A] hover:bg-[#1E40AF] text-white font-semibold shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <FileCheck2 className="w-4 h-4" />
                    <span>
                      {isClosingReport
                        ? 'Menutup Laporan...'
                        : 'Tutup Laporan & Simpan Link Expensify'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* OFFICIAL SPREADSHEET / ACCOUNTING HEADER                                  */}
      {/* ========================================================================= */}
      <div className="tor-formal-print-sheet space-y-4 bg-white">
        <div className="border-b-2 border-slate-900 pb-2 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-extrabold tracking-wide uppercase text-slate-900">
              RINGKASAN CASH ADVANCE &amp; REALISASI BELANJA PER IMPLEMENTASI
            </h2>
            <p className="text-xs text-slate-600">
              {organizationName} — Rekapitulasi Uang Muka Terstruktur Berdasarkan Implementation Timeline TOR
            </p>
          </div>
          <div className="text-xs font-mono text-slate-700">
            No. TOR: <strong className="text-slate-900">{tor.torNumber}</strong>
          </div>
        </div>

        {/* Document Metadata Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5 text-xs bg-slate-50/70 p-3.5 rounded border border-slate-300">
          <div className="flex items-baseline justify-between border-b border-slate-200/80 pb-1">
            <span className="text-slate-600 font-medium">Nama Kegiatan:</span>
            <span className="font-bold text-slate-900 text-right">{tor.title}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-slate-200/80 pb-1">
            <span className="text-slate-600 font-medium">Pemohon / PIC Kegiatan:</span>
            <span className="font-bold text-slate-900 text-right">
              {cashAdvances[0]?.requesterName || tor.picName || tor.createdByName}
            </span>
          </div>
          <div className="flex items-baseline justify-between border-b border-slate-200/80 pb-1">
            <span className="text-slate-600 font-medium">Program Kerja:</span>
            <span className="font-semibold text-slate-800 text-right">
              {tor.programName || 'Program Yayasan Inti Muda Indonesia'}
            </span>
          </div>
          <div className="flex items-baseline justify-between border-b border-slate-200/80 pb-1">
            <span className="text-slate-600 font-medium">Tanggal Rekonsiliasi Laporan:</span>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="font-mono font-semibold text-slate-900 bg-white border border-slate-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-[#1E3A8A]"
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TABEL RINGKASAN DIKELOMPOKKAN MENURUT IMPLEMENTATION TIMELINE (GAMBAR 2)  */}
        {/* ========================================================================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 uppercase tracking-wide">
              <Layers className="w-4 h-4 text-[#1E3A8A]" />
              <span>
                Pengelompokan Ringkasan Cash Advance Berdasarkan Implementation Timeline TOR
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Total Tahap Implementasi: <strong>{timelineItems.length} Tahap</strong>
            </span>
          </div>

          <div className="border border-slate-800 overflow-hidden">
            <table className="w-full table-fixed text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#D9E1F2] text-slate-900 font-bold border-b border-slate-800">
                  <th className="py-2 px-1 w-[3.5%] text-center border-r border-slate-800 align-middle">
                    No
                  </th>
                  <th className="py-2 px-2 w-[15.5%] border-r border-slate-800 align-middle">
                    No. Form Kasbon
                  </th>
                  <th className="py-2 px-1.5 w-[12%] text-center border-r border-slate-800 align-middle">
                    Kode &amp; Master
                  </th>
                  <th className="py-2 px-2 w-[20.5%] border-r border-slate-800 align-middle">
                    Uraian Kebutuhan / Pos Pengeluaran
                  </th>
                  <th className="py-2 px-1.5 w-[10.5%] text-right border-r border-slate-800 align-middle">
                    Uang Muka Diterima
                  </th>
                  <th className="py-2 px-1.5 w-[11%] text-right border-r border-slate-800 align-middle">
                    Realisasi Belanja
                  </th>
                  <th className="py-2 px-1.5 w-[6.5%] text-right border-r border-slate-800 align-middle">
                    Sisa Uang Muka
                  </th>
                  <th className="py-2 px-1.5 w-[6.5%] text-right border-r border-slate-800 align-middle">
                    Minus
                  </th>
                  <th className="py-2 px-1 w-[4.5%] text-center border-r border-slate-800 align-middle">
                    %
                  </th>
                  <th className="py-2 px-1.5 w-[9.5%] align-middle">
                    Status Laporan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-400 bg-white">
                {timelineItems.map((tl, tlIdx) => {
                  const groupRows = rows.filter((r) => r.timelineItemId === tl.id);
                  const groupAdvance = groupRows.reduce(
                    (s, r) => s + (Number(r.advanceAmount) || 0),
                    0
                  );
                  const groupSpent = groupRows.reduce(
                    (s, r) => s + (Number(r.actualSpent) || 0),
                    0
                  );

                  return (
                    <React.Fragment key={tl.id}>
                      {/* Header Kelompok Implementation Timeline (Aktivitas Implementasi) */}
                      <tr className="bg-slate-100 border-y border-slate-800">
                        <td
                          colSpan={10}
                          className="py-2 px-2.5 font-bold text-slate-900"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="px-2 py-0.5 rounded bg-[#1E3A8A] text-white text-[11px] font-mono shrink-0">
                                Tahap {tlIdx + 1}
                              </span>
                              <span className="text-slate-900 font-bold break-words">
                                {tl.activity}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-slate-700 shrink-0">
                              Subtotal Tahap: Uang Muka {formatAccountingCell(groupAdvance)} | Realisasi {formatAccountingCell(groupSpent)}
                            </span>
                          </div>
                        </td>
                      </tr>

                      {groupRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={10}
                            className="py-2.5 px-3 text-slate-500 italic bg-white break-words"
                          >
                            Belum ada item Cash Advance yang diajukan pada aktivitas implementasi ({tl.activity}) ini.
                          </td>
                        </tr>
                      ) : (
                        groupRows.map((row, idx) => {
                          const rowRemaining = Math.max(
                            0,
                            row.advanceAmount - row.actualSpent
                          );
                          const rowShortage = Math.max(
                            0,
                            row.actualSpent - row.advanceAmount
                          );
                          const rowPct =
                            row.advanceAmount > 0
                              ? Math.round(
                                  (row.actualSpent / row.advanceAmount) * 100
                                )
                              : 0;
                          const parentCa = cashAdvances.find(
                            (c) => c.id === row.advanceId
                          );
                          const masterInfo = resolveMasterBudgetByCode(row.budgetCode, tor);

                          return (
                            <tr
                              key={row.id}
                              className="hover:bg-slate-50/80 transition-colors align-top"
                            >
                              <td className="py-2 px-1 text-center font-mono text-slate-700 border-r border-slate-400">
                                {idx + 1}
                              </td>
                              <td className="py-2 px-2 font-mono font-semibold text-[#1E3A8A] border-r border-slate-400 break-all">
                                <div className="text-[11px] leading-snug">{row.advanceNumber}</div>
                                <div className="mt-1 text-[10px] font-sans font-normal text-slate-600 leading-snug break-words">
                                  {row.timelineActivity || tl.activity}
                                </div>
                              </td>
                              <td className="py-2 px-1.5 text-center border-r border-slate-400 break-words">
                                <span className="inline-block font-mono font-bold text-slate-900">
                                  {masterInfo.code}
                                </span>
                                <div className="text-[10px] text-slate-600 font-medium leading-tight mt-0.5">
                                  {masterInfo.masterName}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-slate-900 border-r border-slate-400 break-words">
                                <div className="font-medium leading-snug">{row.description}</div>
                                <input
                                  type="text"
                                  value={row.notes}
                                  onChange={(e) =>
                                    handleNoteChange(row.id, e.target.value)
                                  }
                                  placeholder="Catatan..."
                                  className="mt-1 w-full px-1 py-0.5 text-[10.5px] text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-[#1E3A8A] focus:bg-white focus:outline-none"
                                />
                              </td>
                              <td className="py-2 px-1.5 text-right font-mono text-[11px] text-slate-900 border-r border-slate-400 break-words">
                                {formatAccountingCell(row.advanceAmount)}
                              </td>
                              <td className="py-1.5 px-1.5 border-r border-slate-400 bg-blue-50/20">
                                <input
                                  type="number"
                                  min="0"
                                  step="1000"
                                  value={
                                    row.actualSpent === 0 ? '' : row.actualSpent
                                  }
                                  onChange={(e) =>
                                    handleSpentChange(row.id, e.target.value)
                                  }
                                  placeholder="0"
                                  className="w-full px-1.5 py-1 text-[11px] text-right font-mono font-semibold text-slate-900 bg-white rounded border border-blue-300 focus:border-[#1E3A8A] focus:outline-none print:border-none print:bg-transparent print:p-0"
                                />
                              </td>
                              <td className="py-2 px-1.5 text-right font-mono text-[11px] font-semibold text-emerald-800 bg-[#D9E1F2]/35 border-r border-slate-400 break-words">
                                {formatAccountingCell(rowRemaining)}
                              </td>
                              <td className="py-2 px-1.5 text-right font-mono text-[11px] font-semibold text-rose-700 bg-[#D9E1F2]/35 border-r border-slate-400 break-words">
                                {formatAccountingCell(rowShortage)}
                              </td>
                              <td className="py-2 px-1 text-center font-mono text-[11px] font-bold text-slate-800 border-r border-slate-400">
                                {rowPct}%
                              </td>
                              <td className="py-2 px-1.5 text-[10.5px] break-words">
                                {parentCa?.isReported && parentCa.expensifyPdfLink ? (
                                  <div className="space-y-0.5">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                      Laporan Ditutup
                                    </span>
                                    <a
                                      href={parentCa.expensifyPdfLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-[#1E3A8A] hover:underline font-semibold truncate"
                                    >
                                      <Link2 className="w-3 h-3 shrink-0" />
                                      <span className="truncate">PDF Expensify</span>
                                    </a>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold text-[10px]">
                                      Belum Ditutup
                                    </span>
                                    {parentCa && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenCloseModal(parentCa)}
                                        className="block text-[#1E3A8A] hover:underline font-semibold text-[10px] cursor-pointer print:hidden"
                                      >
                                        + Tutup Laporan
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-[#D9E1F2] font-bold text-slate-900 border-t-2 border-slate-800">
                    <td
                      colSpan={4}
                      className="py-2 px-2.5 text-right uppercase tracking-wide border-r border-slate-800"
                    >
                      TOTAL SELURUH IMPLEMENTASI
                    </td>
                    <td className="py-2 px-1.5 text-right font-mono text-[11px] border-r border-slate-800 break-words">
                      {formatAccountingCell(grandTotalAdvance)}
                    </td>
                    <td className="py-2 px-1.5 text-right font-mono text-[11px] border-r border-slate-800 break-words">
                      {formatAccountingCell(grandTotalSpent)}
                    </td>
                    <td className="py-2 px-1.5 text-right font-mono text-[11px] text-emerald-900 border-r border-slate-800 break-words">
                      {formatAccountingCell(grandTotalRemaining)}
                    </td>
                    <td className="py-2 px-1.5 text-right font-mono text-[11px] text-rose-800 border-r border-slate-800 break-words">
                      {formatAccountingCell(grandTotalShortage)}
                    </td>
                    <td className="py-2 px-1 text-center font-mono text-[11px] border-r border-slate-800">
                      {grandPercentUsed}%
                    </td>
                    <td className="py-2 px-1.5 text-[10.5px] font-semibold">
                      {reportedAdvances.length}/{cashAdvances.length} CA Dilaporkan
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ========================================================================= */}
          {/* GAMBAR 5 & 6: RINGKASAN AKHIR (AKUMULASI LAPORAN YANG TELAH DITUTUP)      */}
          {/* Muncul fitur Tutup Laporan / Laporkan Lap. Keuangan Akhir jika semua      */}
          {/* tahap implementasi sudah memiliki Cash Advance & sudah dilaporkan         */}
          {/* ========================================================================= */}
          {(() => {
            const activeCas = cashAdvances.filter((c) => c.status !== 'Ditolak');
            const coveredStageCount =
              timelineItems.length === 0
                ? activeCas.length > 0
                  ? 1
                  : 0
                : timelineItems.filter((tl) =>
                    rows.some((r) => r.timelineItemId === tl.id) ||
                    activeCas.some(
                      (c) =>
                        c.implementationMode === 'all' ||
                        (c.implementationTimelineIds || []).includes(tl.id)
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

            // Complement upgrade from last financial report approval or summaryMeta
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

            const effectiveSignDate =
              summaryMeta.reportDate || reportDate || new Date().toISOString().slice(0, 10);

            return (
              <div className="pt-4 space-y-2.5 border-t border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs sm:text-sm font-bold text-black uppercase tracking-wide">
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

                {/* Banner Fitur Tutup Laporan & Laporkan Lap. Keuangan Akhir */}
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
                      <FileCheck2 className="w-4 h-4 shrink-0" />
                      <span>
                        {isFinalApprovedByDirector
                          ? 'Laporan Keuangan Akhir Telah Ditutup, Diperiksa Finance & Disetujui Director'
                          : canTriggerFinalFinancialClosure
                          ? 'Seluruh Tahap Implementasi Memiliki Cash Advance & Telah Dilaporkan — Siap Tutup Laporan Keuangan Akhir'
                          : 'Syarat Tutup Laporan Keuangan Akhir: Semua Tahap Implementasi Memiliki Cash Advance & Seluruh CA Telah Dilaporkan'}
                      </span>
                    </div>
                    <p className="text-[11px] opacity-90">
                      {canTriggerFinalFinancialClosure
                        ? 'Silakan klik tombol di bawah untuk melaporkan Laporan Keuangan Akhir, lalu diperiksa oleh Finance dan disetujui oleh Director (complement upgrade otomatis dengan Laporan Keuangan Tahap 08).'
                        : `Saat ini ${coveredStageCount}/${totalStageCount} tahap implementasi memiliki CA dan ${reportedAdvances.length}/${activeCas.length} CA telah ditutup laporannya.`}
                    </p>
                  </div>

                  {canTriggerFinalFinancialClosure && (
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {!summaryMeta.summaryReportedAt && (
                        <button
                          type="button"
                          disabled={isApprovingStage}
                          onClick={() => handleApproveSummary('report')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1E3A8A] hover:bg-[#1E40AF] text-white font-semibold text-xs shadow-2xs cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Tutup Laporan &amp; Laporkan Lap. Keuangan Akhir</span>
                        </button>
                      )}
                      {isFinalReported && !isFinalVerifiedByFinance && (
                        <button
                          type="button"
                          disabled={isApprovingStage}
                          onClick={() => handleApproveSummary('finance')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs shadow-2xs cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Periksa Lap. Keuangan Akhir (Finance)</span>
                        </button>
                      )}
                      {isFinalVerifiedByFinance && !isFinalApprovedByDirector && (
                        <button
                          type="button"
                          disabled={isApprovingStage}
                          onClick={() => handleApproveSummary('director')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-2xs cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Setujui Lap. Keuangan Akhir (Director)</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onNavigateStage(8)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-semibold text-xs cursor-pointer"
                      >
                        <span>Buka Tahap 08 Lap. Keuangan →</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
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

                <div className="grid grid-cols-1 sm:grid-cols-12 pt-1 text-xs italic text-black">
                  <div className="sm:col-span-5 pr-2">Cek uang muka form vs laporan</div>
                  <div className="sm:col-span-7">
                    {reportedAdvances.length > 0
                      ? 'OK – seluruh uang muka pada Form Permintaan Dana & Form Tambahan yang telah ditutup laporan telah tercakup di ringkasan akhir'
                      : 'Menunggu penutupan laporan Cash Advance beserta lampiran Link PDF Expensify'}
                  </div>
                </div>

                {/* 3-Column Stamp Sign-Off Block (Gambar 5 & 6) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-4 pb-2 text-center text-xs text-black">
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
                          disabled={isApprovingStage}
                          onClick={() => handleApproveSummary('report')}
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
                          disabled={isApprovingStage}
                          onClick={() => handleApproveSummary('finance')}
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
                          disabled={isApprovingStage}
                          onClick={() => handleApproveSummary('director')}
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
      </div>

      {/* ========================================================================= */}
      {/* DEDICATED CASH ADVANCE SUMMARY AUDIT TRAIL (TERPISAH DARI AUDIT TOR)      */}
      {/* ========================================================================= */}
      <div className="pt-6 border-t-2 border-slate-200 space-y-4 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#1E3A8A]/10 text-[#1E3A8A] flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                Audit Trail Khusus Ringkasan &amp; Penutupan Laporan Cash Advance
              </h4>
              <p className="text-[11px] text-slate-500">
                Log jejak rekam perubahan realisasi belanja, lampiran PDF Expensify, dan penutupan laporan kasbon
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={updateNote}
              onChange={(e) => setUpdateNote(e.target.value)}
              placeholder="Tambahkan catatan rekonsiliasi / bukti setor..."
              className="px-3 py-1.5 text-xs border border-slate-300 rounded w-64 sm:w-72 focus:outline-none focus:border-[#1E3A8A]"
            />
            <button
              type="button"
              onClick={() => handleSaveSummary('Rekam Jejak Audit Rekonsiliasi Kasbon')}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#1E3A8A] hover:bg-[#1E40AF] text-white transition-colors cursor-pointer shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
              <span>Catat ke Audit Trail</span>
            </button>
          </div>
        </div>

        {auditLogs.length === 0 ? (
          <div className="p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 text-xs text-slate-500 flex items-center justify-between">
            <span>
              Belum ada riwayat perubahan realisasi atau penutupan laporan pada Ringkasan Cash Advance ini.
            </span>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {auditLogs.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-white transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-[#1E3A8A]">{entry.action}</span>
                    <span className="text-slate-300">•</span>
                    <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                      <UserIcon className="w-3 h-3 text-slate-500" />
                      {entry.actorName} ({entry.actorRole})
                    </span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">{entry.details}</p>
                </div>

                <div className="flex sm:flex-col items-end justify-between gap-1 shrink-0 text-right">
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
                    <Clock className="w-3 h-3" />
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                      Realisasi: {formatRupiah(entry.totalSpent)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-bold">
                      {entry.percentUsed}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
