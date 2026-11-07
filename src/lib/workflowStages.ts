import { Tor, TorDocument, DocumentStageId, DocumentStageKey } from '../types/index.js';

export interface WorkflowStageMeta {
  stageNumber: DocumentStageId;
  stageKey: DocumentStageKey;
  num: string;
  title: string;
  desc: string;
  isOptional?: boolean;
}

export const WORKFLOW_STAGES: WorkflowStageMeta[] = [
  {
    stageNumber: 1,
    stageKey: 'tor',
    num: '01',
    title: 'TOR',
    desc: 'Kerangka acuan kerja, target kegiatan, rincian anggaran, dan alur persetujuan',
  },
  {
    stageNumber: 2,
    stageKey: 'cash_advance',
    num: '02',
    title: 'Cash Advance',
    desc: 'Pengajuan dan pencairan uang muka operasional kegiatan ke bagian keuangan',
  },
  {
    stageNumber: 3,
    stageKey: 'cash_advance_tambahan',
    num: '03',
    title: 'Cash Advance Tambahan',
    desc: 'Pengajuan tambahan biaya tak terduga (hanya diwajibkan bila diperlukan organisasi)',
    isOptional: true,
  },
  {
    stageNumber: 4,
    stageKey: 'notulen',
    num: '04',
    title: 'Notulen',
    desc: 'Catatan poin penting musyawarah, lokakarya, atau rapat lapangan',
  },
  {
    stageNumber: 5,
    stageKey: 'dokumentasi_foto',
    num: '05',
    title: 'Dokumentasi Kegiatan',
    desc: 'Five Best Photos (5 slot link), Human Interest Story, dan General Photo Documentation',
  },
  {
    stageNumber: 6,
    stageKey: 'narasi_kegiatan',
    num: '06',
    title: 'Monitoring',
    desc: 'Monitoring kegiatan terintegrasi otomatis dengan ToR, Cash Advance, dan Monitoring Tools',
  },
  {
    stageNumber: 7,
    stageKey: 'laporan_kontribusi',
    num: '07',
    title: 'Laporan TOR',
    desc: 'Laporan Kontribusi yang menggabungkan ToR, Notulen, Dokumentasi, dan Monitoring dalam satu dokumen Legal',
  },
  {
    stageNumber: 8,
    stageKey: 'laporan_keuangan',
    num: '08',
    title: 'Laporan Keuangan',
    desc: 'Pertanggungjawaban struk, kuitansi riil, dan rekonsiliasi kasbon dengan bagian keuangan',
  },
];

export interface TorCompletionStatus {
  isFullyCompleted: boolean;
  completedStagesCount: number;
  totalStagesCount: number;
  isFieldFinished: boolean;
  isTorApproved: boolean;
  missingMandatoryStages: string[];
  statusBadgeText: string;
  completionDate: string;
}

/**
 * Determines whether a TOR meets the strict completion criteria of the organization.
 * 
 * Rules:
 * 1. Field activity must be completed (activityStatus === 'Selesai').
 * 2. TOR must be approved (submissionStatus === 'Disetujui').
 * 3. All mandatory documents (Stages 1, 2, 4, 5, 6, 7, 8) must have status === 'Selesai'.
 * 4. Cash Advance Tambahan (Stage 3) is optional; satisfied if 'Selesai' or 'Tidak Diperlukan'.
 * 5. If field activity is completed but reporting/documents are missing,
 *    it does NOT enter Completed Archive; status is 'Menunggu Kelengkapan Laporan'.
 */
export function checkTorCompletion(tor: Tor, documents: TorDocument[] = []): TorCompletionStatus {
  const torDocs = documents.filter((d) => d.torId === tor.id);

  const isFieldFinished = tor.activityStatus === 'Selesai';
  const isTorApproved = tor.submissionStatus === 'Disetujui';

  const mandatoryStageNumbers = [1, 2, 4, 5, 6, 7, 8];
  const missingMandatoryStages: string[] = [];

  let completedStagesCount = 0;

  WORKFLOW_STAGES.forEach((stage) => {
    const doc = torDocs.find((d) => d.stageNumber === stage.stageNumber);
    if (!doc) {
      if (!stage.isOptional) {
        missingMandatoryStages.push(stage.title);
      }
      return;
    }

    if (doc.status === 'Selesai') {
      completedStagesCount++;
    } else if (stage.isOptional && doc.status === 'Tidak Diperlukan') {
      // Optional stage considered fulfilled
      completedStagesCount++;
    } else if (!stage.isOptional) {
      missingMandatoryStages.push(stage.title);
    }
  });

  // If tor is explicitly marked as archived completed and activity is done
  const hasAllMandatoryDocs = missingMandatoryStages.length === 0;
  const isFullyCompleted =
    Boolean(tor.isArchivedCompleted) ||
    (isFieldFinished && isTorApproved && hasAllMandatoryDocs);

  let statusBadgeText = 'Sedang Berjalan';
  if (isFullyCompleted) {
    statusBadgeText = 'Selesai';
  } else if (isFieldFinished && !hasAllMandatoryDocs) {
    statusBadgeText = 'Menunggu Kelengkapan Laporan';
  } else if (!isTorApproved) {
    statusBadgeText = tor.submissionStatus;
  } else if (tor.activityStatus === 'Belum Dimulai') {
    statusBadgeText = 'Belum Dimulai';
  }

  const completionDate =
    tor.completionDate ||
    (isFullyCompleted ? (tor.reportingDeadline || tor.updatedAt.slice(0, 10)) : '-');

  return {
    isFullyCompleted,
    completedStagesCount,
    totalStagesCount: WORKFLOW_STAGES.length,
    isFieldFinished,
    isTorApproved,
    missingMandatoryStages,
    statusBadgeText,
    completionDate,
  };
}
