import { User, Program, Tor, Outcome, Output, Activity, SubActivity, DashboardStats, AuditLog, TorApprovalRecord, CashAdvanceRecord, MeetingMinutesRecord, ActivityDocumentationRecord, OutputRaciRecord, ActivityMonitoringRecord, SelectedActivityMonitoringTool, MonitoringReportItem, MonitoringReportSections, MonitoringReportStatus, ApprovalHubItem, ApprovalCategoryWorkflowConfig, ApprovalNotificationItem, ApprovalCategoryCode, ApprovalWorkflowMechanism, ParallelApprovalRule, MasterParticipantRecord, AttendanceSystemBundle, DailyAttendanceTimesheetRecord, WijnaWorkCategory, LeaveCategoryGroup } from '../types/index.js';

let activeUserId: string = '';
let activeAuthToken: string | null = (() => {
  try {
    return sessionStorage.getItem('ngo_auth_token') || localStorage.getItem('ngo_auth_token');
  } catch {
    return null;
  }
})();

export function setActiveUser(id: string) {
  activeUserId = id;
  try {
    localStorage.removeItem('ngo_active_user_id');
  } catch {
    // ignore storage errors
  }
}

export function getActiveUserId(): string {
  return activeUserId;
}

export function setAuthToken(token: string | null) {
  activeAuthToken = token;
  try {
    if (token) {
      sessionStorage.setItem('ngo_auth_token', token);
      localStorage.setItem('ngo_auth_token', token);
    } else {
      sessionStorage.removeItem('ngo_auth_token');
      localStorage.removeItem('ngo_auth_token');
      localStorage.removeItem('ngo_active_user_id');
      localStorage.removeItem('wijna_authenticated_session_v1');
    }
  } catch {
    // ignore storage errors
  }
}

export function getAuthToken(): string | null {
  return activeAuthToken;
}

const REQUEST_TIMEOUT_MS = 30000;

async function request<T>(endpoint: string, options: RequestInit = {}, retries = 2): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const safePath = endpoint.split('?')[0];
  const startedAt = Date.now();
  if (retries === 2) {
    console.info(`[API] Request started: ${method} ${safePath}`);
  }

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    'X-Requested-With': 'XMLHttpRequest',
    ...(activeAuthToken ? { Authorization: `Bearer ${activeAuthToken}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS)
    : null;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: options.signal ?? controller?.signal,
    });
  } catch (err: any) {
    if (timeoutId) clearTimeout(timeoutId);
    const isAbort = err?.name === 'AbortError';
    if (!isAbort && method === 'GET' && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return request<T>(endpoint, options, retries - 1);
    }
    const durationMs = Date.now() - startedAt;
    console.warn(
      `[API] Request completed: ${method} ${safePath} -> ${isAbort ? 'TIMEOUT' : 'NETWORK_ERROR'} (${durationMs}ms)`
    );
    throw Object.assign(
      new Error(
        isAbort
          ? 'Permintaan ke server melebihi batas waktu. Silakan coba kembali.'
          : 'Koneksi ke server terputus sementara. Silakan periksa jaringan Anda.'
      ),
      { status: 0, isNetworkError: true }
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startedAt;
  console.info(
    `[API] Request completed: ${method} ${safePath} -> ${response.status} (${durationMs}ms)`
  );

  const refreshedToken = response.headers.get('x-refreshed-token');
  if (refreshedToken && refreshedToken.trim()) {
    setAuthToken(refreshedToken.trim());
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && endpoint !== '/api/auth/login' && endpoint !== '/api/auth/change-password') {
      setAuthToken(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('wijna-auth-unauthorized'));
      }
    }
    const fallbackError =
      response.status === 502 || response.status === 503 || response.status === 504
        ? 'Layanan server sedang sibuk atau baru aktif kembali. Silakan tunggu sesaat.'
        : `Request failed (Status: ${response.status})`;
    throw Object.assign(new Error((data && data.error) || fallbackError), {
      status: response.status,
      errorCategory: data?.errorCategory,
      failedTable: data?.failedTable,
      mysqlErrorCode: data?.mysqlErrorCode,
      rowErrors: data?.rowErrors,
    });
  }

  if (response.status === 204) {
    return {} as T;
  }

  if (data === null) {
    const rawText = await response.text().catch(() => '');
    if (!rawText.trim()) {
      return {} as T;
    }
    try {
      return JSON.parse(rawText) as T;
    } catch {
      throw Object.assign(
        new Error('Invalid server response. Please reload the page.'),
        { status: response.status }
      );
    }
  }

  return data as T;
}

export const api = {
  // Auth & Users
  login: async (identifier: string, password: string) => {
    const res = await request<{ message: string; user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    if (res.user?.id) {
      setActiveUser(res.user.id);
    }
    if (res.token) {
      setAuthToken(res.token);
    }
    return res;
  },
  logout: async () => {
    try {
      await request<{ message: string }>('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      setAuthToken(null);
    }
  },
  getCurrentUser: () => request<User>('/api/auth/current-user'),
  switchUser: (userId: string) => {
    setActiveUser(userId);
    return request<{ message: string; user: User; token?: string }>('/api/auth/switch-user', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }).then((res) => {
      if (res.token) {
        setAuthToken(res.token);
      }
      return res;
    });
  },
  getUsers: () => request<User[]>('/api/users'),
  createUser: (user: Partial<User> & { initialPassword?: string }) =>
    request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify(user),
    }),
  updateUser: (id: string, user: Partial<User>) =>
    request<User>(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(user),
    }),
  changePassword: async (currentPassword: string, newPassword: string) => {
    const res = await request<{ message: string; user: User; token?: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.token) {
      setAuthToken(res.token);
    }
    return res;
  },
  resetUserPassword: (id: string, newPassword: string) =>
    request<{ message: string; user: User }>(`/api/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  deleteUser: (id: string) =>
    request<{ message: string; id: string }>(`/api/users/${id}`, {
      method: 'DELETE',
    }),

  // Programs & Hierarchy
  getPrograms: () =>
    request<{
      programs: Program[];
      outcomes: Outcome[];
      outputs: Output[];
      activities: Activity[];
      subActivities: SubActivity[];
    }>('/api/programs'),

  createProgram: (program: Partial<Program>) =>
    request<Program>('/api/programs', {
      method: 'POST',
      body: JSON.stringify(program),
    }),
  updateProgram: (id: string, program: Partial<Program>) =>
    request<Program>(`/api/programs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(program),
    }),
  deleteProgram: (id: string) =>
    request<{ message: string }>(`/api/programs/${id}`, { method: 'DELETE' }),
  importProgramHierarchyExcel: (programId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return request<{
      alreadyUpToDate: boolean;
      message: string;
      summary: {
        detectedRows: number;
        importedRows: number;
        duplicateRows: number;
        createdOutcomes: number;
        updatedOutcomes?: number;
        addedOutcomeIndicators?: number;
        createdOutputs: number;
        updatedOutputs?: number;
        addedOutputIndicators?: number;
        createdActivities: number;
        updatedActivities?: number;
        createdSubActivities: number;
      };
      expandedOutcomeIds: string[];
      expandedOutputIds: string[];
      outcomes?: Outcome[];
      outputs?: Output[];
      activities?: Activity[];
      subActivities?: SubActivity[];
    }>(`/api/programs/${encodeURIComponent(programId)}/import-hierarchy`, {
      method: 'POST',
      body: formData,
    });
  },

  createOutcome: (outcome: Partial<Outcome>) =>
    request<Outcome>('/api/outcomes', {
      method: 'POST',
      body: JSON.stringify(outcome),
    }),
  updateOutcome: (id: string, outcome: Partial<Outcome>) =>
    request<Outcome>(`/api/outcomes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(outcome),
    }),
  deleteOutcome: (id: string) =>
    request<{ message: string }>(`/api/outcomes/${id}`, { method: 'DELETE' }),

  createOutput: (output: Partial<Output>) =>
    request<Output>('/api/outputs', {
      method: 'POST',
      body: JSON.stringify(output),
    }),
  updateOutput: (id: string, output: Partial<Output>) =>
    request<Output>(`/api/outputs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(output),
    }),
  deleteOutput: (id: string) =>
    request<{ message: string }>(`/api/outputs/${id}`, { method: 'DELETE' }),

  createActivity: (activity: Partial<Activity>) =>
    request<Activity>('/api/activities', {
      method: 'POST',
      body: JSON.stringify(activity),
    }),
  updateActivity: (id: string, activity: Partial<Activity>) =>
    request<Activity>(`/api/activities/${id}`, {
      method: 'PUT',
      body: JSON.stringify(activity),
    }),
  deleteActivity: (id: string) =>
    request<{ message: string }>(`/api/activities/${id}`, { method: 'DELETE' }),

  createSubActivity: (sub: Partial<SubActivity>) =>
    request<SubActivity>('/api/sub-activities', {
      method: 'POST',
      body: JSON.stringify(sub),
    }),
  deleteSubActivity: (id: string) =>
    request<{ message: string }>(`/api/sub-activities/${id}`, { method: 'DELETE' }),

  // TOR
  previewTorNumber: (params: {
    programId?: string;
    outcomeId?: string;
    outputId?: string;
    activityId?: string;
    activityCode?: string;
    date?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params.programId) searchParams.set('programId', params.programId);
    if (params.outcomeId) searchParams.set('outcomeId', params.outcomeId);
    if (params.outputId) searchParams.set('outputId', params.outputId);
    if (params.activityId) searchParams.set('activityId', params.activityId);
    if (params.activityCode) searchParams.set('activityCode', params.activityCode);
    if (params.date) searchParams.set('date', params.date);
    const qs = searchParams.toString();
    return request<{
      previewNumber: string;
      isComplete: boolean;
      statusMessage: string;
      sequenceStr: string;
      programCode: string;
      hierarchyCode: string;
      romanMonth: string;
      year: string;
      nextSequenceNumber: number;
    }>(`/api/tors/preview-number${qs ? `?${qs}` : ''}`);
  },
  getTors: (params?: { search?: string; picId?: string; status?: string; activityStatus?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.picId) searchParams.set('picId', params.picId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.activityStatus) searchParams.set('activityStatus', params.activityStatus);
    const qs = searchParams.toString();
    return request<Tor[]>(`/api/tors${qs ? `?${qs}` : ''}`);
  },
  getTor: (id: string) =>
    request<{ tor: Tor; approvalRecords: TorApprovalRecord[] }>(`/api/tors/${id}`),
  createTor: (tor: Partial<Tor> & { submitImmediately?: boolean }) =>
    request<Tor>('/api/tors', {
      method: 'POST',
      body: JSON.stringify(tor),
    }),
  updateTor: (id: string, tor: Partial<Tor>) =>
    request<Tor>(`/api/tors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(tor),
    }),
  updateTorBudgetEstimate: (
    id: string,
    payload: {
      action: 'finance_determine' | 'a2_update' | 'director_acc';
      budgetRequested?: number;
      budgetNotes?: string;
    }
  ) =>
    request<Tor>(`/api/tors/${id}/budget-estimate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitTor: (id: string, comment?: string) =>
    request<{ message: string; submissionStatus: string }>(`/api/tors/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }),
  reviewTor: (id: string, action: 'Setujui' | 'Tolak' | 'Minta Perbaikan', comment: string) =>
    request<{ message: string; submissionStatus: string }>(`/api/tors/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    }),
  updateActivityStatus: (id: string, activityStatus: string) =>
    request<{ message: string; activityStatus: string }>(`/api/tors/${id}/activity-status`, {
      method: 'PUT',
      body: JSON.stringify({ activityStatus }),
    }),
  requestTorEdit: (id: string, reason: string) =>
    request<{ message: string; tor: Tor }>(`/api/tors/${id}/request-edit`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reviewTorEditRequest: (id: string, decision: 'approve' | 'reject', comment?: string) =>
    request<{ message: string; tor: Tor }>(`/api/tors/${id}/review-edit-request`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    }),
  deleteTor: (id: string) =>
    request<{ message: string; id: string }>(`/api/tors/${id}`, {
      method: 'DELETE',
    }),
  updateDocument: (docId: string, data: { title?: string; summary?: string; content?: string }) =>
    request<any>(`/api/documents/${docId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Cash Advance (Kasbon Operasional)
  getCashAdvances: (params?: { torId?: string; search?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.torId) q.append('torId', params.torId);
    if (params?.search) q.append('search', params.search);
    if (params?.status) q.append('status', params.status);
    const qs = q.toString();
    return request<CashAdvanceRecord[]>(`/api/cash-advances${qs ? `?${qs}` : ''}`);
  },
  getCashAdvance: (id: string) => request<CashAdvanceRecord>(`/api/cash-advances/${id}`),
  createCashAdvance: (ca: Partial<CashAdvanceRecord>) =>
    request<CashAdvanceRecord>('/api/cash-advances', {
      method: 'POST',
      body: JSON.stringify(ca),
    }),
  updateCashAdvance: (id: string, ca: Partial<CashAdvanceRecord>) =>
    request<CashAdvanceRecord>(`/api/cash-advances/${id}`, {
      method: 'PUT',
      body: JSON.stringify(ca),
    }),
  submitCashAdvance: (id: string, note?: string) =>
    request<CashAdvanceRecord>(`/api/cash-advances/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  verifyCashAdvance: (id: string, action: 'verify' | 'revision' | 'reject', notes?: string) =>
    request<CashAdvanceRecord>(`/api/cash-advances/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ action, notes }),
    }),
  approveCashAdvance: (id: string, action: 'approve' | 'reject', notes?: string) =>
    request<CashAdvanceRecord>(`/api/cash-advances/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ action, notes }),
    }),
  disburseCashAdvance: (id: string, transferReference?: string, bankSource?: string) =>
    request<CashAdvanceRecord>(`/api/cash-advances/${id}/disburse`, {
      method: 'POST',
      body: JSON.stringify({ transferReference, bankSource }),
    }),
  closeCashAdvanceReport: (
    id: string,
    payload: {
      expensifyPdfLink: string;
      realizedAmount?: number;
      reportNotes?: string;
      itemRealizations?: Record<string, number>;
    }
  ) =>
    request<CashAdvanceRecord>(`/api/cash-advances/${id}/close-report`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  approveCashAdvanceReport: (
    id: string,
    payload: { stage: 'finance' | 'director'; action?: 'approve' | 'revision'; notes?: string }
  ) =>
    request<CashAdvanceRecord>(`/api/cash-advances/${id}/approve-report`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteCashAdvance: (id: string) =>
    request<{ message: string }>(`/api/cash-advances/${id}`, {
      method: 'DELETE',
    }),

  // Cash Advance Summary & Audit Trail
  getCashAdvanceSummary: (torId: string) =>
    request<{ summary: any; auditLogs: any[] }>(`/api/cash-advance-summaries/${torId}`),
  updateCashAdvanceSummary: (torId: string, payload: { summaryRows: any[]; reportDate?: string; note?: string; actionType?: string }) =>
    request<{ success: boolean; message: string; summary: any; auditLog: any; auditLogs: any[] }>(
      `/api/cash-advance-summaries/${torId}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  approveCashAdvanceSummary: (
    torId: string,
    payload: { stage: 'report' | 'finance' | 'director'; notes?: string }
  ) =>
    request<{ success: boolean; summary: any; auditLogs: any[] }>(
      `/api/cash-advance-summaries/${torId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Meeting Minutes (Modul 04: Notulen)
  getMeetingMinutes: (torId?: string) => {
    const qs = torId ? `?torId=${encodeURIComponent(torId)}` : '';
    return request<MeetingMinutesRecord[]>(`/api/meeting-minutes${qs}`);
  },
  createMeetingMinutes: (payload: Partial<MeetingMinutesRecord>) =>
    request<MeetingMinutesRecord>('/api/meeting-minutes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMeetingMinutes: (id: string, payload: Partial<MeetingMinutesRecord>) =>
    request<MeetingMinutesRecord>(`/api/meeting-minutes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteMeetingMinutes: (id: string) =>
    request<{ message: string }>(`/api/meeting-minutes/${id}`, {
      method: 'DELETE',
    }),

  // Activity Documentation (Modul 05: Documentation)
  getDocumentationList: (torId: string) =>
    request<ActivityDocumentationRecord[]>(`/api/documentation-list/${encodeURIComponent(torId)}`),
  saveDocumentationItem: (torId: string, payload: Partial<ActivityDocumentationRecord>) =>
    request<ActivityDocumentationRecord>(`/api/documentation-list/${encodeURIComponent(torId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteDocumentationItem: (id: string) =>
    request<{ message: string }>(`/api/documentation-list/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getDocumentation: (torId: string) =>
    request<ActivityDocumentationRecord>(`/api/documentations/${encodeURIComponent(torId)}`),
  saveDocumentation: (torId: string, payload: Partial<ActivityDocumentationRecord>) =>
    request<ActivityDocumentationRecord>(`/api/documentations/${encodeURIComponent(torId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Monitoring Tools – MEAL Connect (RACI per Output & Monitoring Tools per Activity)
  getMonitoringConnect: () =>
    request<{
      outputRaciRecords: Record<string, OutputRaciRecord>;
      activityMonitoringRecords: Record<string, ActivityMonitoringRecord>;
    }>('/api/monitoring-connect'),
  saveOutputRaci: (
    outputId: string,
    payload: {
      programId?: string;
      outcomeId?: string;
      responsibleUserId: string;
      accountableUserId: string;
      consultedUsers: string[];
      informedUsers: string[];
    }
  ) =>
    request<OutputRaciRecord>(`/api/monitoring-connect/raci/${encodeURIComponent(outputId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  approveOutputRaci: (
    outputId: string,
    payload: { decision: 'approve' | 'revision'; directorNotes?: string }
  ) =>
    request<OutputRaciRecord>(
      `/api/monitoring-connect/raci/${encodeURIComponent(outputId)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  saveActivityMonitoringTools: (
    activityId: string,
    payload: {
      outputId?: string;
      outcomeId?: string;
      programId?: string;
      tools: Partial<SelectedActivityMonitoringTool>[];
    }
  ) =>
    request<ActivityMonitoringRecord>(
      `/api/monitoring-connect/activity/${encodeURIComponent(activityId)}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Stage 06: Monitoring Reports (Integrated with ToR, Cash Advance & Planned Monitoring Tools)
  getMonitoringReports: (torId?: string) => {
    const qs = torId ? `?torId=${encodeURIComponent(torId)}` : '';
    return request<{
      items: MonitoringReportItem[];
      plannedTools: SelectedActivityMonitoringTool[];
      plannedToolsCount: number;
      cashAdvanceCount: number;
    }>(`/api/monitoring-reports${qs}`);
  },
  updateMonitoringReport: (
    id: string,
    payload: {
      monitoringDate?: string;
      responsibleName?: string;
      mainEvidenceFolderUrl?: string;
      status?: MonitoringReportStatus;
      sections?: MonitoringReportSections;
      involvedParticipantIds?: string[];
      isAutoSave?: boolean;
    }
  ) =>
    request<MonitoringReportItem>(`/api/monitoring-reports/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Pusat Persetujuan (Approval Hub)
  getApprovalHub: () =>
    request<{
      items: ApprovalHubItem[];
      responsibleItems?: ApprovalHubItem[];
      configs: Record<string, ApprovalCategoryWorkflowConfig>;
      notifications: ApprovalNotificationItem[];
      accessProfile: import('../types/index.js').ApprovalAccessProfile;
    }>('/api/approval-hub'),
  markApprovalNotificationsRead: (payload: { notificationId?: string; markAll?: boolean }) =>
    request<{ success: boolean }>('/api/approval-hub/notifications/read', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  executeApprovalHubAction: (
    id: string,
    payload: {
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
    }
  ) =>
    request<{ item: ApprovalHubItem; message: string }>(
      `/api/approval-hub/${encodeURIComponent(id)}/action`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  updateApprovalWorkflowConfig: (payload: {
    categoryCode: ApprovalCategoryCode;
    mechanism: ApprovalWorkflowMechanism;
    parallelRule?: ParallelApprovalRule;
  }) =>
    request<{
      message: string;
      configs: Record<string, ApprovalCategoryWorkflowConfig>;
    }>('/api/approval-hub/workflow-config', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Finance Workspace Authoritative Budgets
  getFinanceProgramBudgets: () =>
    request<Record<string, any>>('/api/finance-workspace/budgets'),
  saveFinanceProgramBudget: (key: string, dataset: any) =>
    request<any>(`/api/finance-workspace/budgets/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(dataset),
    }),

  // Database Peserta (Master Data Mandiri Lintas Program)
  getParticipantDatabase: () =>
    request<{
      records: MasterParticipantRecord[];
      nextIndividualCode: string;
      nextGroupCode: string;
      auditLogs?: AuditLog[];
    }>('/api/participant-database'),
  createParticipantRecord: (payload: Partial<MasterParticipantRecord>) =>
    request<MasterParticipantRecord>('/api/participant-database', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateParticipantRecord: (id: string, payload: Partial<MasterParticipantRecord>) =>
    request<MasterParticipantRecord>(`/api/participant-database/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteParticipantRecord: (id: string) =>
    request<{ message: string }>(`/api/participant-database/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  linkParticipantsToProgram: (
    programId: string,
    payload: {
      participantIds: string[];
      roleInProgram?: string;
      notes?: string;
      joinedAt?: string;
    }
  ) =>
    request<{
      message: string;
      updatedParticipants: MasterParticipantRecord[];
    }>(`/api/programs/${encodeURIComponent(programId)}/participants-link`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  unlinkParticipantFromProgram: (programId: string, participantId: string) =>
    request<MasterParticipantRecord>(
      `/api/programs/${encodeURIComponent(programId)}/participants-link/${encodeURIComponent(
        participantId
      )}`,
      {
        method: 'DELETE',
      }
    ),

  // WIJNA Attendance & Timesheet (Standalone System)
  getAttendanceSystem: () => request<AttendanceSystemBundle>('/api/attendance-system'),
  clockInAttendance: (payload: {
    date?: string;
    latitude: number;
    longitude: number;
    gpsAccuracy?: number;
    outsideReason?: string;
    allowOutsideWithHrApproval?: boolean;
    workItems: { category: WijnaWorkCategory; shortDescription: string }[];
  }) =>
    request<{ record: DailyAttendanceTimesheetRecord; bundle: AttendanceSystemBundle }>(
      '/api/attendance-system/clock-in',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  resetTodayAttendance: (payload?: { date?: string }) =>
    request<{ bundle: AttendanceSystemBundle }>(
      '/api/attendance-system/reset-today',
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    ),
  updateDailyTimesheet: (payload: {
    date?: string;
    timesheetItems: { id?: string; category: WijnaWorkCategory; shortDescription: string }[];
  }) =>
    request<{ record: DailyAttendanceTimesheetRecord; bundle: AttendanceSystemBundle }>(
      '/api/attendance-system/timesheet',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  clockOutAttendance: (payload: {
    date?: string;
    latitude: number;
    longitude: number;
    gpsAccuracy?: number;
    outsideReason?: string;
  }) =>
    request<{ record: DailyAttendanceTimesheetRecord; bundle: AttendanceSystemBundle }>(
      '/api/attendance-system/clock-out',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  reviewOutsideLocation: (payload: {
    recordId: string;
    stage?: 'hr' | 'director';
    decision?: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
    notes?: string;
    returnReason?: string;
  }) =>
    request<{ record: DailyAttendanceTimesheetRecord; bundle: AttendanceSystemBundle }>(
      '/api/attendance-system/outside-location-review',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  updateAttendanceLocationConfig: (payload: {
    officeName: string;
    address: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    standardDailyHours: number;
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/location-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  saveFlextimeAssignment: (payload: {
    id?: string;
    userId?: string;
    startDate: string;
    endDate: string;
    scheduleArrangement: string;
    policyNotes?: string;
    isActive?: boolean;
    mode?: 'staff_request' | 'hr_assign';
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/flextime', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decideFlextimeRequest: (
    id: string,
    payload: {
      decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      notes?: string;
      returnReason?: string;
    }
  ) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/flextime/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  deleteFlextimeAssignment: (id: string) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/flextime/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),
  saveLeaveCategoryPolicy: (payload: {
    id?: string;
    code?: string;
    name: string;
    group: LeaveCategoryGroup;
    allocationDaysPerYear: number;
    requiresAttachmentOrNote?: boolean;
    termsAndProvisions: string;
    isActive?: boolean;
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/leave-policies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteLeaveCategoryPolicy: (id: string) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/leave-policies/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),
  submitLeaveRequest: (payload: {
    categoryId: string;
    startDate: string;
    endDate: string;
    reason?: string;
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/leave-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decideLeaveRequest: (
    id: string,
    payload: {
      stage?: 'hr' | 'director';
      decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      notes?: string;
      returnReason?: string;
    }
  ) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/leave-requests/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  submitOrAssignWfa: (payload: {
    mode: 'staff_request' | 'hr_manual';
    userId?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
    reasonAndPlan: string;
    hrNotes?: string;
    torId?: string;
    torNumber?: string;
    torTitle?: string;
    implementationOption?: string;
    isCustomImplementation?: boolean;
    invitedUserIds?: string[];
    invitedUserNames?: string[];
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/wfa', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decideWfaRequest: (
    id: string,
    payload: {
      stage?: 'hr' | 'director';
      decision?: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      status?: string;
      notes?: string;
      returnReason?: string;
    }
  ) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/wfa/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  submitHolidayRequest: (payload: {
    userId?: string;
    title: string;
    startDate: string;
    endDate?: string;
    reason?: string;
    autoApproveByHr?: boolean;
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/holiday-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decideHolidayRequest: (
    id: string,
    payload: {
      stage?: 'hr' | 'director';
      decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      notes?: string;
      returnReason?: string;
    }
  ) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/holiday-requests/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  saveEmployeeTraining: (payload: {
    id?: string;
    userId: string;
    trainingTitle?: string;
    organizer?: string;
    category?: string;
    startDate?: string;
    endDate?: string;
    durationHours?: number;
    certificateOrEvidenceUrl?: string;
    competencyNotes?: string;
    items?: Array<{
      trainingTitle: string;
      organizer: string;
      category: string;
      startDate: string;
      endDate?: string;
      durationHours?: number;
      certificateOrEvidenceUrl?: string;
      competencyNotes?: string;
    }>;
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/employee-trainings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteEmployeeTraining: (id: string) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/employee-trainings/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),
  decideEmployeeTraining: (
    id: string,
    payload: {
      decision: 'approve' | 'revision' | 'reject';
      notes?: string;
      userId?: string;
    }
  ) =>
    request<{ bundle: AttendanceSystemBundle }>(
      `/api/attendance-system/employee-trainings/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  saveEmployeeProfileLink: (payload: {
    userId: string;
    label?: string;
    url: string;
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/employee-profile-link', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  saveWorkRecapVerification: (payload: {
    userId: string;
    periodId: string;
    stage: 'finance' | 'director';
    notes?: string;
  }) =>
    request<{ bundle: AttendanceSystemBundle }>('/api/attendance-system/work-recap-verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Stats & Audit
  getStats: () => request<DashboardStats>('/api/stats'),
  getAuditLogs: () => request<AuditLog[]>('/api/audit-logs'),
  resetData: () => request<{ message: string }>('/api/reset-data', { method: 'POST' }),
};



