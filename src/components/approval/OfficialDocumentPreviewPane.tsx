import React, { useEffect, useState } from 'react';
import {
  Tor,
  MeetingMinutesRecord,
  ActivityDocumentationRecord,
  MonitoringReportItem,
  CashAdvanceRecord,
  BestPhotoSlot,
  ApprovalHubItem,
} from '../../types/index.js';
import { api } from '../../lib/api.js';
import { formatIndonesianDate } from '../../lib/dateUtils.js';
import { formatRupiah } from '../../lib/terbilang.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';
import { useOrganizationSettings } from '../../lib/organizationSettings.js';
import { Download, ExternalLink, FileText, Edit3 } from 'lucide-react';
import { formatTorTeamSummary } from '../tor/torTeamFormatter.js';

interface OfficialDocumentPreviewPaneProps {
  item: ApprovalHubItem;
  tor: Tor | null;
  isRevisionUnlocked: boolean;
  onOpenSourcePage: (openEditor: boolean) => void;
}

const MONITORING_PREVIEW_SECTIONS = [
  {
    key: 'baseline' as const,
    title: '1. Baseline / Masalah Sebelum Intervensi',
    quote: 'Understand the challenge before seeking the solution.',
  },
  {
    key: 'intervention' as const,
    title: '2. Bagaimana Ditangani (Intervention)',
    quote: 'Every action should create value.',
  },
  {
    key: 'results' as const,
    title: '3. Hasil Setelah Ditangani / Intervensi',
    quote: 'Turning work into meaningful impact.',
  },
  {
    key: 'contextLearning' as const,
    title: '4. Context Learning',
    quote: 'Every context offers a lesson.',
  },
  {
    key: 'reflectionLearning' as const,
    title: '5. Reflection & Learning',
    quote: 'Reflect today, improve tomorrow.',
  },
  {
    key: 'keySuccessParticipation' as const,
    title: '6. Key Success Participation',
    quote: 'Identify the moments that kept participants connected.',
  },
  {
    key: 'nextImplementationProposal' as const,
    title: '7. Usulan untuk Implementasi Selanjutnya',
    quote: 'Capture the next steps for lasting impact, action completes the journey.',
  },
];

export const OfficialDocumentPreviewPane: React.FC<OfficialDocumentPreviewPaneProps> = ({
  item,
  tor,
  isRevisionUnlocked,
  onOpenSourcePage,
}) => {
  const { organizationName } = useOrganizationSettings();
  const [loadingSource, setLoadingSource] = useState<boolean>(false);
  const [notulenRecord, setNotulenRecord] = useState<MeetingMinutesRecord | null>(null);
  const [docRecord, setDocRecord] = useState<ActivityDocumentationRecord | null>(null);
  const [monitoringItem, setMonitoringItem] = useState<MonitoringReportItem | null>(null);
  const [cashAdvanceRecord, setCashAdvanceRecord] = useState<CashAdvanceRecord | null>(null);
  const [allTorCashAdvances, setAllTorCashAdvances] = useState<CashAdvanceRecord[]>([]);
  const [caSummaryData, setCaSummaryData] = useState<any>(null);

  useEffect(() => {
    let active = true;
    const torId = item.sourceTorId || tor?.id || '';
    setLoadingSource(true);
    setNotulenRecord(null);
    setDocRecord(null);
    setMonitoringItem(null);
    setCashAdvanceRecord(null);
    setAllTorCashAdvances([]);
    setCaSummaryData(null);

    const fetchSourceData = async () => {
      try {
        if (item.categoryCode === 'notulen' && torId) {
          const list = await api.getMeetingMinutes(torId).catch(() => []);
          if (!active) return;
          if (Array.isArray(list) && list.length > 0) {
            const matched =
              list.find(
                (m) =>
                  m.id === item.sourceEntityId ||
                  m.documentNumber === item.referenceNumber
              ) || list[0];
            setNotulenRecord(matched);
          }
        } else if (item.categoryCode === 'dokumentasi' && torId) {
          const list = await api.getDocumentationList(torId).catch(() => []);
          if (!active) return;
          if (Array.isArray(list) && list.length > 0) {
            const matched =
              list.find(
                (d) =>
                  d.id === item.sourceEntityId ||
                  d.documentNumber === item.referenceNumber
              ) || list[0];
            setDocRecord(matched);
          } else {
            const single = await api.getDocumentation(torId).catch(() => null);
            if (active && single && single.torId) {
              setDocRecord(single);
            } else if (active && tor?.documentation) {
              setDocRecord(tor.documentation);
            }
          }
        } else if (item.categoryCode === 'executive_summary' && torId) {
          const res = await api.getMonitoringReports(torId).catch(() => null);
          if (!active) return;
          const items: MonitoringReportItem[] = Array.isArray(res?.items) ? res.items : [];
          if (items.length > 0) {
            const matched =
              items.find((m) => m.id === item.sourceEntityId) ||
              items.find((m) => m.toolId === 'EXEC-SUMMARY') ||
              items[0];
            setMonitoringItem(matched);
          }
        } else if (
          (item.categoryCode === 'cash_advance' ||
            item.categoryCode === 'laporan_keuangan_akhir' ||
            item.categoryCode === 'tor') &&
          torId
        ) {
          const [caList, sumRes] = await Promise.all([
            api.getCashAdvances({ torId }).catch(() => []),
            api.getCashAdvanceSummary(torId).catch(() => null),
          ]);
          if (!active) return;
          const validCas = Array.isArray(caList) ? caList : [];
          setAllTorCashAdvances(validCas);
          if (sumRes?.summary) {
            setCaSummaryData(sumRes.summary);
          }
          if (validCas.length > 0) {
            const matchedCa =
              validCas.find(
                (c) =>
                  c.id === item.sourceEntityId ||
                  c.advanceNumber === item.referenceNumber ||
                  c.advanceNumber === item.previewData.cashAdvanceReferenceNumber
              ) || validCas[0];
            setCashAdvanceRecord(matchedCa);
          }
        }
      } finally {
        if (active) setLoadingSource(false);
      }
    };

    fetchSourceData();
    return () => {
      active = false;
    };
  }, [
    item.id,
    item.categoryCode,
    item.sourceEntityId,
    item.referenceNumber,
    item.sourceTorId,
    item.previewData.cashAdvanceReferenceNumber,
    item.previewData.isDisbursed,
    item.updatedAt,
    tor?.id,
    tor?.documentation,
  ]);

  const preview = item.previewData;

  // ==========================================================================
  // 1. RENDER OFFICIAL TOR PREVIEW SHEET
  // ==========================================================================
  const renderTorPreview = () => {
    const effectiveTor = tor;
    const activityCodeDisplay = (() => {
      const codeStr =
        effectiveTor?.activityCode ||
        effectiveTor?.hierarchyCode ||
        item.activityCode ||
        '1.1.1';
      const firstNum = codeStr.split('.')[0] || '1';
      return `Outcome ${firstNum} ; Activity ${codeStr}`;
    })();

    const activeCas = allTorCashAdvances.filter((c) => c.status !== 'Ditolak');
    const totalCaRequested = activeCas.reduce(
      (sum, c) => sum + (Number(c.totalAmount) || 0),
      0
    );
    const effectiveBudgetRequested =
      activeCas.length > 0
        ? totalCaRequested
        : effectiveTor?.budgetRequested ?? preview.requestedAmount;

    const compactBudget =
      effectiveBudgetRequested != null && !isNaN(Number(effectiveBudgetRequested))
        ? `Rp${Number(effectiveBudgetRequested).toLocaleString('id-ID')}`
        : 'Not Available in Source TOR';

    const specificObjectives =
      effectiveTor?.specificObjectives && effectiveTor.specificObjectives.length > 0
        ? effectiveTor.specificObjectives
        : (effectiveTor?.goals || []).map((g, idx) => ({
            id: g.id || `so-${idx + 1}`,
            objective: g.goal,
            expectedResult: g.indicator || g.mov || '',
            expectedChange: '',
          }));

    const timelineItems = effectiveTor?.timelineItems || [];
    const monitoringItems = effectiveTor?.monitoringItems || [];
    const scopeItems = effectiveTor?.scopeOfActivities || [];
    const mechanismItems = effectiveTor?.implementationMechanisms || [];
    const participantRows = effectiveTor?.participantRows || [];
    const participantColumns =
      effectiveTor?.participantCustomColumns && effectiveTor.participantCustomColumns.length > 0
        ? effectiveTor.participantCustomColumns
        : [
            { id: 'col-target', label: 'Target Peserta', type: 'text' as const },
            { id: 'col-male', label: 'Est. Laki-laki', type: 'number' as const },
            { id: 'col-female', label: 'Est. Perempuan', type: 'number' as const },
            { id: 'col-note', label: 'Keterangan', type: 'text' as const },
          ];
    const rolesData = effectiveTor?.rolesResponsibilities || [];

    return (
      <article
        className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-9 sm:py-8 shadow-xs space-y-5 text-[13.5px] leading-[1.38] text-black"
        style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
      >
        <h1 className="text-center font-bold uppercase text-[15px] tracking-normal mb-3 text-black">
          TERM OF REFERENCE
        </h1>

        {/* Project Information */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            Project Information
          </div>
          <table className="w-full text-left border-collapse border border-black text-[13px] text-black">
            <tbody>
              <tr>
                <td className="w-[28%] border border-black px-2.5 py-1 font-bold align-top">
                  Event Name
                </td>
                <td className="w-[72%] border border-black px-2.5 py-1 align-top font-bold">
                  {effectiveTor?.title || item.title}
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
                <td className="border border-black px-2.5 py-1 font-bold align-top">TOR Code</td>
                <td className="border border-black px-2.5 py-1 align-top font-bold">
                  {effectiveTor?.torNumber || item.referenceNumber}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Tim Pelaksana
                </td>
                <td className="border border-black px-2.5 py-1 align-top whitespace-pre-wrap">
                  {formatTorTeamSummary(effectiveTor, '-')}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">Period</td>
                <td className="border border-black px-2.5 py-1 align-top font-semibold">
                  {effectiveTor?.customPeriodCode
                    ? effectiveTor.customPeriodCode.split('—')[0].trim()
                    : 'P1'}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">Start date</td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {formatIndonesianDate(effectiveTor?.startDate || '')}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">End date</td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {formatIndonesianDate(effectiveTor?.endDate || '')}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Report date
                </td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {formatIndonesianDate(effectiveTor?.reportingDeadline || item.dueDate || '')}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">Location</td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {effectiveTor?.location || preview.location || '-'}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Budget request USD/IDR
                </td>
                <td className="border border-black px-2.5 py-1 align-top font-bold">
                  {compactBudget}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Background & Objectives */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            Background
          </div>
          <div className="space-y-2 text-black">
            <p className="whitespace-pre-line leading-[1.38]">
              {effectiveTor?.background || preview.summaryText || '-'}
            </p>
            {effectiveTor?.rationale && (
              <p className="whitespace-pre-line leading-[1.38]">{effectiveTor.rationale}</p>
            )}
          </div>

          <div className="mt-3">
            <div className="font-bold text-black">Tujuan Umum</div>
            <p className="text-black leading-[1.38] whitespace-pre-line">
              {effectiveTor?.generalObjective || effectiveTor?.objectives || '-'}
            </p>
          </div>

          {specificObjectives.length > 0 && (
            <div className="mt-2.5">
              <div className="font-bold text-black">Tujuan Khusus</div>
              <table className="w-full text-left border-collapse border border-black text-[13px] text-black mt-1.5">
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
                  {specificObjectives.map((so, idx) => (
                    <tr key={so.id || idx} className="align-top">
                      <td className="border border-black px-2.5 py-1">
                        {idx + 1}. {so.objective}
                      </td>
                      <td className="border border-black px-2.5 py-1 whitespace-pre-line">
                        {so.expectedResult || '-'}
                      </td>
                      <td className="border border-black px-2.5 py-1 whitespace-pre-line">
                        {so.expectedChange || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Implementation Timeline */}
        {timelineItems.length > 0 && (
          <section>
            <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
              Implementation Timeline
            </div>
            <table className="w-full text-left border-collapse border border-black text-[13px] text-black">
              <thead>
                <tr>
                  <th className="w-[30%] border border-black px-2.5 py-1 font-bold">Period</th>
                  <th className="w-[70%] border border-black px-2.5 py-1 font-bold">Activity</th>
                </tr>
              </thead>
              <tbody>
                {timelineItems.map((tl, idx) => (
                  <tr key={tl.id || idx} className="align-top">
                    <td className="border border-black px-2.5 py-1">{tl.period}</td>
                    <td className="border border-black px-2.5 py-1">{tl.activity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Monitoring Mechanism */}
        {monitoringItems.length > 0 && (
          <section>
            <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
              Monitoring Mechanism
            </div>
            <table className="w-full text-left border-collapse border border-black text-[13px] text-black">
              <thead>
                <tr>
                  <th className="w-[24%] border border-black px-2.5 py-1 font-bold">Aspect</th>
                  <th className="w-[38%] border border-black px-2.5 py-1 font-bold">Method</th>
                  <th className="w-[20%] border border-black px-2.5 py-1 font-bold">Frequency</th>
                  <th className="w-[18%] border border-black px-2.5 py-1 font-bold">PIC</th>
                </tr>
              </thead>
              <tbody>
                {monitoringItems.map((m, idx) => (
                  <tr key={m.id || idx} className="align-top">
                    <td className="border border-black px-2.5 py-1">{m.aspect}</td>
                    <td className="border border-black px-2.5 py-1">{m.method}</td>
                    <td className="border border-black px-2.5 py-1">{m.frequency}</td>
                    <td className="border border-black px-2.5 py-1">{m.pic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Scope of Activities & Mekanisme Pelaksanaan */}
        {scopeItems.length > 0 && (
          <section>
            <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
              Scope of Activities
            </div>
            <ul className="list-disc pl-7 space-y-1 text-black">
              {scopeItems.map((pt, idx) => (
                <li key={idx}>{pt}</li>
              ))}
            </ul>
          </section>
        )}

        {mechanismItems.length > 0 && (
          <section>
            <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
              Mekanisme Pelaksanaan
            </div>
            <ul className="list-disc pl-7 space-y-1 text-black">
              {mechanismItems.map((mech, idx) => (
                <li key={idx}>{mech}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Peserta Kegiatan */}
        {participantRows.length > 0 && (
          <section>
            <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
              Peserta Kegiatan (
              {effectiveTor?.participantType || effectiveTor?.participantsType || 'Peserta'})
            </div>
            <table className="w-full text-left border-collapse border border-black text-[13px] text-black">
              <thead>
                <tr>
                  <th className="w-10 border border-black px-2 py-1 text-center font-bold">No</th>
                  {participantColumns.map((col) => (
                    <th
                      key={col.id}
                      className={`border border-black px-2.5 py-1 font-bold ${
                        col.type === 'number' ? 'text-center w-28' : 'text-left'
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {participantRows.map((row: any, idx: number) => (
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
                            col.type === 'number' ? 'text-center' : ''
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
            </table>
          </section>
        )}

        {/* Role & Responsibility */}
        {rolesData.length > 0 && (
          <section>
            <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
              Role &amp; Responsibility
            </div>
            <table className="w-full text-left border-collapse border border-black text-[13px] text-black">
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
                    <td className="border border-black px-2.5 py-1">{r.responsibilities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </article>
    );
  };

  // ==========================================================================
  // 2. RENDER OFFICIAL NOTULEN PREVIEW SHEET
  // ==========================================================================
  const renderNotulenPreview = () => {
    const rec = notulenRecord;
    const docNum = rec?.documentNumber || item.referenceNumber;
    const title = rec?.title || item.title;
    const implProject =
      rec?.implementationProject ||
      preview.keyHighlights?.find((h) => h.label.toLowerCase().includes('implementasi'))?.value ||
      item.activityName;
    const recorderName = rec?.recorderName || item.responsibleUserName;
    const meetingDate = rec?.meetingDate || item.submittedAt.slice(0, 10);
    const startTime = rec?.startTime || '09:00';
    const endTime = rec?.endTime || '11:30';
    const meetingLocation = rec?.meetingLocation || preview.location || tor?.location || '-';
    const meetingPlatform = rec?.meetingRoomPlatform || 'Tatap Muka (Ruang Rapat / Balai)';
    const participants = rec?.participants?.filter((p) => p.name?.trim()) || [];
    const discussions =
      rec?.discussions && rec.discussions.length > 0
        ? rec.discussions
        : [
            {
              id: 'disc-fallback',
              topic: 'Program Implementation Progress',
              summary: preview.summaryText || '-',
              keyFindings: preview.keyHighlights?.[0]?.value || '—',
              issuesChallenges: preview.keyHighlights?.[1]?.value || '—',
              responsesClarifications: preview.keyHighlights?.[2]?.value || '—',
            },
          ];
    const decisions = rec?.decisions || [];
    const actionPoints = rec?.actionPoints || [];

    return (
      <article
        className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-9 sm:py-8 shadow-xs space-y-5 text-[13.5px] leading-[1.38] text-black"
        style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
      >
        <div className="text-center font-bold uppercase tracking-wide text-black text-[15px]">
          NOTULEN RAPAT / MEETING MINUTES
        </div>

        {/* 1. Meeting Information */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            1. Meeting Information
          </div>
          <table className="w-full border-collapse border border-black text-[13px] text-black">
            <tbody>
              <tr>
                <td className="w-[28%] border border-black px-2.5 py-1 font-bold align-top">
                  Judul Notulen
                </td>
                <td className="w-[72%] border border-black px-2.5 py-1 align-top font-bold">
                  {title}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Nomor Notulen
                </td>
                <td className="border border-black px-2.5 py-1 align-top font-bold break-all">
                  {docNum}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Implementation / Project
                </td>
                <td className="border border-black px-2.5 py-1 align-top">{implProject}</td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Recorder / Notulis
                </td>
                <td className="border border-black px-2.5 py-1 align-top">{recorderName}</td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Meeting Date
                </td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {formatIndonesianDate(meetingDate)}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Meeting Time
                </td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {startTime} – {endTime}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Meeting Location
                </td>
                <td className="border border-black px-2.5 py-1 align-top">{meetingLocation}</td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Meeting Room / Platform
                </td>
                <td className="border border-black px-2.5 py-1 align-top">{meetingPlatform}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3">
            <div className="font-bold text-black mb-1">Participants:</div>
            <table className="w-full border-collapse border border-black text-[13px] text-black">
              <thead>
                <tr>
                  <th className="w-10 border border-black px-2 py-1 text-center font-bold">No</th>
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
                {participants.length > 0 ? (
                  participants.map((p, i) => (
                    <tr key={p.id || i}>
                      <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                      <td className="border border-black px-2.5 py-1">{p.name || '—'}</td>
                      <td className="border border-black px-2.5 py-1">{p.organization || '—'}</td>
                      <td className="border border-black px-2.5 py-1">{p.role || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="border border-black px-2.5 py-1.5 text-center">
                      {item.responsibleUserName} &amp; Tim Pelaksana Kegiatan ({item.activityName})
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. Meeting Agenda & Discussion */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            2. Meeting Agenda &amp; Discussion
          </div>
          <div className="space-y-3">
            {discussions.map((d, idx) => (
              <table
                key={d.id || idx}
                className="w-full border-collapse border border-black text-[13px] text-black"
              >
                <thead>
                  <tr>
                    <th colSpan={2} className="border border-black px-2.5 py-1 text-left font-bold">
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
        </section>

        {/* 3. Key Decisions */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            3. Key Decisions
          </div>
          <table className="w-full border-collapse border border-black text-[13px] text-black">
            <thead>
              <tr>
                <th className="w-10 border border-black px-2 py-1 text-center font-bold">No</th>
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
              {decisions.length > 0 ? (
                decisions.map((dec, idx) => (
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
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="border border-black px-2.5 py-1.5 text-center">
                    {preview.keyHighlights?.[0]?.value || 'Sesuai hasil rapat pelaksanaan kegiatan'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* 4. Action Points / Follow-up */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            4. Action Points / Follow-up
          </div>
          <table className="w-full border-collapse border border-black text-[13px] text-black">
            <thead>
              <tr>
                <th className="w-10 border border-black px-2 py-1 text-center font-bold">No</th>
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
              {actionPoints.length > 0 ? (
                actionPoints.map((ap, idx) => (
                  <tr key={ap.id || idx}>
                    <td className="border border-black px-2 py-1 text-center align-top">
                      {idx + 1}
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">
                      {ap.action || '—'}
                    </td>
                    <td className="border border-black px-2.5 py-1 align-top">{ap.pic || '—'}</td>
                    <td className="border border-black px-2.5 py-1 text-center align-top">
                      {formatIndonesianDate(ap.deadline)}
                    </td>
                    <td className="border border-black px-2.5 py-1 text-center align-top font-bold">
                      {ap.status || 'Completed'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="border border-black px-2.5 py-1.5 text-center">
                    {preview.keyHighlights?.[1]?.value || 'Tindak lanjut sesuai jadwal kegiatan'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* 5. Additional Notes */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            5. Additional Notes
          </div>
          <table className="w-full border-collapse border border-black text-[13px] text-black">
            <tbody>
              <tr>
                <td className="w-[28%] border border-black px-2.5 py-1 font-bold align-top">
                  Catatan Tambahan
                </td>
                <td className="w-[72%] border border-black px-2.5 py-1 align-top whitespace-pre-line">
                  {rec?.additionalNotes || '—'}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Agenda Rapat Berikutnya
                </td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {rec?.nextMeetingAgenda || '—'}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Jadwal Pertemuan Selanjutnya
                </td>
                <td className="border border-black px-2.5 py-1 align-top">
                  {rec?.nextMeetingSchedule || '—'}
                </td>
              </tr>
              <tr>
                <td className="border border-black px-2.5 py-1 font-bold align-top">
                  Informasi / Dokumen Persiapan
                </td>
                <td className="border border-black px-2.5 py-1 align-top whitespace-pre-line">
                  {rec?.preparationDocuments || '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 6. Pengesahan Notulen (Gambar 1 & Gambar 2: Tanpa RACI, langsung Nama & Jabatan + Perwakilan Partner ruang tanda tangan kosong) */}
        <section className="pt-2">
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            6. Pengesahan Notulen
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 border border-black text-[12.5px] text-black divide-y sm:divide-y-0 sm:divide-x divide-black">
            <div className="p-3 flex flex-col items-center justify-between text-center min-h-[155px]">
              <div className="font-bold">Disusun Oleh,</div>
              <div className="my-1.5 flex items-center justify-center">
                <ApprovalBarcodeStamp
                  compact
                  variant="authorized"
                  documentNumber={docNum}
                  roleCode="PIC"
                  signerName={rec?.recorderName || item.responsibleUserName || 'Budi Santoso'}
                  signDate={rec?.meetingDate || item.submittedAt}
                  statusLabel="DISUSUN OLEH"
                />
              </div>
              <div>
                <div className="font-bold underline">
                  {rec?.recorderName || item.responsibleUserName || 'Budi Santoso'}
                </div>
                <div className="text-[11px] text-stone-700">
                  Project Officer / Pelaksana Kegiatan
                </div>
              </div>
            </div>

            <div className="p-3 flex flex-col items-center justify-between text-center min-h-[155px]">
              <div className="font-bold">Diketahui Oleh,</div>
              <div className="my-1.5 flex items-center justify-center">
                <ApprovalBarcodeStamp
                  compact
                  variant="authorized"
                  documentNumber={docNum}
                  roleCode="PM"
                  signerName={item.accountableProgramUserName || 'Dimas Pratama, M.Sc.'}
                  signDate={rec?.meetingDate || item.submittedAt}
                  statusLabel="DIKETAHUI OLEH"
                />
              </div>
              <div>
                <div className="font-bold underline">
                  {item.accountableProgramUserName || 'Dimas Pratama, M.Sc.'}
                </div>
                <div className="text-[11px] text-stone-700">Program Manager</div>
              </div>
            </div>

            <div className="p-3 flex flex-col justify-between text-left min-h-[155px]">
              <div>
                <div className="font-bold text-center">Perwakilan Partner</div>
                <div className="mt-1 text-[11.5px]">
                  <span className="font-bold">Nama Institusi :</span>{' '}
                  <span>
                    {rec?.partnerInstitution ||
                      rec?.partnerOrganization ||
                      '—'}
                  </span>
                </div>
              </div>

              {/* Ruang kosong tanda tangan basah manual */}
              <div className="my-1.5 h-[58px] w-full" />

              <div className="space-y-0.5 text-[11.5px]">
                <div>
                  <span className="font-bold">Nama :</span>{' '}
                  <span className="font-bold underline">
                    {rec?.partnerRepName || '—'}
                  </span>
                </div>
                <div>
                  <span className="font-bold">Jabatan :</span>{' '}
                  <span>{rec?.partnerRepTitle || '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </article>
    );
  };

  // ==========================================================================
  // 3. RENDER OFFICIAL DOKUMENTASI KEGIATAN PREVIEW SHEET
  // ==========================================================================
  const renderDokumentasiPreview = () => {
    const rec = docRecord || tor?.documentation || null;
    const docNum = rec?.documentNumber || item.referenceNumber || '001/DOC/WIJNA/X/2026';
    const storyTopic =
      rec?.bestPhotosStoryTopic ||
      preview.keyHighlights?.find((h) => h.label.toLowerCase().includes('topik'))?.value ||
      item.title.replace(/^Dokumentasi:\s*/i, '');
    const bestPhotos: BestPhotoSlot[] = [1, 2, 3, 4, 5].map((num) => {
      const found = (rec?.bestPhotos || []).find((p) => Number(p.slotNumber) === num);
      return {
        slotNumber: num,
        photoNameTitle:
          found?.photoNameTitle ||
          `Dokumentasi Foto #${num} Kegiatan ${item.activityName} (${preview.location || tor?.location || 'Lokasi Kegiatan'})`,
        photoLink:
          found?.photoLink ||
          `https://drive.google.com/drive/folders/wijna-doc-${item.activityCode || '1.1.1'}-foto-${num}`,
        photoLocation: found?.photoLocation || tor?.location || preview.location || '-',
        photographer: found?.photographer || item.responsibleUserName || tor?.picName || '-',
      };
    });
    const humanInterestStories =
      rec?.humanInterestStories && rec.humanInterestStories.length > 0
        ? rec.humanInterestStories.filter((s) => s.storyTitle?.trim() || s.storyLink?.trim())
        : [
            {
              id: 'his-1',
              storyTitle:
                preview.keyHighlights?.find((h) => h.label.toLowerCase().includes('human interest'))
                  ?.value || `Kisah Perubahan & Partisipasi Warga pada ${item.activityName}`,
              storyLink: `https://drive.google.com/drive/folders/wijna-his-${item.activityCode || '1.1.1'}`,
            },
          ];
    const generalPhotoLinks =
      rec?.generalPhotoLinks && rec.generalPhotoLinks.length > 0
        ? rec.generalPhotoLinks
        : [
            {
              id: 'gpl-1',
              url: `https://drive.google.com/drive/folders/wijna-general-photos-${item.activityCode || '1.1.1'}`,
            },
          ];

    return (
      <article
        className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-9 sm:py-8 shadow-xs space-y-5 text-[13.5px] leading-[1.38] text-black"
        style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
      >
        <div className="text-center pb-2">
          <div className="text-[15px] font-bold uppercase tracking-wide text-black">
            DOCUMENTATION / DOKUMENTASI KEGIATAN PROGRAM
          </div>
          <div className="text-[14px] font-bold uppercase text-black mt-0.5">
            {tor?.title || item.activityName}
          </div>
        </div>

        {/* Informasi Referensi Kegiatan */}
        <table className="w-full text-left border-collapse border border-black text-[13px]">
          <tbody>
            <tr className="align-top">
              <td className="w-56 font-bold py-1.5 px-2.5 border border-black">
                Nomor Dokumen Dokumentasi
              </td>
              <td className="py-1.5 px-2.5 border border-black font-bold">{docNum}</td>
            </tr>
            <tr className="align-top">
              <td className="font-bold py-1.5 px-2.5 border border-black">
                Nama Topik Cerita / Angle
              </td>
              <td className="py-1.5 px-2.5 border border-black font-bold">{storyTopic || '-'}</td>
            </tr>
            <tr className="align-top">
              <td className="font-bold py-1.5 px-2.5 border border-black">
                Referensi TOR (Master Source)
              </td>
              <td className="py-1.5 px-2.5 border border-black">
                <strong>{tor?.torNumber || item.sourceTorId}</strong> — {tor?.title || item.activityName}
              </td>
            </tr>
            <tr className="align-top">
              <td className="font-bold py-1.5 px-2.5 border border-black">Program Terkait</td>
              <td className="py-1.5 px-2.5 border border-black">{item.programName}</td>
            </tr>
            <tr className="align-top">
              <td className="font-bold py-1.5 px-2.5 border border-black">
                Lokasi &amp; Periode Kegiatan
              </td>
              <td className="py-1.5 px-2.5 border border-black">
                {tor?.location || preview.location || '-'} (
                {tor?.startDate
                  ? `${formatIndonesianDate(tor.startDate)} – ${formatIndonesianDate(tor.endDate)}`
                  : preview.activityPeriod || '-'}
                )
              </td>
            </tr>
          </tbody>
        </table>

        {/* 1. Five Best Photos */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            1. Five Best Photos (5 Foto Terbaik &amp; 1 Topik Cerita/Angle)
          </div>
          <div className="mb-2 text-[13px]">
            <strong>Topik Cerita / Angle (1 Topik Cerita untuk 5 Foto Terbaik):</strong>{' '}
            {storyTopic || '-'}
          </div>
          <table className="w-full text-left border-collapse border border-black text-[12.5px]">
            <thead>
              <tr>
                <th className="w-16 border border-black px-2 py-1 text-center font-bold">Slot</th>
                <th className="border border-black px-2.5 py-1 font-bold">
                  Photo Name / Title (Setiap orang yang ada di foto tersebut)
                </th>
                <th className="w-48 border border-black px-2.5 py-1 font-bold">
                  Photo Link (URL)
                </th>
                <th className="w-36 border border-black px-2.5 py-1 font-bold">Photo Location</th>
                <th className="w-32 border border-black px-2.5 py-1 font-bold">Photographer</th>
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
                        className="underline text-[#1D4ED8]"
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
                  <td className="border border-black px-2.5 py-1.5">{slot.photographer || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 2. Human Interest Story */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            2. Human Interest Story dengan 5 Foto Tadi (Opsional)
          </div>
          <table className="w-full text-left border-collapse border border-black text-[12.5px]">
            <thead>
              <tr>
                <th className="w-12 border border-black px-2 py-1 text-center font-bold">No</th>
                <th className="border border-black px-2.5 py-1 font-bold">
                  Story Title (Cerita Individu, Komunitas, Pengalaman, atau Dampak Program)
                </th>
                <th className="w-60 border border-black px-2.5 py-1 font-bold">
                  Story Link (URL Cerita)
                </th>
              </tr>
            </thead>
            <tbody>
              {humanInterestStories.length === 0 ? (
                <tr>
                  <td colSpan={3} className="border border-black px-2.5 py-2 text-center italic">
                    - (Opsional / Tidak ada Human Interest Story)
                  </td>
                </tr>
              ) : (
                humanInterestStories.map((story, idx) => (
                  <tr key={story.id || idx} className="align-top">
                    <td className="border border-black px-2 py-1.5 text-center">{idx + 1}</td>
                    <td className="border border-black px-2.5 py-1.5">
                      {story.storyTitle || '-'}
                    </td>
                    <td className="border border-black px-2.5 py-1.5 break-all">
                      {story.storyLink ? (
                        <a
                          href={story.storyLink}
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-[#1D4ED8]"
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
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            3. General Photo Documentation
          </div>
          <table className="w-full text-left border-collapse border border-black text-[12.5px]">
            <thead>
              <tr>
                <th className="w-12 border border-black px-2 py-1 text-center font-bold">No</th>
                <th className="border border-black px-2.5 py-1 font-bold">
                  General Photo Link (URL Folder Dokumentasi Foto Keseluruhan Kegiatan)
                </th>
              </tr>
            </thead>
            <tbody>
              {generalPhotoLinks.map((gpl, idx) => (
                <tr key={gpl.id || idx} className="align-top">
                  <td className="border border-black px-2 py-1.5 text-center">{idx + 1}</td>
                  <td className="border border-black px-2.5 py-1.5 break-all">
                    {gpl.url ? (
                      <a
                        href={gpl.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-[#1D4ED8]"
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
    );
  };

  // ==========================================================================
  // 4. RENDER OFFICIAL EXECUTIVE SUMMARY (7 BAGIAN MONITORING) PREVIEW SHEET
  // ==========================================================================
  const renderExecutiveSummaryPreview = () => {
    const mItem = monitoringItem;
    const sections = mItem?.sections;
    const caNum =
      mItem?.cashAdvanceNumber ||
      preview.cashAdvanceReferenceNumber ||
      item.referenceNumber;
    const torNum = mItem?.torNumber || tor?.torNumber || item.sourceTorId;
    const monDate = mItem?.monitoringDate || item.submittedAt.slice(0, 10);
    const respName = mItem?.responsibleName || item.responsibleUserName;
    const monStatus = mItem?.status || 'Completed';

    return (
      <article
        className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-9 sm:py-8 shadow-xs space-y-5 text-[13.5px] leading-[1.42] text-black"
        style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
      >
        <div className="text-center pb-2 border-b border-black">
          <div className="text-[15px] font-bold uppercase tracking-wide text-black">
            LAPORAN MONITORING KEGIATAN &amp; EVIDENCE DOCUMENTATION
          </div>
          <div className="text-[13.5px] font-bold uppercase text-black mt-0.5">
            [{mItem?.toolId || 'EXEC-SUMMARY'}] {mItem?.toolName || 'Executive Summary'} —{' '}
            {mItem?.activityName || item.activityName}
          </div>
        </div>

        {/* Tabel Referensi Utama */}
        <table className="w-full text-left border-collapse border border-black text-[13px]">
          <tbody>
            <tr className="align-top">
              <td className="w-48 font-bold py-1.5 px-2.5 border border-black">
                Nomor Dokumen / CA
              </td>
              <td className="py-1.5 px-2.5 border border-black font-bold">{caNum}</td>
              <td className="w-40 font-bold py-1.5 px-2.5 border border-black">
                Tanggal Monitoring
              </td>
              <td className="py-1.5 px-2.5 border border-black">
                {formatIndonesianDate(monDate)}
              </td>
            </tr>
            <tr className="align-top">
              <td className="font-bold py-1.5 px-2.5 border border-black">Referensi ToR</td>
              <td className="py-1.5 px-2.5 border border-black">
                <strong>{torNum}</strong>
              </td>
              <td className="font-bold py-1.5 px-2.5 border border-black">Responsible</td>
              <td className="py-1.5 px-2.5 border border-black">{respName}</td>
            </tr>
            <tr className="align-top">
              <td className="font-bold py-1.5 px-2.5 border border-black">Jenis Implementasi</td>
              <td className="py-1.5 px-2.5 border border-black">
                <div className="font-bold">
                  [{tor?.activityCode || item.activityCode || '1.1.1'}]{' '}
                  {mItem?.activityName || item.activityName}
                </div>
                {mItem?.cashAdvanceActivitySummary && (
                  <div className="mt-0.5">{mItem.cashAdvanceActivitySummary}</div>
                )}
              </td>
              <td className="font-bold py-1.5 px-2.5 border border-black">Status Monitoring</td>
              <td className="py-1.5 px-2.5 border border-black font-bold">{monStatus}</td>
            </tr>
            <tr className="align-top">
              <td className="font-bold py-1.5 px-2.5 border border-black">Jenis Laporan</td>
              <td colSpan={3} className="py-1.5 px-2.5 border border-black">
                <strong>Executive Summary (7 Bagian Evaluasi Monitoring)</strong> —{' '}
                <span className="font-mono">{item.referenceNumber}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* 7 Bagian Monitoring A-G */}
        <div className="space-y-3.5">
          {MONITORING_PREVIEW_SECTIONS.map((meta, idx) => {
            const sec = sections?.[meta.key];
            const fallbackHighlight = preview.keyHighlights?.[idx]?.value;
            const narrativeText =
              sec?.narrative?.trim() ||
              fallbackHighlight ||
              (idx === 0 ? preview.summaryText : '');

            return (
              <section key={meta.key} className="border border-black">
                <div className="bg-[#E5E5E3] text-black font-bold px-2.5 py-1 border-b border-black flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span>{meta.title}</span>
                  <span className="font-normal italic text-[11.5px]">
                    &ldquo;{meta.quote}&rdquo;
                  </span>
                </div>
                <div className="p-2.5 text-[13px]">
                  <div className="whitespace-pre-line">
                    {narrativeText ? (
                      narrativeText
                    ) : (
                      <span className="italic text-stone-500">
                        Telah tercatat dalam laporan pelaksanaan kegiatan ({item.activityName}).
                      </span>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </article>
    );
  };

  // ==========================================================================
  // 5. RENDER OFFICIAL CASH ADVANCE PREVIEW SHEET
  // ==========================================================================
  const renderCashAdvancePreview = () => {
    const rec = cashAdvanceRecord;
    const advNum = rec?.advanceNumber || item.referenceNumber;
    const reqDate = rec?.requestDate || item.submittedAt.slice(0, 10);
    const torNum = rec?.torNumber || tor?.torNumber || item.sourceTorId;
    const actTitle = rec?.activityTitle || tor?.title || item.activityName;
    const implSummary =
      rec?.implementationTimelineSummary ||
      preview.purposeOfFunds ||
      'Pelaksanaan Tahapan Kegiatan sesuai TOR';
    const startDate = rec?.activityStartDate || tor?.startDate || reqDate;
    const endDate = rec?.activityEndDate || tor?.endDate || reqDate;
    const deadlineDate = rec?.reportingDeadlineDate || item.dueDate || reqDate;
    const loc = rec?.location || preview.location || tor?.location || '-';
    const reqName = rec?.requesterName || item.responsibleUserName;
    const bankName = rec?.bankName || 'Bank Mandiri';
    const bankAcc = rec?.bankAccountNumber || '131-00-9823412-0';
    const bankHolder = rec?.bankAccountHolder || reqName;
    const totalAmount = rec?.totalAmount ?? preview.requestedAmount ?? 0;
    const budgetItems =
      rec?.items && rec.items.length > 0
        ? rec.items
        : (preview.budgetLines || []).map((bl, idx) => ({
            id: `bl-${idx}`,
            budgetCode: bl.code || '1.1.1',
            description: bl.description,
            volume: 1,
            unit: 'Paket',
            frequency: 1,
            frequencyUnit: 'Kegiatan',
            unitPrice: bl.amount,
            totalAmount: bl.amount,
            notes: '',
          }));

    return (
      <article
        className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-9 sm:py-8 shadow-xs space-y-5 text-[13.5px] leading-[1.38] text-black"
        style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
      >
        <div className="text-center pb-2">
          <div className="text-[15px] font-bold uppercase tracking-wide text-black">
            FORM PENGAJUAN CASH ADVANCE (UANG MUKA OPERASIONAL)
          </div>
          <div className="text-[14px] font-bold uppercase text-black mt-0.5">{actTitle}</div>
        </div>

        {/* 1. Informasi Pengajuan & Kegiatan */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            1. Informasi Pengajuan &amp; Kegiatan (Cash Advance Information)
          </div>
          <table className="w-full text-left border-collapse border border-black text-[13px]">
            <tbody>
              <tr className="align-top">
                <td className="w-56 font-bold py-1.5 px-2.5 border border-black">
                  Nomor Cash Advance
                </td>
                <td className="py-1.5 px-2.5 border border-black font-bold">{advNum}</td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">Tanggal Pengajuan</td>
                <td className="py-1.5 px-2.5 border border-black">
                  {formatIndonesianDate(reqDate)}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Referensi TOR (Master Source)
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  <strong>{torNum}</strong> — {actTitle}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Tahapan Implementasi TOR
                </td>
                <td className="py-1.5 px-2.5 border border-black">{implSummary}</td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Periode Pelaksanaan
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  {formatIndonesianDate(startDate)} – {formatIndonesianDate(endDate)}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Batas Maksimal Pelaporan (H+7)
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  {formatIndonesianDate(deadlineDate)} (
                  {rec?.isReported ? 'Laporan Telah Ditutup' : 'Belum Dilaporkan'})
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">Lokasi Pelaksanaan</td>
                <td className="py-1.5 px-2.5 border border-black">{loc}</td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Nama Pemohon (PIC)
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  <strong>{reqName}</strong>
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Rekening Transfer Tujuan Kasbon
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  <strong>{bankName}</strong> · No. Rekening: <strong>{bankAcc}</strong> a.n.{' '}
                  <strong>{bankHolder}</strong>
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Status Otorisasi Dokumen
                </td>
                <td className="py-1.5 px-2.5 border border-black font-bold">
                  {rec?.status || item.status}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 2. Rincian Anggaran Kasbon */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            2. Rincian Anggaran Kasbon (Budget Breakdown)
          </div>
          <table className="w-full table-fixed text-left border-collapse border border-black text-[12.5px]">
            <thead>
              <tr>
                <th className="w-[5%] border border-black px-1.5 py-1.5 text-center font-bold">
                  No
                </th>
                <th className="w-[10%] border border-black px-1.5 py-1.5 text-center font-bold">
                  Kode
                </th>
                <th className="w-[38%] border border-black px-2 py-1.5 font-bold">
                  Deskripsi Kebutuhan
                </th>
                <th className="w-[7%] border border-black px-1 py-1.5 text-center font-bold">
                  Vol
                </th>
                <th className="w-[9%] border border-black px-1 py-1.5 text-center font-bold">
                  Satuan
                </th>
                <th className="w-[15%] border border-black px-2 py-1.5 text-right font-bold">
                  Biaya Satuan
                </th>
                <th className="w-[16%] border border-black px-2 py-1.5 text-right font-bold">
                  Total (Rp)
                </th>
              </tr>
            </thead>
            <tbody>
              {budgetItems.map((it: any, idx: number) => (
                <tr key={it.id || idx} className="align-top">
                  <td className="border border-black px-1.5 py-1.5 text-center">{idx + 1}</td>
                  <td className="border border-black px-1.5 py-1.5 text-center break-words">
                    {it.budgetCode || '-'}
                  </td>
                  <td className="border border-black px-2 py-1.5 break-words">{it.description}</td>
                  <td className="border border-black px-1 py-1.5 text-center">
                    {it.volume ?? 1}
                  </td>
                  <td className="border border-black px-1 py-1.5 text-center">
                    {it.unit || 'Paket'}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right">
                    {formatRupiah(it.unitPrice ?? it.totalAmount)}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right font-bold">
                    {formatRupiah(it.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="border border-black px-2.5 py-1.5 text-right font-bold">
                  Total Cash Advance Diajukan
                </td>
                <td className="border border-black px-2 py-1.5 text-right font-bold">
                  {formatRupiah(totalAmount)}
                </td>
              </tr>
              {rec?.amountInWords && (
                <tr>
                  <td colSpan={7} className="border border-black px-2.5 py-1.5">
                    <strong>Terbilang:</strong> <span className="italic">&ldquo;{rec.amountInWords}&rdquo;</span>
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </section>

        {/* 3. Otorisasi & Persetujuan Dokumen */}
        <section>
          <div className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13.5px]">
            3. Otorisasi &amp; Persetujuan Dokumen (Signatures &amp; Verification)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-center text-xs">
            <div className="border border-black p-2.5 flex flex-col justify-between">
              <div className="font-bold">1. Diajukan Oleh (Pemohon / PIC)</div>
              <div className="my-2 min-h-[56px] flex items-center justify-center">
                <ApprovalBarcodeStamp
                  documentNumber={advNum}
                  roleCode="PIC"
                  signerName={reqName}
                  signDate={reqDate}
                  statusLabel="TELAH DIAJUKAN"
                />
              </div>
              <div>
                <div className="font-bold underline">{reqName}</div>
                <div className="text-[11px]">{rec?.signatures?.requestedBy?.roleTitle || 'Pemohon / PIC Kegiatan'}</div>
                <div className="text-[10.5px] mt-0.5">
                  Tanggal: {formatIndonesianDate(reqDate)}
                </div>
              </div>
            </div>

            <div className="border border-black p-2.5 flex flex-col justify-between">
              <div className="font-bold">2. Diperiksa Oleh (Finance)</div>
              <div className="my-2 min-h-[56px] flex items-center justify-center">
                {rec?.signatures?.verifiedBy?.status === 'Terverifikasi' ||
                rec?.status === 'Diverifikasi Finance' ||
                rec?.status === 'Disetujui' ||
                rec?.status === 'Dicairkan' ||
                item.status === 'Pending Approval' ||
                item.status === 'Approved' ? (
                  <ApprovalBarcodeStamp
                    documentNumber={advNum}
                    roleCode="FIN"
                    signerName={rec?.signatures?.verifiedBy?.name || item.accountableFinanceUserName}
                    signDate={rec?.signatures?.verifiedBy?.date || reqDate}
                    statusLabel="TERVERIFIKASI"
                  />
                ) : (
                  <span className="py-4 text-[11px] italic text-stone-600">
                    [Menunggu Verifikasi Finance]
                  </span>
                )}
              </div>
              <div>
                <div className="font-bold underline">
                  {rec?.signatures?.verifiedBy?.name || item.accountableFinanceUserName}
                </div>
                <div className="text-[11px]">Finance Specialist</div>
                <div className="text-[10.5px] mt-0.5">
                  Tanggal:{' '}
                  {rec?.signatures?.verifiedBy?.date
                    ? formatIndonesianDate(rec.signatures.verifiedBy.date)
                    : item.status === 'Pending Approval' || item.status === 'Approved'
                    ? formatIndonesianDate(reqDate)
                    : '-'}
                </div>
              </div>
            </div>

            <div className="border border-black p-2.5 flex flex-col justify-between">
              <div className="font-bold">3. Disetujui Oleh (Executive Director)</div>
              <div className="my-2 min-h-[56px] flex items-center justify-center">
                {rec?.signatures?.approvedBy?.status === 'Disetujui' ||
                rec?.status === 'Disetujui' ||
                rec?.status === 'Dicairkan' ||
                item.status === 'Approved' ? (
                  <ApprovalBarcodeStamp
                    documentNumber={advNum}
                    roleCode="DIR"
                    signerName={rec?.signatures?.approvedBy?.name || item.directorUserName}
                    signDate={rec?.signatures?.approvedBy?.date || reqDate}
                    statusLabel="DISETUJUI"
                  />
                ) : (
                  <span className="py-4 text-[11px] italic text-stone-600">
                    [Menunggu Otorisasi Direktur]
                  </span>
                )}
              </div>
              <div>
                <div className="font-bold underline">
                  {rec?.signatures?.approvedBy?.name || item.directorUserName}
                </div>
                <div className="text-[11px]">Executive Director</div>
                <div className="text-[10.5px] mt-0.5">
                  Tanggal:{' '}
                  {rec?.signatures?.approvedBy?.date
                    ? formatIndonesianDate(rec.signatures.approvedBy.date)
                    : item.status === 'Approved'
                    ? formatIndonesianDate(reqDate)
                    : '-'}
                </div>
              </div>
            </div>

            <div className="border border-black p-2.5 flex flex-col justify-between">
              <div className="font-bold">4. Dicairkan Oleh (Kasir / Finance)</div>
              <div className="my-2 min-h-[56px] flex items-center justify-center">
                {rec?.signatures?.disbursedBy?.isDisbursed ||
                rec?.status === 'Dicairkan' ||
                preview.isDisbursed ? (
                  <ApprovalBarcodeStamp
                    documentNumber={advNum}
                    roleCode="CSH"
                    signerName={
                      rec?.signatures?.disbursedBy?.name ||
                      preview.disbursedByName ||
                      'Ratna Sari'
                    }
                    signDate={
                      rec?.signatures?.disbursedBy?.date ||
                      preview.disbursedAt ||
                      reqDate
                    }
                    statusLabel="DICAIRKAN"
                  />
                ) : (
                  <span className="py-4 text-[11px] italic text-stone-600">
                    {rec?.status === 'Disetujui' || item.status === 'Approved'
                      ? '[Siap Dicairkan Finance]'
                      : '[Belum Dicairkan]'}
                  </span>
                )}
              </div>
              <div>
                <div className="font-bold underline">
                  {rec?.signatures?.disbursedBy?.name ||
                    preview.disbursedByName ||
                    'Ratna Sari'}
                </div>
                <div className="text-[11px]">Kasir / Finance Officer</div>
                <div className="text-[10.5px] mt-0.5">
                  Tanggal:{' '}
                  {rec?.signatures?.disbursedBy?.date || preview.disbursedAt
                    ? formatIndonesianDate(
                        rec?.signatures?.disbursedBy?.date || preview.disbursedAt || ''
                      )
                    : '-'}
                </div>
                {(rec?.signatures?.disbursedBy?.transferReference ||
                  preview.transferReference) && (
                  <div className="text-[10px] font-mono mt-0.5">
                    Ref:{' '}
                    {rec?.signatures?.disbursedBy?.transferReference ||
                      preview.transferReference}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </article>
    );
  };

  // ==========================================================================
  // 6. RENDER OFFICIAL FINAL FINANCIAL REPORT (STAGE 08) PREVIEW SHEET
  // ==========================================================================
  const renderFinalFinancialReportPreview = () => {
    const closedCas = allTorCashAdvances.filter(
      (c) => c.status !== 'Ditolak' && Boolean(c.isReported)
    );
    const summaryRows: any[] = Array.isArray(caSummaryData?.summaryRows)
      ? caSummaryData.summaryRows
      : [];

    const rows =
      closedCas.length > 0
        ? closedCas.flatMap((ca) => {
            if (ca.items && ca.items.length > 0) {
              return ca.items.map((it, idx) => {
                const rowKey = `${ca.id}-${it.id || idx}`;
                const matched = summaryRows.find((sr) => sr.id === rowKey);
                const adv = Number(it.totalAmount) || 0;
                const spent =
                  matched?.actualSpent !== undefined
                    ? Number(matched.actualSpent)
                    : it.actualSpent !== undefined
                    ? Number(it.actualSpent)
                    : ca.realizedAmount !== undefined && ca.items.length === 1
                    ? Number(ca.realizedAmount)
                    : adv;
                return {
                  code: matched?.budgetCode || it.budgetCode || item.activityCode || '1.1.1',
                  description: `${it.description} (${ca.advanceNumber})`,
                  advanceAmount: adv,
                  actualSpent: spent,
                  remaining: Math.max(0, adv - spent),
                  shortage: Math.max(0, spent - adv),
                  percentUsed: adv > 0 ? Math.round((spent / adv) * 100) : 0,
                };
              });
            }
            const adv = Number(ca.totalAmount) || 0;
            const spent =
              ca.realizedAmount !== undefined ? Number(ca.realizedAmount) : adv;
            return [
              {
                code: item.activityCode || '1.1.1',
                description: `${ca.activityTitle || item.activityName} (${ca.advanceNumber})`,
                advanceAmount: adv,
                actualSpent: spent,
                remaining: Math.max(0, adv - spent),
                shortage: Math.max(0, spent - adv),
                percentUsed: adv > 0 ? Math.round((spent / adv) * 100) : 0,
              },
            ];
          })
        : [
            {
              code: item.activityCode || '1.1.1',
              description: item.activityName,
              advanceAmount: preview.approvedAmount ?? preview.requestedAmount ?? 0,
              actualSpent: preview.realizedAmount ?? preview.approvedAmount ?? 0,
              remaining: Math.max(
                0,
                (preview.approvedAmount ?? 0) - (preview.realizedAmount ?? 0)
              ),
              shortage: Math.max(
                0,
                (preview.realizedAmount ?? 0) - (preview.approvedAmount ?? 0)
              ),
              percentUsed:
                (preview.approvedAmount ?? 0) > 0
                  ? Math.round(
                      ((preview.realizedAmount ?? 0) / (preview.approvedAmount ?? 1)) * 100
                    )
                  : 100,
            },
          ];

    const totalAdv = rows.reduce((s, r) => s + r.advanceAmount, 0);
    const totalSpent = rows.reduce((s, r) => s + r.actualSpent, 0);
    const totalRem = rows.reduce((s, r) => s + r.remaining, 0);
    const totalShort = rows.reduce((s, r) => s + r.shortage, 0);
    const totalPct = totalAdv > 0 ? Math.round((totalSpent / totalAdv) * 100) : 0;

    return (
      <article
        className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-6 py-6 sm:px-8 sm:py-7 shadow-xs space-y-4 text-[13px] leading-[1.38] text-black"
        style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
      >
        <div className="text-center pb-1">
          <h1 className="text-[16px] font-bold text-black tracking-normal leading-snug uppercase">
            LAPORAN KEUANGAN AKHIR &amp; REKAPITULASI AKUMULASI DANA PER KODE BUDGET
          </h1>
          <div className="text-[13.5px] font-bold text-black mt-0.5 leading-snug">
            {item.activityName} ({item.referenceNumber})
          </div>
        </div>

        <section>
          <div
            className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13px]"
            style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            1. Rincian Realisasi &amp; Rekonsiliasi Dana (Akumulasi Cash Advance yang Telah Ditutup)
          </div>
          <table className="w-full text-left border-collapse border border-black text-[12px]">
            <thead>
              <tr className="bg-[#EFEFEF] text-black font-bold">
                <th className="py-1.5 px-1.5 w-[5%] text-center border border-black">No</th>
                <th className="py-1.5 px-2 w-[12%] text-left border border-black">Kode Budget</th>
                <th className="py-1.5 px-2.5 w-[31%] border border-black">
                  Jenis Kegiatan / Rincian Pos
                </th>
                <th className="py-1.5 px-2 w-[15%] text-right border border-black">
                  Uang Muka (Rp)
                </th>
                <th className="py-1.5 px-2 w-[15%] text-right border border-black">
                  Realisasi (Rp)
                </th>
                <th className="py-1.5 px-2 w-[14%] text-right border border-black">
                  Sisa / Kurang
                </th>
                <th className="py-1.5 px-1.5 w-[8%] text-center border border-black">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="align-top">
                  <td className="py-1.5 px-1.5 text-center border border-black">{idx + 1}</td>
                  <td className="py-1.5 px-2 text-left font-bold border border-black">{r.code}</td>
                  <td className="py-1.5 px-2.5 border border-black">{r.description}</td>
                  <td className="py-1.5 px-2 text-right border border-black">
                    {formatRupiah(r.advanceAmount)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold border border-black">
                    {formatRupiah(r.actualSpent)}
                  </td>
                  <td className="py-1.5 px-2 text-right border border-black">
                    {r.remaining > 0
                      ? `Sisa ${formatRupiah(r.remaining)}`
                      : r.shortage > 0
                      ? `Kurang ${formatRupiah(r.shortage)}`
                      : 'Nihil (Rp 0)'}
                  </td>
                  <td className="py-1.5 px-1.5 text-center font-bold border border-black">
                    {r.percentUsed}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#EFEFEF] font-bold text-black">
                <td colSpan={3} className="py-1.5 px-2.5 text-right uppercase border border-black">
                  TOTAL REKONSILIASI KEUANGAN AKHIR
                </td>
                <td className="py-1.5 px-2 text-right border border-black">
                  {formatRupiah(totalAdv)}
                </td>
                <td className="py-1.5 px-2 text-right border border-black">
                  {formatRupiah(totalSpent)}
                </td>
                <td className="py-1.5 px-2 text-right border border-black">
                  {totalRem > 0
                    ? `Sisa ${formatRupiah(totalRem)}`
                    : totalShort > 0
                    ? `Kurang ${formatRupiah(totalShort)}`
                    : 'Nihil (Rp 0)'}
                </td>
                <td className="py-1.5 px-1.5 text-center border border-black">{totalPct}%</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* 2. Otorisasi & Bukti Expensify */}
        <section className="pt-1 space-y-2">
          <div
            className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2 text-[13px]"
            style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            2. Referensi Bukti &amp; Otorisasi Laporan Keuangan Akhir
          </div>
          <table className="w-full text-left border-collapse border border-black text-[12px]">
            <tbody>
              <tr>
                <td className="py-1.5 px-2.5 w-[30%] border border-black font-bold">
                  Referensi Cash Advance
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  {preview.cashAdvanceReferenceNumber ||
                    cashAdvanceRecord?.advanceNumber ||
                    '-'}
                </td>
              </tr>
              {cashAdvanceRecord?.expensifyPdfLink && (
                <tr>
                  <td className="py-1.5 px-2.5 border border-black font-bold">
                    Lampiran PDF Expensify
                  </td>
                  <td className="py-1.5 px-2.5 border border-black break-all">
                    <a
                      href={cashAdvanceRecord.expensifyPdfLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#1D4ED8] font-bold underline"
                    >
                      <span>{cashAdvanceRecord.expensifyPdfLink}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <table className="w-full text-center border-collapse border border-black text-[12px]">
            <thead>
              <tr className="bg-[#EFEFEF] font-bold">
                <th className="py-1.5 px-2 w-1/3 border border-black">1. Dilaporkan Oleh (R)</th>
                <th className="py-1.5 px-2 w-1/3 border border-black">
                  2. Diperiksa Oleh (A2 Finance)
                </th>
                <th className="py-1.5 px-2 w-1/3 border border-black">
                  3. Disetujui Oleh (Direktur)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                <td className="py-2 px-2 border border-black">
                  <div className="my-1.5 flex justify-center">
                    <ApprovalBarcodeStamp
                      documentNumber={item.referenceNumber}
                      roleCode="REP"
                      signerName={item.responsibleUserName}
                      signDate={item.submittedAt.slice(0, 10)}
                      statusLabel="TELAH DILAPORKAN"
                    />
                  </div>
                  <div className="font-bold underline">{item.responsibleUserName}</div>
                </td>
                <td className="py-2 px-2 border border-black">
                  <div className="my-1.5 flex justify-center">
                    {item.status === 'Pending Approval' || item.status === 'Approved' ? (
                      <ApprovalBarcodeStamp
                        documentNumber={item.referenceNumber}
                        roleCode="FIN"
                        signerName={item.accountableFinanceUserName}
                        signDate={item.submittedAt.slice(0, 10)}
                        statusLabel="TERVERIFIKASI A2"
                      />
                    ) : (
                      <span className="py-3 text-[11px] italic text-slate-500">
                        [Menunggu Verifikasi A2 Finance]
                      </span>
                    )}
                  </div>
                  <div className="font-bold underline">{item.accountableFinanceUserName}</div>
                </td>
                <td className="py-2 px-2 border border-black">
                  <div className="my-1.5 flex justify-center">
                    {item.status === 'Approved' ? (
                      <ApprovalBarcodeStamp
                        documentNumber={item.referenceNumber}
                        roleCode="DIR"
                        signerName={item.directorUserName}
                        signDate={item.submittedAt.slice(0, 10)}
                        statusLabel="DISETUJUI DIREKTUR"
                      />
                    ) : (
                      <span className="py-3 text-[11px] italic text-slate-500">
                        [Menunggu Otorisasi Direktur]
                      </span>
                    )}
                  </div>
                  <div className="font-bold underline">{item.directorUserName}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </article>
    );
  };

  return (
    <div className="space-y-2.5">
      {/* Top Action Bar: Hanya 2 Tombol Aksi Ringkas Tanpa Judul */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenSourcePage(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCDAD5] bg-white hover:bg-[#FAF9F6] text-[#2F3437] text-xs font-medium transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#787774]" />
            <span>Buka Halaman Preview Penuh</span>
          </button>
          <button
            type="button"
            onClick={() =>
              downloadElementAsPdf({
                filename: `${item.referenceNumber}_${item.title}`,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2F3437] hover:bg-[#1f2325] text-white text-xs font-medium transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download PDF</span>
          </button>
          {isRevisionUnlocked && (
            <button
              type="button"
              onClick={() => onOpenSourcePage(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#EAD6A3] bg-[#FBF3DB] hover:bg-[#F5E7C1] text-[#B87D1E] text-xs font-semibold transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Form Dokumen</span>
            </button>
          )}
        </div>
        {loadingSource && (
          <span className="text-[11px] text-[#787774] italic">Memuat detail...</span>
        )}
      </div>

      {/* Render the exact formal document preview sheet according to category */}
      {item.categoryCode === 'tor' && renderTorPreview()}
      {item.categoryCode === 'notulen' && renderNotulenPreview()}
      {item.categoryCode === 'dokumentasi' && renderDokumentasiPreview()}
      {item.categoryCode === 'executive_summary' && renderExecutiveSummaryPreview()}
      {item.categoryCode === 'cash_advance' && renderCashAdvancePreview()}
      {item.categoryCode === 'laporan_keuangan_akhir' && renderFinalFinancialReportPreview()}
    </div>
  );
};
