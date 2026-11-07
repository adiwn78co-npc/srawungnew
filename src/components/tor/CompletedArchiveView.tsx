import React, { useState, useMemo } from 'react';
import { Outcome, Output, Activity, Tor, TorDocument, User } from '../../types/index.js';
import { checkTorCompletion, WORKFLOW_STAGES } from '../../lib/workflowStages.js';
import { formatIndonesianDate, formatPeriodRange } from '../../lib/dateUtils.js';
import { DocumentWorkflowStages } from './DocumentWorkflowStages.js';
import { DocumentStageModal } from './DocumentStageModal.js';
import {
  ChevronDown,
  ChevronRight,
  Search,
  CheckCircle2,
  FileText,
  ArrowRight,
  Filter,
  RotateCcw,
  Calendar,
  Lock,
  Layers,
  Check,
} from 'lucide-react';

interface CompletedArchiveViewProps {
  outcomes: Outcome[];
  outputs: Output[];
  activities: Activity[];
  tors: Tor[];
  documents: TorDocument[];
  currentUser: User | null;
  onSelectTor: (torId: string) => void;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  onDocumentUpdated?: (updatedDoc: TorDocument) => void;
}

export const CompletedArchiveView: React.FC<CompletedArchiveViewProps> = ({
  outcomes,
  outputs,
  activities,
  tors,
  documents,
  currentUser,
  onSelectTor,
  searchTerm,
  setSearchTerm,
  onDocumentUpdated,
}) => {
  // Archive Filters
  const [filterOutcomeId, setFilterOutcomeId] = useState<string>('all');
  const [filterOutputId, setFilterOutputId] = useState<string>('all');
  const [filterPic, setFilterPic] = useState<string>('all');
  const [filterYear, setFilterYear] = useState<string>('all');

  // Hierarchy expand states (default compact)
  const [expandedOutcomeIds, setExpandedOutcomeIds] = useState<Set<string>>(new Set());
  const [expandedOutputIds, setExpandedOutputIds] = useState<Set<string>>(new Set());

  // Single active TOR accordion at a time
  const [expandedTorId, setExpandedTorId] = useState<string | null>(null);

  // Modal for viewing/editing stage document
  const [activeStageModal, setActiveStageModal] = useState<{
    doc: TorDocument;
    tor: Tor;
  } | null>(null);

  // Filter only TORs that meet the organization's strict completion criteria
  const completedTors = useMemo(() => {
    return tors.filter((t) => {
      const comp = checkTorCompletion(t, documents);
      return comp.isFullyCompleted;
    });
  }, [tors, documents]);

  // Available unique PICs in archive
  const archivePics = useMemo(() => {
    return Array.from(new Set(completedTors.map((t) => t.picName))).filter(Boolean);
  }, [completedTors]);

  // Available completion years
  const archiveYears = useMemo(() => {
    const years = new Set<string>();
    completedTors.forEach((t) => {
      const date = t.completionDate || t.updatedAt;
      if (date && date.length >= 4) {
        years.add(date.slice(0, 4));
      }
    });
    return Array.from(years).sort().reverse();
  }, [completedTors]);

  // Available outputs filtered by selected outcome
  const availableOutputs = useMemo(() => {
    if (filterOutcomeId === 'all') return outputs;
    return outputs.filter((op) => op.outcomeId === filterOutcomeId);
  }, [outputs, filterOutcomeId]);

  // Filtered TORs matching search & dropdown criteria
  const filteredCompletedTors = useMemo(() => {
    return completedTors.filter((t) => {
      // Search
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const match =
          t.title.toLowerCase().includes(q) ||
          t.torNumber.toLowerCase().includes(q) ||
          t.picName.toLowerCase().includes(q) ||
          t.activityName.toLowerCase().includes(q) ||
          t.outputName.toLowerCase().includes(q) ||
          t.outcomeName.toLowerCase().includes(q);
        if (!match) return false;
      }

      // Filter Outcome
      if (filterOutcomeId !== 'all' && t.outcomeId !== filterOutcomeId) return false;

      // Filter Output
      if (filterOutputId !== 'all' && t.outputId !== filterOutputId) return false;

      // Filter PIC
      if (filterPic !== 'all' && t.picName !== filterPic) return false;

      // Filter Year
      if (filterYear !== 'all') {
        const date = t.completionDate || t.updatedAt;
        if (!date || !date.startsWith(filterYear)) return false;
      }

      return true;
    });
  }, [completedTors, searchTerm, filterOutcomeId, filterOutputId, filterPic, filterYear]);

  // Build the hierarchical tree: Outcome -> Output -> TORs
  // Preserving original organizational program ordering
  const hierarchyTree = useMemo(() => {
    const outcomeMap = new Map<
      string,
      {
        outcome: Outcome;
        outputs: Map<string, { output: Output; tors: Tor[] }>;
      }
    >();

    // Sort completed TORs within each output by completion date newest first
    const sortedTors = [...filteredCompletedTors].sort((a, b) => {
      const dateA = a.completionDate || a.updatedAt;
      const dateB = b.completionDate || b.updatedAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    sortedTors.forEach((tor) => {
      let ocData = outcomeMap.get(tor.outcomeId);
      if (!ocData) {
        const oc: Outcome = outcomes.find((o) => o.id === tor.outcomeId) || {
          id: tor.outcomeId,
          programId: tor.programId || '',
          name: tor.outcomeName,
          description: '',
          picId: '',
          picName: '',
          projectName: '',
          status: 'Selesai',
          indicators: [],
          createdAt: '',
        };
        ocData = { outcome: oc, outputs: new Map() };
        outcomeMap.set(tor.outcomeId, ocData);
      }

      let opData = ocData!.outputs.get(tor.outputId);
      if (!opData) {
        const op: Output = outputs.find((o) => o.id === tor.outputId) || {
          id: tor.outputId,
          outcomeId: tor.outcomeId,
          name: tor.outputName,
          description: '',
          picId: '',
          picName: '',
          status: 'Selesai',
          indicators: [],
          createdAt: '',
        };
        opData = { output: op, tors: [] };
        ocData!.outputs.set(tor.outputId, opData);
      }

      opData.tors.push(tor);
    });

    return Array.from(outcomeMap.values()).map((oc) => ({
      outcome: oc.outcome,
      outputs: Array.from(oc.outputs.values()),
    }));
  }, [filteredCompletedTors, outcomes, outputs]);

  // Toggle Handlers
  const toggleOutcome = (outcomeId: string) => {
    setExpandedOutcomeIds((prev) => {
      const next = new Set(prev);
      if (next.has(outcomeId)) {
        next.delete(outcomeId);
      } else {
        next.add(outcomeId);
      }
      return next;
    });
  };

  const toggleOutput = (outputId: string) => {
    setExpandedOutputIds((prev) => {
      const next = new Set(prev);
      if (next.has(outputId)) {
        next.delete(outputId);
      } else {
        next.add(outputId);
      }
      return next;
    });
  };

  const toggleTorAccordion = (torId: string) => {
    setExpandedTorId((prev) => (prev === torId ? null : torId));
  };

  const expandAll = () => {
    const allOc = new Set(hierarchyTree.map((h) => h.outcome.id));
    const allOp = new Set<string>();
    hierarchyTree.forEach((h) => h.outputs.forEach((op) => allOp.add(op.output.id)));
    setExpandedOutcomeIds(allOc);
    setExpandedOutputIds(allOp);
  };

  const collapseAll = () => {
    setExpandedOutcomeIds(new Set());
    setExpandedOutputIds(new Set());
    setExpandedTorId(null);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setFilterOutcomeId('all');
    setFilterOutputId('all');
    setFilterPic('all');
    setFilterYear('all');
  };

  // Open Document Modal when clicking stage in accordion
  const handleOpenStage = (tor: Tor, stageNumber: number, existingDoc?: TorDocument) => {
    if (existingDoc) {
      setActiveStageModal({ doc: existingDoc, tor });
      return;
    }

    // If doc record not yet created in state, create synthetic viewer doc
    const stageMeta = WORKFLOW_STAGES.find((s) => s.stageNumber === stageNumber);
    const syntheticDoc: TorDocument = {
      id: `doc-${tor.id}-${stageNumber}`,
      torId: tor.id,
      stageNumber: (stageNumber as any) || 1,
      stageKey: stageMeta?.stageKey || 'tor',
      stageTitle: stageMeta?.title || `Tahap ${stageNumber}`,
      title: `${stageMeta?.title || 'Dokumen'} - ${tor.title}`,
      summary: stageMeta?.desc || '',
      content: `Dokumen tahapan ${stageMeta?.title} untuk nomor dokumen ${tor.torNumber}. Telah terverifikasi dalam arsip penyelesaian program.`,
      status: 'Selesai',
      authorId: tor.createdById,
      authorName: tor.createdByName,
      authorRole: tor.createdByRole,
      approverName: 'Dr. Hendra Wijaya',
      approverRole: 'director',
      approvalDate: tor.completionDate || tor.updatedAt,
      createdAt: tor.createdAt,
      updatedAt: tor.completionDate || tor.updatedAt,
    };

    setActiveStageModal({ doc: syntheticDoc, tor });
  };

  return (
    <div className="space-y-5">
      {/* ============================================================== */}
      {/* ARSIP CONTROLS: SEARCH & FILTERS                                */}
      {/* ============================================================== */}
      <section className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#8C8C89] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari nama TOR dalam arsip selesai..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-[14px] bg-white border border-[#E5E5E3] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] focus:border-[#1D4ED8] transition-all text-[#171717] placeholder:text-[#8C8C89]"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Outcome Filter */}
            <select
              value={filterOutcomeId}
              onChange={(e) => {
                setFilterOutcomeId(e.target.value);
                setFilterOutputId('all');
              }}
              className="px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E5E3] rounded-md text-[#404040] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] cursor-pointer"
            >
              <option value="all">Semua Outcome</option>
              {outcomes.map((oc) => (
                <option key={oc.id} value={oc.id}>
                  {oc.name.length > 32 ? `${oc.name.slice(0, 32)}...` : oc.name}
                </option>
              ))}
            </select>

            {/* Output Filter */}
            <select
              value={filterOutputId}
              onChange={(e) => setFilterOutputId(e.target.value)}
              className="px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E5E3] rounded-md text-[#404040] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] cursor-pointer"
            >
              <option value="all">Semua Output</option>
              {availableOutputs.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.name.length > 32 ? `${op.name.slice(0, 32)}...` : op.name}
                </option>
              ))}
            </select>

            {/* PIC Filter */}
            <select
              value={filterPic}
              onChange={(e) => setFilterPic(e.target.value)}
              className="px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E5E3] rounded-md text-[#404040] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] cursor-pointer"
            >
              <option value="all">Semua PIC</option>
              {archivePics.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {/* Year Filter */}
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E5E3] rounded-md text-[#404040] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] cursor-pointer"
            >
              <option value="all">Semua Tahun</option>
              {archiveYears.map((yr) => (
                <option key={yr} value={yr}>
                  Tahun {yr}
                </option>
              ))}
            </select>

            {(searchTerm || filterOutcomeId !== 'all' || filterOutputId !== 'all' || filterPic !== 'all' || filterYear !== 'all') && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-2.5 py-1.5 text-[12px] text-[#737373] hover:text-[#171717] bg-white border border-[#E5E5E3] rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                title="Reset seluruh filter"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Quiet Subheader: Hierarchy Count & Expand/Collapse Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F0F0EE] text-[12.5px] text-[#737373]">
          <div className="flex items-center gap-2">
            <span>
              Menampilkan <strong className="text-[#171717] font-semibold">{filteredCompletedTors.length}</strong> TOR Selesai dalam{' '}
              <strong className="text-[#171717] font-semibold">{hierarchyTree.length}</strong> Outcome
            </span>
            <span className="text-[#D4D4D0]">·</span>
            <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Memenuhi seluruh 8 tahapan rantai program</span>
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={expandAll}
              className="text-[#1D4ED8] hover:underline cursor-pointer"
            >
              Buka Semua
            </button>
            <span className="text-[#D4D4D0]">|</span>
            <button
              type="button"
              onClick={collapseAll}
              className="text-[#737373] hover:text-[#171717] cursor-pointer"
            >
              Tutup Semua
            </button>
          </div>
        </div>
      </section>

      {/* ============================================================== */}
      {/* HIERARCHICAL ARSIP LIST (OUTCOME -> OUTPUT -> TOR SELESAI)      */}
      {/* ============================================================== */}
      {hierarchyTree.length === 0 ? (
        <div className="bg-white rounded border border-[#E5E5E3] p-12 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#171717]">
              Tidak Ada Dokumen TOR Selesai yang Sesuai
            </h3>
            <p className="text-xs text-[#737373] max-w-md mx-auto mt-1 leading-relaxed">
              {searchTerm || filterOutcomeId !== 'all' || filterOutputId !== 'all' || filterPic !== 'all' || filterYear !== 'all'
                ? 'Tidak ada arsip TOR selesai yang cocok dengan filter atau kata kunci pencarian.'
                : 'Belum ada TOR yang telah memenuhi seluruh kewajiban penyelesaian kegiatan dan rantai 8 dokumen.'}
            </p>
          </div>
          {(searchTerm || filterOutcomeId !== 'all' || filterOutputId !== 'all' || filterPic !== 'all' || filterYear !== 'all') && (
            <button
              type="button"
              onClick={resetFilters}
              className="px-3.5 py-1.5 text-xs text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors cursor-pointer"
            >
              Hapus Semua Filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {hierarchyTree.map(({ outcome, outputs: outcomeOutputs }) => {
            const isOcExpanded = expandedOutcomeIds.has(outcome.id);
            const totalTorsInOutcome = outcomeOutputs.reduce((acc, op) => acc + op.tors.length, 0);

            return (
              <div
                key={outcome.id}
                className="bg-white rounded border border-[#EAEAEA] overflow-hidden"
              >
                {/* 1. OUTCOME ROW (Level 1 Hierarchy) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleOutcome(outcome.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleOutcome(outcome.id);
                    }
                  }}
                  className="px-4 py-3 bg-[#FAF9F6] hover:bg-[#F5F4F0] transition-colors border-b border-[#F0F0EE] flex items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="p-0.5 text-[#737373]">
                      {isOcExpanded ? (
                        <ChevronDown className="w-4 h-4 text-[#1D4ED8]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[#737373]" />
                      )}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#EDECE8] text-[#525252] uppercase tracking-wider shrink-0">
                      Outcome
                    </span>
                    <h2 className="text-[14px] font-bold text-[#171717] truncate leading-tight">
                      {outcome.name}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-xs text-[#737373]">
                    <span className="font-medium text-[#171717]">{totalTorsInOutcome}</span>
                    <span>TOR Selesai</span>
                  </div>
                </div>

                {/* OUTCOME BODY (Outputs list) */}
                {isOcExpanded && (
                  <div className="divide-y divide-[#F0F0EE] bg-white">
                    {outcomeOutputs.map(({ output, tors: opTors }) => {
                      const isOpExpanded = expandedOutputIds.has(output.id);

                      return (
                        <div key={output.id} className="pl-4 md:pl-6 bg-white">
                          {/* 2. OUTPUT ROW (Level 2 Hierarchy) */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleOutput(output.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleOutput(output.id);
                              }
                            }}
                            className="px-3.5 py-2.5 hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-3 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="p-0.5 text-[#737373]">
                                {isOpExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 text-[#1D4ED8]" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 text-[#737373]" />
                                )}
                              </span>
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 uppercase tracking-wide shrink-0">
                                Output
                              </span>
                              <h3 className="text-[13px] font-semibold text-[#262626] truncate">
                                {output.name}
                              </h3>
                            </div>

                            <div className="text-xs text-[#737373] shrink-0">
                              <span className="font-semibold text-[#171717]">{opTors.length}</span>{' '}
                              <span>dokumen</span>
                            </div>
                          </div>

                          {/* 3. TORS LIST IN OUTPUT (Level 3 Hierarchy) */}
                          {isOpExpanded && (
                            <div className="pl-6 md:pl-8 pr-3 pb-3 pt-1 space-y-2 border-l border-[#F0F0EE] ml-4 md:ml-6 mb-2">
                              {opTors.map((tor) => {
                                const isTorOpen = expandedTorId === tor.id;
                                const torDocs = documents.filter((d) => d.torId === tor.id);
                                const compStatus = checkTorCompletion(tor, documents);

                                return (
                                  <div
                                    key={tor.id}
                                    className="rounded border border-[#E5E5E3] bg-white transition-all overflow-hidden"
                                  >
                                    {/* Accordion Closed Row (Semi-Notion minimalist document row) */}
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => toggleTorAccordion(tor.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          toggleTorAccordion(tor.id);
                                        }
                                      }}
                                      className={`px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer select-none transition-colors ${
                                        isTorOpen
                                          ? 'bg-[#FAF9F6]'
                                          : 'hover:bg-slate-50/70'
                                      }`}
                                    >
                                      {/* Left: Indicator, Title, TOR Number */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          {/* Static Green Indicator for completed document (No distracting pulse) */}
                                          <span
                                            className="w-2 h-2 rounded-full bg-emerald-600 shrink-0"
                                            title="TOR dan seluruh rantai laporan telah selesai"
                                          />

                                          <span className="text-[14px] font-semibold text-[#171717] hover:text-[#1D4ED8] transition-colors truncate">
                                            {tor.title}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-2 text-xs text-[#737373] mt-1 pl-4">
                                          <span className="font-mono text-[#525252]">
                                            {tor.torNumber}
                                          </span>
                                          <span className="text-[#D4D4D0]">·</span>
                                          <span>PIC: {tor.picName}</span>
                                          <span className="text-[#D4D4D0]">·</span>
                                          <span className="text-emerald-700 font-medium">
                                            Selesai {formatIndonesianDate(compStatus.completionDate)}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Right: Date, 8 Stages Badge, Chevron */}
                                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                                        <div className="text-right leading-tight hidden md:block">
                                          <span className="text-[11px] text-[#737373] block">
                                            Tanggal Selesai
                                          </span>
                                          <span className="text-[12px] font-semibold text-[#171717]">
                                            {formatIndonesianDate(compStatus.completionDate)}
                                          </span>
                                        </div>

                                        <span className="text-[10px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shrink-0">
                                          8/8 Tahapan Selesai
                                        </span>

                                        <div className="p-1 text-[#737373]">
                                          <ChevronDown
                                            className={`w-4 h-4 transition-transform duration-200 ${
                                              isTorOpen ? 'rotate-180 text-[#1D4ED8]' : ''
                                            }`}
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {/* Accordion Opened Content: Single inline detail area with soft grey background */}
                                    {isTorOpen && (
                                      <div className="p-4 bg-[#FAF9F6] border-t border-[#F0F0EE] space-y-4 text-xs">
                                        {/* Metadata Details Grid */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-white p-3 rounded border border-[#EDECE8]">
                                          <div>
                                            <span className="text-[#737373] text-[11px] block">
                                              Penanggung Jawab (PIC):
                                            </span>
                                            <span className="font-semibold text-[#171717]">
                                              {tor.picName}
                                            </span>
                                            {tor.implementingTeam && tor.implementingTeam.length > 0 && (
                                              <span className="text-[#737373] text-[10.5px] block truncate">
                                                Tim: {tor.implementingTeam.join(', ')}
                                              </span>
                                            )}
                                          </div>

                                          <div>
                                            <span className="text-[#737373] text-[11px] block">
                                              Kegiatan (Activity):
                                            </span>
                                            <span className="font-medium text-[#171717] line-clamp-1">
                                              {tor.activityName}
                                            </span>
                                            <span className="text-[#737373] text-[10.5px] block">
                                              {formatPeriodRange(tor.startDate, tor.endDate)}
                                            </span>
                                          </div>

                                          <div>
                                            <span className="text-[#737373] text-[11px] block">
                                              Status Akhir Pelaksanaan:
                                            </span>
                                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                              <span>{tor.activityStatus} (100% Tercapai)</span>
                                            </span>
                                            <span className="text-[#737373] text-[10.5px] block">
                                              Persetujuan: {tor.submissionStatus}
                                            </span>
                                          </div>

                                          <div>
                                            <span className="text-[#737373] text-[11px] block">
                                              Penyelesaian Laporan:
                                            </span>
                                            <span className="font-semibold text-emerald-800">
                                              Lengkap & Terverifikasi
                                            </span>
                                            <span className="text-[#737373] text-[10.5px] block">
                                              {formatIndonesianDate(compStatus.completionDate)}
                                            </span>
                                          </div>
                                        </div>

                                        {/* Interactive 8 Stages Workflow Navigation */}
                                        <div className="bg-white p-3.5 rounded border border-[#EDECE8]">
                                          <DocumentWorkflowStages
                                            tor={tor}
                                            documents={torDocs}
                                            onSelectStage={(sNum, d) => handleOpenStage(tor, sNum, d)}
                                            compact={true}
                                          />
                                        </div>

                                        {/* Bottom Action Row: Audit statement & "Buka TOR" Button */}
                                        <div className="pt-2 border-t border-[#EDECE8] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                          <div className="text-[11px] text-[#737373] flex items-center gap-1.5">
                                            <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span>
                                              Dokumen pada arsip ini tersimpan bersama untuk audit, evaluasi program, dan pelaporan donor.
                                            </span>
                                          </div>

                                          <button
                                            type="button"
                                            onClick={() => onSelectTor(tor.id)}
                                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold rounded transition-colors shadow-2xs shrink-0 cursor-pointer"
                                          >
                                            <span>Buka TOR Lengkap</span>
                                            <ArrowRight className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Shared Document Viewer / Modal */}
      {activeStageModal && (
        <DocumentStageModal
          document={activeStageModal.doc}
          tor={activeStageModal.tor}
          currentUser={currentUser}
          onClose={() => setActiveStageModal(null)}
          onDocumentUpdated={(updatedDoc) => {
            setActiveStageModal({ doc: updatedDoc, tor: activeStageModal.tor });
            if (onDocumentUpdated) onDocumentUpdated(updatedDoc);
          }}
        />
      )}
    </div>
  );
};
