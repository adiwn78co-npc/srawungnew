import React, { useMemo, useRef, useState } from 'react';
import {
  Tor,
  Program,
  Outcome,
  Output,
  Activity,
  TorSpecificObjectiveItem,
  TorTimelineItem,
  TorMonitoringItem,
} from '../../types/index.js';
import { Download, X, FileText, Sliders, Check } from 'lucide-react';
import { formatIndonesianDate } from '../../lib/dateUtils.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { formatTorTeamSummary } from './torTeamFormatter.js';

interface TorPdfExportModalProps {
  tor: Tor;
  isOpen: boolean;
  onClose: () => void;
  program?: Program;
  outcome?: Outcome;
  output?: Output;
  activity?: Activity;
}

function formatRupiahCompact(amount?: number | null): string {
  if (amount == null || isNaN(Number(amount))) return '—';
  return `Rp${Number(amount).toLocaleString('id-ID')}`;
}

export const TorPdfExportModal: React.FC<TorPdfExportModalProps> = ({
  tor,
  isOpen,
  onClose,
  program,
  outcome,
  output,
  activity,
}) => {
  const resolvedProgramName = program?.name || tor.programName || '';
  const resolvedOutcomeName = outcome?.name || tor.outcomeName || '';
  const resolvedOutputName = output?.name || tor.outputName || '';
  const resolvedActivityName = activity?.name || tor.activityName || tor.title;

  const activityCodeDisplay = useMemo(() => {
    const codeStr = tor.activityCode || tor.hierarchyCode || '';
    if (!codeStr) return '—';
    const firstNum = codeStr.split('.')[0] || '1';
    return `Outcome ${firstNum} ; Activity ${codeStr}`;
  }, [tor.activityCode, tor.hierarchyCode]);

  const organizerLines = useMemo(
    () => formatTorTeamSummary(tor, '-'),
    [tor]
  );

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
    if (tor.implementationMechanisms && tor.implementationMechanisms.length > 0 && !hasForeign) {
      return tor.implementationMechanisms;
    }
    return [];
  }, [tor]);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // =========================================================================
  // OPSI TAMPILAN & UNDUH PDF TOR
  // =========================================================================
  // 1. Tujuan: 'simple' (Hanya Tujuan Umum & Tujuan Khusus) | 'full' (+ Tabel Hasil & Perubahan)
  const [objectiveDisplayMode, setObjectiveDisplayMode] = useState<'simple' | 'full'>('simple');

  // 2. Implementation Timeline: 'all' (Semua Ditunjukkan) | 'selected' (Hanya yang Dipilih)
  const [timelineDisplayMode, setTimelineDisplayMode] = useState<'all' | 'selected'>('all');
  const [selectedTimelineIds, setSelectedTimelineIds] = useState<string[]>(() =>
    complementaryTimeline.map((t, idx) => t.id || `tl-${idx}`)
  );

  // Sync selectedTimelineIds if complementaryTimeline changes
  React.useEffect(() => {
    setSelectedTimelineIds(complementaryTimeline.map((t, idx) => t.id || `tl-${idx}`));
  }, [complementaryTimeline]);

  const handleToggleTimelineId = (tlId: string) => {
    setSelectedTimelineIds((prev) => {
      if (prev.includes(tlId)) {
        // Minimal sisakan 1 tahapan terpilih
        if (prev.length <= 1) return prev;
        return prev.filter((id) => id !== tlId);
      }
      return [...prev, tlId];
    });
  };

  const displayedTimeline: TorTimelineItem[] = useMemo(() => {
    if (timelineDisplayMode === 'all') return complementaryTimeline;
    const filtered = complementaryTimeline.filter((t, idx) =>
      selectedTimelineIds.includes(t.id || `tl-${idx}`)
    );
    return filtered.length > 0 ? filtered : complementaryTimeline.slice(0, 1);
  }, [complementaryTimeline, timelineDisplayMode, selectedTimelineIds]);

  // 3. Monitoring Mechanism (Opsional: Tampilkan / Sembunyikan)
  const [showMonitoringMechanism, setShowMonitoringMechanism] = useState<boolean>(true);

  // 4. Rundown Kegiatan (Sesuai Implementation Timeline yang Dipilih)
  const [showRundownSection, setShowRundownSection] = useState<boolean>(
    tor.isRundownVisible !== false
  );

  if (!isOpen) return null;

  const handleDownloadPdf = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadElementAsPdf({
        element: sheetRef.current,
        filename: `TOR_${tor.torNumber || tor.id}`,
        paperFormat: 'legal',
        marginMm: 6,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const formattedDate = (dStr?: string) => {
    if (!dStr) return '—';
    return formatIndonesianDate(dStr);
  };

  return (
    <div className="tor-print-modal-overlay fixed inset-0 z-50 bg-stone-900/75 backdrop-blur-xs flex justify-center items-start overflow-y-auto p-3 sm:p-6 print:p-0 print:bg-white print:static print:overflow-visible">
      <div className="tor-print-modal-container bg-white w-full max-w-[850px] shadow-2xl border border-stone-300 overflow-hidden my-4 print:my-0 print:border-none print:shadow-none print:max-w-none">
        {/* Top Control Bar (Hidden when printing) */}
        <div className="bg-stone-800 text-white px-5 py-3 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-sky-400" />
            <span className="text-xs sm:text-sm font-semibold">
              Pratinjau Dokumen TOR (Legal · Margin Narrow)
            </span>
            <span className="text-xs font-mono bg-stone-700 px-2 py-0.5 rounded text-sky-300">
              {tor.torNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0f2b5c] hover:bg-[#1a448a] disabled:opacity-60 text-white text-xs font-medium rounded transition-colors shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isDownloading ? 'Mengunduh PDF...' : 'Download / Simpan PDF (Legal)'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-white rounded hover:bg-stone-700 transition-colors cursor-pointer"
              title="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Panel Opsi Tampilan PDF (Hidden when printing / downloading sheet) */}
        <div className="bg-stone-100 border-b border-stone-300 px-5 py-3.5 text-xs text-stone-800 space-y-3 print:hidden">
          <div className="flex items-center gap-1.5 font-bold text-stone-900 text-[11.5px] uppercase tracking-wider">
            <Sliders className="w-3.5 h-3.5 text-[#0f2b5c]" />
            <span>Opsi Komponen Dokumen PDF yang Ditampilkan</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 1. Opsi Tujuan (Sederhana vs Lengkap) */}
            <div className="bg-white border border-stone-200 rounded p-2.5 space-y-1.5">
              <div className="font-semibold text-stone-800 text-[11px]">
                1. Tampilan Tujuan (Objectives)
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setObjectiveDisplayMode('simple')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                    objectiveDisplayMode === 'simple'
                      ? 'bg-[#0f2b5c] text-white border-[#0f2b5c]'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  Sederhana (Hanya Tujuan Umum & Khusus)
                </button>
                <button
                  type="button"
                  onClick={() => setObjectiveDisplayMode('full')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                    objectiveDisplayMode === 'full'
                      ? 'bg-[#0f2b5c] text-white border-[#0f2b5c]'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  Lengkap (+ Tabel Hasil & Perubahan)
                </button>
              </div>
            </div>

            {/* 2. Opsi Implementation Timeline (Semua vs Hanya yang Dipilih) */}
            <div className="bg-white border border-stone-200 rounded p-2.5 space-y-1.5">
              <div className="font-semibold text-stone-800 text-[11px]">
                2. Opsi Implementation Timeline & Rundown
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTimelineDisplayMode('all')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                    timelineDisplayMode === 'all'
                      ? 'bg-[#0f2b5c] text-white border-[#0f2b5c]'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  Semua Ditunjukkan ({complementaryTimeline.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineDisplayMode('selected')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                    timelineDisplayMode === 'selected'
                      ? 'bg-[#0f2b5c] text-white border-[#0f2b5c]'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  Hanya yang Dipilih ({displayedTimeline.length}/{complementaryTimeline.length})
                </button>
              </div>
            </div>

            {/* 3. Opsi Monitoring Mechanism (Opsional) */}
            <div className="bg-white border border-stone-200 rounded p-2.5 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-stone-800 text-[11px]">
                  3. Monitoring Mechanism (Opsional)
                </div>
                <div className="text-[10.5px] text-stone-500">
                  Tampilkan atau sembunyikan tabel Monitoring Mechanism
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMonitoringMechanism((v) => !v)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer shrink-0 ${
                  showMonitoringMechanism
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-stone-100 text-stone-600 border-stone-300 hover:bg-stone-200'
                }`}
              >
                {showMonitoringMechanism ? 'Ditampilkan' : 'Disembunyikan'}
              </button>
            </div>

            {/* 4. Opsi Rundown Kegiatan (Mengikuti Implementation Timeline yang Dipilih) */}
            <div className="bg-white border border-stone-200 rounded p-2.5 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-stone-800 text-[11px]">
                  4. Rundown Kegiatan (Sesuai Implementasi Terpilih)
                </div>
                <div className="text-[10.5px] text-stone-500">
                  Otomatis menyesuaikan tahapan Implementation Timeline yang dipilih
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRundownSection((v) => !v)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer shrink-0 ${
                  showRundownSection
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-stone-100 text-stone-600 border-stone-300 hover:bg-stone-200'
                }`}
              >
                {showRundownSection ? 'Ditampilkan' : 'Disembunyikan'}
              </button>
            </div>
          </div>

          {/* Daftar Pilihan Tahapan Implementation Timeline (Muncul saat mode 'selected') */}
          {timelineDisplayMode === 'selected' && (
            <div className="bg-white border border-stone-200 rounded p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-stone-800 text-[11px]">
                  Pilih Tahapan Implementation Timeline (Rundown otomatis mengikuti pilihan ini):
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTimelineIds(
                      complementaryTimeline.map((t, idx) => t.id || `tl-${idx}`)
                    )
                  }
                  className="text-[10.5px] font-medium text-[#0f2b5c] hover:underline cursor-pointer"
                >
                  Pilih Semua
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {complementaryTimeline.map((item, idx) => {
                  const tlKey = item.id || `tl-${idx}`;
                  const isChecked = selectedTimelineIds.includes(tlKey);
                  return (
                    <label
                      key={tlKey}
                      onClick={() => handleToggleTimelineId(tlKey)}
                      className={`flex items-start gap-2 p-1.5 rounded border text-[11px] cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-sky-50/70 border-sky-300 text-stone-900'
                          : 'bg-stone-50 border-stone-200 text-stone-500'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                          isChecked
                            ? 'bg-[#0f2b5c] border-[#0f2b5c] text-white'
                            : 'bg-white border-stone-300'
                        }`}
                      >
                        {isChecked && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="leading-snug">
                        <strong className="font-mono">{item.period}</strong> — {item.activity}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* CLASSIC FORMAL PRINT TOR DOCUMENT (MATCHING SCREENSHOTS) */}
        {/* ======================================================== */}
        <div
          ref={sheetRef}
          className="tor-formal-print-sheet px-5 py-5 sm:px-6 sm:py-5 text-black bg-white text-[14px] leading-[1.38] print:px-4 print:py-3"
          style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
        >
          {/* Main Document Heading */}
          <h1 className="text-center font-bold uppercase text-[15px] tracking-normal mb-4 text-black">
            TERM OF REFERENCE
          </h1>

          {/* ================= PROJECT INFORMATION ================= */}
          <div className="mb-5">
            <div
              className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
              style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
            >
              Project Information
            </div>

            <table className="w-full border-collapse border border-black text-[14px] text-black">
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
                {(resolvedProgramName || resolvedOutcomeName || resolvedOutputName) && (
                  <tr>
                    <td className="border border-black px-2.5 py-1 font-bold align-top">
                      Program Hierarchy
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top space-y-0.5">
                      <div>Program: {resolvedProgramName}</div>
                      {resolvedOutcomeName && <div>Outcome: {resolvedOutcomeName}</div>}
                      {resolvedOutputName && <div>Output: {resolvedOutputName}</div>}
                      {resolvedActivityName && <div>Activity: {resolvedActivityName}</div>}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="border border-black px-2.5 py-1 font-bold align-top">
                    Tim Pelaksana
                  </td>
                  <td className="border border-black px-2.5 py-1 align-top whitespace-pre-wrap leading-[1.38]">
                    {organizerLines}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2.5 py-1 font-bold align-top">
                    Start date
                  </td>
                  <td className="border border-black px-2.5 py-1 align-top">
                    {formattedDate(tor.startDate)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2.5 py-1 font-bold align-top">
                    End date
                  </td>
                  <td className="border border-black px-2.5 py-1 align-top">
                    {formattedDate(tor.endDate)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2.5 py-1 font-bold align-top">
                    Report date
                  </td>
                  <td className="border border-black px-2.5 py-1 align-top">
                    {formattedDate(tor.reportingDeadline)}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2.5 py-1 font-bold align-top">
                    Location
                  </td>
                  <td className="border border-black px-2.5 py-1 align-top">
                    {tor.location || '—'}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-2.5 py-1 font-bold align-top">
                    Budget request USD/IDR
                  </td>
                  <td className="border border-black px-2.5 py-1 align-top">
                    {formatRupiahCompact(tor.budgetRequested)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ================= BACKGROUND & OBJECTIVES ================= */}
          <div className="mb-5">
            <div
              className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
              style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
            >
              Background
            </div>

            <div className="space-y-2.5 text-black">
              {tor.background && tor.background.trim() ? (
                tor.background.split(/\n\s*\n/).map((para, idx) => (
                  <p key={idx} className="whitespace-pre-line leading-[1.38]">
                    {para.trim()}
                  </p>
                ))
              ) : (
                <p className="text-stone-500 italic">—</p>
              )}

              {tor.rationale && (
                <p className="whitespace-pre-line leading-[1.38]">{tor.rationale.trim()}</p>
              )}
            </div>

            {/* Tujuan Umum */}
            <div className="mt-3">
              <div className="font-bold text-black">Tujuan Umum</div>
              <p className="text-black leading-[1.38] whitespace-pre-line">
                {tor.generalObjective || tor.objectives || '—'}
              </p>
            </div>

            {/* Tujuan Khusus */}
            <div className="mt-2.5">
              <div className="font-bold text-black">Tujuan Khusus</div>
              {complementaryObjectives.length === 0 ? (
                <p className="text-stone-500 italic mt-0.5">—</p>
              ) : (
                <>
                  <ol className="list-decimal pl-8 space-y-1 text-black leading-[1.38] mt-0.5">
                    {complementaryObjectives.map((so, idx) => (
                      <li key={so.id || idx} className="pl-1">
                        {so.objective}
                      </li>
                    ))}
                  </ol>

                  {/* 3-Column Table: Hanya ditampilkan jika mode 'full' */}
                  {objectiveDisplayMode === 'full' && (
                    <table className="w-full border-collapse border border-black text-[14px] text-black mt-3">
                      <thead>
                        <tr>
                          <th className="w-1/3 border border-black px-2.5 py-1 text-left font-bold">
                            Tujuan Khusus
                          </th>
                          <th className="w-1/3 border border-black px-2.5 py-1 text-left font-bold">
                            Hasil yang Diharapkan
                          </th>
                          <th className="w-1/3 border border-black px-2.5 py-1 text-left font-bold">
                            Perubahan yang Diharapkan
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {complementaryObjectives.map((so, idx) => (
                          <tr key={so.id || idx}>
                            <td className="border border-black px-2.5 py-1 align-top leading-[1.38]">
                              {idx + 1}. {so.objective}
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top leading-[1.38] whitespace-pre-line">
                              {so.expectedResult || '—'}
                            </td>
                            <td className="border border-black px-2.5 py-1 align-top leading-[1.38] whitespace-pre-line">
                              {so.expectedChange || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ================= IMPLEMENTATION TIMELINE ================= */}
          {displayedTimeline.length > 0 && (
            <div className="mb-5">
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Implementation Timeline
              </div>

              <table className="w-full border-collapse border border-black text-[14px] text-black">
                <thead>
                  <tr>
                    <th className="w-[28%] border border-black px-2.5 py-1 text-left font-bold">
                      Period
                    </th>
                    <th className="w-[72%] border border-black px-2.5 py-1 text-left font-bold">
                      Activity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTimeline.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="border border-black px-2.5 py-1 align-top">
                        {item.period}
                      </td>
                      <td className="border border-black px-2.5 py-1 align-top leading-[1.38]">
                        {item.activity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ================= MONITORING MECHANISM (OPSIONAL) ================= */}
          {showMonitoringMechanism && complementaryMonitoring.length > 0 && (
            <div className="mb-5">
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Monitoring Mechanism
              </div>

              <table className="w-full border-collapse border border-black text-[14px] text-black">
                <thead>
                  <tr>
                    <th className="w-[22%] border border-black px-2.5 py-1 text-left font-bold">
                      Aspect
                    </th>
                    <th className="w-[40%] border border-black px-2.5 py-1 text-left font-bold">
                      Method
                    </th>
                    <th className="w-[20%] border border-black px-2.5 py-1 text-left font-bold">
                      Frequency
                    </th>
                    <th className="w-[18%] border border-black px-2.5 py-1 text-left font-bold">
                      PIC
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {complementaryMonitoring.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="border border-black px-2.5 py-1 align-top leading-[1.38]">
                        {item.aspect}
                      </td>
                      <td className="border border-black px-2.5 py-1 align-top leading-[1.38]">
                        {item.method}
                      </td>
                      <td className="border border-black px-2.5 py-1 align-top leading-[1.38]">
                        {item.frequency}
                      </td>
                      <td className="border border-black px-2.5 py-1 align-top leading-[1.38]">
                        {item.pic}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ================= SCOPE OF ACTIVITIES ================= */}
          {complementaryScope.length > 0 && (
            <div className="mb-5">
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Scope of Activities
              </div>

              <ul className="list-disc pl-8 space-y-1 text-black leading-[1.38]">
                {complementaryScope.map((point, idx) => (
                  <li key={idx} className="pl-1">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ================= MEKANISME PELAKSANAAN ================= */}
          {complementaryMechanisms.length > 0 && (
            <div className="mb-5">
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Mekanisme Pelaksanaan
              </div>

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
            </div>
          )}

          {/* ================= PESERTA KEGIATAN ================= */}
          {tor.participantRows && tor.participantRows.length > 0 && (
            <div className="mb-5">
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Peserta Kegiatan ({tor.participantType || tor.participantsType || 'Masyarakat Umum'})
              </div>

              {(() => {
                const cols =
                  tor.participantCustomColumns && tor.participantCustomColumns.length > 0
                    ? tor.participantCustomColumns
                    : [
                        { id: 'col-target', label: 'Target Peserta', type: 'text' as const },
                        { id: 'col-male', label: 'Est. Laki-laki', type: 'number' as const },
                        { id: 'col-female', label: 'Est. Perempuan', type: 'number' as const },
                        { id: 'col-note', label: 'Keterangan', type: 'text' as const },
                      ];

                const colTotals: Record<string, number> = {};
                cols.forEach((col) => {
                  if (col.type === 'number') {
                    let sum = 0;
                    tor.participantRows!.forEach((r) => {
                      const val = Number(
                        r.customValues?.[col.id] ??
                          (col.id === 'col-male'
                            ? r.maleCount
                            : col.id === 'col-female'
                            ? r.femaleCount
                            : 0)
                      );
                      if (!isNaN(val)) sum += val;
                    });
                    colTotals[col.id] = sum;
                  }
                });

                return (
                  <table className="w-full border-collapse border border-black text-[14px] text-black">
                    <thead>
                      <tr>
                        <th className="w-10 border border-black px-2 py-1 text-center font-bold">
                          No
                        </th>
                        {cols.map((col) => (
                          <th
                            key={col.id}
                            className={`border border-black px-2.5 py-1 font-bold ${
                              col.type === 'number' ? 'text-center' : 'text-left'
                            }`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tor.participantRows!.map((row, idx) => (
                        <tr key={row.id || idx}>
                          <td className="border border-black px-2 py-1 text-center align-top">
                            {idx + 1}
                          </td>
                          {cols.map((col) => {
                            let cellValue = row.customValues?.[col.id];
                            if (cellValue === undefined || cellValue === '') {
                              if (col.id === 'col-target' || col.id === 'target')
                                cellValue = row.target;
                              else if (col.id === 'col-male' || col.id === 'maleCount')
                                cellValue =
                                  row.maleCount !== undefined && row.maleCount !== null
                                    ? String(row.maleCount)
                                    : '';
                              else if (col.id === 'col-female' || col.id === 'femaleCount')
                                cellValue =
                                  row.femaleCount !== undefined && row.femaleCount !== null
                                    ? String(row.femaleCount)
                                    : '';
                              else if (col.id === 'col-note' || col.id === 'note')
                                cellValue = row.note;
                              else if (col.id === 'col-segment' || col.id === 'segment')
                                cellValue = row.segment;
                            }

                            return (
                              <td
                                key={col.id}
                                className={`border border-black px-2.5 py-1 align-top ${
                                  col.type === 'number' ? 'text-center' : ''
                                }`}
                              >
                                {cellValue !== undefined && cellValue !== ''
                                  ? col.type === 'number'
                                    ? `${cellValue} Org`
                                    : cellValue
                                  : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    {cols.some((c) => c.type === 'number') && (
                      <tfoot>
                        <tr className="font-bold">
                          <td className="border border-black px-2 py-1 text-center">Σ</td>
                          {cols.map((col, cIdx) => {
                            if (col.type === 'number') {
                              return (
                                <td
                                  key={col.id}
                                  className="border border-black px-2.5 py-1 text-center font-bold"
                                >
                                  {colTotals[col.id] || 0} Org
                                </td>
                              );
                            }
                            return (
                              <td key={col.id} className="border border-black px-2.5 py-1 font-bold">
                                {cIdx === 0 ? 'Total Estimasi Peserta' : ''}
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                );
              })()}
            </div>
          )}

          {/* ================= TIM PELAKSANA (ROLE & RESPONSIBILITY) ================= */}
          {tor.rolesResponsibilities && tor.rolesResponsibilities.length > 0 && (
            <div className="mb-5">
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Role &amp; Responsibility
              </div>

              <table className="w-full border-collapse border border-black text-[14px] text-black">
                <thead>
                  <tr>
                    <th className="w-1/3 border border-black px-2.5 py-1 text-left font-bold">
                      Nama - Lembaga
                    </th>
                    <th className="w-1/4 border border-black px-2.5 py-1 text-left font-bold">
                      Role
                    </th>
                    <th className=" border border-black px-2.5 py-1 text-left font-bold">
                      Responsibility
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tor.rolesResponsibilities.map((r, idx) => (
                    <tr key={r.id || idx}>
                      <td className="border border-black px-2.5 py-1 align-top">
                        {r.nameInstitution ||
                          (r.institution ? `${r.picName} — ${r.institution}` : r.picName)}
                      </td>
                      <td className="border border-black px-2.5 py-1 align-top">{r.role}</td>
                      <td className="border border-black px-2.5 py-1 align-top leading-[1.38]">
                        {r.responsibilities}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ================= RUNDOWN KEGIATAN (SESUAI IMPLEMENTATION TIMELINE TERPILIH) ================= */}
          {showRundownSection && tor.rundown && tor.rundown.length > 0 && (
            <div className="mb-5">
              <div
                className="bg-[#CCCCCC] text-black font-bold px-2 py-1 mb-2.5 text-[14px]"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                Rundown Kegiatan
              </div>

              <div className="space-y-3">
                {(() => {
                  const rawRundown = tor.rundown || [];
                  const activeTlKeySet = new Set(
                    displayedTimeline.map(
                      (t) =>
                        t.id ||
                        `tl-${complementaryTimeline.findIndex((ct) => ct === t)}`
                    )
                  );

                  const groups: {
                    key: string;
                    timelineLabel: string;
                    items: { rd: any; originalIdx: number }[];
                  }[] = [];

                  rawRundown.forEach((rd, idx) => {
                    const matchedTl = rd.timelineId
                      ? complementaryTimeline.find((t) => t.id === rd.timelineId)
                      : complementaryTimeline.find(
                          (t) =>
                            (rd.date && rd.date.includes(t.period)) ||
                            (rd.timelineLabel &&
                              (rd.timelineLabel.includes(t.period) ||
                                rd.timelineLabel.includes(t.activity)))
                        ) ||
                        complementaryTimeline[idx] ||
                        complementaryTimeline[0];

                    const matchedTlIdx = matchedTl
                      ? complementaryTimeline.indexOf(matchedTl)
                      : -1;
                    const resolvedTlId = matchedTl
                      ? matchedTl.id || `tl-${matchedTlIdx}`
                      : rd.timelineId || `group-${idx}`;

                    if (
                      timelineDisplayMode === 'selected' &&
                      matchedTl &&
                      !activeTlKeySet.has(resolvedTlId)
                    ) {
                      return;
                    }

                    const resolvedKey =
                      resolvedTlId ||
                      rd.timelineLabel ||
                      `group-${idx}`;
                    const resolvedLabel = matchedTl
                      ? `${matchedTl.period} — ${matchedTl.activity}`
                      : rd.timelineLabel || rd.date || `Bagian Rundown ${idx + 1}`;

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
                      <table className="w-full table-fixed border-collapse text-[14px] text-black">
                        <thead>
                          <tr>
                            <th className="w-[15%] border-b border-r border-black px-2.5 py-1 text-left font-bold">
                              Tanggal / Hari
                            </th>
                            <th className="w-[12%] border-b border-r border-black px-2.5 py-1 text-left font-bold">
                              Waktu
                            </th>
                            <th className="w-[27%] border-b border-r border-black px-2.5 py-1 text-left font-bold">
                              Agenda Kegiatan
                            </th>
                            <th className="w-[20%] border-b border-r border-black px-2.5 py-1 text-left font-bold">
                              Target Peserta
                            </th>
                            <th className="w-[14%] border-b border-r border-black px-2.5 py-1 text-left font-bold">
                              Tempat
                            </th>
                            <th className="w-[12%] border-b border-black px-2.5 py-1 text-left font-bold">
                              PIC
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map(({ rd, originalIdx }, itemIdx) => {
                            const isLastRow = itemIdx === group.items.length - 1;
                            const rowBorder = isLastRow ? '' : 'border-b border-black';
                            return (
                              <tr key={rd.id || originalIdx}>
                                <td
                                  className={`${rowBorder} border-r border-black px-2.5 py-1 align-top`}
                                >
                                  {rd.date}
                                </td>
                                <td
                                  className={`${rowBorder} border-r border-black px-2.5 py-1 align-top`}
                                >
                                  {rd.time}
                                </td>
                                <td
                                  className={`${rowBorder} border-r border-black px-2.5 py-1 align-top`}
                                >
                                  {rd.agenda}
                                </td>
                                <td
                                  className={`${rowBorder} border-r border-black px-2.5 py-1 align-top`}
                                >
                                  {rd.targetParticipants ||
                                    tor.participantRows?.[originalIdx]?.target ||
                                    tor.participantsTarget ||
                                    'Seluruh Peserta'}
                                </td>
                                <td
                                  className={`${rowBorder} border-r border-black px-2.5 py-1 align-top`}
                                >
                                  {rd.location}
                                </td>
                                <td className={`${rowBorder} px-2.5 py-1 align-top`}>
                                  {rd.picName}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
