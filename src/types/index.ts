export type UserRole = 'admin' | 'director' | 'hr' | 'finance' | 'program_manager' | 'meal' | 'staff';

export interface UserPermissions {
  canManagePrograms: boolean;
  canCreateTor: boolean;
  canApproveTor: boolean;
  canManageUsers: boolean;
  canViewAllTors: boolean;
}

export type UserAccountStatus = 'Aktif' | 'Ditangguhkan' | 'Nonaktif';

export interface User {
  id: string;
  username?: string;
  name: string;
  email: string;
  role: UserRole;
  roleTitle: string;
  department: string;
  isActive: boolean;
  accountStatus?: UserAccountStatus;
  permissions: UserPermissions;
  createdAt: string;
  lastLoginAt?: string;
  passwordUpdatedAt?: string;
  passwordHash?: string;
  mustChangePassword?: boolean;
}

export interface Indicator {
  id: string;
  name: string;
  description: string;
  baseline: string;
  target: string;
  unit: string;
  verificationMethod: string;
  reportingFrequency: string;
  dataSource?: string;
}

export type ProgramStatus = 'Draft' | 'Aktif' | 'Selesai' | 'Diarsipkan';

export interface Program {
  id: string;
  name: string;
  code?: string;
  location: string;
  startDate: string;
  endDate: string;
  description?: string;
  folderUrl?: string;
  picId?: string;
  picName?: string;
  status: ProgramStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface Outcome {
  id: string;
  programId: string;
  programName?: string;
  name: string;
  description: string;
  picId: string;
  picName: string;
  projectName?: string;
  status: 'Belum Dimulai' | 'Sedang Berjalan' | 'Selesai';
  indicators: Indicator[];
  createdAt: string;
}

export interface Output {
  id: string;
  outcomeId: string;
  name: string;
  description: string;
  picId: string;
  picName: string;
  status: 'Belum Dimulai' | 'Sedang Berjalan' | 'Selesai';
  indicators: Indicator[];
  createdAt: string;
}

export interface Activity {
  id: string;
  outputId: string;
  name: string;
  code?: string;
  description: string;
  picId: string;
  picName: string;
  startDate: string;
  endDate: string;
  status: 'Belum Dimulai' | 'Sedang Berjalan' | 'Selesai';
  createdAt: string;
}

export interface SubActivity {
  id: string;
  activityId: string;
  name: string;
  description: string;
  picName?: string;
  startDate?: string;
  endDate?: string;
  status: 'Belum Dimulai' | 'Sedang Berjalan' | 'Selesai';
  createdAt: string;
}

export type ActivityStatus = 'Belum Dimulai' | 'Sedang Berjalan' | 'Selesai';

export type SubmissionStatus =
  | 'Draft'
  | 'Diajukan'
  | 'Menunggu Persetujuan Director'
  | 'Menunggu Persetujuan Finance'
  | 'Disetujui'
  | 'Ditolak'
  | 'Perlu Perbaikan';

export type ReportingPeriodType =
  | 'Sekali / Akhir Kegiatan'
  | 'Harian'
  | 'Mingguan'
  | 'Bulanan'
  | 'Setiap akhir kegiatan'
  | 'Periode Khusus';

export interface TorGoalItem {
  id: string;
  goal: string;
  indicator?: string;
  dataCollectionMethod?: string;
  toolsLink?: string;
  mov?: string;
  picName?: string;
}

export interface TorIndicatorItem {
  id: string;
  activityName: string;
  outputName: string;
  indicator: string;
  target: string;
  verificationMethod: string;
  picName: string;
}

export interface TorLocationItem {
  id: string;
  villageCity: string;
  province: string;
  country: string;
}

export interface TorRoleItem {
  id: string;
  role: string;
  picName: string;
  nameInstitution?: string;
  institution?: string;
  responsibilities: string;
}

export interface TorMealItem {
  id: string;
  aspect: string;
  method: string;
  frequency: string;
  picName: string;
}

export interface TorRundownItem {
  id: string;
  timelineId?: string;
  timelineLabel?: string;
  date: string;
  time: string;
  agenda: string;
  targetParticipants?: string;
  location: string;
  picName: string;
}

export interface TorChallengeItem {
  id: string;
  challenge: string;
  mitigation: string;
  picName: string;
}

export interface TorSpecificObjectiveItem {
  id: string;
  objective: string;
  expectedResult: string;
  expectedChange: string;
}

export interface TorTimelineItem {
  id: string;
  period: string;
  activity: string;
}

export interface TorMonitoringItem {
  id: string;
  aspect: string;
  method: string;
  frequency: string;
  pic: string;
}

export type ParticipantTableMode = 'simple' | 'gender_breakdown' | 'segment_breakdown' | 'custom';

export interface TorParticipantCustomColumn {
  id: string;
  label: string;
  type?: 'text' | 'number';
}

export interface TorParticipantRow {
  id: string;
  segment?: string; // Segmen acara (untuk format segmen)
  target: string; // Target Peserta
  maleCount?: number | null; // Estimasi Jumlah Laki-laki
  femaleCount?: number | null; // Estimasi Jumlah Perempuan
  totalCount?: number | null; // Total (L + P)
  note?: string; // Keterangan
  customValues?: Record<string, string | number>; // Nilai kolom dinamis untuk custom table
}

export interface Tor {
  id: string;
  torNumber: string;
  isOfficialNumber?: boolean;
  publishedAt?: string;
  torSequence?: number;
  hierarchyCode?: string;
  activityCode?: string;
  programCode?: string;
  title: string;
  programId?: string;
  programName?: string;
  outcomeId: string;
  outcomeName: string;
  outputId: string;
  outputName: string;
  activityId: string;
  activityName: string;
  subActivityId?: string;
  subActivityName?: string;
  picId: string;
  picName: string;
  implementingTeam?: string[];
  background: string;
  rationale?: string;
  generalObjective?: string;
  objectives: string;
  participantType?: string;
  participantsType?: string;
  participantsTarget?: string;
  participantsCount?: number | null;
  participantsCriteria?: string;
  participantTableMode?: ParticipantTableMode;
  participantRows?: TorParticipantRow[];
  participantCustomColumns?: TorParticipantCustomColumn[];
  goals?: TorGoalItem[];
  indicators?: TorIndicatorItem[];
  rolesResponsibilities?: TorRoleItem[];
  rolesNotes?: string;
  rolesAdditionalNotes?: string;
  mealItems?: TorMealItem[];
  rundown?: TorRundownItem[];
  rundownNotes?: string;
  rundownAdditionalNotes?: string;
  challengesMitigations?: TorChallengeItem[];
  challengesNotes?: string;
  challengesAdditionalNotes?: string;
  activityDescription: string;
  expectedResults: string;
  location: string;
  locations?: TorLocationItem[];
  customPeriodId?: string;
  customPeriodCode?: string;
  customPeriodLabel?: string;
  customPeriodStartDate?: string;
  customPeriodEndDate?: string;
  customPeriodAllocatedAmount?: number;
  startDate: string;
  endDate: string;
  reportingPeriodType: ReportingPeriodType;
  reportingFrequency: string;
  reportingDeadline: string; // YYYY-MM-DD
  additionalNotes?: string;
  specificObjectives?: TorSpecificObjectiveItem[];
  timelineItems?: TorTimelineItem[];
  monitoringItems?: TorMonitoringItem[];
  scopeOfActivities?: string[];
  implementationMechanisms?: string[];
  isRundownVisible?: boolean;
  organizerPersonInCharge?: string;
  // Edit Request workflow fields (Request Edit -> ACC Edit by Director)
  editRequestStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  editRequestedById?: string;
  editRequestedByName?: string;
  editRequestedByRole?: string;
  editRequestedAt?: string;
  editRequestReason?: string;
  editReviewedByName?: string;
  editReviewedAt?: string;
  editReviewComment?: string;
  activityStatus: ActivityStatus;
  submissionStatus: SubmissionStatus;
  // Budget Overview fields
  budgetRequested?: number | null; // Dana Diminta
  budgetApproved?: number | null; // Dana Disetujui
  budgetActualSpent?: number | null; // Pengeluaran Aktual Terverifikasi
  budgetCurrency?: string; // Default: 'IDR'
  budgetNotes?: string;
  // Documentation (Stage 05) linked to this TOR
  documentation?: ActivityDocumentationRecord;
  isArchivedCompleted?: boolean;
  completionDate?: string;
  createdById: string;
  createdByName: string;
  createdByRole: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface BestPhotoSlot {
  slotNumber: number; // 1..5
  photoNameTitle: string; // Photo Name / Title setiap orang yang ada di foto tersebut
  photoLink: string; // Photo Link (URL)
  photoLocation: string; // Photo Location
  photographer: string; // Photographer (nama pengambil foto)
}

export interface HumanInterestStoryItem {
  id: string;
  storyTitle: string;
  storyLink: string;
}

export interface GeneralPhotoLinkItem {
  id: string;
  url: string;
}

export interface ActivityDocumentationRecord {
  id: string;
  documentNumber?: string;
  torId: string;
  torNumber: string;
  programId?: string;
  programName?: string;
  activityTitle: string;
  bestPhotosStoryTopic: string;
  bestPhotos: BestPhotoSlot[];
  humanInterestStories: HumanInterestStoryItem[];
  generalPhotoLinks: GeneralPhotoLinkItem[];
  updatedById: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
}


export type DocumentStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type DocumentStageKey =
  | 'tor'
  | 'cash_advance'
  | 'cash_advance_tambahan'
  | 'notulen'
  | 'dokumentasi_foto'
  | 'narasi_kegiatan'
  | 'laporan_kontribusi'
  | 'laporan_keuangan';

export type TorDocumentStatus =
  | 'Draft'
  | 'Menunggu Review'
  | 'Menunggu Persetujuan'
  | 'Diajukan'
  | 'Disetujui'
  | 'Perlu Revisi'
  | 'Selesai'
  | 'Tidak Diperlukan';

export interface TorDocument {
  id: string;
  torId: string;
  stageNumber: DocumentStageId;
  stageKey: DocumentStageKey;
  stageName?: string;
  stageTitle?: string;
  documentNumber?: string;
  title: string;
  status: TorDocumentStatus;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  approverName?: string;
  approverRole?: string;
  approvalDate?: string;
  approvalNotes?: string;
  metadata?: Record<string, any>;
  summary?: string;
  content?: string;
  fileUrl?: string;
  fileName?: string;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TorApprovalRecord {
  id: string;
  torId: string;
  stage: 'Director' | 'Finance' | 'Pengajuan' | 'Revisi' | 'Akses Edit';
  action:
    | 'Diajukan'
    | 'Disetujui'
    | 'Ditolak'
    | 'Minta Perbaikan'
    | 'Diajukan Ulang'
    | 'Request Edit'
    | 'ACC Edit'
    | 'Tolak Edit'
    | 'Simpan Edit';
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  comment: string;
  timestamp: string;
  resultingStatus: SubmissionStatus;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: 'TOR' | 'PROGRAM' | 'USER' | 'AUTH' | 'CASH_ADVANCE' | 'CASH_ADVANCE_SUMMARY' | 'PARTICIPANT' | 'ATTENDANCE';
  entityId: string;
  details: string;
  timestamp: string;
}

export interface DashboardStats {
  activeTors: number;
  pendingApprovals: number;
  nearDeadline: number;
  overdue: number;
}

export type CashAdvanceStatus =
  | 'Draft'
  | 'Diajukan'
  | 'Diverifikasi Finance'
  | 'Disetujui'
  | 'Dicairkan'
  | 'Perlu Perbaikan'
  | 'Ditolak';

export interface CashAdvanceItem {
  id: string;
  itemNo: number;
  budgetCode: string;
  description: string;
  volume: number;
  unit: string;
  frequency: number;
  frequencyUnit?: string;
  unitPrice: number;
  totalAmount: number;
  notes?: string;
  timelineItemId?: string;
  timelinePeriod?: string;
  timelineActivity?: string;
  actualSpent?: number;
}

export interface CashAdvanceSignatureBlock {
  requestedBy: {
    name: string;
    roleTitle: string;
    date: string;
    status: 'Draft' | 'Diajukan';
    signatureNote?: string;
  };
  verifiedBy?: {
    name: string;
    roleTitle: string;
    date: string;
    status: 'Pending' | 'Terverifikasi' | 'Perlu Perbaikan' | 'Ditolak';
    notes?: string;
  };
  approvedBy?: {
    name: string;
    roleTitle: string;
    date: string;
    status: 'Pending' | 'Disetujui' | 'Ditolak';
    notes?: string;
  };
  disbursedBy?: {
    name: string;
    date: string;
    transferReference?: string;
    bankSource?: string;
    isDisbursed: boolean;
  };
}

export interface CashAdvanceRecord {
  id: string;
  advanceNumber: string;
  requestDate: string;
  organizationName: string;
  requesterId: string;
  requesterName: string;
  requesterRole: string;
  department: string;
  torId: string;
  torNumber: string;
  activityTitle: string;
  programName: string;
  activityStartDate: string;
  activityEndDate: string;
  location: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  items: CashAdvanceItem[];
  totalAmount: number;
  amountInWords: string;
  complianceNotes?: string[];
  signatures: CashAdvanceSignatureBlock;
  status: CashAdvanceStatus;
  // Implementation Timeline linkage (Gambar 2)
  implementationMode?: 'all' | 'single';
  implementationTimelineIds?: string[];
  implementationTimelineSummary?: string;
  // 7-Day Reporting Deadline & Max 2 Unreported Cash Advances rule
  reportingCommitment?: string;
  reportingDeadlineDate?: string;
  // Report Closure ("Tutup Laporan" in Ringkasan Cash Advance + Expensify PDF Link + Finance -> Director Approval)
  isReported?: boolean;
  reportedAt?: string;
  reportedByName?: string;
  realizedAmount?: number;
  expensifyPdfLink?: string;
  reportNotes?: string;
  reportApprovalStatus?:
    | 'Menunggu Pemeriksaan Finance'
    | 'Menunggu Persetujuan Director'
    | 'Telah Disetujui'
    | 'Perlu Revisi'
    | 'Ditolak';
  reportVerifiedByName?: string;
  reportVerifiedAt?: string;
  reportVerifiedNotes?: string;
  reportApprovedByName?: string;
  reportApprovedAt?: string;
  reportApprovedNotes?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// MODUL 04: NOTULEN (MEETING MINUTES GENERATOR)
// ============================================================================

export interface MeetingMinutesParticipant {
  id: string;
  name: string;
  organization: string;
  role?: string;
}

export interface MeetingDiscussionItem {
  id: string;
  topic: string;
  summary: string;
  keyFindings: string;
  issuesChallenges: string;
  responsesClarifications: string;
}

export interface MeetingDecisionItem {
  id: string;
  statement: string;
  backgroundReason?: string;
  responsibleParty: string;
  relatedProgramActivity?: string;
}

export type ActionPointStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Overdue';

export interface MeetingActionPoint {
  id: string;
  action: string;
  pic: string;
  deadline: string; // YYYY-MM-DD
  status: ActionPointStatus;
}

export interface MeetingMinutesRecord {
  id: string;
  documentNumber: string;
  torId?: string;
  torNumber?: string;
  cashAdvanceId?: string;
  cashAdvanceNumber?: string;
  title: string;
  implementationProject: string;
  partnerOrganization?: string;
  meetingDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  meetingLocation: string;
  meetingRoomPlatform: string;
  participants: MeetingMinutesParticipant[];
  recorderName: string;
  discussions: MeetingDiscussionItem[];
  decisions: MeetingDecisionItem[];
  actionPoints: MeetingActionPoint[];
  additionalNotes: string;
  nextMeetingAgenda: string;
  nextMeetingSchedule: string;
  preparationDocuments: string;
  partnerInstitution?: string;
  partnerRepName?: string;
  partnerRepTitle?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// MONITORING TOOLS – MEAL CONNECT (RACI PER OUTPUT & MONITORING TOOLS PER ACTIVITY)
// ============================================================================

export type OutputRaciStatus =
  | 'Menunggu Program Manager'
  | 'Menunggu Persetujuan Direktur'
  | 'Aktif';

export interface OutputRaciAuditEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  status: OutputRaciStatus;
  notes?: string;
  rName?: string;
  a1Name?: string;
}

export interface OutputRaciRecord {
  outputId: string;
  programId: string;
  outcomeId: string;
  responsibleUserId: string; // Hanya 1 user terdaftar (R)
  responsibleUserName: string;
  accountableUserId: string; // Hanya 1 user terdaftar (A1 - Accountable Program)
  accountableUserName: string;
  accountableFinanceUserId?: string; // Penugasan dinamis A2 - Accountable Finance
  accountableFinanceUserName?: string;
  consultedUsers: string[]; // Bisa >1 user (terdaftar atau manual)
  informedUsers: string[]; // Bisa >1 user (terdaftar atau manual)
  status: OutputRaciStatus;
  assignedById?: string;
  assignedByName?: string;
  assignedAt?: string;
  approvedById?: string;
  approvedByName?: string;
  approvedAt?: string;
  directorNotes?: string;
  auditHistory?: OutputRaciAuditEntry[];
  updatedAt: string;
}

export interface SelectedActivityMonitoringTool {
  toolId: string;
  toolName: string;
  categoryCode: 'A' | 'B' | 'C' | 'D' | 'E';
  categoryName: string;
  shortFunction: string;
  toolUrl?: string;
  notes?: string;
  assignedAt: string;
  assignedById: string;
  assignedByName: string;
}

export interface ActivityMonitoringRecord {
  activityId: string;
  outputId: string;
  outcomeId: string;
  programId: string;
  tools: SelectedActivityMonitoringTool[];
  status: 'Sudah Ada Monitoring' | 'Belum Ada Monitoring';
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
}

// ============================================================================
// MODUL 06: MONITORING (INTEGRASI OTOMATIS TOR, CASH ADVANCE & MONITORING TOOLS)
// ============================================================================

export type MonitoringReportStatus = 'Planned' | 'In Progress' | 'Completed';

export interface MonitoringEvidenceLink {
  id: string;
  label?: string;
  url: string;
}

export interface MonitoringSectionData {
  narrative: string;
  evidenceLinks: MonitoringEvidenceLink[];
}

export interface MonitoringReportSections {
  baseline: MonitoringSectionData;
  intervention: MonitoringSectionData;
  results: MonitoringSectionData;
  contextLearning: MonitoringSectionData;
  reflectionLearning: MonitoringSectionData;
  keySuccessParticipation: MonitoringSectionData;
  nextImplementationProposal: MonitoringSectionData;
}

export interface MonitoringReportItem {
  id: string; // Deterministic: `${torId}__${cashAdvanceId}__${toolId}`
  torId: string;
  torNumber: string;
  programId?: string;
  programName?: string;
  outcomeId?: string;
  outcomeName?: string;
  outputId?: string;
  outputName?: string;
  activityId: string;
  activityName: string;
  cashAdvanceId: string;
  cashAdvanceNumber: string;
  cashAdvanceActivitySummary: string;
  implementationList?: string[];
  timelineItemId?: string;
  timelinePeriod?: string;
  timelineActivity?: string;
  toolId: string;
  toolName: string;
  toolCategoryCode: 'A' | 'B' | 'C' | 'D' | 'E';
  toolCategoryName: string;
  toolShortFunction?: string;
  toolNotes?: string;
  plannedToolUrl?: string;
  responsibleUserId?: string;
  responsibleName: string;
  monitoringDate: string; // YYYY-MM-DD
  status: MonitoringReportStatus;
  mainEvidenceFolderUrl: string;
  sections: MonitoringReportSections;
  involvedParticipantIds?: string[];
  updatedById?: string;
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// PUSAT PERSETUJUAN (APPROVAL HUB) — TERPUSAT & TERINTEGRASI RACI + MONITORING
// ============================================================================

export type ApprovalGroupType = 'program_documents' | 'financial_documents';

export type ApprovalCategoryCode =
  | 'tor'
  | 'notulen'
  | 'dokumentasi'
  | 'executive_summary'
  | 'cash_advance'
  | 'laporan_keuangan_akhir';

export type ApprovalHubStatus =
  | 'Draft'
  | 'Submitted'
  | 'Pending Verification'
  | 'Pending Approval'
  | 'Approved'
  | 'Revision Required'
  | 'Rejected'
  | 'Reported to Director'
  | 'Archived';

export type ApprovalWorkflowMechanism = 'SEQUENTIAL' | 'PARALLEL';

export type ParallelApprovalRule =
  | 'ALL_REQUIRED'
  | 'ANY_DESIGNATED'
  | 'PRIMARY_WITH_CONSULTATION';

export type ApprovalRaciRoleCode = 'R' | 'A1' | 'A2' | 'Direktur' | 'C' | 'I';

export interface ApprovalWorkflowStep {
  stepNumber: 1 | 2 | 3;
  roleCode: 'R' | 'A1' | 'A2' | 'Direktur';
  roleLabel: string;
  actionTypeLabel: string; // mis. "Penyusunan & Pengajuan", "Pemeriksaan & Persetujuan Program", "Verifikasi Keuangan", "Pelaporan kepada Direktur", "Persetujuan Akhir Direktur"
  assignedUserId: string;
  assignedUserName: string;
  status:
    | 'Menunggu Tahap Sebelumnya'
    | 'Sedang Berjalan'
    | 'Selesai'
    | 'Perlu Revisi'
    | 'Ditolak';
  actedByUserId?: string;
  actedByUserName?: string;
  receivedAt?: string;
  actedAt?: string;
  notes?: string;
  signatureCode?: string;
}

export interface ApprovalTimelineEvent {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRoleCode: ApprovalRaciRoleCode | 'Admin';
  actorRoleTitle: string;
  responsibleName: string;
  actionLabel: string;
  resultingStatus: ApprovalHubStatus;
  comment: string;
  version: number;
}

export interface ApprovalNotificationItem {
  id: string;
  approvalItemId: string;
  referenceNumber: string;
  documentTitle: string;
  categoryCode: ApprovalCategoryCode;
  categoryLabel: string;
  eventType:
    | 'NEW_SUBMISSION'
    | 'ENTER_VERIFICATION'
    | 'APPROVED'
    | 'REVISION_REQUIRED'
    | 'REJECTED'
    | 'OVERDUE'
    | 'FINAL_COMPLETED';
  message: string;
  targetUserIds: string[];
  targetRoleCodes: ApprovalRaciRoleCode[];
  createdAt: string;
  isReadByUserIds?: string[];
}

export interface ApprovalCategoryWorkflowConfig {
  categoryCode: ApprovalCategoryCode;
  mechanism: ApprovalWorkflowMechanism;
  parallelRule: ParallelApprovalRule;
  updatedAt: string;
  updatedByName?: string;
}

export interface ApprovalHubItem {
  id: string; // Deterministic ID linked to source entity
  sourceEntityId: string;
  sourceTorId: string;
  sourceCashAdvanceId?: string;
  referenceNumber: string;
  title: string;
  groupType: ApprovalGroupType;
  categoryCode: ApprovalCategoryCode;
  categoryLabel: string;
  // Hierarki Program -> Outcome -> Output -> Activity -> Monitoring Tools
  programId: string;
  programName: string;
  outcomeId: string;
  outcomeName: string;
  outputId: string;
  outputName: string;
  activityId: string;
  activityCode?: string;
  activityName: string;
  monitoringTools: {
    toolId: string;
    toolName: string;
    categoryCode: string;
    categoryName: string;
    toolUrl?: string;
  }[];
  // Penugasan RACI Dinamis pada Output/Activity
  responsibleUserId: string; // R
  responsibleUserName: string;
  accountableProgramUserId: string; // A1
  accountableProgramUserName: string;
  accountableFinanceUserId: string; // A2
  accountableFinanceUserName: string;
  directorUserId: string; // Direktur
  directorUserName: string;
  consultedUsers: string[]; // C
  informedUsers: string[]; // I
  // Status & Tahapan Alur Persetujuan
  status: ApprovalHubStatus;
  currentStepNumber: 1 | 2 | 3;
  currentActiveRole: 'R' | 'A1' | 'A2' | 'Direktur' | 'Selesai';
  workflowMechanism: ApprovalWorkflowMechanism;
  parallelRule?: ParallelApprovalRule;
  steps: ApprovalWorkflowStep[];
  timeline: ApprovalTimelineEvent[];
  // Versi & Penguncian Dokumen
  version: number;
  isLocked: boolean;
  submittedAt: string;
  dueDate?: string;
  completedAt?: string;
  isArchived?: boolean;
  // Pratinjau & Informasi Wajib per Kategori
  previewData: {
    summaryText: string;
    location?: string;
    activityPeriod?: string;
    attachments: { label: string; url: string; refCode?: string }[];
    // Khusus Cash Advance Request (Kategori 5)
    purposeOfFunds?: string;
    budgetLines?: { code: string; description: string; amount: number }[];
    requestedAmount?: number;
    plannedUsageDate?: string;
    plannedSettlementDate?: string;
    isDisbursed?: boolean;
    disbursedByName?: string;
    disbursedAt?: string;
    transferReference?: string;
    bankSource?: string;
    // Khusus Final Financial Report / Laporan Keuangan Akhir (Kategori 6)
    cashAdvanceReferenceNumber?: string;
    approvedAmount?: number;
    realizedAmount?: number;
    budgetVariance?: number;
    remainingFunds?: number;
    varianceExplanation?: string;
    expensifyPdfLink?: string;
    // Khusus Dokumen Program (ToR / Notulen / Dokumentasi / Executive Summary)
    keyHighlights?: { label: string; value: string }[];
    // Khusus Request Edit Dokumen ToR (Terintegrasi di Approval ToR)
    editRequestStatus?: 'none' | 'pending' | 'approved' | 'rejected';
    editRequestedById?: string;
    editRequestedByName?: string;
    editRequestedByRole?: string;
    editRequestedAt?: string;
    editRequestReason?: string;
    editReviewedByName?: string;
    editReviewedAt?: string;
    editReviewComment?: string;
  };
  updatedAt: string;
}

export interface ApprovalAccessProfile {
  userId: string;
  userName: string;
  userRole: UserRole;
  isA1: boolean;
  isA2: boolean;
  isDirector: boolean;
  isFinance: boolean;
  isR: boolean;
  isAdmin: boolean;
  canAccessApprovalMenu: boolean;
  canApproveProgramDocs: boolean;
  canVerifyFinanceDocs: boolean;
  canFinalApproveDirector: boolean;
  activeApprovalRoles: (
    | 'A1 – Accountable Program'
    | 'A2 – Accountable Finance'
    | 'Direktur'
    | 'Finance'
    | 'R – Responsible'
  )[];
  scopeSummary: string;
}

// ============================================================================
// DATABASE PESERTA (MASTER DATA MANDIRI: INDIVIDU & KELOMPOK/ORGANISASI)
// ============================================================================

export type MasterParticipantType = 'INDIVIDU' | 'KELOMPOK/ORGANISASI';

export type MasterParticipantAgeGroup =
  | 'Anak-anak (0–12 tahun)'
  | 'Remaja (13–17 tahun)'
  | 'Pemuda (18–30 tahun)'
  | 'Dewasa (31–59 tahun)'
  | 'Lansia (60 tahun ke atas)';

export type MasterParticipantGender =
  | 'Laki-laki'
  | 'Perempuan'
  | 'Lainnya'
  | 'Memilih tidak menjawab';

export type MasterDisabilityStatus =
  | 'Ya'
  | 'Tidak'
  | 'Memilih tidak menjawab';

export type MasterCommunityRole =
  | 'Pemuda'
  | 'Tokoh Agama'
  | 'Pemimpin Adat'
  | 'Fasilitator'
  | 'Masyarakat Umum'
  | 'Lainnya';

export type MasterGroupCategory =
  | 'Komunitas'
  | 'Organisasi'
  | 'Kelompok Masyarakat'
  | 'Kelompok Keagamaan'
  | 'Kelompok Adat'
  | 'Institusi'
  | 'Lainnya';

export type MasterGroupProgramRole =
  | 'Peserta'
  | 'Mitra'
  | 'Kelompok Sasaran'
  | 'Fasilitator Komunitas'
  | 'Lainnya';

export type GroupCompositionRowKey =
  | 'anak'
  | 'remaja'
  | 'pemuda'
  | 'dewasa'
  | 'lansia';

export interface GroupMemberCompositionRow {
  lakiLaki: number;
  perempuan: number;
  lainnya: number;
  memilihTidakMenjawab: number;
}

export type GroupMemberCompositionMatrix = Record<GroupCompositionRowKey, GroupMemberCompositionRow>;

export interface ParticipantProgramInvolvement {
  programId: string;
  programCode?: string;
  programName: string;
  roleInProgram?: string;
  rolesInProgram?: string[];
  outcomeIds?: string[];
  activityIds?: string[];
  joinedAt: string; // YYYY-MM-DD or ISO
  notes?: string;
}

export interface MasterIndividualParticipant {
  id: string;
  participantType: 'INDIVIDU';
  participantCode: string; // ID Peserta (dibuat otomatis oleh sistem)
  fullName: string; // Nama Lengkap (Wajib diisi)
  organizationInstitution?: string; // Organisasi/Institusi (Opsional)
  ageGroup: MasterParticipantAgeGroup; // Kelompok Usia
  gender: MasterParticipantGender; // Jenis Kelamin
  disability: MasterDisabilityStatus; // Disabilitas
  disabilityNotes?: string; // Keterangan Disabilitas (Opsional jika memilih "Ya")
  communityRole: string; // Peran dalam Komunitas (bisa gabungan beberapa peran)
  communityRoles?: MasterCommunityRole[]; // Multi-select Peran dalam Komunitas
  communityRoleNotes?: string; // Keterangan jika Peran dalam Komunitas memuat "Lainnya"
  regionCommunity: string; // Wilayah/Komunitas
  programInvolvements?: ParticipantProgramInvolvement[]; // Riwayat Keterlibatan Peserta per Program
  createdAt: string;
  updatedAt: string;
}

export interface MasterGroupParticipant {
  id: string;
  participantType: 'KELOMPOK/ORGANISASI';
  participantCode: string; // ID Kelompok (dibuat otomatis oleh sistem)
  groupName: string; // Nama Kelompok/Organisasi (Wajib diisi)
  groupCategory: MasterGroupCategory; // Jenis Kelompok
  groupCategoryNotes?: string; // Keterangan jika Jenis Kelompok = "Lainnya"
  regionCommunity: string; // Wilayah/Komunitas
  contactPerson: string; // Kontak/Penanggung Jawab
  programRole: string; // Peran dalam Program (bisa gabungan beberapa peran)
  programRoles?: MasterGroupProgramRole[]; // Multi-select Peran dalam Program
  programRoleNotes?: string; // Keterangan jika Peran dalam Program memuat "Lainnya"
  memberComposition: GroupMemberCompositionMatrix; // Komposisi Anggota Kelompok
  totalMembers: number; // Dihitung otomatis dari tabel komposisi anggota kelompok
  programInvolvements?: ParticipantProgramInvolvement[]; // Riwayat Keterlibatan Peserta per Program
  createdAt: string;
  updatedAt: string;
}

export type MasterParticipantRecord =
  | MasterIndividualParticipant
  | MasterGroupParticipant;

// ============================================================================
// WIJNA ATTENDANCE & TIMESHEET (SISTEM MANDIRI INTERNAL — TANPA MEAL/PROGRAM)
// ============================================================================

export type WijnaWorkCategory =
  | 'Rapat & Koordinasi'
  | 'Perencanaan & Pengembangan'
  | 'Administrasi & Pelaporan'
  | 'Pendampingan & Supervisi'
  | 'Komunikasi & Hubungan Eksternal'
  | 'Pelatihan & Pengembangan Kapasitas';

export interface TimesheetWorkItem {
  id: string;
  category: WijnaWorkCategory;
  shortDescription: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WijnaLocationConfig {
  officeName: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  standardDailyHours: number; // Default 8 hours for WFA full day
  updatedByName?: string;
  updatedAt?: string;
}

export interface AttendanceCoordinatePoint {
  latitude: number;
  longitude: number;
  distanceMeters: number;
  isOutsideWorkLocation: boolean;
  locationLabel?: string;
  outsideReason?: string;
}

export type AttendanceDayRecordType = 'ATTENDANCE' | 'WFA' | 'LEAVE' | 'HOLIDAY';

/**
 * Role-based workflow distinction:
 * 1. EMPLOYEE_TO_FINANCE_APPROVAL: Employee -> Finance (Submit for Approval: Pending | Approved | Returned with mandatory reason)
 * 2. FINANCE_TO_DIRECTOR_REVIEW: Finance -> Director (Submit for Review: Submitted for Review | Reviewed by Director; strategic input only, no approve/return)
 * 3. DIRECTOR_TO_FINANCE_NOTIFY: Director -> Finance (Notify for Information: Notified to Finance | Acknowledged by Finance; info/record-keeping only, no approve/return)
 */
export type AttendanceWorkflowType =
  | 'EMPLOYEE_TO_FINANCE_APPROVAL'
  | 'FINANCE_TO_DIRECTOR_REVIEW'
  | 'DIRECTOR_TO_FINANCE_NOTIFY';

export type OutsideLocationReviewStatus =
  | 'NOT_REQUIRED'
  | 'PENDING_HR_REVIEW'
  | 'HR_REVIEWED'
  | 'RETURNED_BY_FINANCE'
  | 'SUBMITTED_FOR_REVIEW'
  | 'REVIEWED_BY_DIRECTOR'
  | 'NOTIFIED_TO_FINANCE'
  | 'ACKNOWLEDGED_BY_FINANCE'
  | 'DIRECTOR_ACKNOWLEDGED';

export interface DailyAttendanceTimesheetRecord {
  id: string;
  date: string; // YYYY-MM-DD
  userId: string;
  userName: string;
  userRoleTitle: string;
  department: string;
  recordType: AttendanceDayRecordType; // ATTENDANCE | WFA | LEAVE | HOLIDAY
  workflowType?: AttendanceWorkflowType;
  // Clock In & Clock Out (tidak digunakan saat WFA, LEAVE, atau HOLIDAY)
  clockInTime?: string; // ISO string or HH:mm
  clockInLocation?: AttendanceCoordinatePoint;
  clockOutTime?: string; // ISO string or HH:mm
  clockOutLocation?: AttendanceCoordinatePoint;
  totalWorkHours: number; // Dihitung otomatis dari Clock In -> Clock Out, atau standardDailyHours untuk WFA
  // Status Lokasi Kerja
  isOutsideWorkLocation: boolean;
  outsideLocationReason?: string;
  outsideReviewStatus: OutsideLocationReviewStatus;
  hrReviewByName?: string;
  hrReviewAt?: string;
  hrReviewNotes?: string;
  returnReason?: string;
  directorAckByName?: string;
  directorAckAt?: string;
  directorAckNotes?: string;
  // Flextime, WFA, Leave & Holiday reference
  isFlextimeApplied: boolean;
  flextimeRuleLabel?: string;
  wfaRequestId?: string;
  leaveRequestId?: string;
  leaveCategoryName?: string;
  holidayRequestId?: string;
  holidayTitle?: string;
  // Timesheet Harian Otomatis
  timesheetItems: TimesheetWorkItem[];
  createdAt: string;
  updatedAt: string;
}

export type FlextimeDecisionStatus =
  | 'Pending'
  | 'Approved'
  | 'Returned'
  | 'Submitted for Review'
  | 'Reviewed by Director'
  | 'Notified to Finance'
  | 'Acknowledged by Finance'
  | 'Diajukan Staf'
  | 'Disetujui HR'
  | 'Ditolak HR';

export interface FlextimeAssignment {
  id: string;
  userId: string;
  userName: string;
  userRoleTitle: string;
  department?: string;
  workflowType?: AttendanceWorkflowType;
  isActive: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  scheduleArrangement: string; // e.g. "Jam Masuk Fleksibel 07:30–10:00 (8 Jam Kerja/Hari)"
  policyNotes: string;
  status?: FlextimeDecisionStatus;
  assignedById: string;
  assignedByName: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  returnReason?: string;
  directorReviewedByName?: string;
  directorReviewedAt?: string;
  directorReviewNotes?: string;
  financeAcknowledgedByName?: string;
  financeAcknowledgedAt?: string;
  financeAckNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type LeaveCategoryGroup = 'CUTI_SAKIT' | 'CUTI_KHUSUS' | 'CUTI_LAINNYA';

export interface LeaveCategoryPolicy {
  id: string;
  code: string;
  name: string;
  group: LeaveCategoryGroup;
  allocationDaysPerYear: number;
  requiresAttachmentOrNote: boolean;
  termsAndProvisions: string;
  isActive: boolean;
  updatedByName: string;
  updatedAt: string;
}

export type LeaveDecisionStatus =
  | 'Pending'
  | 'Approved'
  | 'Returned'
  | 'Submitted for Review'
  | 'Reviewed by Director'
  | 'Notified to Finance'
  | 'Acknowledged by Finance'
  | 'Menunggu Review HR'
  | 'Menunggu Keputusan Director'
  | 'Disetujui Director'
  | 'Ditolak';

export interface LeaveRequestRecord {
  id: string;
  userId: string;
  userName: string;
  userRoleTitle: string;
  department: string;
  workflowType?: AttendanceWorkflowType;
  categoryId: string;
  categoryName: string;
  categoryGroup: LeaveCategoryGroup;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalDays: number;
  reason: string;
  status: LeaveDecisionStatus;
  hrReviewerName?: string;
  hrReviewedAt?: string;
  hrReviewNotes?: string;
  returnReason?: string;
  directorDecisionByName?: string;
  directorDecisionAt?: string;
  directorDecisionNotes?: string;
  directorReviewNotes?: string;
  financeAcknowledgedByName?: string;
  financeAcknowledgedAt?: string;
  financeAckNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type WfaEntryStatus =
  | 'Pending'
  | 'Approved'
  | 'Returned'
  | 'Submitted for Review'
  | 'Reviewed by Director'
  | 'Notified to Finance'
  | 'Acknowledged by Finance'
  | 'Diajukan Staf'
  | 'Disetujui HR'
  | 'Ditolak HR';

export interface TorImplementationOption {
  value: string;
  label: string;
  shortActivity: string;
  torId: string;
  torNumber: string;
  torTitle: string;
  periodLabel?: string;
  startDate?: string;
  endDate?: string;
  ownershipLabel: string;
}

export interface WfaRequestRecord {
  id: string;
  userId: string;
  userName: string;
  userRoleTitle: string;
  department: string;
  workflowType?: AttendanceWorkflowType;
  date: string; // YYYY-MM-DD (tanggal mulai / single date)
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  totalDays?: number;
  reasonAndPlan: string;
  torId?: string;
  torNumber?: string;
  torTitle?: string;
  implementationOption?: string;
  isCustomImplementation?: boolean;
  invitedUserIds?: string[];
  invitedUserNames?: string[];
  status: WfaEntryStatus;
  enteredManuallyByHr: boolean;
  hrManagedByName?: string;
  hrManagedAt?: string;
  hrNotes?: string;
  returnReason?: string;
  directorAcknowledgedByName?: string;
  directorAcknowledgedAt?: string;
  directorReviewNotes?: string;
  financeAcknowledgedByName?: string;
  financeAcknowledgedAt?: string;
  financeAckNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type HolidayRequestStatus =
  | 'Pending'
  | 'Approved'
  | 'Returned'
  | 'Submitted for Review'
  | 'Reviewed by Director'
  | 'Notified to Finance'
  | 'Acknowledged by Finance'
  | 'Diajukan Staf'
  | 'Disetujui HR'
  | 'Ditolak HR';

export interface HolidayRequestRecord {
  id: string;
  userId: string;
  userName: string;
  userRoleTitle: string;
  department: string;
  workflowType?: AttendanceWorkflowType;
  title: string; // e.g. "Hari Libur Bersama / Hari Raya Keagamaan", "Cuti Bersama Pilihan"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalDays: number;
  reason: string;
  status: HolidayRequestStatus;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  returnReason?: string;
  directorAcknowledgedByName?: string;
  directorAcknowledgedAt?: string;
  directorReviewNotes?: string;
  financeAcknowledgedByName?: string;
  financeAcknowledgedAt?: string;
  financeAckNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type EmployeeTrainingApprovalStatus =
  | 'Menunggu Persetujuan Director'
  | 'Disetujui Director'
  | 'Perlu Revisi'
  | 'Ditolak Director';

export interface EmployeeTrainingRecord {
  id: string;
  userId: string;
  userName: string;
  userRoleTitle: string;
  department: string;
  trainingTitle: string;
  organizer: string;
  category: string; // e.g., "Kepemimpinan & Manajemen Program", "Keuangan & Compliance NGO", "MEAL & Riset", "Teknis Lapangan"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  durationHours: number;
  certificateOrEvidenceUrl?: string;
  competencyNotes?: string;
  status: EmployeeTrainingApprovalStatus;
  createdByHrId: string;
  createdByHrName: string;
  createdAt: string;
  updatedAt: string;
  directorDecisionByName?: string;
  directorDecisionAt?: string;
  directorNotes?: string;
  directorSignatureCode?: string;
}

export interface AttendanceAuditTrailEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  module:
    | 'CLOCK_IN_OUT'
    | 'OUTSIDE_LOCATION'
    | 'TIMESHEET'
    | 'FLEXTIME'
    | 'LEAVE'
    | 'WFA'
    | 'HOLIDAY'
    | 'TRAINING'
    | 'POLICY';
  action: string;
  targetUserName?: string;
  details: string;
}

export interface EmployeeProfileDocumentLink {
  userId: string;
  label: string;
  url: string;
  updatedByName: string;
  updatedAt: string;
}

export interface WorkRecapVerificationRecord {
  key?: string;
  userId?: string;
  periodId?: string;
  periodType?: string;
  periodLabel?: string;
  financeVerified: boolean;
  financeVerifierName: string;
  financeVerifierRole: string;
  financeVerifiedAt: string;
  financeRefCode: string;
  financeNotes: string;
  financeVerifiedBy?: string;
  financeSignatureCode?: string;
  directorVerified: boolean;
  directorVerifierName: string;
  directorVerifierRole: string;
  directorVerifiedAt: string;
  directorRefCode: string;
  directorNotes: string;
  directorVerifiedBy?: string;
  directorSignatureCode?: string;
  updatedAt?: string;
}

export interface AttendanceSystemBundle {
  locationConfig: WijnaLocationConfig;
  records: DailyAttendanceTimesheetRecord[];
  flextimeAssignments: FlextimeAssignment[];
  leavePolicies: LeaveCategoryPolicy[];
  leaveRequests: LeaveRequestRecord[];
  wfaRequests: WfaRequestRecord[];
  holidayRequests?: HolidayRequestRecord[];
  employeeTrainings?: EmployeeTrainingRecord[];
  employeeProfileLinks?: Record<string, EmployeeProfileDocumentLink>;
  workRecapVerifications?: Record<string, WorkRecapVerificationRecord>;
  auditTrail: AttendanceAuditTrailEntry[];
}




