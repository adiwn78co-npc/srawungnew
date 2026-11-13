import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Tor,
  Program,
  User,
  CashAdvanceRecord,
  MeetingMinutesRecord,
  MeetingMinutesParticipant,
  MeetingDiscussionItem,
  MeetingDecisionItem,
  MeetingActionPoint,
  ActionPointStatus,
} from '../../types/index.js';
import { api } from '../../lib/api.js';
import { formatIndonesianDate, formatPeriodRange, getNotulenReportingSchedule } from '../../lib/dateUtils.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';
import {
  Plus,
  Trash2,
  FileText,
  Printer,
  Download,
  Search,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  X,
} from 'lucide-react';

interface NotulenStageProps {
  tor: Tor;
  programs?: Program[];
  cashAdvances?: CashAdvanceRecord[];
  currentUser: User | null;
  onNavigateStage?: (stageNum: number) => void;
  initialRecordId?: string;
  initialViewMode?: 'preview' | 'editor';
}

const PLATFORM_PRESETS = [
  'Tatap Muka (Ruang Rapat / Balai)',
  'Zoom Meeting',
  'Google Meet',
  'Microsoft Teams',
  'Hybrid (Tatap Muka & Online)',
];

const DISCUSSION_TOPIC_OPTIONS = [
  'Program Implementation Progress',
  'MEAL Reporting and Documentation',
  'Implementation Challenges',
  'Coordination and Communication',
  'Financial and Administrative Updates',
];

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Format Nomor Notulen sesuai komponen standar:
 * 001/MOM/WIJNA/X/2026
 * - 001   : Nomor urut notulen
 * - MOM   : Minutes of Meeting
 * - WIJNA : Identitas organisasi
 * - X     : Bulan dalam angka Romawi
 * - 2026  : Tahun rapat
 */
export function formatNotulenNumber(params: {
  torNumber?: string;
  meetingDate?: string;
  sequence: number | string;
  notulenTitle?: string;
  torTitle?: string;
}): string {
  const seqStr = String(params.sequence || 1).padStart(3, '0');
  const datePart = (params.meetingDate || getTodayIso()).trim();
  const parsed = new Date(datePart);
  const now = new Date();
  const monthIdx = !isNaN(parsed.getTime()) ? parsed.getMonth() : now.getMonth();
  const year = !isNaN(parsed.getTime()) ? parsed.getFullYear() : now.getFullYear();
  const romanMonth = ROMAN_MONTHS[monthIdx] || 'X';
  return `${seqStr}/MOM/WIJNA/${romanMonth}/${year}`;
}

/**
 * Automatically marks an action point as 'Overdue' if its deadline has passed
 * and its status is not 'Completed'.
 */
export function resolveActionPointStatus(ap: MeetingActionPoint): ActionPointStatus {
  if (ap.status === 'Completed') return 'Completed';
  if (ap.deadline) {
    const today = getTodayIso();
    if (ap.deadline < today) {
      return 'Overdue';
    }
  }
  return ap.status || 'Not Started';
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const NotulenStage: React.FC<NotulenStageProps> = ({
  tor,
  cashAdvances: propCashAdvances,
  currentUser,
  initialRecordId,
  initialViewMode = 'preview',
}) => {
  // Primary view is 'list' (daftar notulen seperti daftar ToR list)
  const [subView, setSubView] = useState<'list' | 'editor' | 'preview'>('list');
  const [autoOpenedId, setAutoOpenedId] = useState<string | null>(null);

  // Saved minutes list from backend
  const [allMinutes, setAllMinutes] = useState<MeetingMinutesRecord[]>([]);
  const [fetchedCashAdvances, setFetchedCashAdvances] = useState<CashAdvanceRecord[]>([]);
  const [summaryRowTimelineMap, setSummaryRowTimelineMap] = useState<Record<string, string>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Seluruh tahapan Implementation Timeline yang ada di ToR (Eksklusif dari TOR Tahap 1)
  const rawTimelineItems = useMemo(() => {
    if (tor.timelineItems && tor.timelineItems.length > 0) {
      return tor.timelineItems.filter((tl) => tl.period?.trim() || tl.activity?.trim());
    }
    return [];
  }, [tor]);

  // Gabungkan Cash Advance dari props atau hasil fetch
  const effectiveCashAdvances = useMemo(() => {
    const source =
      propCashAdvances && propCashAdvances.length > 0 ? propCashAdvances : fetchedCashAdvances;
    return source.filter(
      (ca) =>
        (ca.torId === tor.id || (ca.torNumber && ca.torNumber === tor.torNumber)) &&
        ca.status !== 'Ditolak'
    );
  }, [propCashAdvances, fetchedCashAdvances, tor.id, tor.torNumber]);

  // Daftar Cash Advance yang laporannya masih belum ditutup (!isReported)
  const openCashAdvances = useMemo(() => {
    const unreported = effectiveCashAdvances.filter((ca) => !ca.isReported);
    return unreported.length > 0 ? unreported : effectiveCashAdvances;
  }, [effectiveCashAdvances]);

  // Helper: tentukan tahap Implementation / Project otomatis berdasarkan Cash Advance yang dipilih
  const getImplementationForCashAdvance = useCallback(
    (ca?: CashAdvanceRecord): string => {
      if (!ca) {
        if (rawTimelineItems.length > 0) {
          const tl = rawTimelineItems[0];
          return `Tahap 1 (${tl.period}): ${tl.activity}`;
        }
        return tor.title;
      }

      // 1. Jika memilih tahap spesifik pada Cash Advance (mode 'single' atau 1 tahap terpilih)
      if (
        ca.implementationMode === 'single' &&
        Array.isArray(ca.implementationTimelineIds) &&
        ca.implementationTimelineIds.length > 0
      ) {
        const foundIdx = rawTimelineItems.findIndex(
          (t) => t.id === ca.implementationTimelineIds![0]
        );
        if (foundIdx >= 0) {
          const tl = rawTimelineItems[foundIdx];
          return `Tahap ${foundIdx + 1} (${tl.period}): ${tl.activity}`;
        }
      }

      // 2. Jika terdapat pemetaan baris di Ringkasan Cash Advance / item timelineItemId
      if (Array.isArray(ca.items) && ca.items.length > 0 && ca.implementationMode === 'single') {
        for (let itemIdx = 0; itemIdx < ca.items.length; itemIdx++) {
          const item = ca.items[itemIdx];
          const rowKey = `${ca.id}-${item.id || itemIdx}`;
          const targetTlId = summaryRowTimelineMap[rowKey] || item.timelineItemId;
          if (targetTlId) {
            const foundIdx = rawTimelineItems.findIndex((t) => t.id === targetTlId);
            if (foundIdx >= 0) {
              const tl = rawTimelineItems[foundIdx];
              return `Tahap ${foundIdx + 1} (${tl.period}): ${tl.activity}`;
            }
          }
        }
      }

      // 3. Petakan urutan Cash Advance (.01 -> Tahap 1, .02 -> Tahap 2, dst.) terhadap tahapan ToR
      if (rawTimelineItems.length > 0) {
        const chronologicalCas = [...effectiveCashAdvances].sort((a, b) =>
          (a.advanceNumber || '').localeCompare(b.advanceNumber || '')
        );
        const caOrderIdx = chronologicalCas.findIndex((c) => c.id === ca.id);
        const stageIdx =
          caOrderIdx >= 0 ? caOrderIdx % rawTimelineItems.length : 0;
        const tl = rawTimelineItems[stageIdx];
        return `Tahap ${stageIdx + 1} (${tl.period}): ${tl.activity}`;
      }

      return ca.implementationTimelineSummary || tor.title;
    },
    [rawTimelineItems, summaryRowTimelineMap, effectiveCashAdvances, tor.title]
  );

  // Pilihan Implementation / Project: hanya tahap yang sesuai dengan Cash Advance yang masuk
  const cashAdvanceStageOptions = useMemo(() => {
    if (effectiveCashAdvances.length === 0) {
      return [];
    }

    const matchedStageMap = new Map<number, Set<string>>();

    effectiveCashAdvances.forEach((ca, caIdx) => {
      let matchedAny = false;

      if (ca.implementationMode === 'all') {
        rawTimelineItems.forEach((_, idx) => {
          if (!matchedStageMap.has(idx)) matchedStageMap.set(idx, new Set());
          matchedStageMap.get(idx)!.add(ca.advanceNumber);
        });
        matchedAny = true;
      }

      if (Array.isArray(ca.implementationTimelineIds) && ca.implementationTimelineIds.length > 0) {
        ca.implementationTimelineIds.forEach((tlId) => {
          const foundIdx = rawTimelineItems.findIndex((t) => t.id === tlId);
          if (foundIdx >= 0) {
            if (!matchedStageMap.has(foundIdx)) matchedStageMap.set(foundIdx, new Set());
            matchedStageMap.get(foundIdx)!.add(ca.advanceNumber);
            matchedAny = true;
          }
        });
      }

      if (Array.isArray(ca.items) && ca.items.length > 0) {
        ca.items.forEach((item, itemIdx) => {
          const rowKey = `${ca.id}-${item.id || itemIdx}`;
          const targetTlId = summaryRowTimelineMap[rowKey] || item.timelineItemId;
          if (targetTlId) {
            const foundIdx = rawTimelineItems.findIndex((t) => t.id === targetTlId);
            if (foundIdx >= 0) {
              if (!matchedStageMap.has(foundIdx)) matchedStageMap.set(foundIdx, new Set());
              matchedStageMap.get(foundIdx)!.add(ca.advanceNumber);
              matchedAny = true;
            }
          }
        });
      }

      if (!matchedAny && rawTimelineItems.length > 0) {
        const fallbackIdx = caIdx % rawTimelineItems.length;
        if (!matchedStageMap.has(fallbackIdx)) matchedStageMap.set(fallbackIdx, new Set());
        matchedStageMap.get(fallbackIdx)!.add(ca.advanceNumber);
      }
    });

    const options: { value: string; label: string; caNumbers: string[] }[] = [];
    rawTimelineItems.forEach((tl, idx) => {
      const caSet = matchedStageMap.get(idx);
      if (caSet && caSet.size > 0) {
        const stageText = `Tahap ${idx + 1} (${tl.period}): ${tl.activity}`;
        const caNums = Array.from(caSet);
        options.push({
          value: stageText,
          label: `${stageText} (${caNums.join(', ')})`,
          caNumbers: caNums,
        });
      }
    });

    return options;
  }, [effectiveCashAdvances, rawTimelineItems, summaryRowTimelineMap]);

  const torStageOptions = useMemo(() => {
    if (cashAdvanceStageOptions.length > 0) {
      return cashAdvanceStageOptions.map((o) => o.value);
    }
    return rawTimelineItems.map((tl, idx) => `Tahap ${idx + 1} (${tl.period}): ${tl.activity}`);
  }, [cashAdvanceStageOptions, rawTimelineItems]);

  // Notulen list filtered to this ToR (or matching torNumber)
  const torMinutesList = useMemo(() => {
    return allMinutes.filter(
      (m) => m.torId === tor.id || (m.torNumber && m.torNumber === tor.torNumber)
    );
  }, [allMinutes, tor.id, tor.torNumber]);

  const notulenSchedule = useMemo(
    () => getNotulenReportingSchedule(tor, torMinutesList),
    [tor, torMinutesList]
  );

  const filteredTorMinutes = useMemo(() => {
    if (!searchQuery.trim()) return torMinutesList;
    const q = searchQuery.toLowerCase();
    return torMinutesList.filter(
      (m) =>
        (m.title || '').toLowerCase().includes(q) ||
        (m.documentNumber || '').toLowerCase().includes(q) ||
        (m.meetingDate || '').toLowerCase().includes(q)
    );
  }, [torMinutesList, searchQuery]);

  // Sequence number for a new Notulen under this ToR
  const [activeSeqNumber, setActiveSeqNumber] = useState<number>(1);

  const createDefaultDraft = useCallback(
    (seqNum = 1): MeetingMinutesRecord => {
      const today = getTodayIso();
      const defaultCa = openCashAdvances[0];
      const defaultStage = defaultCa
        ? getImplementationForCashAdvance(defaultCa)
        : torStageOptions[0] || tor.title;
      const defaultTitle = `Notulen Rapat ${tor.title}`;
      const autoDocNum = formatNotulenNumber({
        meetingDate: today,
        sequence: seqNum,
      });

      return {
        id: '',
        documentNumber: autoDocNum,
        torId: tor.id,
        torNumber: tor.torNumber,
        cashAdvanceId: defaultCa?.id || '',
        cashAdvanceNumber: defaultCa?.advanceNumber || '',
        title: defaultTitle,
        implementationProject: defaultStage,
        partnerOrganization: '',
        meetingDate: today,
        startTime: '09:00',
        endTime: '11:00',
        meetingLocation: tor.location || '',
        meetingRoomPlatform: 'Tatap Muka (Ruang Rapat / Balai)',
        participants: [
          {
            id: `mp-${Date.now()}-1`,
            name: '',
            organization: '',
            role: '',
          },
        ],
        recorderName: '', // Isi manual
        discussions: [
          {
            id: `disc-${Date.now()}-1`,
            topic: DISCUSSION_TOPIC_OPTIONS[0],
            summary: '',
            keyFindings: '',
            issuesChallenges: '',
            responsesClarifications: '',
          },
        ],
        decisions: [
          {
            id: `dec-${Date.now()}-1`,
            statement: '',
            backgroundReason: '',
            responsibleParty: '',
            relatedProgramActivity: defaultStage,
          },
        ],
        actionPoints: [
          {
            id: `ap-${Date.now()}-1`,
            action: '',
            pic: '',
            deadline: today,
            status: 'Not Started',
          },
        ],
        additionalNotes: '',
        nextMeetingAgenda: '',
        nextMeetingSchedule: '',
        preparationDocuments: '',
        createdById: currentUser?.id || 'user-staff-1',
        createdByName: currentUser?.name || 'Staff WIJNA',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    [tor, openCashAdvances, getImplementationForCashAdvance, torStageOptions, currentUser]
  );

  const [formData, setFormData] = useState<MeetingMinutesRecord>(() => createDefaultDraft(1));

  // Sinkronkan pilihan Cash Advance & Implementation / Project otomatis saat data Cash Advance dimuat
  useEffect(() => {
    if (!formData.id && openCashAdvances.length > 0 && !formData.cashAdvanceId) {
      const firstCa = openCashAdvances[0];
      const autoStage = getImplementationForCashAdvance(firstCa);
      setFormData((prev) => ({
        ...prev,
        cashAdvanceId: firstCa.id,
        cashAdvanceNumber: firstCa.advanceNumber,
        implementationProject: autoStage,
        decisions: prev.decisions.map((d) => ({
          ...d,
          relatedProgramActivity: autoStage,
        })),
      }));
    }
  }, [openCashAdvances, formData.id, formData.cashAdvanceId, getImplementationForCashAdvance]);

  const handleSelectCashAdvance = (caId: string) => {
    const chosenCa =
      openCashAdvances.find((c) => c.id === caId) ||
      effectiveCashAdvances.find((c) => c.id === caId);
    const autoStage = getImplementationForCashAdvance(chosenCa);
    setFormData((prev) => ({
      ...prev,
      cashAdvanceId: chosenCa?.id || '',
      cashAdvanceNumber: chosenCa?.advanceNumber || '',
      implementationProject: autoStage,
      decisions: prev.decisions.map((d) => ({
        ...d,
        relatedProgramActivity:
          !d.relatedProgramActivity ||
          d.relatedProgramActivity === prev.implementationProject
            ? autoStage
            : d.relatedProgramActivity,
      })),
    }));
  };

  const loadMinutesList = useCallback(async () => {
    setLoadingList(true);
    try {
      const [list, caList, caSummaryRes] = await Promise.all([
        api.getMeetingMinutes(),
        api.getCashAdvances({ torId: tor.id }).catch(() => []),
        api.getCashAdvanceSummary(tor.id).catch(() => null),
      ]);
      setAllMinutes(Array.isArray(list) ? list : []);
      if (Array.isArray(caList)) {
        setFetchedCashAdvances(caList);
      }
      if (caSummaryRes?.summary && Array.isArray(caSummaryRes.summary.summaryRows)) {
        const tlMap: Record<string, string> = {};
        caSummaryRes.summary.summaryRows.forEach((sr: any) => {
          if (sr.id && sr.timelineItemId) {
            tlMap[sr.id] = sr.timelineItemId;
          }
        });
        setSummaryRowTimelineMap(tlMap);
      }
    } catch {
      // ignore
    } finally {
      setLoadingList(false);
    }
  }, [tor.id]);

  useEffect(() => {
    loadMinutesList();
  }, [loadMinutesList]);

  // Keep Nomor Notulen (001/MOM/WIJNA/X/2026) synced automatically when meetingDate changes
  const handleMeetingDateChange = (newDate: string) => {
    setFormData((prev) => {
      const updatedDocNumber = formatNotulenNumber({
        meetingDate: newDate,
        sequence: activeSeqNumber,
      });
      return {
        ...prev,
        meetingDate: newDate,
        documentNumber: updatedDocNumber,
      };
    });
  };

  const handleTitleChange = (newTitle: string) => {
    setFormData((prev) => ({
      ...prev,
      title: newTitle,
    }));
  };

  // --- PARTICIPANT HANDLERS ---
  const handleAddParticipant = () => {
    setFormData((prev) => ({
      ...prev,
      participants: [
        ...prev.participants,
        {
          id: `mp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: '',
          organization: '',
          role: '',
        },
      ],
    }));
  };

  const handleUpdateParticipant = (
    id: string,
    field: keyof MeetingMinutesParticipant,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      participants: prev.participants.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    }));
  };

  const handleRemoveParticipant = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      participants: prev.participants.filter((p) => p.id !== id),
    }));
  };

  // --- DISCUSSION HANDLERS ---
  const handleAddDiscussion = () => {
    setFormData((prev) => ({
      ...prev,
      discussions: [
        ...prev.discussions,
        {
          id: `disc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          topic: DISCUSSION_TOPIC_OPTIONS[prev.discussions.length % DISCUSSION_TOPIC_OPTIONS.length],
          summary: '',
          keyFindings: '',
          issuesChallenges: '',
          responsesClarifications: '',
        },
      ],
    }));
  };

  const handleUpdateDiscussion = (
    id: string,
    field: keyof MeetingDiscussionItem,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      discussions: prev.discussions.map((d) => (d.id === id ? { ...d, [field]: value } : d)),
    }));
  };

  const handleRemoveDiscussion = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      discussions: prev.discussions.filter((d) => d.id !== id),
    }));
  };

  // --- DECISION HANDLERS ---
  const handleAddDecision = () => {
    setFormData((prev) => ({
      ...prev,
      decisions: [
        ...prev.decisions,
        {
          id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          statement: '',
          backgroundReason: '',
          responsibleParty: '',
          relatedProgramActivity: prev.implementationProject || torStageOptions[0] || tor.title,
        },
      ],
    }));
  };

  const handleUpdateDecision = (
    id: string,
    field: keyof MeetingDecisionItem,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      decisions: prev.decisions.map((d) => (d.id === id ? { ...d, [field]: value } : d)),
    }));
  };

  const handleRemoveDecision = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      decisions: prev.decisions.filter((d) => d.id !== id),
    }));
  };

  // --- ACTION POINT HANDLERS ---
  const handleAddActionPoint = () => {
    setFormData((prev) => ({
      ...prev,
      actionPoints: [
        ...prev.actionPoints,
        {
          id: `ap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          action: '',
          pic: '',
          deadline: getTodayIso(),
          status: 'Not Started',
        },
      ],
    }));
  };

  const handleUpdateActionPoint = (
    id: string,
    field: keyof MeetingActionPoint,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      actionPoints: prev.actionPoints.map((ap) => {
        if (ap.id !== id) return ap;
        const updated = { ...ap, [field]: value } as MeetingActionPoint;
        if (field === 'deadline' && updated.status !== 'Completed') {
          if (value && value < getTodayIso()) {
            updated.status = 'Overdue';
          } else if (updated.status === 'Overdue' && value >= getTodayIso()) {
            updated.status = 'In Progress';
          }
        }
        return updated;
      }),
    }));
  };

  const handleRemoveActionPoint = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      actionPoints: prev.actionPoints.filter((ap) => ap.id !== id),
    }));
  };

  // --- CREATE / OPEN / SAVE / DELETE ---
  const handleCreateNewNotulen = () => {
    const nextSeq = torMinutesList.length + 1;
    setActiveSeqNumber(nextSeq);
    const fresh = createDefaultDraft(nextSeq);
    setFormData(fresh);
    setFeedback(null);
    setSubView('editor');
  };

  const handleOpenRecord = (
    record: MeetingMinutesRecord,
    targetView: 'editor' | 'preview' = 'editor'
  ) => {
    const idxInTor = torMinutesList.findIndex((m) => m.id === record.id);
    const seqNum = idxInTor >= 0 ? torMinutesList.length - idxInTor : 1;
    setActiveSeqNumber(seqNum);

    const validStage = torStageOptions.includes(record.implementationProject)
      ? record.implementationProject
      : torStageOptions[0] || record.implementationProject;

    const cleanTitle =
      record.title && !record.title.startsWith('Tahap ')
        ? record.title
        : `Notulen Rapat ${tor.title}`;

    setFormData({
      ...record,
      implementationProject: validStage,
      title: cleanTitle,
      participants: Array.isArray(record.participants) ? record.participants : [],
      discussions: Array.isArray(record.discussions) ? record.discussions : [],
      decisions: Array.isArray(record.decisions) ? record.decisions : [],
      actionPoints: (Array.isArray(record.actionPoints) ? record.actionPoints : []).map((ap) => ({
        ...ap,
        status: resolveActionPointStatus(ap),
      })),
    });
    setFeedback(null);
    setSubView(targetView);
  };

  useEffect(() => {
    const key = `${initialRecordId || 'first'}-${initialViewMode || ''}`;
    if (autoOpenedId === key) return;
    if (!initialRecordId && !initialViewMode) return;
    if (torMinutesList.length === 0) return;

    const matched =
      (initialRecordId && torMinutesList.find((m) => m.id === initialRecordId)) ||
      torMinutesList[0];
    if (matched) {
      setAutoOpenedId(key);
      handleOpenRecord(matched, initialViewMode || 'preview');
    }
  }, [initialRecordId, initialViewMode, torMinutesList, autoOpenedId]);

  const handleSaveMinutes = async () => {
    setFeedback(null);
    setSaving(true);
    try {
      const normalizedActions = (formData.actionPoints || []).map((ap) => ({
        ...ap,
        status: resolveActionPointStatus(ap),
      }));

      const effectiveStage = formData.implementationProject || torStageOptions[0] || tor.title;
      const effectiveTitle = (formData.title || '').trim() || `Notulen Rapat ${tor.title}`;
      const effectiveDocNumber = formatNotulenNumber({
        meetingDate: formData.meetingDate || getTodayIso(),
        sequence: activeSeqNumber,
      });

      const payload: Partial<MeetingMinutesRecord> = {
        ...formData,
        documentNumber: formData.documentNumber || effectiveDocNumber,
        torId: tor.id,
        torNumber: tor.torNumber,
        implementationProject: effectiveStage,
        title: effectiveTitle,
        participants: Array.isArray(formData.participants) ? formData.participants : [],
        discussions: Array.isArray(formData.discussions) ? formData.discussions : [],
        decisions: Array.isArray(formData.decisions) ? formData.decisions : [],
        actionPoints: normalizedActions,
      };

      let savedRecord: MeetingMinutesRecord;
      if (formData.id) {
        savedRecord = await api.updateMeetingMinutes(formData.id, payload);
      } else {
        savedRecord = await api.createMeetingMinutes(payload);
      }

      setFormData({
        ...savedRecord,
        participants: Array.isArray(savedRecord?.participants) ? savedRecord.participants : [],
        discussions: Array.isArray(savedRecord?.discussions) ? savedRecord.discussions : [],
        decisions: Array.isArray(savedRecord?.decisions) ? savedRecord.decisions : [],
        actionPoints: Array.isArray(savedRecord?.actionPoints) ? savedRecord.actionPoints : [],
      });
      await loadMinutesList();
      setFeedback({
        type: 'success',
        message: 'Notulen berhasil disimpan.',
      });
      setSubView('list');
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Gagal menyimpan dokumen notulen.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRecord = async (record: MeetingMinutesRecord) => {
    try {
      await api.deleteMeetingMinutes(record.id);
      await loadMinutesList();
      setFeedback({
        type: 'success',
        message: `Notulen telah dihapus.`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Gagal menghapus notulen.',
      });
    }
  };

  // --- EXPORT TO DOCX ---
  const handleExportDocx = (doc: MeetingMinutesRecord = formData) => {
    const participantsRows =
      doc.participants && doc.participants.some((p) => p.name.trim())
        ? doc.participants
            .filter((p) => p.name.trim())
            .map(
              (p, i) => `
          <tr>
            <td style="border:1px solid #000;padding:5px 8px;text-align:center;">${i + 1}</td>
            <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">${escapeHtml(
              p.name || '—'
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
              p.organization || '—'
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(p.role || '—')}</td>
          </tr>`
            )
            .join('')
        : `<tr><td colspan="4" style="border:1px solid #000;padding:6px;text-align:center;">—</td></tr>`;

    const discussionsHtml =
      doc.discussions && doc.discussions.some((d) => d.topic || d.summary)
        ? doc.discussions
            .map(
              (d, i) => `
          <div style="margin-bottom:12px;border:1px solid #000;padding:8px 10px;">
            <div style="font-weight:bold;font-size:11pt;margin-bottom:4px;">${i + 1}. ${escapeHtml(
                d.topic || 'Topik Pembahasan'
              )}</div>
            <table style="width:100%;border-collapse:collapse;font-size:10.5pt;">
              <tr>
                <td style="width:28%;font-weight:bold;padding:3px 0;vertical-align:top;">Description / Summary:</td>
                <td style="padding:3px 0;vertical-align:top;">${escapeHtml(d.summary || '—')}</td>
              </tr>
              <tr>
                <td style="font-weight:bold;padding:3px 0;vertical-align:top;">Key Findings:</td>
                <td style="padding:3px 0;vertical-align:top;">${escapeHtml(
                  d.keyFindings || '—'
                )}</td>
              </tr>
              <tr>
                <td style="font-weight:bold;padding:3px 0;vertical-align:top;">Issues / Challenges:</td>
                <td style="padding:3px 0;vertical-align:top;">${escapeHtml(
                  d.issuesChallenges || '—'
                )}</td>
              </tr>
              <tr>
                <td style="font-weight:bold;padding:3px 0;vertical-align:top;">Responses / Clarifications:</td>
                <td style="padding:3px 0;vertical-align:top;">${escapeHtml(
                  d.responsesClarifications || '—'
                )}</td>
              </tr>
            </table>
          </div>`
            )
            .join('')
        : `<p>—</p>`;

    const decisionsRows =
      doc.decisions && doc.decisions.some((d) => d.statement)
        ? doc.decisions
            .map(
              (d, i) => `
          <tr>
            <td style="border:1px solid #000;padding:5px 8px;text-align:center;vertical-align:top;">${
              i + 1
            }</td>
            <td style="border:1px solid #000;padding:5px 8px;vertical-align:top;font-weight:bold;">${escapeHtml(
              d.statement || '—'
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;vertical-align:top;">${escapeHtml(
              d.backgroundReason || '—'
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;vertical-align:top;">${escapeHtml(
              d.responsibleParty || '—'
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;vertical-align:top;">${escapeHtml(
              d.relatedProgramActivity || '—'
            )}</td>
          </tr>`
            )
            .join('')
        : `<tr><td colspan="5" style="border:1px solid #000;padding:6px;text-align:center;">—</td></tr>`;

    const actionRows =
      doc.actionPoints && doc.actionPoints.some((a) => a.action)
        ? doc.actionPoints
            .map((ap, i) => {
              const effStatus = resolveActionPointStatus(ap);
              return `
          <tr>
            <td style="border:1px solid #000;padding:5px 8px;text-align:center;vertical-align:top;">${
              i + 1
            }</td>
            <td style="border:1px solid #000;padding:5px 8px;vertical-align:top;">${escapeHtml(
              ap.action || '—'
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;vertical-align:top;">${escapeHtml(
              ap.pic || '—'
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;text-align:center;vertical-align:top;">${escapeHtml(
              formatIndonesianDate(ap.deadline)
            )}</td>
            <td style="border:1px solid #000;padding:5px 8px;text-align:center;vertical-align:top;font-weight:bold;">${escapeHtml(
              effStatus
            )}</td>
          </tr>`;
            })
            .join('')
        : `<tr><td colspan="5" style="border:1px solid #000;padding:6px;text-align:center;">—</td></tr>`;

    const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.documentNumber)}</title>
<style>
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000000; line-height: 1.38; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 12px 0; text-transform: uppercase; }
  .section-bar { background-color: #CCCCCC; font-weight: bold; padding: 4px 8px; margin-top: 14px; margin-bottom: 8px; font-size: 12pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
</style>
</head>
<body>
  <h1>NOTULEN RAPAT / MEETING MINUTES</h1>

  <div class="section-bar">1. Meeting Information</div>
  <table>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;width:28%;font-weight:bold;">Judul Notulen</td>
      <td style="border:1px solid #000;padding:5px 8px;width:72%;font-weight:bold;">${escapeHtml(
        doc.title || '—'
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;width:28%;font-weight:bold;">Nomor Notulen</td>
      <td style="border:1px solid #000;padding:5px 8px;width:72%;font-weight:bold;">${escapeHtml(
        doc.documentNumber
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Implementation / Project</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        doc.implementationProject
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Recorder / Notulis</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(doc.recorderName || '—')}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Meeting Date</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        formatIndonesianDate(doc.meetingDate)
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Meeting Time</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(doc.startTime)} – ${escapeHtml(
      doc.endTime
    )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Meeting Location</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        doc.meetingLocation || '—'
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Meeting Room / Platform</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        doc.meetingRoomPlatform || '—'
      )}</td>
    </tr>
  </table>

  <div style="font-weight:bold;margin:8px 0 4px 0;">Participants:</div>
  <table>
    <thead>
      <tr style="background-color:#F1F5F9;font-weight:bold;">
        <th style="border:1px solid #000;padding:5px 8px;width:8%;">No</th>
        <th style="border:1px solid #000;padding:5px 8px;width:34%;text-align:left;">Nama Peserta</th>
        <th style="border:1px solid #000;padding:5px 8px;width:32%;text-align:left;">Organisasi / Partner</th>
        <th style="border:1px solid #000;padding:5px 8px;width:26%;text-align:left;">Peran / Jabatan</th>
      </tr>
    </thead>
    <tbody>
      ${participantsRows}
    </tbody>
  </table>

  <div class="section-bar">2. Meeting Agenda &amp; Discussion</div>
  ${discussionsHtml}

  <div class="section-bar">3. Key Decisions</div>
  <table>
    <thead>
      <tr style="background-color:#F1F5F9;font-weight:bold;">
        <th style="border:1px solid #000;padding:5px 8px;width:6%;">No</th>
        <th style="border:1px solid #000;padding:5px 8px;width:32%;text-align:left;">Decision Statement</th>
        <th style="border:1px solid #000;padding:5px 8px;width:24%;text-align:left;">Background / Reason</th>
        <th style="border:1px solid #000;padding:5px 8px;width:19%;text-align:left;">Responsible Party</th>
        <th style="border:1px solid #000;padding:5px 8px;width:19%;text-align:left;">Related Program / Activity</th>
      </tr>
    </thead>
    <tbody>
      ${decisionsRows}
    </tbody>
  </table>

  <div class="section-bar">4. Action Points / Follow-up</div>
  <table>
    <thead>
      <tr style="background-color:#F1F5F9;font-weight:bold;">
        <th style="border:1px solid #000;padding:5px 8px;width:6%;">No</th>
        <th style="border:1px solid #000;padding:5px 8px;width:40%;text-align:left;">Follow-up Action</th>
        <th style="border:1px solid #000;padding:5px 8px;width:22%;text-align:left;">Person in Charge (PIC)</th>
        <th style="border:1px solid #000;padding:5px 8px;width:16%;text-align:center;">Deadline</th>
        <th style="border:1px solid #000;padding:5px 8px;width:16%;text-align:center;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${actionRows}
    </tbody>
  </table>

  <div class="section-bar">5. Additional Notes</div>
  <table>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;width:28%;font-weight:bold;">Catatan Tambahan</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        doc.additionalNotes || '—'
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Agenda Rapat Berikutnya</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        doc.nextMeetingAgenda || '—'
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Jadwal Pertemuan Selanjutnya</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        doc.nextMeetingSchedule || '—'
      )}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:5px 8px;font-weight:bold;">Dokumen / Persiapan Rapat Berikutnya</td>
      <td style="border:1px solid #000;padding:5px 8px;">${escapeHtml(
        doc.preparationDocuments || '—'
      )}</td>
    </tr>
  </table>

  <div class="section-bar">6. Pengesahan &amp; Akuntabilitas Notulen</div>
  <table>
    <tr>
      <td style="border:1px solid #000;padding:8px;width:33.33%;text-align:center;vertical-align:top;">
        <div style="font-weight:bold;margin-bottom:8px;">Disusun Oleh (R – Responsible),</div>
        <div style="display:inline-block;border:1.5px solid #2563EB;background:#EFF6FF;color:#1D4ED8;padding:4px 8px;font-family:monospace;font-size:9pt;font-weight:bold;margin:8px 0;">
          STAMPED &amp; SIGNED (R)<br/>
          AUTHORIZED: ${escapeHtml(doc.meetingDate || tor.startDate || '2026-10-08')}
        </div>
        <div style="font-weight:bold;text-decoration:underline;margin-top:8px;">${escapeHtml(
          doc.recorderName || tor.picName || tor.createdByName || 'Budi Santoso'
        )}</div>
        <div style="font-size:9.5pt;color:#334155;">R – Responsible (Pelaksana Kegiatan)</div>
      </td>
      <td style="border:1px solid #000;padding:8px;width:33.33%;text-align:center;vertical-align:top;">
        <div style="font-weight:bold;margin-bottom:8px;">Diketahui Oleh (A1 – Accountable Program),</div>
        <div style="display:inline-block;border:1.5px solid #2563EB;background:#EFF6FF;color:#1D4ED8;padding:4px 8px;font-family:monospace;font-size:9pt;font-weight:bold;margin:8px 0;">
          STAMPED &amp; VERIFIED (A1)<br/>
          AUTHORIZED: ${escapeHtml(doc.meetingDate || tor.startDate || '2026-10-08')}
        </div>
        <div style="font-weight:bold;text-decoration:underline;margin-top:8px;">Dimas Pratama, M.Sc.</div>
        <div style="font-size:9.5pt;color:#334155;">A1 – Accountable Program (Program Manager)</div>
      </td>
      <td style="border:1px solid #000;padding:8px;width:33.33%;text-align:center;vertical-align:top;">
        <div style="font-weight:bold;margin-bottom:8px;">Perwakilan Partner / Mitra Setempat,</div>
        <div style="height:52px;border:1px dashed #64748B;margin:6px 12px;display:flex;align-items:center;justify-content:center;font-size:8.5pt;color:#64748B;font-style:italic;">
          (Tanda Tangan Basah Manual &amp; Stempel Mitra)
        </div>
        <div style="font-weight:bold;text-decoration:underline;margin-top:8px;">${escapeHtml(
          doc.partnerRepName || 'H. Asep Sunandar'
        )}</div>
        <div style="font-size:9.5pt;color:#334155;">${escapeHtml(
          doc.partnerRepTitle || doc.partnerOrganization || 'Ketua POKMAIR / Perwakilan Partner Desa Sasaran'
        )}</div>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const blob = new Blob(['\ufeff', wordHtml], {
      type: 'application/msword;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeFilename = (doc.documentNumber || 'Notulen_Rapat')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 80)
      .concat('.doc');
    link.href = url;
    link.download = safeFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded border text-xs flex items-center justify-between print:hidden ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-0.5 hover:opacity-75 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* VIEW 1: SIMPLE NOTULEN LIST (HANYA JUDUL NOTULEN, NOMOR, TANGGAL)  */}
      {/* ================================================================== */}
      {subView === 'list' && (
        <div className="space-y-3 print:hidden">
          {/* Top Bar: Jadwal Notulen & Info Laporan Final 7 Hari (Executive Summary) */}
          <div className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA]">
            <div className="px-4 py-2.5 bg-[#FAF9F7] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-stone-600">
                <span>
                  Aturan Pelaporan:{' '}
                  <strong className="text-stone-900">
                    {tor.reportingPeriodType || 'Sekali / Akhir Kegiatan'}
                  </strong>
                </span>
                <span className="text-stone-300">·</span>
                <span>
                  Laporan Final 7 Hari (H+7):{' '}
                  <strong className="text-[#1D4ED8]">
                    Executive Summary (7 Bagian Form Monitoring)
                  </strong>{' '}
                  — Tenggat:{' '}
                  <strong className="text-stone-900">
                    {formatIndonesianDate(tor.reportingDeadline || notulenSchedule.nearestDueDate)}
                  </strong>
                </span>
              </div>
              <span className="px-2 py-0.5 rounded font-medium text-[11px] border bg-stone-100 border-stone-200 text-stone-700">
                Notulen Rapat Tercatat: {torMinutesList.length} Dokumen
              </span>
            </div>

            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari judul notulen, nomor notulen, atau tanggal..."
                    className="w-full h-8 pl-8 pr-3 bg-white border border-stone-200 focus:border-stone-400 rounded text-xs text-stone-800 focus:outline-none"
                  />
                </div>
                <span className="text-xs text-stone-500">
                  Total <strong className="text-stone-900">{filteredTorMinutes.length}</strong> Notulen
                </span>
              </div>

              <button
                type="button"
                onClick={handleCreateNewNotulen}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Buat Notulen</span>
              </button>
            </div>
          </div>

          {/* Simple List Container (Mirip Daftar ToR List — Hanya Judul Notulen) */}
          <div className="bg-white rounded-lg border border-[#EAEAEA] divide-y divide-[#EAEAEA] overflow-hidden">
            {loadingList ? (
              <div className="py-16 text-center text-stone-500 text-xs">
                Memuat daftar notulen...
              </div>
            ) : filteredTorMinutes.length === 0 ? (
              <div className="py-16 text-center text-stone-500 space-y-2">
                <FileText className="w-7 h-7 text-stone-300 mx-auto" />
                <p className="font-medium text-stone-800 text-sm">Belum ada dokumen Notulen</p>
                <p className="text-xs text-stone-500">
                  Klik tombol &quot;+ Buat Notulen&quot; untuk mencatat notulen rapat pada ToR ini.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleCreateNewNotulen}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Buat Notulen</span>
                  </button>
                </div>
              </div>
            ) : (
              filteredTorMinutes.map((item) => {
                // Tampilkan hanya Judul Notulen (bukan teks Tahap Implementasi yang panjang)
                const notulenTitleOnly =
                  item.title && !item.title.startsWith('Tahap ')
                    ? item.title
                    : `Notulen Rapat ${tor.title}`;
                const formattedDate = formatIndonesianDate(
                  item.meetingDate || item.createdAt.slice(0, 10)
                ).toUpperCase();

                return (
                  <div
                    key={item.id}
                    onClick={() => handleOpenRecord(item, 'preview')}
                    className="px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-[#F7F7F5] transition-colors cursor-pointer group"
                  >
                    {/* Left Column: Dot, Judul Notulen saja, Nomor Notulen */}
                    <div className="flex-1 flex items-start gap-3 min-w-0 pr-3">
                      <div className="pt-1.5 shrink-0">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-medium text-[#2F3437] group-hover:text-[#1D4ED8] transition-colors leading-snug break-words">
                          {notulenTitleOnly}
                        </h3>
                        <div className="text-[12px] text-[#1D4ED8] font-mono font-semibold mt-1 break-all">
                          {item.documentNumber}
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Tanggal Dibuat & Simple Actions */}
                    <div
                      className="flex items-center justify-between sm:justify-end gap-3.5 shrink-0 pl-5 sm:pl-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="w-[2px] h-7 rounded-full bg-[#EDEDEC] hidden sm:block shrink-0" />

                      <div className="text-left sm:text-right leading-tight min-w-[110px]">
                        <div className="text-[12px] font-semibold tracking-wider text-[#2F3437] uppercase font-sans">
                          {formattedDate}
                        </div>
                        <div className="text-[11px] text-[#787774] mt-0.5">Tanggal Dibuat</div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenRecord(item, 'preview')}
                          className="px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-xs font-medium transition-colors cursor-pointer"
                          title="Lihat / Cetak Notulen"
                        >
                          Lihat
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenRecord(item, 'editor')}
                          className="px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-xs font-medium transition-colors cursor-pointer"
                          title="Edit Notulen"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRecord(item)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Hapus Notulen"
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

      {/* ================================================================== */}
      {/* VIEW 2: FORM BUAT / EDIT NOTULEN (DESAIN SEDERHANA SEPERTI TOR)    */}
      {/* ================================================================== */}
      {subView === 'editor' && (
        <div className="bg-white rounded-lg border border-stone-200 overflow-hidden print:hidden">
          {/* Compact Header Matching TorFormModal */}
          <header className="bg-white border-b border-stone-200 px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="px-2 py-0.5 text-[11px] font-medium bg-stone-100 text-stone-600 rounded shrink-0">
                {formData.id ? 'Edit Notulen' : 'Draft Notulen'}
              </span>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-xs font-mono text-stone-700 truncate">
                <span className="text-[11px] font-sans text-stone-400">No:</span>
                <span className="font-semibold text-stone-800 truncate">
                  {formData.documentNumber}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSubView('preview')}
                className="px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 border border-stone-200 rounded transition-colors cursor-pointer"
              >
                Preview Dokumen
              </button>
              <button
                type="button"
                onClick={handleSaveMinutes}
                disabled={saving}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Menyimpan...' : 'Simpan Notulen'}
              </button>
              <button
                type="button"
                onClick={() => setSubView('list')}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors ml-1 cursor-pointer"
                title="Kembali ke Daftar Notulen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Single-Column Clean Form Body Matching TorFormModal */}
          <div className="p-4 sm:p-8 sm:px-12 bg-white">
            <div className="max-w-4xl mx-auto space-y-8 pb-6">
              {/* ======================================================== */}
              {/* 1. MEETING INFORMATION                                   */}
              {/* ======================================================== */}
              <section className="space-y-4">
                <div className="pb-1.5 border-b border-stone-200">
                  <h2 className="text-sm font-semibold text-stone-900">1. Meeting Information</h2>
                </div>

                {/* Vertical Stack (Menurun Bukan Mendatar) */}
                <div className="space-y-3.5 text-xs">
                  {/* Judul Notulen (Informasi Baru di Gambar 2 & Judul pada Daftar Notulen) */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">Judul Notulen</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      placeholder="Contoh: Rapat Koordinasi Persiapan Pelatihan Pompa Desa Cibuluh..."
                      className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                    />
                  </div>

                  {/* Nomor Notulen (Otomatis: 001/MOM/WIJNA/X/2026 tanpa pilihan lain) */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">Nomor Notulen</label>
                    <input
                      type="text"
                      value={formData.documentNumber}
                      readOnly
                      className="w-full h-8 px-2.5 bg-stone-50 border border-stone-200 rounded text-stone-700 font-mono focus:outline-none cursor-default"
                    />
                  </div>

                  {/* Pilihan Cash Advance yang Masih Belum Ditutup Laporannya */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Cash Advance (Belum Ditutup Laporannya)
                    </label>
                    <select
                      value={
                        formData.cashAdvanceId &&
                        openCashAdvances.some((ca) => ca.id === formData.cashAdvanceId)
                          ? formData.cashAdvanceId
                          : openCashAdvances[0]?.id || ''
                      }
                      onChange={(e) => handleSelectCashAdvance(e.target.value)}
                      className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                    >
                      {openCashAdvances.length > 0 ? (
                        openCashAdvances.map((ca) => (
                          <option key={ca.id} value={ca.id}>
                            {ca.advanceNumber} — {ca.requesterName} (
                            {getImplementationForCashAdvance(ca)})
                          </option>
                        ))
                      ) : (
                        <option value="">Belum ada Cash Advance aktif</option>
                      )}
                    </select>
                  </div>

                  {/* Implementation / Project (Otomatis Mengikuti Cash Advance yang Dipilih) */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Implementation / Project
                    </label>
                    <input
                      type="text"
                      value={formData.implementationProject}
                      readOnly
                      className="w-full h-8 px-2.5 bg-stone-50 border border-stone-200 rounded text-stone-700 focus:outline-none cursor-default"
                    />
                  </div>

                  {/* Recorder / Notulis (Isi Manual) */}
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Recorder / Notulis
                    </label>
                    <input
                      type="text"
                      value={formData.recorderName}
                      onChange={(e) => setFormData({ ...formData, recorderName: e.target.value })}
                      placeholder="Ketik nama notulis secara manual..."
                      className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                    />
                  </div>

                  {/* 5 Kolom: Meeting Date, Meeting Time (Mulai), Meeting Time (Selesai), Meeting Location, Meeting Room / Platform */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Meeting Date
                      </label>
                      <input
                        type="date"
                        value={formData.meetingDate}
                        onChange={(e) => handleMeetingDateChange(e.target.value)}
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Meeting Time (Mulai)
                      </label>
                      <input
                        type="time"
                        value={formData.startTime}
                        onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Meeting Time (Selesai)
                      </label>
                      <input
                        type="time"
                        value={formData.endTime}
                        onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Meeting Location
                      </label>
                      <input
                        type="text"
                        value={formData.meetingLocation}
                        onChange={(e) =>
                          setFormData({ ...formData, meetingLocation: e.target.value })
                        }
                        placeholder="Lokasi rapat..."
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Meeting Room / Platform
                      </label>
                      <input
                        type="text"
                        list="platform-presets-list"
                        value={formData.meetingRoomPlatform}
                        onChange={(e) =>
                          setFormData({ ...formData, meetingRoomPlatform: e.target.value })
                        }
                        placeholder="Ruangan / platform..."
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 transition-colors focus:outline-none"
                      />
                      <datalist id="platform-presets-list">
                        {PLATFORM_PRESETS.map((p) => (
                          <option key={p} value={p} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  {/* Participants (Tabel Sederhana Seperti Buat ToR) */}
                  <div className="pt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-stone-700 font-medium">Participants</label>
                      <button
                        type="button"
                        onClick={handleAddParticipant}
                        className="text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline cursor-pointer"
                      >
                        + Baris Peserta
                      </button>
                    </div>

                    <div className="border border-stone-200 rounded overflow-hidden text-xs">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-stone-100/80 text-stone-700 border-b border-stone-200 font-semibold">
                            <th className="py-2 px-2.5 w-10 text-center">No</th>
                            <th className="py-2 px-2.5">Nama Peserta</th>
                            <th className="py-2 px-2.5">Organisasi / Partner</th>
                            <th className="py-2 px-2.5">Peran / Jabatan</th>
                            <th className="py-2 px-2 text-center w-14">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100 text-stone-700">
                          {(formData.participants || []).length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-4 text-center text-stone-400 italic">
                                Belum ada baris peserta. Klik &quot;+ Baris Peserta&quot; di atas.
                              </td>
                            </tr>
                          ) : (
                            (formData.participants || []).map((part, idx) => (
                              <tr key={part.id} className="hover:bg-stone-50/50">
                                <td className="py-1.5 px-2.5 text-center text-stone-400 font-mono text-[11px]">
                                  {idx + 1}
                                </td>
                                <td className="py-1.5 px-2">
                                  <input
                                    type="text"
                                    value={part.name}
                                    onChange={(e) =>
                                      handleUpdateParticipant(part.id, 'name', e.target.value)
                                    }
                                    placeholder="Ketik nama peserta..."
                                    className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none transition-colors"
                                  />
                                </td>
                                <td className="py-1.5 px-2">
                                  <input
                                    type="text"
                                    value={part.organization}
                                    onChange={(e) =>
                                      handleUpdateParticipant(
                                        part.id,
                                        'organization',
                                        e.target.value
                                      )
                                    }
                                    placeholder="Ketik organisasi / partner..."
                                    className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none transition-colors"
                                  />
                                </td>
                                <td className="py-1.5 px-2">
                                  <input
                                    type="text"
                                    value={part.role || ''}
                                    onChange={(e) =>
                                      handleUpdateParticipant(part.id, 'role', e.target.value)
                                    }
                                    placeholder="Ketik peran / jabatan..."
                                    className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none transition-colors"
                                  />
                                </td>
                                <td className="py-1.5 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveParticipant(part.id)}
                                    className="text-stone-400 hover:text-rose-600 text-xs px-1 hover:underline cursor-pointer"
                                  >
                                    Hapus
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>

              {/* ======================================================== */}
              {/* 2. MEETING AGENDA & DISCUSSION (SEDERHANA SEPERTI TOR)   */}
              {/* ======================================================== */}
              <section className="space-y-4">
                <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-stone-900">
                      2. Meeting Agenda &amp; Discussion
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddDiscussion}
                    className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Discussion</span>
                  </button>
                </div>

                {(formData.discussions || []).length === 0 ? (
                  <div className="py-4 border border-dashed border-stone-200 rounded text-center space-y-1.5 bg-stone-50/20 text-xs">
                    <p className="text-stone-500">Belum ada pembahasan rapat.</p>
                    <button
                      type="button"
                      onClick={handleAddDiscussion}
                      className="px-2.5 py-1 text-xs font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 border border-stone-200 rounded transition-colors cursor-pointer"
                    >
                      + Add Discussion
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4 text-xs">
                    {(formData.discussions || []).map((disc, idx) => (
                      <div
                        key={disc.id}
                        className="p-3 bg-stone-50/40 rounded border border-stone-200 space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-stone-700">
                            Pembahasan {idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveDiscussion(disc.id)}
                            className="text-stone-400 hover:text-rose-600 text-xs hover:underline cursor-pointer"
                          >
                            Hapus
                          </button>
                        </div>

                        <div>
                          <label className="block text-stone-700 font-medium mb-1">
                            Discussion Topic
                          </label>
                          <select
                            value={
                              DISCUSSION_TOPIC_OPTIONS.includes(disc.topic)
                                ? disc.topic
                                : disc.topic || DISCUSSION_TOPIC_OPTIONS[0]
                            }
                            onChange={(e) =>
                              handleUpdateDiscussion(disc.id, 'topic', e.target.value)
                            }
                            className="w-full h-8 px-2.5 bg-white hover:bg-stone-50/50 focus:bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 transition-colors focus:outline-none"
                          >
                            {disc.topic && !DISCUSSION_TOPIC_OPTIONS.includes(disc.topic) && (
                              <option value={disc.topic}>{disc.topic}</option>
                            )}
                            {DISCUSSION_TOPIC_OPTIONS.map((topicOpt) => (
                              <option key={topicOpt} value={topicOpt}>
                                {topicOpt}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-stone-700 font-medium mb-1">
                            Description / Summary
                          </label>
                          <textarea
                            rows={2}
                            value={disc.summary}
                            onChange={(e) =>
                              handleUpdateDiscussion(disc.id, 'summary', e.target.value)
                            }
                            placeholder="Ringkasan pembahasan..."
                            className="w-full p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-stone-700 font-medium mb-1">
                            Key Findings
                          </label>
                          <textarea
                            rows={2}
                            value={disc.keyFindings}
                            onChange={(e) =>
                              handleUpdateDiscussion(disc.id, 'keyFindings', e.target.value)
                            }
                            placeholder="Temuan utama..."
                            className="w-full p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-stone-700 font-medium mb-1">
                            Issues / Challenges
                          </label>
                          <textarea
                            rows={2}
                            value={disc.issuesChallenges}
                            onChange={(e) =>
                              handleUpdateDiscussion(disc.id, 'issuesChallenges', e.target.value)
                            }
                            placeholder="Kendala atau tantangan..."
                            className="w-full p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-stone-700 font-medium mb-1">
                            Responses / Clarifications
                          </label>
                          <textarea
                            rows={2}
                            value={disc.responsesClarifications}
                            onChange={(e) =>
                              handleUpdateDiscussion(
                                disc.id,
                                'responsesClarifications',
                                e.target.value
                              )
                            }
                            placeholder="Tanggapan atau klarifikasi..."
                            className="w-full p-2 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ======================================================== */}
              {/* 3. KEY DECISIONS (TABEL 4 KOLOM SEPERTI GAMBAR 1)        */}
              {/* ======================================================== */}
              <section className="space-y-3">
                <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-stone-900">3. Key Decisions</h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddDecision}
                    className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Key Decision</span>
                  </button>
                </div>

                <div className="border border-stone-200 rounded overflow-x-auto text-xs bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-stone-100/80 text-stone-700 border-b border-stone-200 font-semibold">
                        <th className="py-2 px-2.5 w-10 text-center">No</th>
                        <th className="py-2 px-2.5 min-w-[180px]">Decision Statement</th>
                        <th className="py-2 px-2.5 min-w-[170px]">Background / Reason (Opsional)</th>
                        <th className="py-2 px-2.5 min-w-[150px]">Responsible Party</th>
                        <th className="py-2 px-2.5 min-w-[170px]">
                          Related Program / Activity (Opsional)
                        </th>
                        <th className="py-2 px-2 text-center w-14">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 text-stone-700">
                      {(formData.decisions || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-stone-400 italic">
                            Belum ada keputusan rapat. Klik &quot;Add Key Decision&quot; di atas.
                          </td>
                        </tr>
                      ) : (
                        (formData.decisions || []).map((dec, idx) => (
                          <tr key={dec.id} className="hover:bg-stone-50/50">
                            <td className="py-1.5 px-2.5 text-center text-stone-400 font-mono text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={dec.statement}
                                onChange={(e) =>
                                  handleUpdateDecision(dec.id, 'statement', e.target.value)
                                }
                                placeholder="Pernyataan keputusan rapat..."
                                className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={dec.backgroundReason || ''}
                                onChange={(e) =>
                                  handleUpdateDecision(dec.id, 'backgroundReason', e.target.value)
                                }
                                placeholder="Alasan / latar belakang keputusan..."
                                className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={dec.responsibleParty}
                                onChange={(e) =>
                                  handleUpdateDecision(dec.id, 'responsibleParty', e.target.value)
                                }
                                placeholder="Pihak penanggung jawab..."
                                className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <select
                                value={
                                  torStageOptions.includes(dec.relatedProgramActivity || '')
                                    ? dec.relatedProgramActivity || ''
                                    : formData.implementationProject || torStageOptions[0] || ''
                                }
                                onChange={(e) =>
                                  handleUpdateDecision(
                                    dec.id,
                                    'relatedProgramActivity',
                                    e.target.value
                                  )
                                }
                                className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 bg-white rounded text-stone-800 focus:outline-none"
                              >
                                {torStageOptions.map((stage, sIdx) => (
                                  <option key={sIdx} value={stage}>
                                    {stage}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveDecision(dec.id)}
                                className="text-stone-400 hover:text-rose-600 text-xs px-1 hover:underline cursor-pointer"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ======================================================== */}
              {/* 4. ACTION POINTS / FOLLOW-UP (TABEL SEDERHANA TOR)       */}
              {/* ======================================================== */}
              <section className="space-y-3">
                <div className="pb-1 border-b border-stone-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-stone-900">
                      4. Action Points / Follow-up
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddActionPoint}
                    className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Action Point</span>
                  </button>
                </div>

                <div className="border border-stone-200 rounded overflow-x-auto text-xs bg-white">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-stone-100/80 text-stone-700 border-b border-stone-200 font-semibold">
                        <th className="py-2 px-2.5 w-10 text-center">No</th>
                        <th className="py-2 px-2.5 min-w-[200px]">Follow-up Action</th>
                        <th className="py-2 px-2.5 min-w-[160px]">Person in Charge (PIC)</th>
                        <th className="py-2 px-2.5 w-36">Deadline</th>
                        <th className="py-2 px-2.5 w-36">Status</th>
                        <th className="py-2 px-2 text-center w-14">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 text-stone-700">
                      {(formData.actionPoints || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-stone-400 italic">
                            Belum ada tindak lanjut. Klik &quot;Add Action Point&quot; di atas.
                          </td>
                        </tr>
                      ) : (
                        (formData.actionPoints || []).map((ap, idx) => {
                          const effectiveStatus = resolveActionPointStatus(ap);
                          return (
                            <tr key={ap.id} className="hover:bg-stone-50/50">
                              <td className="py-1.5 px-2.5 text-center text-stone-400 font-mono text-[11px]">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="text"
                                  value={ap.action}
                                  onChange={(e) =>
                                    handleUpdateActionPoint(ap.id, 'action', e.target.value)
                                  }
                                  placeholder="Tindakan tindak lanjut..."
                                  className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="text"
                                  value={ap.pic}
                                  onChange={(e) =>
                                    handleUpdateActionPoint(ap.id, 'pic', e.target.value)
                                  }
                                  placeholder="PIC / Organisasi..."
                                  className="w-full h-7 px-2 border border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="date"
                                  value={ap.deadline}
                                  onChange={(e) =>
                                    handleUpdateActionPoint(ap.id, 'deadline', e.target.value)
                                  }
                                  className="w-full h-7 px-2 border border-stone-200 focus:border-stone-400 bg-white rounded text-stone-800 focus:outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <select
                                  value={effectiveStatus}
                                  onChange={(e) =>
                                    handleUpdateActionPoint(
                                      ap.id,
                                      'status',
                                      e.target.value as ActionPointStatus
                                    )
                                  }
                                  className={`w-full h-7 px-2 border border-stone-200 focus:border-stone-400 bg-white rounded text-xs focus:outline-none ${
                                    effectiveStatus === 'Overdue'
                                      ? 'text-rose-700 font-semibold'
                                      : effectiveStatus === 'Completed'
                                      ? 'text-emerald-700 font-semibold'
                                      : 'text-stone-800'
                                  }`}
                                >
                                  <option value="Not Started">Not Started</option>
                                  <option value="In Progress">In Progress</option>
                                  <option value="Completed">Completed</option>
                                  <option value="Overdue">Overdue</option>
                                </select>
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveActionPoint(ap.id)}
                                  className="text-stone-400 hover:text-rose-600 text-xs px-1 hover:underline cursor-pointer"
                                >
                                  Hapus
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ======================================================== */}
              {/* 5. ADDITIONAL NOTES (SEDERHANA SEPERTI TOR)              */}
              {/* ======================================================== */}
              <section className="space-y-4">
                <div className="pb-1 border-b border-stone-200">
                  <h2 className="text-sm font-semibold text-stone-900">5. Additional Notes</h2>
                </div>

                <div className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Catatan Tambahan
                    </label>
                    <textarea
                      rows={3}
                      value={formData.additionalNotes}
                      onChange={(e) =>
                        setFormData({ ...formData, additionalNotes: e.target.value })
                      }
                      placeholder="Catatan tambahan..."
                      className="w-full p-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Agenda Rapat Berikutnya
                    </label>
                    <input
                      type="text"
                      value={formData.nextMeetingAgenda}
                      onChange={(e) =>
                        setFormData({ ...formData, nextMeetingAgenda: e.target.value })
                      }
                      placeholder="Agenda rapat berikutnya..."
                      className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Jadwal Pertemuan Selanjutnya
                    </label>
                    <input
                      type="text"
                      value={formData.nextMeetingSchedule}
                      onChange={(e) =>
                        setFormData({ ...formData, nextMeetingSchedule: e.target.value })
                      }
                      placeholder="Jadwal pertemuan selanjutnya..."
                      className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-stone-700 font-medium mb-1">
                      Informasi atau Dokumen yang Perlu Disiapkan Sebelum Rapat Berikutnya
                    </label>
                    <textarea
                      rows={2}
                      value={formData.preparationDocuments}
                      onChange={(e) =>
                        setFormData({ ...formData, preparationDocuments: e.target.value })
                      }
                      placeholder="Dokumen atau persiapan untuk rapat berikutnya..."
                      className="w-full p-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                    />
                  </div>

                  {/* Perwakilan Partner (Nama Institusi, Nama, dan Jabatan — Tanda Tangan Manual) */}
                  <div className="pt-2 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Nama Institusi Perwakilan Partner
                      </label>
                      <input
                        type="text"
                        value={formData.partnerInstitution ?? formData.partnerOrganization ?? ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            partnerInstitution: e.target.value,
                            partnerOrganization: e.target.value,
                          })
                        }
                        placeholder="Contoh: POKMAIR / Pemerintah Desa Sukamaju"
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Nama Perwakilan Partner
                      </label>
                      <input
                        type="text"
                        value={formData.partnerRepName || ''}
                        onChange={(e) =>
                          setFormData({ ...formData, partnerRepName: e.target.value })
                        }
                        placeholder="Contoh: H. Asep Sunandar"
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-700 font-medium mb-1">
                        Jabatan Perwakilan Partner
                      </label>
                      <input
                        type="text"
                        value={formData.partnerRepTitle || ''}
                        onChange={(e) =>
                          setFormData({ ...formData, partnerRepTitle: e.target.value })
                        }
                        placeholder="Contoh: Ketua POKMAIR / Kepala Desa"
                        className="w-full h-8 px-2.5 bg-white border border-stone-200 focus:border-stone-400 rounded text-stone-800 placeholder:text-stone-300 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Footer Actions */}
              <div className="pt-4 border-t border-stone-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSubView('list')}
                  className="px-3.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 border border-stone-200 rounded transition-colors cursor-pointer"
                >
                  ← Kembali ke Daftar Notulen
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubView('preview')}
                    className="px-3.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 border border-stone-200 rounded transition-colors cursor-pointer"
                  >
                    Preview Dokumen
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveMinutes}
                    disabled={saving}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 rounded transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? 'Menyimpan...' : 'Simpan Notulen'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* VIEW 3: PREVIEW & CETAK DOKUMEN RESMI                              */}
      {/* ================================================================== */}
      {subView === 'preview' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-stone-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <button
              type="button"
              onClick={() => setSubView('list')}
              className="px-3 py-1.5 rounded border border-stone-200 hover:bg-stone-100 text-xs font-medium text-stone-700 cursor-pointer"
            >
              ← Kembali ke Daftar Notulen
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSubView('editor')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-medium cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Notulen</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportDocx(formData)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-medium cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export DOCX</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadElementAsPdf({
                    filename: `${formData.documentNumber || 'Notulen_Rapat'}_${formData.title || tor.title}`,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium cursor-pointer"
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
            <div className="text-center font-bold uppercase tracking-wide text-black text-[15px]">
              NOTULEN RAPAT / MEETING MINUTES
            </div>

            {/* 1. Meeting Information */}
            <section>
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
                    {(formData.participants || []).filter((p) => (p?.name || '').trim()).length > 0 ? (
                      (formData.participants || [])
                        .filter((p) => (p?.name || '').trim())
                        .map((p, i) => (
                          <tr key={p.id || i}>
                            <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                            <td className="border border-black px-2.5 py-1">{p.name || '—'}</td>
                            <td className="border border-black px-2.5 py-1">
                              {p.organization || '—'}
                            </td>
                            <td className="border border-black px-2.5 py-1">{p.role || '—'}</td>
                          </tr>
                        ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="border border-black px-2.5 py-2 text-center">
                          —
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 2. Meeting Agenda & Discussion */}
            <section>
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
            </section>

            {/* 3. Key Decisions */}
            <section>
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
            </section>

            {/* 4. Action Points / Follow-up */}
            <section>
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
            </section>

            {/* 5. Additional Notes */}
            <section>
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
            </section>

            {/* GAMBAR 1 & GAMBAR 2: PENGESAHAN NOTULEN (Tanpa label RACI, langsung Nama & Jabatan + Perwakilan Partner dengan ruang tanda tangan kosong) */}
            {(() => {
              const responsibleName =
                formData.recorderName || tor.picName || tor.createdByName || 'Budi Santoso';
              const responsibleRoleTitle = 'Project Officer / Pelaksana Kegiatan';
              const accountableA1Name = 'Dimas Pratama, M.Sc.';
              const accountableA1RoleTitle = 'Program Manager';
              const externalParticipant = (formData.participants || []).find(
                (p) => p.organization && !/wijna/i.test(p.organization)
              );
              const resolvedPartnerInstitution =
                formData.partnerInstitution ||
                formData.partnerOrganization ||
                externalParticipant?.organization ||
                'POKMAIR / Mitra Desa Sasaran';
              const resolvedPartnerName =
                formData.partnerRepName ||
                externalParticipant?.name ||
                'H. Asep Sunandar';
              const resolvedPartnerTitle =
                formData.partnerRepTitle ||
                externalParticipant?.role ||
                'Ketua POKMAIR';
              const signDateStr = formData.meetingDate || tor.startDate || getTodayIso();

              return (
                <section className="pt-2">
                  <div
                    className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
                    style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                  >
                    6. Pengesahan Notulen
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 border border-black text-[13px] text-black divide-y sm:divide-y-0 sm:divide-x divide-black">
                    {/* Kolom 1: Disusun Oleh (Stempel Otomatis — Tanpa RACI, langsung Nama & Jabatan) */}
                    <div className="p-3 flex flex-col items-center justify-between text-center min-h-[165px]">
                      <div className="font-bold">Disusun Oleh,</div>
                      <div className="my-2 flex items-center justify-center">
                        <ApprovalBarcodeStamp
                          compact
                          variant="authorized"
                          documentNumber={formData.documentNumber || tor.torNumber}
                          roleCode="PIC"
                          signerName={responsibleName}
                          signDate={signDateStr}
                          statusLabel="DISUSUN OLEH"
                        />
                      </div>
                      <div>
                        <div className="font-bold underline">{responsibleName}</div>
                        <div className="text-[11.5px] text-stone-700">
                          {responsibleRoleTitle}
                        </div>
                      </div>
                    </div>

                    {/* Kolom 2: Diketahui Oleh (Stempel Otomatis — Tanpa RACI, langsung Nama & Jabatan) */}
                    <div className="p-3 flex flex-col items-center justify-between text-center min-h-[165px]">
                      <div className="font-bold">Diketahui Oleh,</div>
                      <div className="my-2 flex items-center justify-center">
                        <ApprovalBarcodeStamp
                          compact
                          variant="authorized"
                          documentNumber={formData.documentNumber || tor.torNumber}
                          roleCode="PM"
                          signerName={accountableA1Name}
                          signDate={signDateStr}
                          statusLabel="DIKETAHUI OLEH"
                        />
                      </div>
                      <div>
                        <div className="font-bold underline">{accountableA1Name}</div>
                        <div className="text-[11.5px] text-stone-700">
                          {accountableA1RoleTitle}
                        </div>
                      </div>
                    </div>

                    {/* Kolom 3: Perwakilan Partner (Nama Institusi, Ruang Kosong Tanda Tangan, Nama, Jabatan) */}
                    <div className="p-3 flex flex-col justify-between text-left min-h-[165px]">
                      <div>
                        <div className="font-bold text-center">Perwakilan Partner</div>
                        <div className="mt-1 text-[12px]">
                          <span className="font-bold">Nama Institusi :</span>{' '}
                          <span>{resolvedPartnerInstitution}</span>
                        </div>
                      </div>

                      {/* Ruang kosong tanda tangan basah manual */}
                      <div className="my-2 h-[64px] w-full" />

                      <div className="space-y-0.5 text-[12px]">
                        <div>
                          <span className="font-bold">Nama :</span>{' '}
                          <span className="font-bold underline">{resolvedPartnerName}</span>
                        </div>
                        <div>
                          <span className="font-bold">Jabatan :</span>{' '}
                          <span>{resolvedPartnerTitle}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              );
            })()}
          </article>
        </div>
      )}
    </div>
  );
};
