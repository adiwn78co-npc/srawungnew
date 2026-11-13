import type {
  DatabaseSchema,
} from './db.ts';
import type {
  ApprovalAccessProfile,
  ApprovalCategoryCode,
  ApprovalCategoryWorkflowConfig,
  ApprovalHubItem,
  ApprovalHubStatus,
  ApprovalNotificationItem,
  ApprovalRaciRoleCode,
  ApprovalTimelineEvent,
  ApprovalWorkflowStep,
  CashAdvanceRecord,
  MeetingMinutesRecord,
  ActivityDocumentationRecord,
  MonitoringReportItem,
  Tor,
  User,
} from '../types/index.ts';

const ALL_CATEGORIES: ApprovalCategoryCode[] = [
  'tor',
  'notulen',
  'dokumentasi',
  'executive_summary',
  'cash_advance',
  'laporan_keuangan_akhir',
];

export const CATEGORY_META: Record<
  ApprovalCategoryCode,
  {
    label: string;
    shortLabel: string;
    groupType: 'program_documents' | 'financial_documents';
    verifierRole: 'A1' | 'A2';
    finalDirectorMode: 'REPORTING' | 'FINAL_APPROVAL';
    flowSummary: string;
  }
> = {
  tor: {
    label: 'Terms of Reference (ToR)',
    shortLabel: 'ToR',
    groupType: 'program_documents',
    verifierRole: 'A1',
    finalDirectorMode: 'REPORTING',
    flowSummary: 'R → A1 → Direktur (Pelaporan / Pencatatan)',
  },
  notulen: {
    label: 'Notulen Rapat (Meeting Minutes)',
    shortLabel: 'Notulen Rapat',
    groupType: 'program_documents',
    verifierRole: 'A1',
    finalDirectorMode: 'REPORTING',
    flowSummary: 'R → A1 → Direktur (Pelaporan / Pencatatan)',
  },
  dokumentasi: {
    label: 'Dokumentasi Kegiatan',
    shortLabel: 'Dokumentasi Kegiatan',
    groupType: 'program_documents',
    verifierRole: 'A1',
    finalDirectorMode: 'REPORTING',
    flowSummary: 'R → A1 → Direktur (Pelaporan / Pencatatan)',
  },
  executive_summary: {
    label: 'Executive Summary (Ringkasan Eksekutif)',
    shortLabel: 'Executive Summary',
    groupType: 'program_documents',
    verifierRole: 'A1',
    finalDirectorMode: 'REPORTING',
    flowSummary: 'R → A1 → Direktur (Pelaporan / Pencatatan)',
  },
  cash_advance: {
    label: 'Cash Advance Request (Pengajuan Uang Muka)',
    shortLabel: 'Cash Advance Request',
    groupType: 'financial_documents',
    verifierRole: 'A2',
    finalDirectorMode: 'FINAL_APPROVAL',
    flowSummary: 'R → A2 → Direktur (Persetujuan Akhir)',
  },
  laporan_keuangan_akhir: {
    label: 'Final Financial Report (Laporan Keuangan Akhir)',
    shortLabel: 'Laporan Keuangan Akhir',
    groupType: 'financial_documents',
    verifierRole: 'A2',
    finalDirectorMode: 'FINAL_APPROVAL',
    flowSummary: 'R → A2 → Direktur (Persetujuan Akhir)',
  },
};

function ensureWorkflowConfigs(
  draft: DatabaseSchema
): Record<string, ApprovalCategoryWorkflowConfig> {
  if (!draft.approvalWorkflowConfigs) {
    draft.approvalWorkflowConfigs = {};
  }
  const nowIso = new Date().toISOString();
  for (const cat of ALL_CATEGORIES) {
    if (!draft.approvalWorkflowConfigs[cat]) {
      draft.approvalWorkflowConfigs[cat] = {
        categoryCode: cat,
        mechanism: 'SEQUENTIAL',
        parallelRule: 'PRIMARY_WITH_CONSULTATION',
        updatedAt: nowIso,
        updatedByName: 'Sistem Default WIJNA',
      };
    }
  }
  return draft.approvalWorkflowConfigs;
}

function findUserByIdOrName(users: User[], userId?: string, userName?: string): User | undefined {
  if (userId) {
    const byId = users.find((u) => u.id === userId);
    if (byId) return byId;
  }
  const normName = String(userName || '').trim().toLowerCase();
  if (normName) {
    return users.find(
      (u) =>
        String(u.name || '').trim().toLowerCase() === normName ||
        String(u.email || '').trim().toLowerCase() === normName
    );
  }
  return undefined;
}

function resolveDynamicRaciForOutput(
  draft: DatabaseSchema,
  outputId: string,
  fallbackResponsibleId?: string,
  fallbackResponsibleName?: string
) {
  const raci = draft.outputRaciRecords?.[outputId];
  const output = (draft.outputs || []).find((o) => o.id === outputId);
  const outcome = (draft.outcomes || []).find((oc) => oc.id === output?.outcomeId);
  const allUsers = draft.users || [];
  const activeUsers = allUsers.filter((u) => u.isActive !== false);

  // Resolve A2 (Accountable Finance): from RACI or active Finance user with approval authority
  const designatedA2User =
    findUserByIdOrName(activeUsers, raci?.accountableFinanceUserId, raci?.accountableFinanceUserName) ||
    activeUsers.find((u) => u.role === 'finance' && u.permissions?.canApproveTor !== false) ||
    activeUsers.find((u) => u.role === 'finance') ||
    allUsers.find((u) => u.role === 'finance');

  // Resolve Direktur from active users with role === 'director'
  const directorUser =
    activeUsers.find((u) => u.role === 'director') ||
    allUsers.find((u) => u.role === 'director');

  // Resolve Program Manager fallback if Output RACI has not yet set A1
  const pmUser =
    activeUsers.find((u) => u.role === 'program_manager') ||
    allUsers.find((u) => u.role === 'program_manager');

  const staffFallback =
    activeUsers.find((u) => u.role === 'staff' || u.role === 'meal') || activeUsers[0];

  const matchedResponsibleUser =
    findUserByIdOrName(allUsers, raci?.responsibleUserId, raci?.responsibleUserName) ||
    findUserByIdOrName(allUsers, fallbackResponsibleId, fallbackResponsibleName) ||
    findUserByIdOrName(allUsers, output?.picId, output?.picName);

  const responsibleUserId =
    matchedResponsibleUser?.id ||
    raci?.responsibleUserId ||
    fallbackResponsibleId ||
    output?.picId ||
    staffFallback?.id ||
    '';
  const responsibleUser = matchedResponsibleUser || allUsers.find((u) => u.id === responsibleUserId);
  const responsibleUserName =
    responsibleUser?.name ||
    raci?.responsibleUserName ||
    fallbackResponsibleName ||
    output?.picName ||
    'Responsible (R)';

  const matchedAccountableProgramUser =
    findUserByIdOrName(allUsers, raci?.accountableUserId, raci?.accountableUserName) ||
    findUserByIdOrName(allUsers, outcome?.picId, outcome?.picName);

  const accountableProgramUserId =
    matchedAccountableProgramUser?.id ||
    raci?.accountableUserId ||
    outcome?.picId ||
    pmUser?.id ||
    '';
  const accountableProgramUser =
    matchedAccountableProgramUser || allUsers.find((u) => u.id === accountableProgramUserId);
  const accountableProgramUserName =
    accountableProgramUser?.name ||
    raci?.accountableUserName ||
    outcome?.picName ||
    pmUser?.name ||
    'Accountable Program (A1)';

  const matchedAccountableFinanceUser = findUserByIdOrName(
    allUsers,
    raci?.accountableFinanceUserId,
    raci?.accountableFinanceUserName
  );
  const accountableFinanceUserId =
    matchedAccountableFinanceUser?.id || raci?.accountableFinanceUserId || designatedA2User?.id || '';
  const accountableFinanceUser =
    matchedAccountableFinanceUser || allUsers.find((u) => u.id === accountableFinanceUserId);
  const accountableFinanceUserName =
    accountableFinanceUser?.name ||
    raci?.accountableFinanceUserName ||
    designatedA2User?.name ||
    'Accountable Finance (A2)';

  const directorUserId = directorUser?.id || '';
  const directorUserName = directorUser?.name || 'Direktur';

  return {
    responsibleUserId,
    responsibleUserName,
    accountableProgramUserId,
    accountableProgramUserName,
    accountableFinanceUserId,
    accountableFinanceUserName,
    directorUserId,
    directorUserName,
    consultedUsers: raci?.consultedUsers || [],
    informedUsers:
      raci?.informedUsers ||
      [directorUserName, accountableFinanceUserName].filter(Boolean),
  };
}

function resolveHierarchyAndMonitoring(draft: DatabaseSchema, tor: Tor) {
  const activity = (draft.activities || []).find((a) => a.id === tor.activityId);
  const output = (draft.outputs || []).find(
    (o) => o.id === (tor.outputId || activity?.outputId)
  );
  const outcome = (draft.outcomes || []).find(
    (oc) => oc.id === (tor.outcomeId || output?.outcomeId)
  );
  const program = (draft.programs || []).find(
    (p) => p.id === (tor.programId || outcome?.programId)
  );

  const actMon = draft.activityMonitoringRecords?.[tor.activityId];
  const monitoringTools = (actMon?.tools || []).map((t) => ({
    toolId: t.toolId,
    toolName: t.toolName,
    categoryCode: t.categoryCode,
    categoryName: t.categoryName,
    toolUrl: t.toolUrl,
  }));

  return {
    programId: program?.id || tor.programId || '',
    programName: program?.name || tor.programName || '',
    outcomeId: outcome?.id || tor.outcomeId || '',
    outcomeName: outcome?.name || tor.outcomeName || '',
    outputId: output?.id || tor.outputId || '',
    outputName: output?.name || tor.outputName || '',
    activityId: activity?.id || tor.activityId || '',
    activityCode: activity?.code || tor.activityCode || '',
    activityName: activity?.name || tor.activityName || tor.title,
    monitoringTools,
  };
}

function buildStepsForStatus(params: {
  categoryCode: ApprovalCategoryCode;
  status: ApprovalHubStatus;
  responsibleUserId: string;
  responsibleUserName: string;
  accountableProgramUserId: string;
  accountableProgramUserName: string;
  accountableFinanceUserId: string;
  accountableFinanceUserName: string;
  directorUserId: string;
  directorUserName: string;
  submittedAt: string;
  verifiedAt?: string;
  verifiedNotes?: string;
  completedAt?: string;
  directorNotes?: string;
  refPrefix: string;
}): {
  steps: ApprovalWorkflowStep[];
  currentStepNumber: 1 | 2 | 3;
  currentActiveRole: 'R' | 'A1' | 'A2' | 'Direktur' | 'Selesai';
} {
  const meta = CATEGORY_META[params.categoryCode];
  const isProgramDoc = meta.groupType === 'program_documents';
  const step2RoleCode: 'A1' | 'A2' = isProgramDoc ? 'A1' : 'A2';
  const step2UserId = isProgramDoc
    ? params.accountableProgramUserId
    : params.accountableFinanceUserId;
  const step2UserName = isProgramDoc
    ? params.accountableProgramUserName
    : params.accountableFinanceUserName;
  const step2RoleLabel = isProgramDoc
    ? 'A1 – Accountable Program'
    : 'A2 – Accountable Finance';
  const step2ActionLabel = isProgramDoc
    ? 'Pemeriksaan & Persetujuan Program (A1)'
    : 'Verifikasi Dokumen & Kepatuhan Keuangan (A2)';
  const step3ActionLabel = isProgramDoc
    ? 'Pelaporan & Pencatatan Akhir Direktur'
    : 'Persetujuan Akhir Transaksi Keuangan (Direktur)';

  let step1Status: ApprovalWorkflowStep['status'] = 'Selesai';
  let step2Status: ApprovalWorkflowStep['status'] = 'Menunggu Tahap Sebelumnya';
  let step3Status: ApprovalWorkflowStep['status'] = 'Menunggu Tahap Sebelumnya';
  let currentStepNumber: 1 | 2 | 3 = 1;
  let currentActiveRole: 'R' | 'A1' | 'A2' | 'Direktur' | 'Selesai' = 'R';

  switch (params.status) {
    case 'Draft':
      step1Status = 'Sedang Berjalan';
      step2Status = 'Menunggu Tahap Sebelumnya';
      step3Status = 'Menunggu Tahap Sebelumnya';
      currentStepNumber = 1;
      currentActiveRole = 'R';
      break;
    case 'Revision Required':
      step1Status = 'Perlu Revisi';
      step2Status = 'Perlu Revisi';
      step3Status = 'Menunggu Tahap Sebelumnya';
      currentStepNumber = 1;
      currentActiveRole = 'R';
      break;
    case 'Submitted':
    case 'Pending Verification':
      step1Status = 'Selesai';
      step2Status = 'Sedang Berjalan';
      step3Status = 'Menunggu Tahap Sebelumnya';
      currentStepNumber = 2;
      currentActiveRole = step2RoleCode;
      break;
    case 'Pending Approval':
      step1Status = 'Selesai';
      step2Status = 'Selesai';
      step3Status = 'Sedang Berjalan';
      currentStepNumber = 3;
      currentActiveRole = 'Direktur';
      break;
    case 'Approved':
      if (isProgramDoc) {
        // Dokumen program yang sudah disetujui A1 tetapi belum dilaporkan ke Direktur
        step1Status = 'Selesai';
        step2Status = 'Selesai';
        step3Status = 'Sedang Berjalan';
        currentStepNumber = 3;
        currentActiveRole = 'Direktur';
      } else {
        // Dokumen keuangan yang sudah disetujui akhir oleh Direktur
        step1Status = 'Selesai';
        step2Status = 'Selesai';
        step3Status = 'Selesai';
        currentStepNumber = 3;
        currentActiveRole = 'Selesai';
      }
      break;
    case 'Reported to Director':
    case 'Archived':
      step1Status = 'Selesai';
      step2Status = 'Selesai';
      step3Status = 'Selesai';
      currentStepNumber = 3;
      currentActiveRole = 'Selesai';
      break;
    case 'Rejected':
      step1Status = 'Selesai';
      step2Status = 'Ditolak';
      step3Status = 'Menunggu Tahap Sebelumnya';
      currentStepNumber = 2;
      currentActiveRole = 'R';
      break;
  }

  const steps: ApprovalWorkflowStep[] = [
    {
      stepNumber: 1,
      roleCode: 'R',
      roleLabel: 'R – Responsible',
      actionTypeLabel: 'Penyusunan, Konfirmasi & Pengajuan Dokumen',
      assignedUserId: params.responsibleUserId,
      assignedUserName: params.responsibleUserName,
      status: step1Status,
      actedByUserId: step1Status === 'Selesai' ? params.responsibleUserId : undefined,
      actedByUserName: step1Status === 'Selesai' ? params.responsibleUserName : undefined,
      receivedAt: params.submittedAt,
      actedAt: step1Status === 'Selesai' ? params.submittedAt : undefined,
      notes:
        step1Status === 'Selesai'
          ? 'Dokumen telah disusun dan diajukan melalui Pusat Persetujuan.'
          : undefined,
      signatureCode:
        step1Status === 'Selesai' ? `SIG-${params.refPrefix}-R` : undefined,
    },
    {
      stepNumber: 2,
      roleCode: step2RoleCode,
      roleLabel: step2RoleLabel,
      actionTypeLabel: step2ActionLabel,
      assignedUserId: step2UserId,
      assignedUserName: step2UserName,
      status: step2Status,
      actedByUserId:
        step2Status === 'Selesai' || step2Status === 'Perlu Revisi' || step2Status === 'Ditolak'
          ? step2UserId
          : undefined,
      actedByUserName:
        step2Status === 'Selesai' || step2Status === 'Perlu Revisi' || step2Status === 'Ditolak'
          ? step2UserName
          : undefined,
      receivedAt:
        step1Status === 'Selesai' || step2Status === 'Perlu Revisi' || step2Status === 'Ditolak'
          ? params.submittedAt
          : undefined,
      actedAt:
        step2Status === 'Selesai' || step2Status === 'Perlu Revisi' || step2Status === 'Ditolak'
          ? params.verifiedAt || params.submittedAt
          : undefined,
      notes: params.verifiedNotes,
      signatureCode:
        step2Status === 'Selesai'
          ? `SIG-${params.refPrefix}-${step2RoleCode}`
          : undefined,
    },
    {
      stepNumber: 3,
      roleCode: 'Direktur',
      roleLabel: 'Direktur Eksekutif',
      actionTypeLabel: step3ActionLabel,
      assignedUserId: params.directorUserId,
      assignedUserName: params.directorUserName,
      status: step3Status,
      actedByUserId: step3Status === 'Selesai' ? params.directorUserId : undefined,
      actedByUserName: step3Status === 'Selesai' ? params.directorUserName : undefined,
      receivedAt:
        step2Status === 'Selesai'
          ? params.verifiedAt || params.submittedAt
          : undefined,
      actedAt:
        step3Status === 'Selesai'
          ? params.completedAt || params.verifiedAt || params.submittedAt
          : undefined,
      notes: params.directorNotes,
      signatureCode:
        step3Status === 'Selesai' ? `SIG-${params.refPrefix}-DIR` : undefined,
    },
  ];

  return { steps, currentStepNumber, currentActiveRole };
}

export function syncApprovalHubData(draft: DatabaseSchema): {
  items: ApprovalHubItem[];
  configs: Record<string, ApprovalCategoryWorkflowConfig>;
  notifications: ApprovalNotificationItem[];
} {
  const configs = ensureWorkflowConfigs(draft);
  if (!draft.approvalHubItems) {
    draft.approvalHubItems = {};
  }
  if (!draft.approvalNotifications) {
    draft.approvalNotifications = [];
  }

  const tors = draft.tors || [];
  const cashAdvances = draft.cashAdvances || [];
  const meetingMinutes = draft.meetingMinutes || [];
  const docList = draft.activityDocumentationList || Object.values(draft.activityDocumentations || {});
  const monReports = Object.values(draft.monitoringReports || {});

  // Prune any approvalHubItems whose underlying source entity no longer exists
  const validItemIds = new Set<string>([
    ...tors.map((t) => `apv-tor-${t.id}`),
    ...cashAdvances.map((ca) => `apv-ca-${ca.id}`),
    ...cashAdvances.filter((ca) => ca.isReported).map((ca) => `apv-finrep-${ca.id}`),
    ...meetingMinutes.map((mm) => `apv-notulen-${mm.id}`),
    ...docList.filter(Boolean).map((d) => `apv-doc-${d.id}`),
    ...monReports.filter((m) => m.toolId === 'EXEC-SUMMARY').map((m) => `apv-exec-${m.id}`),
  ]);
  for (const existingKey of Object.keys(draft.approvalHubItems)) {
    if (!validItemIds.has(existingKey)) {
      delete draft.approvalHubItems[existingKey];
    }
  }
  draft.approvalNotifications = (draft.approvalNotifications || []).filter(
    (n) =>
      Boolean(draft.approvalHubItems?.[n.approvalItemId]) ||
      Boolean(n.approvalItemId?.startsWith('raci-'))
  );

  // 1. Sync Terms of Reference (ToR) -> R -> A1 -> Direktur (Pelaporan)
  for (const tor of tors) {
    const itemId = `apv-tor-${tor.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, tor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      tor.picId || tor.createdById,
      tor.picName || tor.createdByName
    );
    const existing = draft.approvalHubItems[itemId];

    // Always reflect live status from underlying ToR record in the database
    let mappedStatus: ApprovalHubStatus = existing?.status || 'Pending Verification';
    if (tor.isArchivedCompleted || existing?.status === 'Archived') {
      mappedStatus = 'Archived';
    } else if (tor.submissionStatus === 'Draft') {
      mappedStatus = 'Draft';
    } else if (
      tor.submissionStatus === 'Diajukan' ||
      tor.submissionStatus === 'Menunggu Persetujuan Finance'
    ) {
      mappedStatus = 'Pending Verification'; // Menunggu pemeriksaan & persetujuan A1
    } else if (tor.submissionStatus === 'Menunggu Persetujuan Director') {
      mappedStatus = 'Approved'; // Telah disetujui A1, menunggu dilaporkan ke Direktur
    } else if (tor.submissionStatus === 'Disetujui') {
      mappedStatus = 'Reported to Director';
    } else if (tor.submissionStatus === 'Perlu Perbaikan') {
      mappedStatus = 'Revision Required';
    } else if (tor.submissionStatus === 'Ditolak') {
      mappedStatus = 'Rejected';
    }

    const wfConfig = configs['tor'];
    const stepInfo = buildStepsForStatus({
      categoryCode: 'tor',
      status: mappedStatus,
      ...raci,
      submittedAt: tor.createdAt || new Date().toISOString(),
      verifiedAt: tor.updatedAt,
      verifiedNotes:
        existing?.steps?.[1]?.notes ||
        (mappedStatus === 'Approved' || mappedStatus === 'Reported to Director'
          ? 'Dokumen ToR telah diperiksa dan disetujui oleh A1 (Accountable Program).'
          : undefined),
      completedAt: tor.publishedAt || tor.updatedAt,
      directorNotes:
        existing?.steps?.[2]?.notes ||
        (mappedStatus === 'Reported to Director'
          ? 'Laporan ToR telah diterima dan dicatat oleh Direktur.'
          : undefined),
      refPrefix: tor.id.toUpperCase(),
    });

    const defaultTimeline: ApprovalTimelineEvent[] = existing?.timeline?.length
      ? existing.timeline
      : [
          {
            id: `tl-${itemId}-1`,
            timestamp: tor.createdAt || new Date().toISOString(),
            actorId: raci.responsibleUserId,
            actorName: raci.responsibleUserName,
            actorRoleCode: 'R',
            actorRoleTitle: 'Responsible (Pelaksana Kegiatan)',
            responsibleName: raci.responsibleUserName,
            actionLabel: 'Mengajukan Dokumen ToR',
            resultingStatus: 'Pending Verification',
            comment: `Pengajuan Terms of Reference (${tor.torNumber}) untuk kegiatan ${hier.activityName}.`,
            version: 1,
          },
          ...(mappedStatus === 'Approved' || mappedStatus === 'Reported to Director'
            ? [
                {
                  id: `tl-${itemId}-2`,
                  timestamp: tor.updatedAt || new Date().toISOString(),
                  actorId: raci.accountableProgramUserId,
                  actorName: raci.accountableProgramUserName,
                  actorRoleCode: 'A1' as const,
                  actorRoleTitle: 'Accountable Program',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Menyetujui ToR (Tahap A1)',
                  resultingStatus: 'Approved' as ApprovalHubStatus,
                  comment:
                    'Substansi program, indikator Output, dan rencana monitoring kegiatan sesuai standar.',
                  version: 1,
                },
              ]
            : []),
          ...(mappedStatus === 'Reported to Director'
            ? [
                {
                  id: `tl-${itemId}-3`,
                  timestamp: tor.publishedAt || tor.updatedAt || new Date().toISOString(),
                  actorId: raci.directorUserId,
                  actorName: raci.directorUserName,
                  actorRoleCode: 'Direktur' as const,
                  actorRoleTitle: 'Executive Director',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Menerima Laporan ToR (Dilaporkan ke Direktur)',
                  resultingStatus: 'Reported to Director' as ApprovalHubStatus,
                  comment:
                    'Telah dilaporkan kepada Direktur dan resmi diterbitkan untuk pelaksanaan kegiatan.',
                  version: 1,
                },
              ]
            : []),
        ];

    if (tor.editRequestStatus === 'pending' && stepInfo.steps[2]) {
      stepInfo.currentStepNumber = 3;
      stepInfo.currentActiveRole = 'Direktur';
      stepInfo.steps[2] = {
        ...stepInfo.steps[2],
        status: 'Sedang Berjalan',
        receivedAt: tor.editRequestedAt || tor.updatedAt || new Date().toISOString(),
        notes: `Permintaan Akses Edit ToR dari ${tor.editRequestedByName || raci.responsibleUserName}: "${
          tor.editRequestReason || '-'
        }"`,
      };
    }

    const torRefNumber = String(tor.torNumber || tor.id || '');

    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: tor.id,
      sourceTorId: tor.id,
      referenceNumber: torRefNumber,
      title: tor.title || hier.activityName || 'Dokumen ToR',
      groupType: 'program_documents',
      categoryCode: 'tor',
      categoryLabel: CATEGORY_META.tor.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked:
        tor.editRequestStatus === 'approved'
          ? false
          : mappedStatus === 'Approved' ||
            mappedStatus === 'Reported to Director' ||
            mappedStatus === 'Archived',
      submittedAt: existing?.submittedAt || tor.createdAt,
      dueDate: tor.reportingDeadline,
      completedAt:
        mappedStatus === 'Reported to Director'
          ? tor.publishedAt || tor.updatedAt
          : existing?.completedAt,
      isArchived: mappedStatus === 'Archived',
      previewData: {
        summaryText:
          tor.background ||
          tor.objectives ||
          `Terms of Reference pelaksanaan kegiatan ${hier.activityName}.`,
        location: tor.location,
        activityPeriod: `${tor.startDate} s/d ${tor.endDate}`,
        attachments: [
          {
            label: `Dokumen Utama ToR (${torRefNumber})`,
            url: `#tor-preview-${tor.id}`,
            refCode: torRefNumber,
          },
          ...hier.monitoringTools
            .filter((t) => t.toolUrl)
            .map((t) => ({
              label: `Monitoring Tool: [${t.toolId}] ${t.toolName}`,
              url: t.toolUrl || '',
              refCode: t.toolId,
            })),
        ],
        keyHighlights: [
          { label: 'Tujuan Kegiatan', value: tor.generalObjective || tor.objectives || '-' },
          { label: 'Lokasi & Periode', value: `${tor.location} (${tor.startDate} – ${tor.endDate})` },
          {
            label: 'Estimasi Pagu Anggaran ToR',
            value: `Rp ${Number(tor.budgetApproved || tor.budgetRequested || 0).toLocaleString('id-ID')}`,
          },
          {
            label: 'Batas Waktu Pelaporan',
            value: tor.reportingDeadline || '-',
          },
        ],
        editRequestStatus: tor.editRequestStatus || 'none',
        editRequestedById: tor.editRequestedById,
        editRequestedByName: tor.editRequestedByName,
        editRequestedByRole: tor.editRequestedByRole,
        editRequestedAt: tor.editRequestedAt,
        editRequestReason: tor.editRequestReason,
        editReviewedByName: tor.editReviewedByName,
        editReviewedAt: tor.editReviewedAt,
        editReviewComment: tor.editReviewComment,
      },
      updatedAt: existing?.updatedAt || tor.updatedAt || tor.createdAt,
    };
  }

  // 2. Sync Cash Advance Request (Pengajuan Uang Muka) -> R -> A2 -> Direktur (Persetujuan Akhir)
  for (const ca of cashAdvances) {
    const parentTor = tors.find(
      (t) => t.id === ca.torId || (Boolean(ca.torNumber) && t.torNumber === ca.torNumber)
    );
    if (!parentTor) continue;
    const itemId = `apv-ca-${ca.id}`;
    const caAdvanceNumber = String(ca.advanceNumber || (ca as any).caNumber || ca.id || '');
    const caTorNumber = String(ca.torNumber || parentTor.torNumber || parentTor.id || '');
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      ca.requesterId || parentTor.picId,
      ca.requesterName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];

    let mappedStatus: ApprovalHubStatus = existing?.status || 'Pending Verification';
    if (existing?.status === 'Archived') {
      mappedStatus = 'Archived';
    } else if (ca.status === 'Draft') {
      mappedStatus = 'Draft';
    } else if (ca.status === 'Diajukan') {
      mappedStatus = 'Pending Verification'; // Menunggu verifikasi A2
    } else if (ca.status === 'Diverifikasi Finance') {
      mappedStatus = 'Pending Approval'; // Menunggu persetujuan akhir Direktur
    } else if (ca.status === 'Disetujui' || ca.status === 'Dicairkan') {
      mappedStatus = 'Approved';
    } else if (ca.status === 'Perlu Perbaikan') {
      mappedStatus = 'Revision Required';
    } else if (ca.status === 'Ditolak') {
      mappedStatus = 'Rejected';
    }

    const wfConfig = configs['cash_advance'];
    const stepInfo = buildStepsForStatus({
      categoryCode: 'cash_advance',
      status: mappedStatus,
      ...raci,
      submittedAt: ca.requestDate || ca.createdAt,
      verifiedAt: ca.signatures?.verifiedBy?.date || ca.updatedAt,
      verifiedNotes:
        ca.signatures?.verifiedBy?.notes ||
        existing?.steps?.[1]?.notes ||
        (mappedStatus === 'Pending Approval' || mappedStatus === 'Approved'
          ? 'Pos anggaran dan rincian biaya telah diverifikasi oleh A2 (Finance).'
          : undefined),
      completedAt: ca.signatures?.approvedBy?.date || ca.updatedAt,
      directorNotes:
        ca.signatures?.approvedBy?.notes ||
        existing?.steps?.[2]?.notes ||
        (mappedStatus === 'Approved'
          ? 'Pengajuan Cash Advance disetujui oleh Direktur untuk pencairan dana.'
          : undefined),
      refPrefix: ca.id.toUpperCase(),
    });

    const isDisbursed = Boolean(
      ca.status === 'Dicairkan' || ca.signatures?.disbursedBy?.isDisbursed
    );
    const disbursedByName = ca.signatures?.disbursedBy?.name || 'Ratna Sari';
    const disbursedAt = ca.signatures?.disbursedBy?.date || ca.updatedAt;
    const transferRef = ca.signatures?.disbursedBy?.transferReference;
    const bankSource = ca.signatures?.disbursedBy?.bankSource;

    const defaultTimeline: ApprovalTimelineEvent[] = existing?.timeline?.length
      ? existing.timeline
      : [
          {
            id: `tl-${itemId}-1`,
            timestamp: ca.createdAt || new Date().toISOString(),
            actorId: raci.responsibleUserId,
            actorName: raci.responsibleUserName,
            actorRoleCode: 'R',
            actorRoleTitle: 'Responsible (Pemohon Dana)',
            responsibleName: raci.responsibleUserName,
            actionLabel: 'Mengajukan Cash Advance Request',
            resultingStatus: 'Pending Verification',
            comment: `Pengajuan uang muka operasional ${ca.advanceNumber} sebesar Rp ${Number(ca.totalAmount || 0).toLocaleString('id-ID')}.`,
            version: 1,
          },
          ...(mappedStatus === 'Pending Approval' || mappedStatus === 'Approved'
            ? [
                {
                  id: `tl-${itemId}-2`,
                  timestamp: ca.signatures?.verifiedBy?.date || ca.updatedAt,
                  actorId: raci.accountableFinanceUserId,
                  actorName: raci.accountableFinanceUserName,
                  actorRoleCode: 'A2' as const,
                  actorRoleTitle: 'Accountable Finance',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Memverifikasi Cash Advance (Tahap A2)',
                  resultingStatus: 'Pending Approval' as ApprovalHubStatus,
                  comment:
                    ca.signatures?.verifiedBy?.notes ||
                    'Kode anggaran, rincian biaya, dan kepatuhan dokumen pendukung telah terverifikasi.',
                  version: 1,
                },
              ]
            : []),
          ...(mappedStatus === 'Approved'
            ? [
                {
                  id: `tl-${itemId}-3`,
                  timestamp: ca.signatures?.approvedBy?.date || ca.updatedAt,
                  actorId: raci.directorUserId,
                  actorName: raci.directorUserName,
                  actorRoleCode: 'Direktur' as const,
                  actorRoleTitle: 'Executive Director',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Menyetujui Akhir Cash Advance (Direktur)',
                  resultingStatus: 'Approved' as ApprovalHubStatus,
                  comment:
                    ca.signatures?.approvedBy?.notes ||
                    'Disetujui akhir oleh Direktur Eksekutif.',
                  version: 1,
                },
              ]
            : []),
          ...(isDisbursed
            ? [
                {
                  id: `tl-${itemId}-4`,
                  timestamp: disbursedAt || ca.updatedAt,
                  actorId: raci.accountableFinanceUserId,
                  actorName: disbursedByName,
                  actorRoleCode: 'A2' as const,
                  actorRoleTitle: 'Kasir / Finance Officer',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Mencairkan Dana Cash Advance ke Pengaju (Finance)',
                  resultingStatus: 'Approved' as ApprovalHubStatus,
                  comment: `Dana sebesar Rp ${Number(ca.totalAmount || 0).toLocaleString('id-ID')} telah dicairkan ke rekening ${ca.bankName} (${ca.bankAccountNumber} a.n. ${ca.bankAccountHolder})${transferRef ? ` — Ref: ${transferRef}` : ''}.`,
                  version: 1,
                },
              ]
            : []),
        ];

    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: ca.id,
      sourceTorId: parentTor.id,
      sourceCashAdvanceId: ca.id,
      referenceNumber: caAdvanceNumber,
      title: `Cash Advance: ${ca.activityTitle || parentTor.title}`,
      groupType: 'financial_documents',
      categoryCode: 'cash_advance',
      categoryLabel: CATEGORY_META.cash_advance.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked: mappedStatus === 'Approved' || mappedStatus === 'Archived',
      submittedAt: existing?.submittedAt || ca.requestDate || ca.createdAt,
      dueDate: ca.reportingDeadlineDate || parentTor.reportingDeadline,
      completedAt:
        mappedStatus === 'Approved'
          ? ca.signatures?.approvedBy?.date || ca.updatedAt
          : existing?.completedAt,
      isArchived: mappedStatus === 'Archived',
      previewData: {
        summaryText:
          ca.implementationTimelineSummary ||
          `Pengajuan dana operasional untuk kegiatan ${ca.activityTitle || parentTor.title} (${ca.location || parentTor.location || '-'}).`,
        location: ca.location || parentTor.location,
        activityPeriod: `${ca.activityStartDate} s/d ${ca.activityEndDate}`,
        purposeOfFunds:
          ca.implementationTimelineSummary ||
          `Pembiayaan pelaksanaan aktivitas lapangan pada ${ca.activityTitle || parentTor.title} sesuai ToR ${caTorNumber}.`,
        budgetLines: (ca.items || []).map((it) => ({
          code: it.budgetCode || '1.1.1',
          description: `${it.description} (${it.volume} ${it.unit} × ${it.frequency} ${it.frequencyUnit || 'Kali'})`,
          amount: Number(it.totalAmount) || 0,
        })),
        requestedAmount: Number(ca.totalAmount) || 0,
        plannedUsageDate: `${ca.activityStartDate} s/d ${ca.activityEndDate}`,
        plannedSettlementDate:
          ca.reportingDeadlineDate || parentTor.reportingDeadline || '-',
        isDisbursed,
        disbursedByName: isDisbursed ? disbursedByName : undefined,
        disbursedAt: isDisbursed ? disbursedAt : undefined,
        transferReference: isDisbursed ? transferRef : undefined,
        bankSource: isDisbursed ? bankSource : undefined,
        attachments: [
          {
            label: `Referensi Dokumen ToR (${caTorNumber})`,
            url: `#tor-ref-${parentTor.id}`,
            refCode: caTorNumber,
          },
          {
            label: `Rincian Anggaran & Rekening Tujuan (${ca.bankName} - ${ca.bankAccountNumber})`,
            url: `#ca-items-${ca.id}`,
            refCode: caAdvanceNumber,
          },
        ],
      },
      updatedAt: existing?.updatedAt || ca.updatedAt || ca.createdAt,
    };

    // 3. Sync Final Financial Report (Laporan Keuangan Akhir) -> R -> A2 -> Direktur (Persetujuan Akhir)
    // Hanya muncul sebagai pengajuan aktif apabila R telah menutup/mengirimkan laporan keuangan (ca.isReported === true)
    if (ca.isReported) {
      const finItemId = `apv-finrep-${ca.id}`;
      const existingFin = draft.approvalHubItems[finItemId];
      const approvedAmt = Number(ca.totalAmount) || 0;
      const realizedAmt =
        typeof ca.realizedAmount === 'number'
          ? ca.realizedAmount
          : (ca.items || []).reduce(
              (acc, it) =>
                acc +
                (typeof it.actualSpent === 'number' ? it.actualSpent : Number(it.totalAmount) || 0),
              0
            );
      const diffAmt = approvedAmt - realizedAmt;
      const remainingAmt = diffAmt > 0 ? diffAmt : 0;

      let finStatus: ApprovalHubStatus = existingFin?.status || 'Pending Verification';
      if (existingFin?.status === 'Archived') {
        finStatus = 'Archived';
      } else if (ca.reportApprovalStatus === 'Menunggu Pemeriksaan Finance') {
        finStatus = 'Pending Verification'; // Menunggu verifikasi A2
      } else if (ca.reportApprovalStatus === 'Menunggu Persetujuan Director') {
        finStatus = 'Pending Approval'; // Menunggu persetujuan akhir Direktur
      } else if (ca.reportApprovalStatus === 'Telah Disetujui') {
        finStatus = 'Approved';
      } else if (ca.reportApprovalStatus === 'Perlu Revisi') {
        finStatus = 'Revision Required';
      } else if (ca.reportApprovalStatus === 'Ditolak') {
        finStatus = 'Rejected';
      } else if (!ca.reportApprovalStatus) {
        // Fallback jika ca.isReported true pada data seed lama yang sudah disetujui
        finStatus = existingFin?.status || 'Approved';
      }

      const finWfConfig = configs['laporan_keuangan_akhir'];
      const finRefNumber = caAdvanceNumber
        ? caAdvanceNumber.replace(/^CA\//, 'LPJ-FIN/')
        : `LPJ-FIN/${ca.id}`;
      const finStepInfo = buildStepsForStatus({
        categoryCode: 'laporan_keuangan_akhir',
        status: finStatus,
        ...raci,
        submittedAt: ca.reportedAt || ca.updatedAt,
        verifiedAt: ca.reportVerifiedAt || ca.updatedAt,
        verifiedNotes:
          ca.reportVerifiedNotes ||
          existingFin?.steps?.[1]?.notes ||
          (finStatus === 'Pending Approval' || finStatus === 'Approved'
            ? 'Bukti transaksi, nota pengeluaran, dan lampiran PDF Expensify telah diverifikasi oleh A2.'
            : undefined),
        completedAt: ca.reportApprovedAt || ca.updatedAt,
        directorNotes:
          ca.reportApprovedNotes ||
          existingFin?.steps?.[2]?.notes ||
          (finStatus === 'Approved'
            ? 'Laporan Keuangan Akhir telah disetujui akhir oleh Direktur.'
            : undefined),
        refPrefix: `FIN-${ca.id.toUpperCase()}`,
      });

      const finTimeline: ApprovalTimelineEvent[] =
        existingFin?.timeline?.length && existingFin.status === finStatus
          ? existingFin.timeline
          : [
              {
                id: `tl-${finItemId}-1`,
                timestamp: ca.reportedAt || ca.updatedAt || new Date().toISOString(),
                actorId: raci.responsibleUserId,
                actorName: raci.responsibleUserName,
                actorRoleCode: 'R',
                actorRoleTitle: 'Responsible (Pelaksana Kegiatan)',
                responsibleName: raci.responsibleUserName,
                actionLabel: 'Mengonfirmasi & Mengajukan Laporan Keuangan Akhir',
                resultingStatus:
                  finStatus === 'Draft' ? 'Draft' : 'Pending Verification',
                comment:
                  ca.reportNotes ||
                  `Konfirmasi realisasi pengeluaran Rp ${realizedAmt.toLocaleString('id-ID')} dari pagu Cash Advance Rp ${approvedAmt.toLocaleString('id-ID')}.`,
                version: 1,
              },
              ...(finStatus === 'Pending Approval' || finStatus === 'Approved'
                ? [
                    {
                      id: `tl-${finItemId}-2`,
                      timestamp: ca.reportVerifiedAt || ca.updatedAt,
                      actorId: raci.accountableFinanceUserId,
                      actorName: raci.accountableFinanceUserName,
                      actorRoleCode: 'A2' as const,
                      actorRoleTitle: 'Accountable Finance',
                      responsibleName: raci.responsibleUserName,
                      actionLabel: 'Memverifikasi Laporan Keuangan Akhir (Tahap A2)',
                      resultingStatus: 'Pending Approval' as ApprovalHubStatus,
                      comment:
                        ca.reportVerifiedNotes ||
                        'Bukti transaksi, rekonsiliasi sisa dana, dan lampiran Expensify sesuai.',
                      version: 1,
                    },
                  ]
                : []),
              ...(finStatus === 'Approved'
                ? [
                    {
                      id: `tl-${finItemId}-3`,
                      timestamp: ca.reportApprovedAt || ca.updatedAt,
                      actorId: raci.directorUserId,
                      actorName: raci.directorUserName,
                      actorRoleCode: 'Direktur' as const,
                      actorRoleTitle: 'Executive Director',
                      responsibleName: raci.responsibleUserName,
                      actionLabel: 'Menyetujui Akhir Laporan Keuangan (Direktur)',
                      resultingStatus: 'Approved' as ApprovalHubStatus,
                      comment:
                        ca.reportApprovedNotes ||
                        'Laporan pertanggungjawaban keuangan akhir disetujui dan ditutup.',
                      version: 1,
                    },
                  ]
                : []),
            ];

      draft.approvalHubItems[finItemId] = {
        id: finItemId,
        sourceEntityId: ca.id,
        sourceTorId: parentTor.id,
        sourceCashAdvanceId: ca.id,
        referenceNumber: finRefNumber,
        title: `Laporan Keuangan Akhir: ${ca.activityTitle}`,
        groupType: 'financial_documents',
        categoryCode: 'laporan_keuangan_akhir',
        categoryLabel: CATEGORY_META.laporan_keuangan_akhir.label,
        ...hier,
        ...raci,
        status: finStatus,
        currentStepNumber: finStepInfo.currentStepNumber,
        currentActiveRole: finStepInfo.currentActiveRole,
        workflowMechanism: existingFin?.workflowMechanism || finWfConfig.mechanism,
        parallelRule: existingFin?.parallelRule || finWfConfig.parallelRule,
        steps: finStepInfo.steps,
        timeline: finTimeline,
        version: existingFin?.version || 1,
        isLocked: finStatus === 'Approved' || finStatus === 'Archived',
        submittedAt: existingFin?.submittedAt || ca.reportedAt || ca.updatedAt,
        dueDate: ca.reportingDeadlineDate || parentTor.reportingDeadline,
        completedAt:
          finStatus === 'Approved'
            ? ca.reportApprovedAt || ca.updatedAt
            : existingFin?.completedAt,
        isArchived: finStatus === 'Archived',
        previewData: {
          summaryText:
            ca.reportNotes ||
            `Laporan pertanggungjawaban keuangan akhir atas Cash Advance ${ca.advanceNumber}.`,
          location: ca.location,
          activityPeriod: `${ca.activityStartDate} s/d ${ca.activityEndDate}`,
          cashAdvanceReferenceNumber: ca.advanceNumber,
          approvedAmount: approvedAmt,
          realizedAmount: realizedAmt,
          budgetVariance: diffAmt,
          remainingFunds: remainingAmt,
          varianceExplanation:
            ca.reportNotes ||
            (diffAmt === 0
              ? 'Realisasi pengeluaran 100% sesuai dengan rincian anggaran Cash Advance yang disetujui.'
              : diffAmt > 0
              ? `Terdapat efisiensi/sisa dana sebesar Rp ${diffAmt.toLocaleString('id-ID')} yang telah dikembalikan ke kas organisasi.`
              : `Terdapat selisih kurang (minus) sebesar Rp ${Math.abs(diffAmt).toLocaleString('id-ID')} karena penyesuaian kebutuhan riil di lapangan.`),
          expensifyPdfLink:
            ca.expensifyPdfLink ||
            'https://drive.google.com/file/d/expensify-verified-receipts/view',
          attachments: [
            {
              label: `Bukti Transaksi & PDF Expensify (${finRefNumber})`,
              url:
                ca.expensifyPdfLink ||
                'https://drive.google.com/file/d/expensify-verified-receipts/view',
              refCode: ca.advanceNumber,
            },
            {
              label: `Referensi Cash Advance (${ca.advanceNumber})`,
              url: `#ca-ref-${ca.id}`,
              refCode: ca.advanceNumber,
            },
          ],
        },
        updatedAt: existingFin?.updatedAt || ca.updatedAt,
      };
    }
  }

  // 4. Sync Notulen Rapat (Meeting Minutes) -> R -> A1 -> Direktur (Pelaporan)
  for (const mm of meetingMinutes) {
    const parentTor = tors.find(
      (t) => t.id === mm.torId || (Boolean(mm.torNumber) && t.torNumber === mm.torNumber)
    );
    if (!parentTor) continue;
    const itemId = `apv-notulen-${mm.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      mm.createdById || parentTor.picId,
      mm.recorderName || mm.createdByName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];

    const mappedStatus: ApprovalHubStatus = existing?.status || 'Pending Verification';
    const wfConfig = configs['notulen'];
    const stepInfo = buildStepsForStatus({
      categoryCode: 'notulen',
      status: mappedStatus,
      ...raci,
      submittedAt: mm.createdAt,
      verifiedAt: mm.updatedAt,
      refPrefix: mm.id.toUpperCase(),
    });

    const defaultTimeline: ApprovalTimelineEvent[] = existing?.timeline?.length
      ? existing.timeline
      : [
          {
            id: `tl-${itemId}-1`,
            timestamp: mm.createdAt || new Date().toISOString(),
            actorId: raci.responsibleUserId,
            actorName: raci.responsibleUserName,
            actorRoleCode: 'R',
            actorRoleTitle: 'Responsible (Notulis / Pelaksana)',
            responsibleName: raci.responsibleUserName,
            actionLabel: 'Mengajukan Notulen Rapat',
            resultingStatus: 'Pending Verification',
            comment: `Notulen "${mm.title}" (${mm.documentNumber}) diajukan untuk diverifikasi oleh A1.`,
            version: 1,
          },
        ];

    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: mm.id,
      sourceTorId: parentTor.id,
      sourceCashAdvanceId: mm.cashAdvanceId,
      referenceNumber: mm.documentNumber,
      title: mm.title,
      groupType: 'program_documents',
      categoryCode: 'notulen',
      categoryLabel: CATEGORY_META.notulen.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked:
        mappedStatus === 'Approved' ||
        mappedStatus === 'Reported to Director' ||
        mappedStatus === 'Archived',
      submittedAt: existing?.submittedAt || mm.createdAt,
      dueDate: parentTor.reportingDeadline,
      completedAt: existing?.completedAt,
      isArchived: mappedStatus === 'Archived',
      previewData: {
        summaryText:
          mm.discussions?.[0]?.summary ||
          `Notulen rapat kegiatan ${mm.title} pada ${mm.meetingDate} di ${mm.meetingLocation}.`,
        location: `${mm.meetingLocation} (${mm.meetingRoomPlatform})`,
        activityPeriod: `${mm.meetingDate} · ${mm.startTime}–${mm.endTime}`,
        attachments: [
          {
            label: `Dokumen Notulen Rapat (${mm.documentNumber})`,
            url: `#notulen-${mm.id}`,
            refCode: mm.documentNumber,
          },
        ],
        keyHighlights: [
          {
            label: 'Peserta & Pencatat',
            value: `${(mm.participants || []).length} Peserta · Notulis: ${mm.recorderName}`,
          },
          {
            label: 'Pokok Pembahasan',
            value: (mm.discussions || []).map((d) => d.topic).join('; ') || '-',
          },
          {
            label: 'Keputusan Rapat',
            value: (mm.decisions || []).map((d) => d.statement).join('; ') || '-',
          },
          {
            label: 'Rencana Tindak Lanjut',
            value: `${(mm.actionPoints || []).length} Butir Tindak Lanjut (Action Points)`,
          },
        ],
      },
      updatedAt: existing?.updatedAt || mm.updatedAt || mm.createdAt,
    };
  }

  // 5. Sync Dokumentasi Kegiatan -> R -> A1 -> Direktur (Pelaporan)
  for (const doc of docList) {
    if (!doc || !doc.torId) continue;
    const parentTor = tors.find((t) => t.id === doc.torId);
    if (!parentTor) continue;
    const itemId = `apv-doc-${doc.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      doc.updatedById || parentTor.picId,
      doc.updatedByName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];

    const isSeededDoc = doc.id === 'doc-act-tor-1' || doc.id.startsWith('doc-seed-');
    const mappedStatus: ApprovalHubStatus =
      existing?.status || (isSeededDoc ? 'Approved' : 'Pending Verification');
    const wfConfig = configs['dokumentasi'];
    const refNumber =
      doc.documentNumber ||
      String(parentTor.torNumber || parentTor.id || '').replace(/^TOR\//, 'DOK/');
    const stepInfo = buildStepsForStatus({
      categoryCode: 'dokumentasi',
      status: mappedStatus,
      ...raci,
      submittedAt: doc.createdAt,
      verifiedAt: doc.updatedAt,
      verifiedNotes:
        existing?.steps?.[1]?.notes ||
        (mappedStatus === 'Approved' || mappedStatus === 'Reported to Director'
          ? 'Dokumentasi foto terbaik, Human Interest Story, dan tautan bukti kegiatan telah diverifikasi oleh A1.'
          : undefined),
      directorNotes: existing?.steps?.[2]?.notes,
      refPrefix: doc.id.toUpperCase(),
    });

    const defaultTimeline: ApprovalTimelineEvent[] = existing?.timeline?.length
      ? existing.timeline
      : [
          {
            id: `tl-${itemId}-1`,
            timestamp: doc.createdAt || new Date().toISOString(),
            actorId: raci.responsibleUserId,
            actorName: raci.responsibleUserName,
            actorRoleCode: 'R',
            actorRoleTitle: 'Responsible (Pelaksana Kegiatan)',
            responsibleName: raci.responsibleUserName,
            actionLabel: 'Mengajukan Dokumentasi Kegiatan',
            resultingStatus: 'Pending Verification',
            comment: `Pengajuan paket dokumentasi kegiatan "${doc.activityTitle}" (${(doc.bestPhotos || []).length} Foto Terbaik & ${(doc.humanInterestStories || []).length} Human Interest Story).`,
            version: 1,
          },
          ...(mappedStatus === 'Approved' || mappedStatus === 'Reported to Director'
            ? [
                {
                  id: `tl-${itemId}-2`,
                  timestamp: doc.updatedAt || new Date().toISOString(),
                  actorId: raci.accountableProgramUserId,
                  actorName: raci.accountableProgramUserName,
                  actorRoleCode: 'A1' as const,
                  actorRoleTitle: 'Accountable Program',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Memverifikasi & Menyetujui Dokumentasi (Tahap A1)',
                  resultingStatus: 'Approved' as ApprovalHubStatus,
                  comment:
                    'Kelengkapan foto lapangan, atribusi fotografer, dan narasi cerita telah sesuai.',
                  version: 1,
                },
              ]
            : []),
        ];

    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: doc.id,
      sourceTorId: parentTor.id,
      referenceNumber: refNumber,
      title: `Dokumentasi: ${doc.activityTitle || parentTor.title}`,
      groupType: 'program_documents',
      categoryCode: 'dokumentasi',
      categoryLabel: CATEGORY_META.dokumentasi.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked:
        mappedStatus === 'Approved' ||
        mappedStatus === 'Reported to Director' ||
        mappedStatus === 'Archived',
      submittedAt: existing?.submittedAt || doc.createdAt,
      dueDate: parentTor.reportingDeadline,
      completedAt: existing?.completedAt,
      isArchived: mappedStatus === 'Archived',
      previewData: {
        summaryText:
          doc.bestPhotosStoryTopic ||
          `Dokumentasi visual & Human Interest Story kegiatan ${doc.activityTitle}.`,
        location: parentTor.location,
        activityPeriod: `${parentTor.startDate} s/d ${parentTor.endDate}`,
        attachments: [
          ...(doc.generalPhotoLinks || []).map((g, i) => ({
            label: `Tautan Folder Dokumentasi #${i + 1}`,
            url: g.url,
            refCode: refNumber,
          })),
          ...(doc.bestPhotos || [])
            .filter((p) => p.photoLink)
            .slice(0, 3)
            .map((p) => ({
              label: `Foto Terbaik #${p.slotNumber}: ${p.photoNameTitle}`,
              url: p.photoLink,
              refCode: `FOTO-${p.slotNumber}`,
            })),
        ],
        keyHighlights: [
          { label: 'Topik Cerita Utama', value: doc.bestPhotosStoryTopic || '-' },
          {
            label: 'Foto Terbaik Terkurasi',
            value: `${(doc.bestPhotos || []).filter((p) => p.photoLink).length} / 5 Slot Foto Terisi`,
          },
          {
            label: 'Human Interest Story',
            value:
              (doc.humanInterestStories || []).map((s) => s.storyTitle).join('; ') ||
              '-',
          },
        ],
      },
      updatedAt: existing?.updatedAt || doc.updatedAt || doc.createdAt,
    };
  }

  // 6. Sync Executive Summary (Ringkasan Eksekutif) -> R -> A1 -> Direktur (Pelaporan)
  const execItems = monReports.filter((m) => m.toolId === 'EXEC-SUMMARY');
  for (const exec of execItems) {
    const parentTor = tors.find((t) => t.id === exec.torId);
    if (!parentTor) continue;
    const itemId = `apv-exec-${exec.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      exec.responsibleUserId || parentTor.picId,
      exec.responsibleName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];

    let mappedStatus: ApprovalHubStatus = existing?.status || 'Pending Verification';
    if (!existing || existing.status === 'Draft') {
      if (exec.status === 'Planned') {
        mappedStatus = 'Draft';
      } else if (exec.status === 'In Progress' || exec.status === 'Completed') {
        const isLegacySeed = !existing && exec.id.startsWith('tor-1__') && exec.status === 'Completed';
        mappedStatus = isLegacySeed ? 'Reported to Director' : 'Pending Verification';
      }
    }

    const wfConfig = configs['executive_summary'];
    const refNumber = String(parentTor.torNumber || parentTor.id || '').replace(/^TOR\//, 'EXEC/');
    const stepInfo = buildStepsForStatus({
      categoryCode: 'executive_summary',
      status: mappedStatus,
      ...raci,
      submittedAt: exec.createdAt,
      verifiedAt: exec.updatedAt,
      verifiedNotes:
        existing?.steps?.[1]?.notes ||
        (mappedStatus === 'Approved' || mappedStatus === 'Reported to Director'
          ? 'Ketujuh bagian Executive Summary (Baseline s/d Usulan Implementasi) dan bukti lapangan telah diverifikasi oleh A1.'
          : undefined),
      completedAt: exec.updatedAt,
      directorNotes:
        existing?.steps?.[2]?.notes ||
        (mappedStatus === 'Reported to Director'
          ? 'Executive Summary 7 Hari telah diterima oleh Direktur sebagai laporan akhir kegiatan.'
          : undefined),
      refPrefix: `EXEC-${parentTor.id.toUpperCase()}`,
    });

    const wasPromotedFromDraft = existing?.status === 'Draft' && mappedStatus === 'Pending Verification';
    const defaultTimeline: ApprovalTimelineEvent[] =
      existing?.timeline?.length && !wasPromotedFromDraft
        ? existing.timeline
        : [
            {
              id: `tl-${itemId}-1`,
              timestamp: (wasPromotedFromDraft ? exec.updatedAt : exec.createdAt) || new Date().toISOString(),
              actorId: raci.responsibleUserId,
              actorName: raci.responsibleUserName,
              actorRoleCode: 'R',
              actorRoleTitle: 'Responsible (Pelaksana Kegiatan)',
              responsibleName: raci.responsibleUserName,
              actionLabel: 'Menyusun & Mengajukan Executive Summary',
              resultingStatus:
                mappedStatus === 'Draft' ? 'Draft' : 'Pending Verification',
              comment: `Pengajuan Executive Summary (7 Bagian Pembelajaran & Bukti MEAL) untuk ${exec.cashAdvanceActivitySummary}.`,
              version: 1,
            },
          ...(mappedStatus === 'Approved' || mappedStatus === 'Reported to Director'
            ? [
                {
                  id: `tl-${itemId}-2`,
                  timestamp: exec.updatedAt || new Date().toISOString(),
                  actorId: raci.accountableProgramUserId,
                  actorName: raci.accountableProgramUserName,
                  actorRoleCode: 'A1' as const,
                  actorRoleTitle: 'Accountable Program',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Memverifikasi Executive Summary (Tahap A1)',
                  resultingStatus: 'Approved' as ApprovalHubStatus,
                  comment:
                    'Capaian indikator, pembelajaran konteks, dan rekomendasi tindak lanjut telah terverifikasi.',
                  version: 1,
                },
              ]
            : []),
          ...(mappedStatus === 'Reported to Director'
            ? [
                {
                  id: `tl-${itemId}-3`,
                  timestamp: exec.updatedAt || new Date().toISOString(),
                  actorId: raci.directorUserId,
                  actorName: raci.directorUserName,
                  actorRoleCode: 'Direktur' as const,
                  actorRoleTitle: 'Executive Director',
                  responsibleName: raci.responsibleUserName,
                  actionLabel: 'Menerima Laporan Executive Summary (Direktur)',
                  resultingStatus: 'Reported to Director' as ApprovalHubStatus,
                  comment:
                    'Executive Summary resmi diterima Direktur sebagai laporan akhir kegiatan 7 hari.',
                  version: 1,
                },
              ]
            : []),
        ];

    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: exec.id,
      sourceTorId: parentTor.id,
      sourceCashAdvanceId: exec.cashAdvanceId,
      referenceNumber: refNumber,
      title: `Executive Summary: ${exec.timelineActivity || parentTor.title}`,
      groupType: 'program_documents',
      categoryCode: 'executive_summary',
      categoryLabel: CATEGORY_META.executive_summary.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked:
        mappedStatus === 'Approved' ||
        mappedStatus === 'Reported to Director' ||
        mappedStatus === 'Archived',
      submittedAt: existing?.submittedAt || exec.createdAt,
      dueDate: parentTor.reportingDeadline,
      completedAt:
        mappedStatus === 'Reported to Director' ? exec.updatedAt : existing?.completedAt,
      isArchived: mappedStatus === 'Archived',
      previewData: {
        summaryText:
          exec.sections?.results?.narrative ||
          exec.sections?.intervention?.narrative ||
          `Ringkasan eksekutif 7 bagian (Baseline, Intervensi, Hasil, Context Learning, Reflection, Participation, UsulanSelanjutnya) untuk ${exec.cashAdvanceActivitySummary}.`,
        location: parentTor.location,
        activityPeriod: exec.timelinePeriod || `${parentTor.startDate} s/d ${parentTor.endDate}`,
        attachments: [
          ...(exec.mainEvidenceFolderUrl
            ? [
                {
                  label: 'Folder Bukti Utama (Main Evidence Folder)',
                  url: exec.mainEvidenceFolderUrl,
                  refCode: 'EVIDENCE-MAIN',
                },
              ]
            : []),
          ...hier.monitoringTools.map((t) => ({
            label: `Terhubung Monitoring Tool: [${t.toolId}] ${t.toolName}`,
            url: t.toolUrl || `#tool-${t.toolId}`,
            refCode: t.toolId,
          })),
        ],
        keyHighlights: [
          {
            label: 'A. Baseline',
            value: exec.sections?.baseline?.narrative || 'Data kondisi awal sebelum intervensi kegiatan.',
          },
          {
            label: 'B. Intervensi & C. Hasil',
            value:
              exec.sections?.results?.narrative ||
              exec.sections?.intervention?.narrative ||
              'Proses penanganan lapangan dan hasil langsung pasca kegiatan.',
          },
          {
            label: 'D. Context & E. Reflection Learning',
            value:
              exec.sections?.reflectionLearning?.narrative ||
              exec.sections?.contextLearning?.narrative ||
              'Pembelajaran konteks lokal dan refleksi tim pelaksana.',
          },
          {
            label: 'F. Partisipasi & G. Usulan Selanjutnya',
            value:
              exec.sections?.nextImplementationProposal?.narrative ||
              'Rekomendasi tindak lanjut untuk implementasi tahap berikutnya.',
          },
        ],
      },
      updatedAt: existing?.updatedAt || exec.updatedAt || exec.createdAt,
    };
  }

  const cleanTitleForNotif = (rawTitle: string) =>
    (rawTitle || '').replace(
      /^(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/i,
      ''
    );

  const sanitizeNotifMessage = (msg: string) =>
    (msg || '')
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(
        /"(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/gi,
        '"'
      );

  // Ensure initial notifications exist for active non-draft items that do not yet have any notification
  const allItems = Object.values(draft.approvalHubItems);
  const existingItemNotifIds = new Set(
    (draft.approvalNotifications || []).map((n) => n.approvalItemId)
  );
  for (const item of allItems) {
    if (existingItemNotifIds.has(item.id)) continue;
    const cleanTitle = cleanTitleForNotif(item.title);
      if (item.status === 'Pending Verification') {
        const targetId =
          item.groupType === 'program_documents'
            ? item.accountableProgramUserId
            : item.accountableFinanceUserId;
        const targetRole: ApprovalRaciRoleCode =
          item.groupType === 'program_documents' ? 'A1' : 'A2';
        draft.approvalNotifications.unshift({
          id: `notif-init-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: 'ENTER_VERIFICATION',
          message: `"${cleanTitle}" menunggu verifikasi ${targetRole} (${
            targetRole === 'A1'
              ? item.accountableProgramUserName
              : item.accountableFinanceUserName
          }).`,
          targetUserIds: [targetId],
          targetRoleCodes: [targetRole],
          createdAt: item.updatedAt,
          isReadByUserIds: [],
        });
      } else if (
        item.status === 'Pending Approval' ||
        (item.status === 'Approved' && item.groupType === 'program_documents')
      ) {
        draft.approvalNotifications.unshift({
          id: `notif-dir-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType:
            item.groupType === 'program_documents' ? 'APPROVED' : 'ENTER_VERIFICATION',
          message:
            item.groupType === 'program_documents'
              ? `"${cleanTitle}" telah disetujui A1 (${item.accountableProgramUserName}) dan dilaporkan kepada Direktur.`
              : `"${cleanTitle}" telah diverifikasi A2 (${item.accountableFinanceUserName}) dan menunggu Persetujuan Akhir Direktur.`,
          targetUserIds: [item.directorUserId, item.responsibleUserId],
          targetRoleCodes: ['Direktur', 'R'],
          createdAt: item.updatedAt,
          isReadByUserIds: [],
        });
      } else if (
        item.status === 'Reported to Director' ||
        (item.status === 'Approved' && item.groupType === 'financial_documents')
      ) {
        draft.approvalNotifications.unshift({
          id: `notif-done-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: 'FINAL_COMPLETED',
          message:
            item.groupType === 'program_documents'
              ? `"${cleanTitle}" telah disetujui A1 & diterima Direktur. Silakan lanjutkan pelaksanaan kegiatan.`
              : `"${cleanTitle}" telah disetujui akhir oleh Direktur. Dana & dokumen siap ditindaklanjuti.`,
          targetUserIds: [item.responsibleUserId],
          targetRoleCodes: ['R'],
          createdAt: item.updatedAt,
          isReadByUserIds: [],
        });
      } else if (item.status === 'Revision Required') {
        const latestRevComment =
          item.timeline?.[0]?.comment || 'Mohon perbaiki dokumen sesuai catatan pemeriksa.';
        draft.approvalNotifications.unshift({
          id: `notif-rev-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: 'REVISION_REQUIRED',
          message: `"${cleanTitle}" dikembalikan untuk perbaikan: "${latestRevComment}".`,
          targetUserIds: [item.responsibleUserId],
          targetRoleCodes: ['R'],
          createdAt: item.updatedAt,
          isReadByUserIds: [],
        });
      } else if (item.status === 'Rejected') {
        draft.approvalNotifications.unshift({
          id: `notif-rej-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: 'REJECTED',
          message: `"${cleanTitle}" ditolak. Periksa catatan pemeriksa untuk tindak lanjut.`,
          targetUserIds: [item.responsibleUserId],
          targetRoleCodes: ['R'],
          createdAt: item.updatedAt,
          isReadByUserIds: [],
        });
    }
  }
  // Deduplicate notifications so the same document & event never appear twice
  const seenNotifKeys = new Set<string>();
  const dedupedNotifications = [];
  for (const notif of draft.approvalNotifications || []) {
    notif.message = sanitizeNotifMessage(notif.message);
    if (notif.documentTitle) {
      notif.documentTitle = cleanTitleForNotif(notif.documentTitle);
    }
    const normTargets = [...(notif.targetUserIds || [])].sort().join(',');
    const dedupeKey = `${notif.approvalItemId}|${notif.eventType}|${normTargets}|${notif.message}`;
    const initKey = `${notif.approvalItemId}|${notif.eventType}|${normTargets}`;
    if (seenNotifKeys.has(dedupeKey) || (notif.eventType === 'ENTER_VERIFICATION' && seenNotifKeys.has(initKey))) {
      continue;
    }
    seenNotifKeys.add(dedupeKey);
    seenNotifKeys.add(initKey);
    dedupedNotifications.push(notif);
  }
  draft.approvalNotifications = dedupedNotifications;

  const sortedItems = allItems.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const sortedNotifications = [...(draft.approvalNotifications || [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 60);

  return {
    items: sortedItems,
    configs,
    notifications: sortedNotifications,
  };
}

/**
 * Menentukan Hak Akses Menu Approval berdasarkan Role dari User Management & Penugasan RACI Dinamis.
 * Prinsip: Only Relevant Roles. Role-Based Visibility. Controlled Approval Authority.
 */
export function resolveUserApprovalAccess(
  draft: DatabaseSchema,
  user: User,
  allItems?: ApprovalHubItem[]
): ApprovalAccessProfile {
  const items = allItems || Object.values(draft.approvalHubItems || {});
  const raciList = Object.values(draft.outputRaciRecords || {});

  const isActiveUser = user.isActive !== false;
  const isAdmin = user.role === 'admin';
  const isDirector =
    isActiveUser &&
    !isAdmin &&
    (user.role === 'director' || items.some((i) => i.directorUserId === user.id));
  const isFinance = isActiveUser && !isAdmin && user.role === 'finance';

  // A1 ditentukan secara dinamis dari penugasan RACI (accountableUserId) atau penugasan A1 pada dokumen
  const isAssignedA1 =
    raciList.some((r) => r.accountableUserId === user.id) ||
    items.some((i) => i.accountableProgramUserId === user.id);
  const isA1 = isActiveUser && !isAdmin && isAssignedA1 && user.permissions?.canApproveTor !== false;

  // A2 ditentukan secara dinamis dari penugasan A2 (accountableFinanceUserId) dengan kewenangan persetujuan aktif
  const isAssignedA2 =
    raciList.some((r) => r.accountableFinanceUserId === user.id) ||
    items.some((i) => i.accountableFinanceUserId === user.id);
  const isA2 = isActiveUser && isAssignedA2 && !isAdmin && user.permissions?.canApproveTor !== false;

  // R ditentukan dari penugasan RACI (responsibleUserId) atau penugasan R pada dokumen / pelaksana
  const isR =
    isActiveUser &&
    !isAdmin &&
    (raciList.some((r) => r.responsibleUserId === user.id) ||
      items.some((i) => i.responsibleUserId === user.id) ||
      user.role === 'staff' ||
      user.role === 'meal' ||
      user.role === 'program_manager');

  // Menu Approval & Tracking Ticket dapat diakses oleh akun aktif: A1, A2, Direktur, Finance, serta R (Responsible) untuk Tracking Ticket.
  // Admin mengatur konfigurasi akses di User Management dan tidak otomatis memiliki akses/kewenangan persetujuan.
  const canAccessApprovalMenu =
    isActiveUser && !isAdmin && (isA1 || isA2 || isDirector || isFinance || isR);

  const activeApprovalRoles: ApprovalAccessProfile['activeApprovalRoles'] = [];
  if (isDirector) activeApprovalRoles.push('Direktur');
  if (isA1) activeApprovalRoles.push('A1 – Accountable Program');
  if (isA2) activeApprovalRoles.push('A2 – Accountable Finance');
  if (isFinance && !isA2) activeApprovalRoles.push('Finance');
  if (isR) activeApprovalRoles.push('R – Responsible');

  let scopeSummary = 'Tidak memiliki akses ke Menu Approval.';
  if (isDirector) {
    scopeSummary =
      'Direktur: Melihat seluruh pengajuan program & keuangan, persetujuan akhir keuangan, dan penerimaan laporan program.';
  } else if (isA1 && (isA2 || isFinance)) {
    scopeSummary =
      'A1 & Keuangan: Melihat dokumen program sesuai RACI A1 serta dokumen keuangan.';
  } else if (isA1) {
    scopeSummary =
      'A1 – Accountable Program: Hanya melihat, memverifikasi, menyetujui, dan mengembalikan dokumen program sesuai penugasan RACI.';
  } else if (isA2) {
    scopeSummary =
      'A2 – Accountable Finance: Hanya melihat, memverifikasi, dan mengembalikan dokumen keuangan yang menjadi tanggung jawabnya.';
  } else if (isFinance) {
    scopeSummary =
      'Finance: Melihat pengajuan keuangan, memantau verifikasi, dan mengelola pencatatan keuangan (tanpa kewenangan persetujuan otomatis).';
  } else if (isR) {
    scopeSummary =
      'R – Responsible: Memantau seluruh perjalanan persetujuan dokumen melalui Tracking Ticket (R → A1/A2 → Direktur), berdiskusi dengan pemeriksa, dan menindaklanjuti revisi.';
  }

  return {
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    isA1,
    isA2,
    isDirector,
    isFinance,
    isR,
    isAdmin,
    canAccessApprovalMenu,
    canApproveProgramDocs: !isAdmin && isA1,
    canVerifyFinanceDocs: !isAdmin && isA2,
    canFinalApproveDirector: !isAdmin && isDirector,
    activeApprovalRoles,
    scopeSummary,
  };
}

/**
 * Memeriksa apakah pengguna berhak melihat dokumen pengajuan tertentu di Menu Approval:
 * - Direktur: seluruh pengajuan program dan keuangan
 * - A1: hanya pengajuan dokumen program yang menjadi tanggung jawabnya berdasarkan RACI
 * - A2: hanya pengajuan dokumen keuangan yang menjadi tanggung jawabnya
 * - Finance: seluruh dokumen keuangan yang relevan dengan tugasnya
 * - R / Admin: tidak memiliki visibilitas di Menu Approval (R memantau melalui Monitoring Tools)
 */
export function canUserViewApprovalItem(
  item: ApprovalHubItem,
  user: User,
  access: ApprovalAccessProfile
): boolean {
  if (!access.canAccessApprovalMenu) return false;

  if (access.isDirector) {
    return true;
  }

  const normUserName = String(user.name || '').trim().toLowerCase();
  const isProgramDoc = item.groupType === 'program_documents';
  const isFinanceDoc = item.groupType === 'financial_documents';

  if (
    isProgramDoc &&
    access.isA1 &&
    (item.accountableProgramUserId === user.id ||
      (Boolean(normUserName) &&
        String(item.accountableProgramUserName || '').trim().toLowerCase() === normUserName))
  ) {
    return true;
  }

  if (
    isFinanceDoc &&
    access.isA2 &&
    (item.accountableFinanceUserId === user.id ||
      (Boolean(normUserName) &&
        String(item.accountableFinanceUserName || '').trim().toLowerCase() === normUserName))
  ) {
    return true;
  }

  if (isFinanceDoc && access.isFinance) {
    return true;
  }

  // Responsible (R) dapat melihat tiket dokumen miliknya sendiri untuk pemantauan progres
  if (
    access.isR &&
    (item.responsibleUserId === user.id ||
      (Boolean(normUserName) &&
        String(item.responsibleUserName || '').trim().toLowerCase() === normUserName))
  ) {
    return true;
  }

  // Peran manajemen program / MEAL dengan hak lihat seluruh ToR dapat memantau dokumen program secara baca-saja
  if (
    isProgramDoc &&
    (user.role === 'program_manager' || user.role === 'meal') &&
    user.permissions?.canViewAllTors !== false
  ) {
    return true;
  }

  return false;
}

export function filterApprovalItemsForUser(
  items: ApprovalHubItem[],
  user: User,
  access: ApprovalAccessProfile
): ApprovalHubItem[] {
  if (!access.canAccessApprovalMenu) return [];
  return items.filter((item) => canUserViewApprovalItem(item, user, access));
}

export function executeApprovalHubAction(params: {
  draft: DatabaseSchema;
  itemId: string;
  actor: User;
  action:
    | 'submit'
    | 'verify_approve'
    | 'report_to_director'
    | 'director_final_approve'
    | 'revision'
    | 'reject'
    | 'comment'
    | 'archive'
    | 'create_new_version'
    | 'request_edit'
    | 'approve_edit_request'
    | 'reject_edit_request';
  comment?: string;
}): { item: ApprovalHubItem; message: string } {
  const { draft, itemId, actor, action, comment = '' } = params;
  const synced = syncApprovalHubData(draft);

  const item = draft.approvalHubItems?.[itemId];
  if (!item) {
    throw new Error('Dokumen persetujuan tidak ditemukan.');
  }

  if (actor.isActive === false) {
    throw new Error(
      'Akun Anda berstatus Nonaktif dan tidak dapat melakukan tindakan pengajuan atau persetujuan.'
    );
  }

  const access = resolveUserApprovalAccess(draft, actor, synced.items);

  // Determine actor's dynamic RACI role on this specific item
  const isR = actor.id === item.responsibleUserId;
  const isA1 =
    !access.isAdmin &&
    item.groupType === 'program_documents' &&
    actor.id === item.accountableProgramUserId &&
    actor.permissions?.canApproveTor !== false;
  const isA2 =
    !access.isAdmin &&
    item.groupType === 'financial_documents' &&
    actor.id === item.accountableFinanceUserId &&
    actor.permissions?.canApproveTor !== false;
  const isDirector =
    !access.isAdmin && (actor.id === item.directorUserId || actor.role === 'director');
  const isFinanceObserver =
    !access.isAdmin && actor.role === 'finance' && item.groupType === 'financial_documents';
  const isProgramDoc = item.groupType === 'program_documents';

  // Pastikan pembatasan akses berlaku pada data dan tindakan:
  // Selain R (atau A1 khusus untuk request_edit ToR) yang mengelola dokumennya, pengguna wajib memiliki visibilitas sah atas dokumen ini.
  const canViewItem = canUserViewApprovalItem(item, actor, access);
  if (
    !canViewItem &&
    !(
      (isR &&
        (action === 'comment' ||
          action === 'submit' ||
          action === 'create_new_version' ||
          action === 'request_edit')) ||
      (isA1 && action === 'request_edit')
    )
  ) {
    throw new Error(
      'Akses ditolak: Anda tidak memiliki hak akses untuk melihat atau memproses dokumen pengajuan ini.'
    );
  }

  const trimmedComment = comment.trim();
  if (action === 'revision' && !trimmedComment) {
    throw new Error('Pengembalian untuk revisi wajib disertai komentar perbaikan.');
  }
  if (action === 'reject' && !trimmedComment) {
    throw new Error('Penolakan dokumen wajib disertai alasan penolakan.');
  }
  if (action === 'comment' && !trimmedComment) {
    throw new Error('Komentar tidak boleh kosong.');
  }
  if (action === 'request_edit' && !trimmedComment) {
    throw new Error('Alasan permintaan edit wajib diisi.');
  }

  let actorRoleCode: ApprovalRaciRoleCode | 'Admin' = 'C';
  if (
    isDirector &&
    (action === 'report_to_director' ||
      action === 'director_final_approve' ||
      action === 'approve_edit_request' ||
      action === 'reject_edit_request')
  ) {
    actorRoleCode = 'Direktur';
  } else if (isA1 && isProgramDoc) {
    actorRoleCode = 'A1';
  } else if (isA2 && !isProgramDoc) {
    actorRoleCode = 'A2';
  } else if (isR || action === 'request_edit') {
    actorRoleCode = 'R';
  } else if (isDirector) {
    actorRoleCode = 'Direktur';
  } else if (actor.role === 'admin') {
    actorRoleCode = 'Admin';
  }

  const nowIso = new Date().toISOString();
  let nextStatus: ApprovalHubStatus = item.status;
  let actionLabel = '';
  let notifType: ApprovalNotificationItem['eventType'] = 'ENTER_VERIFICATION';
  let notifMessage = '';
  let notifTargets: string[] = [];
  let notifRoles: ApprovalRaciRoleCode[] = [];

  const cleanItemTitle = (item.title || '').replace(
    /^(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/i,
    ''
  );

  // ==========================================================================
  // TERINTEGRASI DI APPROVAL TOR: REQUEST EDIT & KEPUTUSAN ACC/TOLAK EDIT DIREKTUR
  // ==========================================================================
  if (
    action === 'request_edit' ||
    action === 'approve_edit_request' ||
    action === 'reject_edit_request'
  ) {
    if (item.categoryCode !== 'tor') {
      throw new Error('Fitur Request Edit Dokumen saat ini khusus untuk tiket Approval ToR.');
    }
    const torIdx = (draft.tors || []).findIndex((t) => t.id === item.sourceTorId);
    if (torIdx === -1) {
      throw new Error('Dokumen ToR sumber tidak ditemukan.');
    }
    const tor = draft.tors[torIdx];

    if (action === 'request_edit') {
      if (actor.role === 'admin' || (!isR && !isA1)) {
        throw new Error(
          `Hanya R (${item.responsibleUserName}) dan A1 (${item.accountableProgramUserName}) pada ToR ini yang berwenang mengajukan izin Request Edit kepada Direktur.`
        );
      }
      const requesterRaciLabel = isA1 ? 'A1 – Accountable Program' : 'R – Responsible';
      const requesterRaciShort: ApprovalRaciRoleCode = isA1 ? 'A1' : 'R';

      tor.editRequestStatus = 'pending';
      tor.editRequestedById = actor.id;
      tor.editRequestedByName = actor.name;
      tor.editRequestedByRole = `${actor.roleTitle} (${requesterRaciShort})`;
      tor.editRequestedAt = nowIso;
      tor.editRequestReason = trimmedComment;
      tor.updatedAt = nowIso;

      item.previewData = {
        ...item.previewData,
        editRequestStatus: 'pending',
        editRequestedById: actor.id,
        editRequestedByName: actor.name,
        editRequestedByRole: `${actor.roleTitle} (${requesterRaciShort})`,
        editRequestedAt: nowIso,
        editRequestReason: trimmedComment,
      };
      item.currentStepNumber = 3;
      item.currentActiveRole = 'Direktur';
      if (item.steps?.[2]) {
        item.steps[2] = {
          ...item.steps[2],
          status: 'Sedang Berjalan',
          receivedAt: nowIso,
          notes: `Permintaan Akses Edit ToR dari ${actor.name} (${requesterRaciShort}): "${trimmedComment}"`,
        };
      }
      item.updatedAt = nowIso;

      actionLabel = `Mengajukan Request Edit Dokumen ToR ke Direktur (${requesterRaciShort})`;
      item.timeline.unshift({
        id: `tl-${item.id}-${Date.now()}`,
        timestamp: nowIso,
        actorId: actor.id,
        actorName: actor.name,
        actorRoleCode: requesterRaciShort,
        actorRoleTitle: actor.roleTitle,
        responsibleName: item.responsibleUserName,
        actionLabel,
        resultingStatus: item.status,
        comment: `Permintaan akses edit ToR oleh ${requesterRaciLabel} kepada Direktur: "${trimmedComment}"`,
        version: item.version,
      });

      if (!draft.approvalRecords) draft.approvalRecords = [];
      draft.approvalRecords.unshift({
        id: `app-${Date.now()}`,
        torId: tor.id,
        stage: 'Akses Edit',
        action: 'Request Edit',
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        comment: `Mengajukan izin edit (${requesterRaciShort}) kepada Direktur melalui Approval ToR: "${trimmedComment}"`,
        timestamp: nowIso,
        resultingStatus: tor.submissionStatus,
      });

      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      draft.approvalNotifications.unshift({
        id: `notif-edreq-${Date.now()}`,
        approvalItemId: item.id,
        referenceNumber: item.referenceNumber,
        documentTitle: item.title,
        categoryCode: 'tor',
        categoryLabel: item.categoryLabel,
        eventType: 'ENTER_VERIFICATION',
        message: `Request Edit ToR "${cleanItemTitle}" diajukan oleh ${actor.name} (${requesterRaciShort}) dan menunggu ACC Edit Direktur di Approval ToR. Alasan: "${trimmedComment}"`,
        targetUserIds: [item.directorUserId],
        targetRoleCodes: ['Direktur'],
        createdAt: nowIso,
        isReadByUserIds: [],
      });

      draft.auditLogs.unshift({
        id: `log-apv-edreq-${Date.now()}`,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: `${actor.roleTitle} (${requesterRaciShort})`,
        action: 'Approval ToR: Request Edit ke Direktur',
        entityType: 'TOR',
        entityId: tor.id,
        details: `[${item.referenceNumber}] ${actor.name} (${requesterRaciShort}) mengajukan Request Edit ToR ke Direktur: "${trimmedComment}"`,
        timestamp: nowIso,
      });

      return {
        item,
        message:
          'Permintaan edit dokumen ToR berhasil masuk ke tiket Approval ToR dan menunggu keputusan (ACC Edit) Direktur.',
      };
    }

    // approve_edit_request or reject_edit_request by Director
    if (!isDirector) {
      throw new Error(
        `Hanya Direktur (${item.directorUserName}) yang berwenang menyetujui (ACC) atau menolak Request Edit ToR.`
      );
    }
    const isApproveEdit = action === 'approve_edit_request';
    const effectiveNote =
      trimmedComment ||
      (isApproveEdit
        ? 'Permintaan akses edit dokumen ToR disetujui (ACC) oleh Direktur di Approval ToR.'
        : 'Permintaan akses edit dokumen ToR ditolak oleh Direktur di Approval ToR.');

    tor.editRequestStatus = isApproveEdit ? 'approved' : 'rejected';
    tor.editReviewedByName = actor.name;
    tor.editReviewedAt = nowIso;
    tor.editReviewComment = effectiveNote;
    tor.updatedAt = nowIso;

    item.previewData = {
      ...item.previewData,
      editRequestStatus: isApproveEdit ? 'approved' : 'rejected',
      editReviewedByName: actor.name,
      editReviewedAt: nowIso,
      editReviewComment: effectiveNote,
    };
    item.isLocked = !isApproveEdit;
    item.currentStepNumber = 3;
    item.currentActiveRole = 'Selesai';
    if (item.steps?.[2]) {
      item.steps[2] = {
        ...item.steps[2],
        status: 'Selesai',
        actedAt: nowIso,
        notes: effectiveNote,
      };
    }
    item.updatedAt = nowIso;

    actionLabel = isApproveEdit
      ? 'Menyetujui (ACC) Request Edit Dokumen ToR (Direktur)'
      : 'Menolak Request Edit Dokumen ToR (Direktur)';

    item.timeline.unshift({
      id: `tl-${item.id}-${Date.now()}`,
      timestamp: nowIso,
      actorId: actor.id,
      actorName: actor.name,
      actorRoleCode: 'Direktur',
      actorRoleTitle: actor.roleTitle,
      responsibleName: item.responsibleUserName,
      actionLabel,
      resultingStatus: item.status,
      comment: effectiveNote,
      version: item.version,
    });

    if (!draft.approvalRecords) draft.approvalRecords = [];
    draft.approvalRecords.unshift({
      id: `app-${Date.now()}`,
      torId: tor.id,
      stage: 'Akses Edit',
      action: isApproveEdit ? 'ACC Edit' : 'Tolak Edit',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      comment: effectiveNote,
      timestamp: nowIso,
      resultingStatus: tor.submissionStatus,
    });

    const targetUsers = Array.from(
      new Set(
        [
          item.responsibleUserId,
          item.accountableProgramUserId,
          tor.editRequestedById || '',
        ].filter(Boolean)
      )
    );
    if (!draft.approvalNotifications) draft.approvalNotifications = [];
    draft.approvalNotifications.unshift({
      id: `notif-edrev-${Date.now()}`,
      approvalItemId: item.id,
      referenceNumber: item.referenceNumber,
      documentTitle: item.title,
      categoryCode: 'tor',
      categoryLabel: item.categoryLabel,
      eventType: isApproveEdit ? 'APPROVED' : 'REJECTED',
      message: isApproveEdit
        ? `Request Edit ToR "${cleanItemTitle}" telah di-ACC oleh Direktur (${actor.name}). Dokumen ToR kini terbuka untuk diedit oleh R / A1.`
        : `Request Edit ToR "${cleanItemTitle}" ditolak oleh Direktur (${actor.name}): "${effectiveNote}"`,
      targetUserIds: targetUsers,
      targetRoleCodes: ['R', 'A1'],
      createdAt: nowIso,
      isReadByUserIds: [],
    });

    draft.auditLogs.unshift({
      id: `log-apv-edrev-${Date.now()}`,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: `${actor.roleTitle} (Direktur)`,
      action: isApproveEdit
        ? 'Approval ToR: ACC Request Edit ToR'
        : 'Approval ToR: Tolak Request Edit ToR',
      entityType: 'TOR',
      entityId: tor.id,
      details: `[${item.referenceNumber}] ${actionLabel} — Catatan: "${effectiveNote}"`,
      timestamp: nowIso,
    });

    return {
      item,
      message: isApproveEdit
        ? `Request Edit untuk ${item.referenceNumber} berhasil di-ACC. Dokumen ToR kini terbuka untuk diedit.`
        : `Request Edit untuk ${item.referenceNumber} telah ditolak.`,
    };
  }

  if (action === 'comment') {
    if (!canViewItem && !isR) {
      throw new Error('Anda tidak memiliki akses untuk memberikan catatan pada dokumen ini.');
    }
    actionLabel = isFinanceObserver && !isA2
      ? 'Catatan Pencatatan & Pemantauan Finance'
      : isR
      ? 'Balasan Diskusi / Catatan Pengaju (R)'
      : 'Menambahkan Komentar / Masukan Pemeriksa';
    item.timeline.unshift({
      id: `tl-${item.id}-${Date.now()}`,
      timestamp: nowIso,
      actorId: actor.id,
      actorName: actor.name,
      actorRoleCode,
      actorRoleTitle: actor.roleTitle,
      responsibleName: item.responsibleUserName,
      actionLabel,
      resultingStatus: item.status,
      comment: trimmedComment,
      version: item.version,
    });
    item.updatedAt = nowIso;

    // Kirim notifikasi diskusi ke pihak terkait (R atau Approver aktif)
    if (!draft.approvalNotifications) draft.approvalNotifications = [];
    const commentTargets = isR
      ? [
          isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId,
          item.directorUserId,
        ]
      : [item.responsibleUserId];
    const commentRoles: ApprovalRaciRoleCode[] = isR
      ? [isProgramDoc ? 'A1' : 'A2', 'Direktur']
      : ['R'];
    draft.approvalNotifications.unshift({
      id: `notif-cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      approvalItemId: item.id,
      referenceNumber: item.referenceNumber,
      documentTitle: cleanItemTitle,
      categoryCode: item.categoryCode,
      categoryLabel: item.categoryLabel,
      eventType: 'ENTER_VERIFICATION',
      message: `${actor.name} (${actorRoleCode}) menulis pada "${cleanItemTitle}": "${trimmedComment}"`,
      targetUserIds: commentTargets,
      targetRoleCodes: commentRoles,
      createdAt: nowIso,
      isReadByUserIds: [],
    });

    return { item, message: 'Komentar diskusi berhasil ditambahkan dan disinkronkan ke tiket.' };
  }

  if (action === 'create_new_version') {
    if (!isR) {
      throw new Error(
        'Hanya R (Responsible) pada Activity terkait yang berwenang membuat versi revisi baru.'
      );
    }
    if (item.status === 'Pending Verification' || item.status === 'Pending Approval') {
      throw new Error(
        `Pencegahan Double Submission: Dokumen ini sedang dalam proses pemeriksaan (${item.status}) dan tidak dapat diajukan ulang sebelum ada keputusan pemeriksa.`
      );
    }
    if (
      (item.status === 'Approved' || item.status === 'Reported to Director') &&
      item.previewData?.editRequestStatus !== 'approved'
    ) {
      throw new Error(
        'Dokumen yang telah disetujui bersifat terkunci (final). Ajukan Request Edit kepada Direktur terlebih dahulu jika memerlukan perubahan.'
      );
    }
    item.version = (item.version || 1) + 1;
    item.isLocked = false;
    nextStatus = 'Pending Verification';
    actionLabel = `Membuat Versi Baru (v${item.version}) & Mengajukan Ulang Persetujuan`;
    notifType = 'NEW_SUBMISSION';
    notifMessage = `Versi baru v${item.version} untuk "${cleanItemTitle}" diajukan kembali oleh R (${actor.name}).`;
    notifTargets = [
      isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId,
    ];
    notifRoles = [isProgramDoc ? 'A1' : 'A2'];
  } else if (action === 'submit') {
    if (actor.role === 'admin') {
      throw new Error(
        'Admin mengatur konfigurasi akses, tetapi tidak memiliki kewenangan pengajuan atau persetujuan.'
      );
    }
    if (!isR) {
      throw new Error(
        `Hanya R (Responsible: ${item.responsibleUserName}) yang berwenang mengajukan atau memperbaiki dokumen ini.`
      );
    }
    if (item.status === 'Pending Verification' || item.status === 'Pending Approval') {
      throw new Error(
        `Pencegahan Double Submission: Dokumen "${item.referenceNumber}" sudah diajukan dan sedang menunggu pemeriksaan (${item.status}).`
      );
    }
    if (
      (item.status === 'Approved' || item.status === 'Reported to Director') &&
      item.previewData?.editRequestStatus !== 'approved'
    ) {
      throw new Error(
        'Dokumen ini telah disetujui dan terkunci. Tidak dapat diajukan ulang tanpa izin edit.'
      );
    }
    const wasRevision = item.status === 'Revision Required' || item.status === 'Rejected';
    if (wasRevision) {
      item.version = (item.version || 1) + 1;
    }
    nextStatus = 'Pending Verification';
    item.submittedAt = nowIso;
    item.isLocked = false;
    actionLabel = wasRevision
      ? `Mengajukan Ulang Dokumen Setelah Perbaikan (v${item.version}) oleh R`
      : 'Mengajukan Dokumen untuk Diverifikasi (R)';
    notifType = 'NEW_SUBMISSION';
    notifMessage = `"${cleanItemTitle}" diajukan oleh R (${actor.name}) dan menunggu pemeriksaan ${
      isProgramDoc ? `A1 (${item.accountableProgramUserName})` : `A2 (${item.accountableFinanceUserName})`
    }.`;
    notifTargets = [
      isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId,
    ];
    notifRoles = [isProgramDoc ? 'A1' : 'A2'];
  } else if (action === 'verify_approve') {
    if (actor.role === 'admin') {
      throw new Error(
        'Admin dapat mengatur konfigurasi akses, tetapi tidak otomatis memiliki kewenangan persetujuan.'
      );
    }
    if (isR) {
      throw new Error(
        'Integritas Persetujuan: Pengaju dokumen (R) tidak diperbolehkan menyetujui pengajuannya sendiri pada tahap pemeriksaan/verifikasi.'
      );
    }
    // Validasi Tahapan (Cegah Double Approval & Lompat Tahap)
    if (item.status !== 'Pending Verification' && item.status !== 'Submitted') {
      if (
        item.status === 'Approved' ||
        item.status === 'Pending Approval' ||
        item.status === 'Reported to Director'
      ) {
        throw new Error(
          `Pencegahan Double Approval: Dokumen "${item.referenceNumber}" sudah melewati tahap verifikasi ${
            isProgramDoc ? 'A1' : 'A2'
          } (Status saat ini: ${item.status}).`
        );
      }
      throw new Error(
        `Transisi Status Tidak Valid: Dokumen berstatus "${item.status}" belum dapat diverifikasi oleh ${
          isProgramDoc ? 'A1' : 'A2'
        }. Dokumen harus diajukan oleh R terlebih dahulu.`
      );
    }
    if (isProgramDoc) {
      if (!isA1) {
        throw new Error(
          `Dokumen program pada Output ini hanya dapat diperiksa dan disetujui oleh A1 – Accountable Program (${item.accountableProgramUserName}).`
        );
      }
      // Dokumen program disetujui oleh A1 -> Status menjadi 'Approved' (Disetujui A1, menunggu dilaporkan ke Direktur)
      nextStatus = 'Approved';
      item.isLocked = true;
      actionLabel = 'Memeriksa & Menyetujui Dokumen Program (A1)';
      notifType = 'APPROVED';
      notifMessage = `"${cleanItemTitle}" telah disetujui oleh A1 (${actor.name}) dan diteruskan kepada Direktur (${item.directorUserName}).`;
      notifTargets = [item.directorUserId, item.responsibleUserId];
      notifRoles = ['Direktur', 'R'];
    } else {
      if (!isA2) {
        if (isFinanceObserver) {
          throw new Error(
            `Akun Finance Anda hanya memiliki akses pemantauan & pencatatan. Verifikasi hanya dapat dilakukan oleh A2 – Accountable Finance (${item.accountableFinanceUserName}).`
          );
        }
        throw new Error(
          `Dokumen keuangan hanya dapat diverifikasi oleh A2 – Accountable Finance (${item.accountableFinanceUserName}).`
        );
      }
      // Dokumen keuangan diverifikasi oleh A2 -> Status menjadi 'Pending Approval' (Menunggu Persetujuan Akhir Direktur)
      nextStatus = 'Pending Approval';
      actionLabel = 'Memverifikasi Dokumen Keuangan (A2)';
      notifType = 'ENTER_VERIFICATION';
      notifMessage = `"${cleanItemTitle}" telah diverifikasi oleh A2 (${actor.name}) dan menunggu Persetujuan Akhir Direktur (${item.directorUserName}).`;
      notifTargets = [item.directorUserId, item.responsibleUserId];
      notifRoles = ['Direktur', 'R'];
    }
  } else if (action === 'report_to_director') {
    if (!isProgramDoc) {
      throw new Error('Tindakan pelaporan hanya berlaku untuk Dokumen Program.');
    }
    if (isR && !isDirector) {
      throw new Error(
        'Integritas Persetujuan: Pengaju dokumen (R) tidak diperbolehkan mengesahkan pelaporan dokumennya sendiri.'
      );
    }
    if (!isA1 && !isDirector) {
      throw new Error(
        'Hanya A1 – Accountable Program atau Direktur yang berwenang memproses pelaporan dokumen program kepada Direktur.'
      );
    }
    // Validasi Tahapan: Wajib sudah disetujui oleh A1 ('Approved' atau 'Pending Approval')
    if (item.status === 'Reported to Director') {
      throw new Error(
        `Pencegahan Double Approval: Dokumen "${item.referenceNumber}" sudah dilaporkan dan diterima oleh Direktur.`
      );
    }
    if (item.status !== 'Approved' && item.status !== 'Pending Approval') {
      throw new Error(
        `Dokumen tidak dapat melewati tahapan wajib: "${item.referenceNumber}" masih berstatus "${item.status}" dan wajib diperiksa serta disetujui oleh A1 (${item.accountableProgramUserName}) terlebih dahulu sebelum diteruskan ke Direktur.`
      );
    }
    nextStatus = 'Reported to Director';
    item.isLocked = true;
    item.completedAt = nowIso;
    actionLabel = isDirector
      ? 'Menerima & Mencatat Laporan Dokumen Program (Direktur)'
      : 'Melaporkan Dokumen yang Telah Disetujui A1 kepada Direktur';
    notifType = 'FINAL_COMPLETED';
    notifMessage = `"${cleanItemTitle}" telah resmi dilaporkan kepada Direktur (${item.directorUserName}).`;
    notifTargets = [item.directorUserId, item.responsibleUserId, item.accountableProgramUserId];
    notifRoles = ['Direktur', 'R', 'A1'];
  } else if (action === 'director_final_approve') {
    if (!isDirector) {
      throw new Error(
        `Hanya Direktur (${item.directorUserName}) yang berwenang memberikan persetujuan akhir.`
      );
    }
    if (isR) {
      throw new Error(
        'Integritas Persetujuan: Pengaju dokumen (R) tidak diperbolehkan memberikan persetujuan akhir atas pengajuannya sendiri pada tahap yang sama.'
      );
    }
    // Validasi Tahapan Wajib Sebelum Persetujuan Akhir Direktur
    if (isProgramDoc) {
      if (item.status === 'Reported to Director') {
        throw new Error(
          `Pencegahan Double Approval: Dokumen program "${item.referenceNumber}" sudah disahkan oleh Direktur.`
        );
      }
      if (item.status !== 'Approved' && item.status !== 'Pending Approval') {
        throw new Error(
          `Dokumen tidak dapat melewati tahapan wajib: Dokumen program "${item.referenceNumber}" wajib diperiksa dan disetujui oleh A1 (${item.accountableProgramUserName}) terlebih dahulu sebelum disahkan Direktur.`
        );
      }
    } else {
      if (item.status === 'Approved') {
        throw new Error(
          `Pencegahan Double Approval: Dokumen keuangan "${item.referenceNumber}" sudah disetujui akhir oleh Direktur.`
        );
      }
      if (item.status !== 'Pending Approval') {
        throw new Error(
          `Dokumen tidak dapat melewati tahapan wajib: Dokumen keuangan "${item.referenceNumber}" masih berstatus "${item.status}" dan wajib diverifikasi oleh A2 – Accountable Finance (${item.accountableFinanceUserName}) terlebih dahulu sebelum Persetujuan Akhir Direktur.`
        );
      }
    }
    nextStatus = isProgramDoc ? 'Reported to Director' : 'Approved';
    item.isLocked = true;
    item.completedAt = nowIso;
    actionLabel = isProgramDoc
      ? 'Menerima & Mengesahkan Pelaporan Dokumen Program (Direktur)'
      : 'Memberikan Persetujuan Akhir Dokumen Keuangan (Direktur)';
    notifType = 'FINAL_COMPLETED';
    const allFinanceIds = (draft.users || [])
      .filter(
        (u) =>
          u.isActive !== false &&
          (u.role === 'finance' ||
            (u.roleTitle || '').toLowerCase().includes('finance') ||
            (u.roleTitle || '').toLowerCase().includes('kasir'))
      )
      .map((u) => u.id);
    if (item.categoryCode === 'cash_advance') {
      notifMessage = `"${cleanItemTitle}" telah disetujui oleh Direktur (${actor.name}). Selanjutnya Finance akan mencairkan dana ke rekening pengaju (${item.responsibleUserName}).`;
      notifTargets = Array.from(
        new Set([item.responsibleUserId, item.accountableFinanceUserId, ...allFinanceIds].filter(Boolean))
      );
      notifRoles = ['R', 'A2'];
    } else {
      notifMessage = `"${cleanItemTitle}" telah mendapatkan pengesahan akhir dari Direktur (${actor.name}).`;
      notifTargets = Array.from(
        new Set(
          [
            item.responsibleUserId,
            isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId,
          ].filter(Boolean)
        )
      );
      notifRoles = ['R', isProgramDoc ? 'A1' : 'A2'];
    }
  } else if (action === 'revision') {
    if (actor.role === 'admin') {
      throw new Error(
        'Admin dapat mengatur konfigurasi akses, tetapi tidak otomatis memiliki kewenangan persetujuan/revisi.'
      );
    }
    if (isR) {
      throw new Error('Pengaju (R) tidak dapat meminta revisi atas dokumennya sendiri.');
    }
    const canReturnForRevision =
      (isProgramDoc && (isA1 || isDirector)) || (!isProgramDoc && (isA2 || isDirector));
    if (!canReturnForRevision) {
      throw new Error('Anda tidak memiliki kewenangan mengembalikan dokumen ini untuk revisi.');
    }
    if (
      item.status === 'Draft' ||
      item.status === 'Revision Required' ||
      item.status === 'Rejected' ||
      item.status === 'Archived' ||
      item.status === 'Reported to Director' ||
      (!isProgramDoc && item.status === 'Approved')
    ) {
      throw new Error(
        `Dokumen berstatus "${item.status}" tidak dapat dikembalikan untuk revisi pada tahap ini.`
      );
    }
    nextStatus = 'Revision Required';
    item.isLocked = false;
    actionLabel = `Mengembalikan Dokumen untuk Revisi (${actorRoleCode})`;
    notifType = 'REVISION_REQUIRED';
    notifMessage = `"${cleanItemTitle}" dikembalikan untuk revisi oleh ${actor.name} (${actorRoleCode}): "${trimmedComment}"`;
    notifTargets = [item.responsibleUserId];
    notifRoles = ['R'];
  } else if (action === 'reject') {
    if (actor.role === 'admin') {
      throw new Error(
        'Admin dapat mengatur konfigurasi akses, tetapi tidak otomatis memiliki kewenangan menolak pengajuan.'
      );
    }
    if (isR) {
      throw new Error('Pengaju (R) tidak dapat menolak dokumennya sendiri.');
    }
    const canReject =
      (isProgramDoc && (isA1 || isDirector)) || (!isProgramDoc && (isA2 || isDirector));
    if (!canReject) {
      throw new Error('Anda tidak memiliki kewenangan menolak dokumen ini.');
    }
    if (
      item.status === 'Draft' ||
      item.status === 'Rejected' ||
      item.status === 'Archived' ||
      item.status === 'Reported to Director' ||
      (!isProgramDoc && item.status === 'Approved')
    ) {
      throw new Error(
        `Dokumen berstatus "${item.status}" tidak dapat ditolak pada tahap ini.`
      );
    }
    nextStatus = 'Rejected';
    item.isLocked = false;
    actionLabel = `Menolak Pengajuan Dokumen (${actorRoleCode})`;
    notifType = 'REJECTED';
    notifMessage = `"${cleanItemTitle}" ditolak oleh ${actor.name} (${actorRoleCode}): "${trimmedComment}"`;
    notifTargets = [item.responsibleUserId];
    notifRoles = ['R'];
  } else if (action === 'archive') {
    if (!isDirector && !isA1 && !isA2) {
      throw new Error('Anda tidak memiliki kewenangan mengarsipkan dokumen ini.');
    }
    nextStatus = 'Archived';
    item.isArchived = true;
    item.isLocked = true;
    actionLabel = 'Mengarsipkan Dokumen Persetujuan';
  }

  // Update item status and rebuild sequential steps
  item.status = nextStatus;
  item.updatedAt = nowIso;

  const updatedStepInfo = buildStepsForStatus({
    categoryCode: item.categoryCode,
    status: nextStatus,
    responsibleUserId: item.responsibleUserId,
    responsibleUserName: item.responsibleUserName,
    accountableProgramUserId: item.accountableProgramUserId,
    accountableProgramUserName: item.accountableProgramUserName,
    accountableFinanceUserId: item.accountableFinanceUserId,
    accountableFinanceUserName: item.accountableFinanceUserName,
    directorUserId: item.directorUserId,
    directorUserName: item.directorUserName,
    submittedAt: item.submittedAt,
    verifiedAt: nowIso,
    verifiedNotes:
      action === 'verify_approve' || action === 'revision' || action === 'reject'
        ? trimmedComment || actionLabel
        : item.steps?.[1]?.notes,
    completedAt: item.completedAt || nowIso,
    directorNotes:
      action === 'report_to_director' || action === 'director_final_approve'
        ? trimmedComment || actionLabel
        : item.steps?.[2]?.notes,
    refPrefix: item.sourceEntityId.toUpperCase(),
  });

  item.steps = updatedStepInfo.steps;
  item.currentStepNumber = updatedStepInfo.currentStepNumber;
  item.currentActiveRole = updatedStepInfo.currentActiveRole;

  // Prepend timeline event (newest at the top)
  item.timeline.unshift({
    id: `tl-${item.id}-${Date.now()}`,
    timestamp: nowIso,
    actorId: actor.id,
    actorName: actor.name,
    actorRoleCode,
    actorRoleTitle: actor.roleTitle,
    responsibleName: item.responsibleUserName,
    actionLabel,
    resultingStatus: nextStatus,
    comment: trimmedComment || actionLabel,
    version: item.version,
  });

  // Synchronize back to underlying source entities so ToR, Cash Advance, Monitoring Tools, and Finance stay 100% in sync!
  if (item.categoryCode === 'tor') {
    const torIdx = (draft.tors || []).findIndex((t) => t.id === item.sourceTorId);
    if (torIdx !== -1) {
      if (nextStatus === 'Draft') draft.tors[torIdx].submissionStatus = 'Draft';
      else if (nextStatus === 'Pending Verification') {
        draft.tors[torIdx].submissionStatus = 'Menunggu Persetujuan Finance';
        draft.tors[torIdx].editRequestStatus = 'none';
      } else if (nextStatus === 'Approved')
        draft.tors[torIdx].submissionStatus = 'Menunggu Persetujuan Director';
      else if (nextStatus === 'Reported to Director') {
        draft.tors[torIdx].submissionStatus = 'Disetujui';
        draft.tors[torIdx].isOfficialNumber = true;
        draft.tors[torIdx].publishedAt = nowIso;
        draft.tors[torIdx].editRequestStatus = 'none';
      } else if (nextStatus === 'Revision Required') {
        draft.tors[torIdx].submissionStatus = 'Perlu Perbaikan';
        draft.tors[torIdx].editRequestStatus = 'approved';
        draft.tors[torIdx].editReviewedByName = actor.name;
        draft.tors[torIdx].editReviewedAt = nowIso;
        draft.tors[torIdx].editReviewComment =
          trimmedComment || 'Akses edit otomatis dibuka karena dokumen diminta revisi.';
      } else if (nextStatus === 'Rejected') draft.tors[torIdx].submissionStatus = 'Ditolak';
      else if (nextStatus === 'Archived') draft.tors[torIdx].isArchivedCompleted = true;
      draft.tors[torIdx].updatedAt = nowIso;

      // Also sync TorApprovalRecord so Riwayat Persetujuan & Audit in TorDetailView shows the latest action at the top
      if (!draft.approvalRecords) draft.approvalRecords = [];
      draft.approvalRecords.unshift({
        id: `app-${Date.now()}`,
        torId: item.sourceTorId,
        stage:
          action === 'revision'
            ? 'Revisi'
            : actorRoleCode === 'Direktur'
            ? 'Director'
            : actorRoleCode === 'A2'
            ? 'Finance'
            : 'Pengajuan',
        action:
          action === 'revision'
            ? 'Minta Perbaikan'
            : action === 'reject'
            ? 'Ditolak'
            : action === 'submit' || action === 'create_new_version'
            ? 'Diajukan Ulang'
            : 'Disetujui',
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        comment: trimmedComment || actionLabel,
        timestamp: nowIso,
        resultingStatus: draft.tors[torIdx].submissionStatus,
      });
    }
  } else if (item.categoryCode === 'cash_advance') {
    const caIdx = (draft.cashAdvances || []).findIndex(
      (c) => c.id === item.sourceCashAdvanceId
    );
    if (caIdx !== -1) {
      const ca = draft.cashAdvances![caIdx];
      if (nextStatus === 'Pending Verification') {
        ca.status = 'Diajukan';
      } else if (nextStatus === 'Pending Approval') {
        ca.status = 'Diverifikasi Finance';
        ca.signatures = {
          ...ca.signatures,
          verifiedBy: {
            name: actor.name,
            roleTitle: actor.roleTitle,
            date: nowIso.slice(0, 10),
            status: 'Terverifikasi',
            notes: trimmedComment || 'Diverifikasi oleh A2 di Pusat Persetujuan.',
          },
        };
      } else if (nextStatus === 'Approved') {
        ca.status = 'Disetujui';
        ca.signatures = {
          ...ca.signatures,
          approvedBy: {
            name: actor.name,
            roleTitle: actor.roleTitle,
            date: nowIso.slice(0, 10),
            status: 'Disetujui',
            notes: trimmedComment || 'Disetujui Akhir oleh Direktur di Pusat Persetujuan.',
          },
        };
      } else if (nextStatus === 'Revision Required') {
        ca.status = 'Perlu Perbaikan';
      } else if (nextStatus === 'Rejected') {
        ca.status = 'Ditolak';
      }
      ca.updatedAt = nowIso;
    }
  } else if (item.categoryCode === 'laporan_keuangan_akhir') {
    const caIdx = (draft.cashAdvances || []).findIndex(
      (c) => c.id === item.sourceCashAdvanceId
    );
    if (caIdx !== -1) {
      const ca = draft.cashAdvances![caIdx];
      ca.isReported = true;
      if (nextStatus === 'Pending Verification') {
        ca.reportApprovalStatus = 'Menunggu Pemeriksaan Finance';
      } else if (nextStatus === 'Pending Approval') {
        ca.reportApprovalStatus = 'Menunggu Persetujuan Director';
        ca.reportVerifiedByName = actor.name;
        ca.reportVerifiedAt = nowIso;
        ca.reportVerifiedNotes = trimmedComment || 'Diverifikasi oleh A2.';
      } else if (nextStatus === 'Approved') {
        ca.reportApprovalStatus = 'Telah Disetujui';
        ca.reportApprovedByName = actor.name;
        ca.reportApprovedAt = nowIso;
        ca.reportApprovedNotes = trimmedComment || 'Disetujui akhir oleh Direktur.';
      } else if (nextStatus === 'Revision Required') {
        ca.reportApprovalStatus = 'Perlu Revisi';
      } else if (nextStatus === 'Rejected') {
        ca.reportApprovalStatus = 'Ditolak';
      }
      ca.updatedAt = nowIso;
    }
  } else if (item.categoryCode === 'notulen') {
    const mmIdx = (draft.meetingMinutes || []).findIndex((m) => m.id === item.sourceEntityId);
    if (mmIdx !== -1) {
      draft.meetingMinutes![mmIdx].updatedAt = nowIso;
    }
  } else if (item.categoryCode === 'dokumentasi') {
    const docIdx = (draft.activityDocumentationList || []).findIndex(
      (d) => d.id === item.sourceEntityId
    );
    if (docIdx !== -1) {
      draft.activityDocumentationList![docIdx].updatedAt = nowIso;
    }
  } else if (item.categoryCode === 'executive_summary') {
    const monItem = draft.monitoringReports?.[item.sourceEntityId];
    if (monItem) {
      if (nextStatus === 'Reported to Director' || nextStatus === 'Approved') {
        monItem.status = 'Completed';
      } else if (nextStatus === 'Pending Verification' || nextStatus === 'Revision Required') {
        monItem.status = 'In Progress';
      }
      monItem.updatedAt = nowIso;
    }
  }

  // Record notification if applicable (removing any duplicate for the same item & eventType)
  if (notifMessage) {
    if (!draft.approvalNotifications) draft.approvalNotifications = [];
    draft.approvalNotifications = draft.approvalNotifications.filter(
      (n) =>
        !(
          n.approvalItemId === item.id &&
          (n.id === `notif-init-${item.id}` ||
            (n.eventType === notifType && n.message === notifMessage))
        )
    );
    draft.approvalNotifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      approvalItemId: item.id,
      referenceNumber: item.referenceNumber,
      documentTitle: item.title,
      categoryCode: item.categoryCode,
      categoryLabel: item.categoryLabel,
      eventType: notifType,
      message: notifMessage,
      targetUserIds: notifTargets,
      targetRoleCodes: notifRoles,
      createdAt: nowIso,
      isReadByUserIds: [],
    });
  }

  // Record unified Audit Log
  draft.auditLogs.unshift({
    id: `log-apv-${Date.now()}`,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: `${actor.roleTitle} (${actorRoleCode})`,
    action: `Approval Hub: ${actionLabel}`,
    entityType:
      item.categoryCode === 'cash_advance'
        ? 'CASH_ADVANCE'
        : item.categoryCode === 'laporan_keuangan_akhir'
        ? 'CASH_ADVANCE_SUMMARY'
        : 'TOR',
    entityId: item.sourceTorId,
    details: `[${item.categoryLabel} · ${item.referenceNumber}] ${actionLabel} — Status: ${nextStatus}${
      trimmedComment ? ` | Catatan: "${trimmedComment}"` : ''
    }`,
    timestamp: nowIso,
  });

  return {
    item,
    message: `Berhasil memproses "${actionLabel}" untuk dokumen ${item.referenceNumber}.`,
  };
}
