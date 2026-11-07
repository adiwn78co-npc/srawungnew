import React from 'react';
import { Tor, TorDocument } from '../../types/index.js';
import { WORKFLOW_STAGES } from '../../lib/workflowStages.js';
import { Check, Clock, AlertCircle } from 'lucide-react';

interface DocumentWorkflowStagesProps {
  tor: Tor;
  documents: TorDocument[];
  onSelectStage: (stageNumber: number, doc?: TorDocument) => void;
  activeStageNumber?: number;
  compact?: boolean;
}

export const DocumentWorkflowStages: React.FC<DocumentWorkflowStagesProps> = ({
  tor,
  documents,
  onSelectStage,
  activeStageNumber,
  compact = false,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold text-[#525252] uppercase tracking-wider flex items-center gap-2">
          <span>Alur Rantai Dokumen Program · 8 Tahapan</span>
          <span className="text-[10px] text-[#8C8C89] font-normal lowercase">
            (klik kotak untuk melihat dokumen)
          </span>
        </div>
      </div>

      {/* Responsive Grid: 2 cols on mobile, 4 cols on tablet, 8 cols on large desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {WORKFLOW_STAGES.map((stg) => {
          const doc = documents.find((d) => d.stageNumber === stg.stageNumber);
          const isSelected = activeStageNumber === stg.stageNumber;

          // Compute actual status:
          // For Stage 1 (TOR): If doc exists, use doc.status; else if tor.submissionStatus === 'Disetujui', it's 'Selesai'
          let statusText = 'Belum Tersedia';
          let isComplete = false;
          let isDraft = false;
          let isPending = false;
          let isOptionalNA = false;

          if (doc) {
            statusText = doc.status;
            if (doc.status === 'Selesai') {
              isComplete = true;
            } else if (doc.status === 'Draft') {
              isDraft = true;
            } else if (doc.status === 'Tidak Diperlukan') {
              isOptionalNA = true;
            } else if (doc.status === 'Menunggu Persetujuan' || doc.status === 'Diajukan') {
              isPending = true;
            }
          } else if (stg.stageNumber === 1 && tor.submissionStatus === 'Disetujui') {
            statusText = 'Selesai';
            isComplete = true;
          } else if (stg.stageNumber === 1) {
            statusText = tor.submissionStatus;
            isPending = tor.submissionStatus.includes('Menunggu');
            isDraft = tor.submissionStatus === 'Draft' || tor.submissionStatus === 'Perlu Perbaikan';
          }

          return (
            <button
              key={stg.stageNumber}
              type="button"
              onClick={() => onSelectStage(stg.stageNumber, doc)}
              title={`Tahap ${stg.num}: ${stg.title} · Status: ${statusText}`}
              className={`text-left p-2.5 rounded border transition-all cursor-pointer flex flex-col justify-between ${
                compact ? 'min-h-[64px]' : 'min-h-[76px]'
              } ${
                isSelected
                  ? 'border-[#1D4ED8] bg-blue-50/60 ring-1 ring-[#1D4ED8]'
                  : isComplete
                  ? 'border-[#E2E8F0] bg-white hover:border-slate-300 hover:bg-slate-50/80'
                  : isOptionalNA
                  ? 'border-[#E5E5E3] bg-[#FAFAFA] hover:bg-slate-100/70'
                  : 'border-[#E5E5E3] bg-white hover:border-slate-300 hover:bg-slate-50/60'
              }`}
            >
              {/* Header: Stage Number & Status Indicator */}
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-mono text-[10px] font-semibold text-[#737373]">
                  {stg.num}
                </span>

                {isComplete ? (
                  <span
                    className="inline-flex items-center text-emerald-600"
                    title="Dokumen Selesai"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  </span>
                ) : isOptionalNA ? (
                  <span
                    className="text-[10px] text-slate-400 font-medium"
                    title="Tidak Diperlukan"
                  >
                    N/A
                  </span>
                ) : isDraft ? (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-amber-500"
                    title="Draf Dokumen"
                  />
                ) : isPending ? (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-blue-500"
                    title="Menunggu Persetujuan"
                  />
                ) : (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-slate-300"
                    title="Belum Tersedia"
                  />
                )}
              </div>

              {/* Document Title */}
              <div className="text-[11px] font-medium text-[#171717] line-clamp-2 leading-tight">
                {stg.title}
              </div>

              {/* Status Label (Minimalist, quiet) */}
              <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between">
                <span
                  className={`text-[9.5px] truncate font-medium ${
                    isComplete
                      ? 'text-emerald-700'
                      : isOptionalNA
                      ? 'text-slate-400 italic'
                      : isDraft
                      ? 'text-amber-700'
                      : isPending
                      ? 'text-blue-700'
                      : 'text-slate-400'
                  }`}
                >
                  {isComplete
                    ? 'Selesai'
                    : isOptionalNA
                    ? 'Tidak Perlu'
                    : statusText}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
