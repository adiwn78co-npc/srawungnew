import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  UserCheck,
  Building2,
  Search,
  Link2,
  X,
  CheckCircle2,
  FolderGit2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Layers,
  Activity as ActivityIcon,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Program,
  Outcome,
  Output,
  Activity,
  MasterParticipantRecord,
  MonitoringReportItem,
} from '../../types/index.js';

export interface AgeGenderCell {
  lakiLaki: number;
  perempuan: number;
  total: number;
}

export interface CombinedDemographicsSummary {
  totalUniqueRecords: number;
  totalIndividuals: number;
  totalGroups: number;
  totalGroupMembers: number;
  totalPeopleCount: number; // Total Jiwa
  totalLakiLaki: number;
  totalPerempuan: number;
  ageGender: {
    anak: AgeGenderCell;
    remaja: AgeGenderCell;
    pemuda: AgeGenderCell;
    dewasa: AgeGenderCell;
    lansia: AgeGenderCell;
  };
  lainnyaWithoutAge: number; // Lainnya tidak punya umur
}

export interface OutcomeAccumulationEntry {
  participant: MasterParticipantRecord;
  activities: { id: string; code: string; name: string }[];
  sourceNote: string;
}

export interface ActivityAccumulationSummary {
  activity: Activity;
  outputName: string;
  entries: OutcomeAccumulationEntry[];
  demographics: CombinedDemographicsSummary;
}

export interface OutcomeAccumulationSummary {
  outcome: Outcome;
  uniqueEntries: OutcomeAccumulationEntry[];
  activityBreakdowns: ActivityAccumulationSummary[];
  demographics: CombinedDemographicsSummary;
}

export function summarizeCombinedDemographics(
  entries: OutcomeAccumulationEntry[]
): CombinedDemographicsSummary {
  let totalIndividuals = 0;
  let totalGroups = 0;
  let totalGroupMembers = 0;
  let totalLakiLaki = 0;
  let totalPerempuan = 0;
  let lainnyaWithoutAge = 0;

  const ageGender = {
    anak: { lakiLaki: 0, perempuan: 0, total: 0 },
    remaja: { lakiLaki: 0, perempuan: 0, total: 0 },
    pemuda: { lakiLaki: 0, perempuan: 0, total: 0 },
    dewasa: { lakiLaki: 0, perempuan: 0, total: 0 },
    lansia: { lakiLaki: 0, perempuan: 0, total: 0 },
  };

  const addAgeGender = (
    key: 'anak' | 'remaja' | 'pemuda' | 'dewasa' | 'lansia',
    lCount: number,
    pCount: number
  ) => {
    ageGender[key].lakiLaki += lCount;
    ageGender[key].perempuan += pCount;
    ageGender[key].total += lCount + pCount;
    totalLakiLaki += lCount;
    totalPerempuan += pCount;
  };

  for (const item of entries) {
    const p = item.participant;
    if (p.participantType === 'INDIVIDU') {
      totalIndividuals += 1;
      // Lainnya (dan Memilih tidak menjawab) tidak punya umur
      if (p.gender === 'Lainnya' || p.gender === 'Memilih tidak menjawab') {
        lainnyaWithoutAge += 1;
      } else {
        const isL = p.gender === 'Laki-laki' ? 1 : 0;
        const isP = p.gender === 'Perempuan' ? 1 : 0;
        if (p.ageGroup.startsWith('Anak-anak')) addAgeGender('anak', isL, isP);
        else if (p.ageGroup.startsWith('Remaja')) addAgeGender('remaja', isL, isP);
        else if (p.ageGroup.startsWith('Pemuda')) addAgeGender('pemuda', isL, isP);
        else if (p.ageGroup.startsWith('Dewasa')) addAgeGender('dewasa', isL, isP);
        else if (p.ageGroup.startsWith('Lansia')) addAgeGender('lansia', isL, isP);
        else addAgeGender('dewasa', isL, isP);
      }
    } else {
      totalGroups += 1;
      totalGroupMembers += p.totalMembers || 0;
      const comp = p.memberComposition;
      if (comp) {
        const keys: ('anak' | 'remaja' | 'pemuda' | 'dewasa' | 'lansia')[] = [
          'anak',
          'remaja',
          'pemuda',
          'dewasa',
          'lansia',
        ];
        for (const k of keys) {
          const row = comp[k];
          if (!row) continue;
          const lVal = Number(row.lakiLaki) || 0;
          const pVal = Number(row.perempuan) || 0;
          const otherVal =
            (Number(row.lainnya) || 0) + (Number(row.memilihTidakMenjawab) || 0);
          addAgeGender(k, lVal, pVal);
          lainnyaWithoutAge += otherVal;
        }
      }
    }
  }

  return {
    totalUniqueRecords: entries.length,
    totalIndividuals,
    totalGroups,
    totalGroupMembers,
    totalPeopleCount: totalIndividuals + totalGroupMembers,
    totalLakiLaki,
    totalPerempuan,
    ageGender,
    lainnyaWithoutAge,
  };
}

export function computeOutcomeAccumulations(params: {
  program: Program;
  outcomes: Outcome[];
  outputs: Output[];
  activities: Activity[];
  participants: MasterParticipantRecord[];
  monitoringItems: MonitoringReportItem[];
}): {
  perOutcome: OutcomeAccumulationSummary[];
  programUniqueEntries: OutcomeAccumulationEntry[];
  programTotals: CombinedDemographicsSummary;
} {
  const { program, outcomes, outputs, activities, participants, monitoringItems } = params;
  const programOutcomes = outcomes.filter((o) => o.programId === program.id);
  const participantMap = new Map<string, MasterParticipantRecord>();
  participants.forEach((p) => participantMap.set(p.id, p));

  const programWideMap = new Map<
    string,
    {
      participant: MasterParticipantRecord;
      activityMap: Map<string, { id: string; code: string; name: string }>;
      sourceNote: string;
    }
  >();

  const perOutcome: OutcomeAccumulationSummary[] = programOutcomes.map((outcome) => {
    const outcomeOutputs = outputs.filter((op) => op.outcomeId === outcome.id);
    const outputById = new Map<string, Output>();
    outcomeOutputs.forEach((op) => outputById.set(op.id, op));

    const outcomeActivities = activities.filter((act) => outputById.has(act.outputId));
    const activityById = new Map<string, Activity>();
    outcomeActivities.forEach((a) => activityById.set(a.id, a));

    // De-duplicated map at Outcome level keyed by participant.id
    const dedupMap = new Map<
      string,
      {
        participant: MasterParticipantRecord;
        activityMap: Map<string, { id: string; code: string; name: string }>;
        sourceNote: string;
      }
    >();

    // Per-Activity de-duplicated map: activityId -> Map<participantId, OutcomeAccumulationEntry>
    const perActivityMap = new Map<
      string,
      Map<string, { participant: MasterParticipantRecord; sourceNote: string }>
    >();
    outcomeActivities.forEach((act) => {
      perActivityMap.set(act.id, new Map());
    });

    const ensureParticipantEntry = (p: MasterParticipantRecord, note: string) => {
      if (!dedupMap.has(p.id)) {
        dedupMap.set(p.id, {
          participant: p,
          activityMap: new Map(),
          sourceNote: note,
        });
      }
      if (!programWideMap.has(p.id)) {
        programWideMap.set(p.id, {
          participant: p,
          activityMap: new Map(),
          sourceNote: note,
        });
      }
    };

    // 1. Collect from Monitoring Reports (Executive Summary / Tools) under this Outcome
    for (const mItem of monitoringItems) {
      const belongsToOutcome =
        mItem.outcomeId === outcome.id ||
        (mItem.activityId && activityById.has(mItem.activityId));
      if (!belongsToOutcome) continue;

      const pIds = Array.isArray(mItem.involvedParticipantIds) ? mItem.involvedParticipantIds : [];
      for (const pid of pIds) {
        const p = participantMap.get(pid);
        if (!p) continue;
        ensureParticipantEntry(p, 'Executive Summary Activity');
        const actObj = activityById.get(mItem.activityId);
        const actInfo = {
          id: mItem.activityId || mItem.id,
          code: actObj?.code || mItem.torNumber || 'ACT',
          name: actObj?.name || mItem.activityName || 'Aktivitas',
        };
        dedupMap.get(p.id)!.activityMap.set(actInfo.id, actInfo);
        programWideMap.get(p.id)!.activityMap.set(actInfo.id, actInfo);

        if (mItem.activityId && perActivityMap.has(mItem.activityId)) {
          perActivityMap.get(mItem.activityId)!.set(p.id, {
            participant: p,
            sourceNote: `Executive Summary (${mItem.torNumber || actInfo.code})`,
          });
        }
      }
    }

    // 2. Collect from Participant Program Involvements linked to this Outcome / Activity / Program
    for (const p of participants) {
      const inv = (p.programInvolvements || []).find((i) => i.programId === program.id);
      if (!inv) continue;

      const hasExplicitOutcome =
        Array.isArray(inv.outcomeIds) && inv.outcomeIds.includes(outcome.id);
      const matchedActs = Array.isArray(inv.activityIds)
        ? inv.activityIds.filter((aid) => activityById.has(aid))
        : [];
      const hasNoSpecificOutcomeYet =
        (!inv.outcomeIds || inv.outcomeIds.length === 0) &&
        (!inv.activityIds || inv.activityIds.length === 0);

      if (hasExplicitOutcome || matchedActs.length > 0 || hasNoSpecificOutcomeYet) {
        ensureParticipantEntry(
          p,
          matchedActs.length > 0 ? 'Aktivitas Program' : 'Terdaftar di Program'
        );
        for (const aid of matchedActs) {
          const actObj = activityById.get(aid);
          if (actObj) {
            const actInfo = { id: actObj.id, code: actObj.code || 'ACT', name: actObj.name };
            dedupMap.get(p.id)!.activityMap.set(actInfo.id, actInfo);
            programWideMap.get(p.id)!.activityMap.set(actInfo.id, actInfo);
            if (perActivityMap.has(aid) && !perActivityMap.get(aid)!.has(p.id)) {
              perActivityMap.get(aid)!.set(p.id, {
                participant: p,
                sourceNote: 'Terhubung ke Activity',
              });
            }
          }
        }
      }
    }

    const uniqueEntries: OutcomeAccumulationEntry[] = Array.from(dedupMap.values()).map((v) => ({
      participant: v.participant,
      activities: Array.from(v.activityMap.values()),
      sourceNote: v.sourceNote,
    }));

    const activityBreakdowns: ActivityAccumulationSummary[] = outcomeActivities.map((act) => {
      const actParticipantsMap = perActivityMap.get(act.id) || new Map();
      const actEntries: OutcomeAccumulationEntry[] = Array.from(actParticipantsMap.values()).map(
        (v) => ({
          participant: v.participant,
          activities: [{ id: act.id, code: act.code || 'ACT', name: act.name }],
          sourceNote: v.sourceNote,
        })
      );
      return {
        activity: act,
        outputName: outputById.get(act.outputId)?.name || '-',
        entries: actEntries,
        demographics: summarizeCombinedDemographics(actEntries),
      };
    });

    return {
      outcome,
      uniqueEntries,
      activityBreakdowns,
      demographics: summarizeCombinedDemographics(uniqueEntries),
    };
  });

  for (const p of participants) {
    const inv = (p.programInvolvements || []).find((i) => i.programId === program.id);
    if (inv && !programWideMap.has(p.id)) {
      programWideMap.set(p.id, {
        participant: p,
        activityMap: new Map(),
        sourceNote: 'Terdaftar di Program',
      });
    }
  }

  const programUniqueEntries: OutcomeAccumulationEntry[] = Array.from(programWideMap.values()).map(
    (v) => ({
      participant: v.participant,
      activities: Array.from(v.activityMap.values()),
      sourceNote: v.sourceNote,
    })
  );

  return {
    perOutcome,
    programUniqueEntries,
    programTotals: summarizeCombinedDemographics(programUniqueEntries),
  };
}

/**
 * Reusable Table: Menggabungkan Kelompok Usia (Anak, Remaja, Pemuda, Dewasa, Lansia) dengan Laki-laki (L) & Perempuan (P),
 * sedangkan "Lainnya" berdiri sendiri tanpa umur.
 */
const CombinedAgeGenderTable: React.FC<{
  demographics: CombinedDemographicsSummary;
  totalLabel?: string;
}> = ({ demographics, totalLabel = 'Total Akumulasi (Unik)' }) => {
  const { ageGender, lainnyaWithoutAge } = demographics;
  const ageKeys: {
    key: 'anak' | 'remaja' | 'pemuda' | 'dewasa' | 'lansia';
    label: string;
  }[] = [
    { key: 'anak', label: 'Anak (0–12)' },
    { key: 'remaja', label: 'Remaja (13–17)' },
    { key: 'pemuda', label: 'Pemuda (18–30)' },
    { key: 'dewasa', label: 'Dewasa (31–59)' },
    { key: 'lansia', label: 'Lansia (60+)' },
  ];

  return (
    <div className="overflow-x-auto border border-[#E5E5E3] rounded">
      <table className="w-full text-center border-collapse text-[11px]">
        <thead>
          <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[#5F5E5B] font-semibold">
            <th rowSpan={2} className="py-1.5 px-2.5 text-left border-r border-[#E5E5E3]">
              {totalLabel}
            </th>
            {ageKeys.map((ak) => (
              <th
                key={ak.key}
                colSpan={2}
                className="py-1 px-2 border-r border-[#E5E5E3] text-[#171717]"
              >
                {ak.label}{' '}
                <span className="font-mono text-[10px] text-[#787774]">
                  ({ageGender[ak.key].total})
                </span>
              </th>
            ))}
            <th
              rowSpan={2}
              className="py-1.5 px-2.5 bg-stone-100/70 text-[#37352F]"
              title="Jenis kelamin Lainnya tidak memiliki pengelompokan umur"
            >
              <div>Lainnya</div>
              <div className="text-[9.5px] font-normal text-[#787774]">(Tanpa Umur)</div>
            </th>
          </tr>
          <tr className="bg-[#FAFAF9] border-b border-[#E5E5E3] text-[10px] font-bold">
            {ageKeys.map((ak) => (
              <React.Fragment key={`${ak.key}-sub`}>
                <th className="py-1 px-1.5 bg-blue-50/40 text-blue-800 border-r border-[#E5E5E3]">
                  L
                </th>
                <th className="py-1 px-1.5 bg-pink-50/40 text-pink-800 border-r border-[#E5E5E3]">
                  P
                </th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="font-bold text-[#171717] bg-white">
            <td className="py-1.5 px-2.5 text-left border-r border-[#E5E5E3] bg-[#FAFAF9]">
              <div>
                {demographics.totalPeopleCount} Jiwa{' '}
                <span className="font-normal text-[#787774]">
                  ({demographics.totalIndividuals} Ind, {demographics.totalGroups} Klp)
                </span>
              </div>
              <div className="text-[10px] font-normal text-[#5F5E5B]">
                Total L: <strong>{demographics.totalLakiLaki}</strong> · Total P:{' '}
                <strong>{demographics.totalPerempuan}</strong> · Lainnya:{' '}
                <strong>{lainnyaWithoutAge}</strong>
              </div>
            </td>
            {ageKeys.map((ak) => (
              <React.Fragment key={`${ak.key}-val`}>
                <td className="py-1.5 px-1.5 bg-blue-50/20 text-blue-900 border-r border-[#E5E5E3]">
                  {ageGender[ak.key].lakiLaki}
                </td>
                <td className="py-1.5 px-1.5 bg-pink-50/20 text-pink-900 border-r border-[#E5E5E3]">
                  {ageGender[ak.key].perempuan}
                </td>
              </React.Fragment>
            ))}
            <td className="py-1.5 px-2.5 bg-stone-50 text-[#171717]">{lainnyaWithoutAge}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

interface ProgramOutcomeParticipantTracingProps {
  program: Program;
  outcomes: Outcome[];
  outputs: Output[];
  activities: Activity[];
  participants: MasterParticipantRecord[];
  monitoringItems: MonitoringReportItem[];
  onOpenManageModal?: () => void;
}

export const ProgramOutcomeParticipantTracing: React.FC<ProgramOutcomeParticipantTracingProps> = ({
  program,
  outcomes,
  outputs,
  activities,
  participants,
  monitoringItems,
  onOpenManageModal,
}) => {
  const [expandedOutcomeIds, setExpandedOutcomeIds] = useState<Record<string, boolean>>({});
  const [expandedActivityIds, setExpandedActivityIds] = useState<Record<string, boolean>>({});
  const [showOutcomeAllNames, setShowOutcomeAllNames] = useState<Record<string, boolean>>({});
  const [detailSearch, setDetailSearch] = useState<Record<string, string>>({});

  const { perOutcome, programTotals } = useMemo(
    () =>
      computeOutcomeAccumulations({
        program,
        outcomes,
        outputs,
        activities,
        participants,
        monitoringItems,
      }),
    [program, outcomes, outputs, activities, participants, monitoringItems]
  );

  const toggleOutcomeDetail = (outcomeId: string) => {
    setExpandedOutcomeIds((prev) => ({ ...prev, [outcomeId]: !prev[outcomeId] }));
  };

  const toggleActivityDetail = (activityId: string) => {
    setExpandedActivityIds((prev) => ({ ...prev, [activityId]: !prev[activityId] }));
  };

  const toggleOutcomeUniqueNamesList = (outcomeId: string) => {
    setShowOutcomeAllNames((prev) => ({ ...prev, [outcomeId]: !prev[outcomeId] }));
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Ringkasan Akumulasi Program (Umur digabung Laki-laki & Perempuan, Lainnya Tanpa Umur) */}
      <div className="bg-white rounded-md border border-[#E5E5E3] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEFED] pb-2.5">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#1D4ED8]" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#171717]">
                Tracing Peserta &amp; Akumulasi per Outcome (Tanpa Duplikasi Lintas Activity)
              </h3>
            </div>
            <p className="text-[11px] text-[#787774] mt-0.5">
              Laki-laki (L) &amp; Perempuan (P) digabung di dalam masing-masing Kelompok Usia, sedangkan{' '}
              <strong>Lainnya</strong> tidak memiliki kelompok usia. Klik Outcome untuk membuka rincian per <strong>Activity</strong>.
            </p>
          </div>
          {onOpenManageModal && (
            <button
              type="button"
              onClick={onOpenManageModal}
              className="px-3 py-1.5 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Kelola / Hubungkan Peserta Program</span>
            </button>
          )}
        </div>

        {/* Kartu Ringkasan Tingkat Program: Umur (L & P) + Lainnya Tanpa Umur */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <div className="bg-[#F8FAFC] border border-blue-200 rounded p-2.5">
            <div className="text-[10px] font-bold uppercase text-blue-800">
              Total Peserta Unik Program
            </div>
            <div className="text-base font-bold text-[#171717] mt-0.5">
              {programTotals.totalPeopleCount}{' '}
              <span className="text-[11px] font-normal text-[#5F5E5B]">Jiwa</span>
            </div>
            <div className="text-[10px] text-[#5F5E5B] mt-0.5">
              {programTotals.totalIndividuals} Ind · {programTotals.totalGroups} Klp (L:{' '}
              {programTotals.totalLakiLaki} · P: {programTotals.totalPerempuan})
            </div>
          </div>

          {[
            { key: 'anak' as const, label: 'Anak (0–12)' },
            { key: 'remaja' as const, label: 'Remaja (13–17)' },
            { key: 'pemuda' as const, label: 'Pemuda (18–30)' },
            { key: 'dewasa' as const, label: 'Dewasa (31–59)' },
            { key: 'lansia' as const, label: 'Lansia (60+)' },
          ].map((ag) => {
            const cell = programTotals.ageGender[ag.key];
            return (
              <div key={ag.key} className="bg-[#FAFAF9] border border-[#E5E5E3] rounded p-2.5">
                <div className="text-[10.5px] font-semibold text-[#5F5E5B]">{ag.label}</div>
                <div className="text-base font-bold text-[#171717] mt-0.5">{cell.total}</div>
                <div className="flex items-center gap-2 text-[10.5px] mt-0.5">
                  <span className="text-blue-700 font-semibold">L: {cell.lakiLaki}</span>
                  <span className="text-[#D3D3D0]">·</span>
                  <span className="text-pink-700 font-semibold">P: {cell.perempuan}</span>
                </div>
              </div>
            );
          })}

          <div className="bg-stone-50 border border-[#E5E5E3] rounded p-2.5">
            <div className="text-[10.5px] font-semibold text-[#5F5E5B]">Lainnya</div>
            <div className="text-base font-bold text-[#171717] mt-0.5">
              {programTotals.lainnyaWithoutAge}
            </div>
            <div className="text-[10px] text-[#787774] mt-0.5">Tanpa Kelompok Usia</div>
          </div>
        </div>
      </div>

      {/* Daftar Akumulasi Peserta per Outcome -> Jika dibuka tampil Rincian per Activity */}
      {perOutcome.length === 0 ? (
        <div className="bg-white rounded-md border border-[#E5E5E3] p-6 text-center text-[#787774]">
          Belum ada Outcome pada program ini.
        </div>
      ) : (
        <div className="space-y-2.5">
          {perOutcome.map((item, idx) => {
            const isExpanded = Boolean(expandedOutcomeIds[item.outcome.id]);
            const isShowingAllOutcomeNames = Boolean(showOutcomeAllNames[item.outcome.id]);
            const q = (detailSearch[item.outcome.id] || '').trim().toLowerCase();
            const filteredEntries = item.uniqueEntries.filter((e) => {
              if (!q) return true;
              const name =
                e.participant.participantType === 'INDIVIDU'
                  ? e.participant.fullName
                  : e.participant.groupName;
              return (
                name.toLowerCase().includes(q) ||
                e.participant.participantCode.toLowerCase().includes(q) ||
                (e.participant.regionCommunity || '').toLowerCase().includes(q)
              );
            });

            return (
              <div
                key={item.outcome.id}
                className="bg-white rounded-md border border-[#E5E5E3] overflow-hidden"
              >
                {/* Header Outcome + Tabel Gabungan Umur (L/P) & Lainnya */}
                <div className="p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-[#EEF3FF] text-[#1D4ED8] font-mono text-[10.5px] font-bold">
                          OUTCOME {idx + 1}
                        </span>
                        <span className="font-bold text-[#171717] text-[13px]">
                          {item.outcome.name}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200 text-[10.5px] font-medium">
                          {item.activityBreakdowns.length} Activity
                        </span>
                      </div>
                      {item.outcome.description && (
                        <p className="text-[11.5px] text-[#787774] line-clamp-1">
                          {item.outcome.description}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleOutcomeDetail(item.outcome.id)}
                      className={`px-3 py-1.5 rounded border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shrink-0 ${
                        isExpanded
                          ? 'bg-[#171717] text-white border-[#171717]'
                          : 'bg-white hover:bg-[#F7F7F5] text-[#171717] border-[#D9D9D6]'
                      }`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <span>
                        Detail per Activity &amp; Peserta ({item.demographics.totalUniqueRecords} Unik)
                      </span>
                    </button>
                  </div>

                  {/* Tabel Akumulasi Outcome (Umur digabung L & P, Lainnya Tanpa Umur) */}
                  <CombinedAgeGenderTable
                    demographics={item.demographics}
                    totalLabel="Total Akumulasi Outcome (Unik)"
                  />
                </div>

                {/* JIKA OUTCOME DIBUKA: Tampilkan Rincian per Activity + Daftar Nama Unik Outcome */}
                {isExpanded && (
                  <div className="border-t border-[#E5E5E3] bg-[#FAFAF9] p-3.5 space-y-3">
                    {/* 1. Rincian per Activity di bawah Outcome ini */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#171717] uppercase tracking-wide">
                          <ActivityIcon className="w-3.5 h-3.5 text-[#1D4ED8]" />
                          <span>
                            Rincian Peserta per Activity pada Outcome {idx + 1} ({item.activityBreakdowns.length} Activity)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleOutcomeUniqueNamesList(item.outcome.id)}
                          className="px-2.5 py-1 rounded border border-[#D9D9D6] bg-white hover:bg-[#F7F7F5] text-[11px] font-semibold text-[#1D4ED8] cursor-pointer"
                        >
                          {isShowingAllOutcomeNames
                            ? 'Sembunyikan Daftar Gabungan Nama Outcome'
                            : `Lihat Daftar Gabungan Nama Unik Outcome (${item.uniqueEntries.length})`}
                        </button>
                      </div>

                      {item.activityBreakdowns.length === 0 ? (
                        <div className="p-3 bg-white rounded border border-[#E5E5E3] text-[#787774] text-center">
                          Belum ada Activity terdaftar di bawah Outcome ini.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {item.activityBreakdowns.map((actItem) => {
                            const isActExpanded = Boolean(
                              expandedActivityIds[actItem.activity.id]
                            );
                            return (
                              <div
                                key={actItem.activity.id}
                                className="bg-white rounded border border-[#E5E5E3] overflow-hidden"
                              >
                                <div className="p-2.5 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-bold">
                                          ACTIVITY {actItem.activity.code || ''}
                                        </span>
                                        <span className="font-semibold text-[#171717] text-xs">
                                          {actItem.activity.name}
                                        </span>
                                      </div>
                                      <div className="text-[10.5px] text-[#787774] mt-0.5">
                                        Output: {actItem.outputName}
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => toggleActivityDetail(actItem.activity.id)}
                                      className={`px-2.5 py-1 rounded border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                        isActExpanded
                                          ? 'bg-emerald-700 text-white border-emerald-700'
                                          : 'bg-[#FAFAF9] hover:bg-stone-100 text-[#171717] border-[#D9D9D6]'
                                      }`}
                                    >
                                      {isActExpanded ? (
                                        <ChevronDown className="w-3 h-3" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3" />
                                      )}
                                      <span>
                                        Lihat Nama Peserta Activity ({actItem.entries.length})
                                      </span>
                                    </button>
                                  </div>

                                  <CombinedAgeGenderTable
                                    demographics={actItem.demographics}
                                    totalLabel="Total Peserta Activity"
                                  />
                                </div>

                                {/* Detail Daftar Nama Peserta di Activity Ini */}
                                {isActExpanded && (
                                  <div className="border-t border-[#E5E5E3] bg-[#F8FAFC] p-2.5">
                                    {actItem.entries.length === 0 ? (
                                      <div className="p-3 text-center bg-white rounded border border-[#E5E5E3] text-[#787774] text-[11px]">
                                        Belum ada peserta yang dimasukkan pada Activity ini. Silakan isi melalui{' '}
                                        <strong>Executive Summary — Laporan Final 7 Hari (H+7)</strong> pada menu Monitoring ToR.
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto bg-white border border-[#E5E5E3] rounded">
                                        <table className="w-full text-left border-collapse text-[11px]">
                                          <thead>
                                            <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[10px] font-bold uppercase text-[#5F5E5B]">
                                              <th className="py-1.5 px-2 w-8">No</th>
                                              <th className="py-1.5 px-2 w-24">ID</th>
                                              <th className="py-1.5 px-2">Nama Lengkap / Kelompok</th>
                                              <th className="py-1.5 px-2">Jenis</th>
                                              <th className="py-1.5 px-2">
                                                Umur &amp; Jenis Kelamin
                                              </th>
                                              <th className="py-1.5 px-2">Wilayah &amp; Peran</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[#EFEFED]">
                                            {actItem.entries.map((e, eIdx) => {
                                              const p = e.participant;
                                              const isInd = p.participantType === 'INDIVIDU';
                                              const isOtherGender =
                                                isInd &&
                                                (p.gender === 'Lainnya' ||
                                                  p.gender === 'Memilih tidak menjawab');
                                              return (
                                                <tr key={p.id} className="hover:bg-[#FAFAF9]">
                                                  <td className="py-1.5 px-2 text-[#787774]">
                                                    {eIdx + 1}
                                                  </td>
                                                  <td className="py-1.5 px-2 font-mono font-semibold text-[#171717]">
                                                    {p.participantCode}
                                                  </td>
                                                  <td className="py-1.5 px-2 font-semibold text-[#171717]">
                                                    {isInd ? p.fullName : p.groupName}
                                                  </td>
                                                  <td className="py-1.5 px-2">
                                                    {isInd
                                                      ? 'Individu'
                                                      : `Kelompok (${p.totalMembers})`}
                                                  </td>
                                                  <td className="py-1.5 px-2 text-[#37352F]">
                                                    {isInd
                                                      ? isOtherGender
                                                        ? `${p.gender} (Tanpa Umur)`
                                                        : `${p.ageGroup} · ${p.gender}`
                                                      : `Komposisi Kelompok (${p.totalMembers} anggota)`}
                                                  </td>
                                                  <td className="py-1.5 px-2 text-[#37352F]">
                                                    {p.regionCommunity || '-'} —{' '}
                                                    {isInd ? p.communityRole : p.programRole}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 2. Daftar Gabungan Nama Peserta Unik di Outcome Ini (Tidak Terduplikasi Lintas Activity) */}
                    {isShowingAllOutcomeNames && (
                      <div className="pt-2 border-t border-[#E5E5E3] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[11.5px] font-bold text-[#171717]">
                            Daftar Akumulasi Nama Peserta Unik pada Outcome {idx + 1} (Tidak Terduplikasi Lintas Activity)
                          </div>
                          <div className="relative w-full sm:w-64">
                            <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 top-2" />
                            <input
                              type="text"
                              value={detailSearch[item.outcome.id] || ''}
                              onChange={(e) =>
                                setDetailSearch((prev) => ({
                                  ...prev,
                                  [item.outcome.id]: e.target.value,
                                }))
                              }
                              placeholder="Cari nama atau ID peserta..."
                              className="w-full h-7 pl-8 pr-2.5 text-xs bg-white border border-[#D9D9D6] rounded"
                            />
                          </div>
                        </div>

                        {filteredEntries.length === 0 ? (
                          <div className="p-4 text-center bg-white rounded border border-[#E5E5E3] text-[#787774]">
                            Belum ada peserta yang tercatat pada Outcome ini.
                          </div>
                        ) : (
                          <div className="overflow-x-auto bg-white border border-[#E5E5E3] rounded">
                            <table className="w-full text-left border-collapse text-[11.5px]">
                              <thead>
                                <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[10.5px] font-bold uppercase text-[#5F5E5B]">
                                  <th className="py-2 px-2.5 w-9">No</th>
                                  <th className="py-2 px-2.5 w-24">ID</th>
                                  <th className="py-2 px-2.5">Nama Lengkap / Kelompok</th>
                                  <th className="py-2 px-2.5">Jenis</th>
                                  <th className="py-2 px-2.5">Umur &amp; Jenis Kelamin</th>
                                  <th className="py-2 px-2.5">Wilayah &amp; Peran</th>
                                  <th className="py-2 px-2.5">
                                    Activity yang Diikuti (1 Nama Tidak Terduplikasi)
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#EFEFED]">
                                {filteredEntries.map((entry, rIdx) => {
                                  const p = entry.participant;
                                  const isInd = p.participantType === 'INDIVIDU';
                                  const isOtherGender =
                                    isInd &&
                                    (p.gender === 'Lainnya' ||
                                      p.gender === 'Memilih tidak menjawab');
                                  return (
                                    <tr key={p.id} className="hover:bg-[#FAFAF9]">
                                      <td className="py-2 px-2.5 text-[#787774]">{rIdx + 1}</td>
                                      <td className="py-2 px-2.5 font-mono font-semibold text-[#171717]">
                                        {p.participantCode}
                                      </td>
                                      <td className="py-2 px-2.5 font-semibold text-[#171717]">
                                        {isInd ? p.fullName : p.groupName}
                                      </td>
                                      <td className="py-2 px-2.5">
                                        {isInd ? (
                                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10.5px] font-semibold">
                                            Individu
                                          </span>
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10.5px] font-semibold">
                                            Kelompok ({p.totalMembers})
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-2 px-2.5 text-[#37352F]">
                                        {isInd
                                          ? isOtherGender
                                            ? `${p.gender} (Tanpa Umur)`
                                            : `${p.ageGroup} · ${p.gender}`
                                          : `Komposisi (${p.totalMembers} anggota)`}
                                      </td>
                                      <td className="py-2 px-2.5 text-[#37352F]">
                                        <div>{p.regionCommunity || '-'}</div>
                                        <div className="text-[10.5px] text-[#787774]">
                                          {isInd ? p.communityRole : p.programRole}
                                        </div>
                                      </td>
                                      <td className="py-2 px-2.5">
                                        {entry.activities.length > 0 ? (
                                          <div className="flex flex-wrap gap-1">
                                            {entry.activities.map((act) => (
                                              <span
                                                key={act.id}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10.5px] font-medium"
                                              >
                                                <ActivityIcon className="w-2.5 h-2.5" />
                                                <span>
                                                  [{act.code}] {act.name}
                                                </span>
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200 text-[10.5px]">
                                            {entry.sourceNote}
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface ProgramParticipantsModalProps {
  program: Program;
  outcomes?: Outcome[];
  outputs?: Output[];
  activities?: Activity[];
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

export const ProgramParticipantsModal: React.FC<ProgramParticipantsModalProps> = ({
  program,
  outcomes = [],
  outputs = [],
  activities = [],
  isOpen,
  onClose,
  onUpdated,
}) => {
  const [records, setRecords] = useState<MasterParticipantRecord[]>([]);
  const [monitoringItems, setMonitoringItems] = useState<MonitoringReportItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'tracing' | 'linked' | 'picker'>('tracing');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMasterParticipants = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [pRes, mRes] = await Promise.all([
        api.getParticipantDatabase(),
        api.getMonitoringReports().catch(() => ({
          items: [],
          plannedTools: [],
          plannedToolsCount: 0,
          cashAdvanceCount: 0,
        })),
      ]);
      setRecords(pRes.records || []);
      setMonitoringItems(Array.isArray(mRes.items) ? mRes.items : []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memuat Database Peserta.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadMasterParticipants();
      setSelectedIds([]);
      setStatusMessage(null);
    }
  }, [isOpen, program.id, loadMasterParticipants]);

  const linkedParticipants = useMemo(() => {
    return records.filter((r) =>
      (r.programInvolvements || []).some((inv) => inv.programId === program.id)
    );
  }, [records, program.id]);

  const pickerCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return records.filter((r) => {
      if (filterType !== 'ALL' && r.participantType !== filterType) return false;
      if (q) {
        const name =
          r.participantType === 'INDIVIDU'
            ? r.fullName.toLowerCase()
            : r.groupName.toLowerCase();
        const code = r.participantCode.toLowerCase();
        const region = (r.regionCommunity || '').toLowerCase();
        if (!name.includes(q) && !code.includes(q) && !region.includes(q)) return false;
      }
      return true;
    });
  }, [records, searchQuery, filterType]);

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleLinkSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await api.linkParticipantsToProgram(program.id, {
        participantIds: selectedIds,
      });
      setStatusMessage(`${selectedIds.length} peserta berhasil ditambahkan ke program.`);
      setSelectedIds([]);
      await loadMasterParticipants();
      setActiveTab('tracing');
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menghubungkan peserta.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlinkParticipant = async (participantId: string) => {
    setErrorMessage(null);
    try {
      await api.unlinkParticipantFromProgram(program.id, participantId);
      setStatusMessage('Peserta dilepaskan dari program ini.');
      await loadMasterParticipants();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal melepaskan peserta.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#E5E5E3] flex items-center justify-between bg-[#FAFAF9]">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-[#1D4ED8] shrink-0" />
            <h2 className="text-sm font-bold text-[#252525] truncate">
              Tracing &amp; Database Peserta Program — {program.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#787774] hover:text-[#252525] hover:bg-[#EFEFEA] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-navigation */}
        <div className="px-5 py-2 bg-[#F7F7F5] border-b border-[#E5E5E3] flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('tracing')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
              activeTab === 'tracing'
                ? 'bg-[#171717] text-white'
                : 'bg-white text-[#5F5E5B] border border-[#E5E5E3] hover:text-[#171717]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Tracing Peserta per Outcome &amp; Activity</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('linked')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'linked'
                ? 'bg-[#171717] text-white'
                : 'bg-white text-[#5F5E5B] border border-[#E5E5E3] hover:text-[#171717]'
            }`}
          >
            Terdaftar di Program ({linkedParticipants.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('picker')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
              activeTab === 'picker'
                ? 'bg-[#2563EB] text-white'
                : 'bg-white text-[#2563EB] border border-blue-200 hover:bg-blue-50'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>+ Pilih dari Database Peserta ({records.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
          {statusMessage && (
            <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{statusMessage}</span>
              </div>
              <button type="button" onClick={() => setStatusMessage(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 flex items-center justify-between gap-2">
              <span>{errorMessage}</span>
              <button type="button" onClick={() => setErrorMessage(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-[#787774]">Memuat data peserta...</div>
          ) : activeTab === 'tracing' ? (
            <ProgramOutcomeParticipantTracing
              program={program}
              outcomes={outcomes}
              outputs={outputs}
              activities={activities}
              participants={records}
              monitoringItems={monitoringItems}
            />
          ) : activeTab === 'linked' ? (
            linkedParticipants.length === 0 ? (
              <div className="py-8 text-center rounded border border-dashed border-[#D9D9D6] bg-[#FAFAF9] space-y-2">
                <div className="text-xs font-medium text-[#6B6B68]">
                  Belum ada peserta di program ini.
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('picker')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Pilih dari Database Peserta</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#E5E5E3] rounded">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[10.5px] font-bold uppercase text-[#6B6B68]">
                      <th className="py-2 px-3">ID</th>
                      <th className="py-2 px-3">Nama Peserta</th>
                      <th className="py-2 px-3">Jenis</th>
                      <th className="py-2 px-3">Umur &amp; Jenis Kelamin</th>
                      <th className="py-2 px-3">Wilayah/Komunitas</th>
                      <th className="py-2 px-3">Total Program</th>
                      <th className="py-2 px-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFED]">
                    {linkedParticipants.map((rec) => {
                      const isInd = rec.participantType === 'INDIVIDU';
                      const isOtherGender =
                        isInd &&
                        (rec.gender === 'Lainnya' || rec.gender === 'Memilih tidak menjawab');
                      const totalProgramsCount = (rec.programInvolvements || []).length;

                      return (
                        <tr key={rec.id} className="hover:bg-[#FAFAF9]">
                          <td className="py-2 px-3 font-mono font-semibold text-[#252525]">
                            {rec.participantCode}
                          </td>
                          <td className="py-2 px-3 font-semibold text-[#252525]">
                            {isInd ? rec.fullName : rec.groupName}
                          </td>
                          <td className="py-2 px-3">
                            {isInd ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                                <UserCheck className="w-3 h-3" />
                                Individu
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-semibold">
                                <Building2 className="w-3 h-3" />
                                Kelompok ({rec.totalMembers})
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[#37352F]">
                            {isInd
                              ? isOtherGender
                                ? `${rec.gender} (Tanpa Umur)`
                                : `${rec.ageGroup} · ${rec.gender}`
                              : `${rec.totalMembers} anggota`}
                          </td>
                          <td className="py-2 px-3 text-[#37352F]">
                            {rec.regionCommunity || '-'}
                          </td>
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F4F4F2] border border-[#E5E5E3] font-medium text-[#37352F]">
                              <FolderGit2 className="w-3 h-3" />
                              {totalProgramsCount} Program
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleUnlinkParticipant(rec.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-red-600 hover:bg-red-50 font-medium cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Lepas</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <form onSubmit={handleLinkSelected} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-8 relative">
                  <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama peserta, ID, atau wilayah..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-[#FAFAF9]"
                  />
                </div>
                <div className="sm:col-span-4">
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                  >
                    <option value="ALL">Semua Jenis Peserta</option>
                    <option value="INDIVIDU">Individu</option>
                    <option value="KELOMPOK/ORGANISASI">Kelompok/Organisasi</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E5E5E3] rounded max-h-64 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#F7F7F5] border-b border-[#E5E5E3] text-[10.5px] font-bold uppercase text-[#6B6B68]">
                    <tr>
                      <th className="py-2 px-3 w-10 text-center">Pilih</th>
                      <th className="py-2 px-3">ID</th>
                      <th className="py-2 px-3">Nama Peserta</th>
                      <th className="py-2 px-3">Jenis</th>
                      <th className="py-2 px-3">Wilayah/Komunitas</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFED]">
                    {pickerCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-[#787774]">
                          Tidak ada data peserta yang cocok.
                        </td>
                      </tr>
                    ) : (
                      pickerCandidates.map((rec) => {
                        const isInd = rec.participantType === 'INDIVIDU';
                        const alreadyLinked = (rec.programInvolvements || []).some(
                          (i) => i.programId === program.id
                        );
                        const checked = selectedIds.includes(rec.id);

                        return (
                          <tr
                            key={rec.id}
                            onClick={() => toggleSelectId(rec.id)}
                            className={`cursor-pointer transition-colors ${
                              checked ? 'bg-blue-50/60' : 'hover:bg-[#FAFAF9]'
                            }`}
                          >
                            <td
                              className="py-2 px-3 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelectId(rec.id)}
                                className="rounded border-[#D9D9D6] cursor-pointer"
                              />
                            </td>
                            <td className="py-2 px-3 font-mono font-semibold text-[#252525]">
                              {rec.participantCode}
                            </td>
                            <td className="py-2 px-3 font-semibold text-[#252525]">
                              {isInd ? rec.fullName : rec.groupName}
                            </td>
                            <td className="py-2 px-3">
                              {isInd ? 'Individu' : `Kelompok (${rec.totalMembers})`}
                            </td>
                            <td className="py-2 px-3 text-[#37352F]">
                              {rec.regionCommunity || '-'}
                            </td>
                            <td className="py-2 px-3">
                              {alreadyLinked ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[10.5px]">
                                  Terdaftar
                                </span>
                              ) : (
                                <span className="text-[#787774] text-[11px]">
                                  {(rec.programInvolvements || []).length} program lain
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[#6B6B68]">
                  Terpilih: <strong>{selectedIds.length}</strong> peserta
                </span>
                <button
                  type="submit"
                  disabled={selectedIds.length === 0 || submitting}
                  className="px-4 py-1.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white font-semibold cursor-pointer"
                >
                  {submitting ? 'Menyimpan...' : `Tambahkan ke Program (${selectedIds.length})`}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
