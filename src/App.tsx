import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Sidebar, NavTab } from './components/layout/Sidebar.js';
import { Topbar } from './components/layout/Topbar.js';
import { DashboardView } from './components/dashboard/DashboardView.js';
import { ProgramStructureView } from './components/program/ProgramStructureView.js';
import { TorDetailView } from './components/tor/TorDetailView.js';
import { TorFormModal } from './components/tor/TorFormModal.js';
import { ApprovalCenterView } from './components/approval/ApprovalCenterView.js';
import { FinanceWorkspaceView } from './components/finance/FinanceWorkspaceView.js';
import { UserManagementView } from './components/admin/UserManagementView.js';
import { AuditTrailView } from './components/audit/AuditTrailView.js';
import { MonitoringToolsView } from './components/monitoring/MonitoringToolsView.js';
import { ParticipantDatabaseView } from './components/participants/ParticipantDatabaseView.js';
import { AttendanceTimesheetView } from './components/attendance/AttendanceTimesheetView.js';
import { LoginPage } from './components/auth/LoginPage.js';
import {
  Tor,
  Program,
  Outcome,
  Output,
  Activity,
  SubActivity,
  DashboardStats,
  AuditLog,
  TorApprovalRecord,
  ApprovalHubItem,
  ApprovalAccessProfile,
  ApprovalNotificationItem,
  ApprovalCategoryCode,
} from './types/index.js';
import { api } from './lib/api.js';
import { hydrateProgramBudgetDatasetsFromServer } from './lib/programBudgetStorage.js';
import { hydrateOrganizationSettingsFromServer } from './lib/organizationSettings.js';

const CATEGORY_STAGE_MAP: Record<ApprovalCategoryCode, number> = {
  tor: 1,
  cash_advance: 2,
  notulen: 4,
  dokumentasi: 5,
  executive_summary: 6,
  laporan_keuangan_akhir: 8,
};

function MainAppContent() {
  const { currentUser, isDirector, isFinance, isAdmin, isAuthenticated, refreshUsers, allUsers } =
    useAuth();

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedTorId, setSelectedTorId] = useState<string | null>(null);
  const [selectedTorInitialStage, setSelectedTorInitialStage] = useState<number>(1);
  const [selectedTorTargetEntityId, setSelectedTorTargetEntityId] = useState<string | undefined>(
    undefined
  );
  const [selectedTorFocusedSourceMode, setSelectedTorFocusedSourceMode] = useState<boolean>(false);
  const [selectedTorAutoOpenEdit, setSelectedTorAutoOpenEdit] = useState<boolean>(false);
  const [selectedTorData, setSelectedTorData] = useState<{
    tor: Tor;
    approvalRecords: TorApprovalRecord[];
  } | null>(null);

  const [tors, setTors] = useState<Tor[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    activeTors: 0,
    pendingApprovals: 0,
    nearDeadline: 0,
    overdue: 0,
  });

  const [programs, setPrograms] = useState<Program[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [subActivities, setSubActivities] = useState<SubActivity[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [approvalHubItems, setApprovalHubItems] = useState<ApprovalHubItem[]>([]);
  const [responsibleApprovalItems, setResponsibleApprovalItems] = useState<ApprovalHubItem[]>([]);
  const [approvalNotifications, setApprovalNotifications] = useState<ApprovalNotificationItem[]>(
    []
  );
  const [approvalAccessProfile, setApprovalAccessProfile] = useState<ApprovalAccessProfile | null>(
    null
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [approvalFilterActivityId, setApprovalFilterActivityId] = useState<string | null>(null);

  // Modal State
  const [showCreateTorModal, setShowCreateTorModal] = useState(false);
  const [initialTorActivitySelection, setInitialTorActivitySelection] = useState<{
    outcomeId: string;
    outputId: string;
    activityId: string;
  } | undefined>(undefined);

  // Fetch all core application data (only when authenticated)
  const loadData = useCallback(async () => {
    if (!isAuthenticated || !currentUser) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [torsRes, statsRes, progRes, auditRes, apvRes, finBudgetsRes] = await Promise.all([
        api.getTors(),
        api.getStats(),
        api.getPrograms(),
        api.getAuditLogs(),
        api.getApprovalHub().catch(() => null),
        api.getFinanceProgramBudgets().catch(() => null),
        hydrateOrganizationSettingsFromServer().catch(() => null),
      ]);

      if (finBudgetsRes && typeof finBudgetsRes === 'object') {
        hydrateProgramBudgetDatasetsFromServer(finBudgetsRes);
      }
      if (Array.isArray(torsRes)) setTors(torsRes);
      if (statsRes && typeof statsRes === 'object') setStats(statsRes);
      if (progRes && typeof progRes === 'object') {
        setPrograms(Array.isArray(progRes.programs) ? progRes.programs : []);
        setOutcomes(Array.isArray(progRes.outcomes) ? progRes.outcomes : []);
        setOutputs(Array.isArray(progRes.outputs) ? progRes.outputs : []);
        setActivities(Array.isArray(progRes.activities) ? progRes.activities : []);
        setSubActivities(Array.isArray(progRes.subActivities) ? progRes.subActivities : []);
      }
      if (Array.isArray(auditRes)) setAuditLogs(auditRes);
      if (apvRes && typeof apvRes === 'object') {
        setApprovalHubItems(Array.isArray(apvRes.items) ? apvRes.items : []);
        setResponsibleApprovalItems(
          Array.isArray(apvRes.responsibleItems) ? apvRes.responsibleItems : []
        );
        setApprovalNotifications(
          Array.isArray(apvRes.notifications) ? apvRes.notifications : []
        );
        setApprovalAccessProfile(apvRes.accessProfile || null);
      }

      // If a TOR is currently selected, refresh its details as well
      if (selectedTorId) {
        try {
          const detail = await api.getTor(selectedTorId);
          if (detail && detail.tor) {
            setSelectedTorData({
              tor: detail.tor,
              approvalRecords: Array.isArray(detail.approvalRecords) ? detail.approvalRecords : [],
            });
          } else {
            const fallbackTor = Array.isArray(torsRes)
              ? torsRes.find((t) => t.id === selectedTorId)
              : undefined;
            if (fallbackTor) {
              setSelectedTorData({ tor: fallbackTor, approvalRecords: [] });
            } else {
              setSelectedTorId(null);
              setSelectedTorData(null);
            }
          }
        } catch {
          const fallbackTor = Array.isArray(torsRes)
            ? torsRes.find((t) => t.id === selectedTorId)
            : undefined;
          if (fallbackTor) {
            setSelectedTorData({ tor: fallbackTor, approvalRecords: [] });
          } else {
            setSelectedTorId(null);
            setSelectedTorData(null);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load application data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedTorId, isAuthenticated, currentUser]);

  useEffect(() => {
    if (isAuthenticated && currentUser) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [loadData, isAuthenticated, currentUser]);

  // When clicking on a TOR (optionally targeting a specific workflow stage 1..8 and source entity)
  const handleSelectTor = async (
    torId: string,
    initialStage: number = 1,
    options?: {
      targetEntityId?: string;
      focusedSourceMode?: boolean;
      autoOpenEdit?: boolean;
    }
  ) => {
    setSelectedTorInitialStage(initialStage);
    setSelectedTorTargetEntityId(options?.targetEntityId);
    setSelectedTorFocusedSourceMode(Boolean(options?.focusedSourceMode));
    setSelectedTorAutoOpenEdit(Boolean(options?.autoOpenEdit));
    const existingTor = tors.find((t) => t.id === torId);
    if (existingTor) {
      setSelectedTorData((prev) => ({
        tor: existingTor,
        approvalRecords: prev?.tor?.id === torId ? prev.approvalRecords : [],
      }));
      setSelectedTorId(torId);
    }
    try {
      setLoading(true);
      const detail = await api.getTor(torId);
      if (detail && detail.tor) {
        setSelectedTorData({
          tor: detail.tor,
          approvalRecords: Array.isArray(detail.approvalRecords) ? detail.approvalRecords : [],
        });
        setSelectedTorId(torId);
      }
    } catch (err) {
      console.error('Failed to fetch TOR detail:', err);
    } finally {
      setLoading(false);
    }
  };

  // Open TOR creation form
  const handleOpenCreateTor = (selection?: {
    outcomeId: string;
    outputId: string;
    activityId: string;
  }) => {
    setInitialTorActivitySelection(selection);
    setShowCreateTorModal(true);
  };

  // On TOR creation success
  const handleTorCreatedSuccess = (newTorId: string) => {
    setShowCreateTorModal(false);
    loadData();
    handleSelectTor(newTorId, 1);
  };

  const canAccessApprovalMenu = Boolean(approvalAccessProfile?.canAccessApprovalMenu);
  const isPureResponsibleUser = Boolean(
    approvalAccessProfile?.isR &&
      !approvalAccessProfile?.isA1 &&
      !approvalAccessProfile?.isA2 &&
      !approvalAccessProfile?.isDirector &&
      !approvalAccessProfile?.isFinance
  );
  const hasBothApproverAndResponsibleRoles = Boolean(
    approvalAccessProfile?.isR &&
      (approvalAccessProfile?.isA1 ||
        approvalAccessProfile?.isA2 ||
        approvalAccessProfile?.isDirector ||
        approvalAccessProfile?.isFinance)
  );
  const approvalMenuLabel = 'Your Next Steps';

  // If the user switches to an account that does not have access to Menu Approval (e.g., Admin), redirect away from 'approvals'
  // Also restrict 'work-recap' to HR/Finance and Director only
  useEffect(() => {
    if (!loading && approvalAccessProfile && !approvalAccessProfile.canAccessApprovalMenu && activeTab === 'approvals') {
      setActiveTab(isAdmin ? 'users' : 'monitoring-tools');
      setApprovalFilterActivityId(null);
    }
    const canSeeWorkRecap =
      currentUser?.role === 'finance' ||
      currentUser?.role === 'hr' ||
      currentUser?.role === 'director';
    if (!loading && activeTab === 'work-recap' && !canSeeWorkRecap) {
      setActiveTab('attendance');
    }
  }, [loading, approvalAccessProfile, activeTab, isAdmin, currentUser?.role]);

  // Pending approvals count for current user based on Role & RACI authority
  const approverActionCount = approvalHubItems.filter((item) => {
    if (!currentUser || !canAccessApprovalMenu) return false;
    if (item.responsibleUserId === currentUser.id) return false;
    const isProgramDoc = item.groupType === 'program_documents';
    const isFinanceDoc = item.groupType === 'financial_documents';
    const isWaitingVerification =
      item.status === 'Pending Verification' || item.status === 'Submitted';

    if (
      isProgramDoc &&
      approvalAccessProfile?.isA1 &&
      item.accountableProgramUserId === currentUser.id &&
      isWaitingVerification
    ) {
      return true;
    }
    if (
      isFinanceDoc &&
      approvalAccessProfile?.isA2 &&
      item.accountableFinanceUserId === currentUser.id &&
      isWaitingVerification
    ) {
      return true;
    }
    if (
      approvalAccessProfile?.isDirector &&
      ((isFinanceDoc && item.status === 'Pending Approval') ||
        (isProgramDoc && (item.status === 'Approved' || item.status === 'Pending Approval')))
    ) {
      return true;
    }
    return false;
  }).length;

  const responsibleRevisionCount = responsibleApprovalItems.filter(
    (item) =>
      currentUser &&
      item.responsibleUserId === currentUser.id &&
      !item.isArchived &&
      (item.status === 'Revision Required' || item.status === 'Rejected')
  ).length;

  const pendingApprovalsCount = isPureResponsibleUser
    ? responsibleRevisionCount
    : approverActionCount + responsibleRevisionCount;

  const monitoringFollowUpCount = (() => {
    if (!currentUser) return 0;
    return approvalNotifications.filter(
      (n) =>
        n.approvalItemId?.startsWith('raci-') &&
        !(n.isReadByUserIds || []).includes(currentUser.id)
    ).length;
  })();

  const handleMarkNotificationRead = async (notificationId?: string, markAll?: boolean) => {
    if (!currentUser) return;
    try {
      await api.markApprovalNotificationsRead({ notificationId, markAll });
      setApprovalNotifications((prev) =>
        prev.map((n) => {
          if (markAll || (notificationId && n.id === notificationId)) {
            const readSet = new Set(n.isReadByUserIds || []);
            readSet.add(currentUser.id);
            return { ...n, isReadByUserIds: Array.from(readSet) };
          }
          return n;
        })
      );
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleSelectNotification = async (notif: ApprovalNotificationItem) => {
    const isRead = Boolean(currentUser && (notif.isReadByUserIds || []).includes(currentUser.id));
    if (!isRead) {
      await handleMarkNotificationRead(notif.id, false);
    }
    if (notif.approvalItemId && notif.approvalItemId.startsWith('raci-')) {
      setActiveTab('monitoring-tools');
      return;
    }
    const targetItem =
      responsibleApprovalItems.find((i) => i.id === notif.approvalItemId) ||
      approvalHubItems.find((i) => i.id === notif.approvalItemId);

    if (targetItem && targetItem.sourceTorId) {
      const stageNum = CATEGORY_STAGE_MAP[targetItem.categoryCode] || 1;
      const isRevision =
        notif.eventType === 'REVISION_REQUIRED' ||
        targetItem.status === 'Revision Required' ||
        targetItem.status === 'Rejected';
      handleSelectTor(targetItem.sourceTorId, stageNum, {
        targetEntityId: targetItem.sourceCashAdvanceId || targetItem.sourceEntityId,
        focusedSourceMode: true,
        autoOpenEdit: isRevision,
      });
      return;
    }

    if (canAccessApprovalMenu) {
      setActiveTab('approvals');
    } else {
      setActiveTab('monitoring-tools');
    }
  };

  const pageTitles: Record<NavTab, string> = {
    dashboard: 'Your Progress',
    calendar: 'Calendar',
    attendance: 'Your Contribution',
    'employee-profile': 'Profil Karyawan — Output, Cuti & Multi Pelatihan',
    'work-recap': 'Rekap Kerja – WIJNA',
    programs: 'Our Impact',
    participants: 'People We Reach & Serve',
    'monitoring-tools': 'Your Missions',
    'my-tors': currentUser?.role === 'staff' ? 'TOR Saya' : 'Daftar Dokumen TOR',
    finance: 'WIJNA Finance Workspace',
    approvals: 'Your Next Steps',
    users: 'System Organisator — Kelola Pengguna & Pengaturan Organisasi',
    audit: 'Our Journey',
  };

  const activeSelectedTor =
    selectedTorData?.tor || (selectedTorId ? tors.find((t) => t.id === selectedTorId) : undefined);

  // Automatic mobile & tablet screen detection (< 1280px / < xl) — tablet treated identically to mobile
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1280 : false
  );
  const [forceFullWebVersion, setForceFullWebVersion] = useState<boolean>(true);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 1279px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobileViewport(e.matches);
      if (!e.matches) {
        setIsMobileDrawerOpen(false);
      }
    };
    handleChange(mql);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    } else {
      window.addEventListener('resize', () => setIsMobileViewport(window.innerWidth < 1280));
      return () =>
        window.removeEventListener('resize', () => setIsMobileViewport(window.innerWidth < 1280));
    }
  }, []);

  // Default to Full Web Version; user can still switch to Mobile Quick-Access Mode if desired
  const isMobileQuickMode = isMobileViewport && !forceFullWebVersion;

  const currentPageTitle =
    selectedTorId && activeSelectedTor
      ? `Detail Dokumen: ${activeSelectedTor.torNumber || 'TOR'}`
      : pageTitles[activeTab];

  if (!isAuthenticated) {
    return (
      <LoginPage
        onLoginSuccess={(loggedInUser) => {
          setSelectedTorId(null);
          setSelectedTorData(null);
          setActiveTab(loggedInUser.role === 'admin' ? 'users' : 'dashboard');
          loadData();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen bg-[#FAFAF9] font-sans text-[#252525] antialiased">
      {/* Sidebar Navigation (Hidden in Mobile Quick-Access Mode; Drawer in Mobile Full Web Mode; Persistent on Desktop) */}
      {!isMobileQuickMode && (
        <Sidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            if (tab === 'approvals' && !canAccessApprovalMenu) return;
            setActiveTab(tab);
            setSelectedTorId(null);
            setSelectedTorData(null);
            setSelectedTorTargetEntityId(undefined);
            setSelectedTorFocusedSourceMode(false);
            setSelectedTorAutoOpenEdit(false);
            if (tab !== 'approvals') {
              setApprovalFilterActivityId(null);
            }
          }}
          pendingApprovalsCount={pendingApprovalsCount}
          monitoringFollowUpCount={monitoringFollowUpCount}
          canAccessApprovalMenu={canAccessApprovalMenu}
          approvalMenuLabel={approvalMenuLabel}
          isMobileDrawerOpen={isMobileDrawerOpen}
          onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
          showBackToMobileQuickMode={isMobileViewport && forceFullWebVersion}
          onBackToMobileQuickMode={() => {
            setForceFullWebVersion(false);
            setSelectedTorId(null);
            setSelectedTorData(null);
            setActiveTab('attendance');
          }}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          pageTitle={currentPageTitle}
          onRefreshData={loadData}
          notifications={approvalNotifications}
          onSelectNotification={(notif) => {
            if (isMobileQuickMode) {
              setForceFullWebVersion(true);
            }
            handleSelectNotification(notif);
          }}
          onMarkAllNotificationsRead={() => handleMarkNotificationRead(undefined, true)}
          onOpenEmployeeProfile={() => {
            if (isMobileQuickMode) {
              setForceFullWebVersion(true);
            }
            setSelectedTorId(null);
            setSelectedTorData(null);
            setActiveTab('employee-profile');
          }}
          isMobileQuickMode={isMobileQuickMode}
          onOpenFullWebVersion={() => setForceFullWebVersion(true)}
          onBackToMobileQuickMode={
            isMobileViewport && forceFullWebVersion
              ? () => {
                  setForceFullWebVersion(false);
                  setSelectedTorId(null);
                  setSelectedTorData(null);
                  setActiveTab('attendance');
                }
              : undefined
          }
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
        />

        {/* Viewport Content Container */}
        <main className="flex-1 px-3 py-2.5 sm:px-4 sm:py-3 md:px-6 md:py-4 max-w-7xl w-full mx-auto overflow-y-auto">
          {isMobileQuickMode ? (
            /* Simplified Mobile Quick-Access View: Prioritizes Your Contribution (Clock In/Out), WFA, and Cuti & Izin */
            <AttendanceTimesheetView
              key="attendance-mobile-quick"
              initialSubTab="daily"
              isMobileQuickMode={true}
              onOpenFullWebVersion={() => setForceFullWebVersion(true)}
            />
          ) : selectedTorId && activeSelectedTor ? (
            <TorDetailView
              tor={activeSelectedTor}
              approvalRecords={selectedTorData?.approvalRecords || []}
              initialStage={selectedTorInitialStage}
              targetEntityId={selectedTorTargetEntityId}
              focusedSourceMode={selectedTorFocusedSourceMode}
              autoOpenEdit={selectedTorAutoOpenEdit}
              onBack={() => {
                setSelectedTorId(null);
                setSelectedTorData(null);
                setSelectedTorTargetEntityId(undefined);
                setSelectedTorFocusedSourceMode(false);
                setSelectedTorAutoOpenEdit(false);
                loadData();
              }}
              onRefresh={loadData}
              programs={programs}
              outcomes={outcomes}
              outputs={outputs}
              activities={activities}
              subActivities={subActivities}
              users={allUsers}
            />
          ) : (
            <>
              {(activeTab === 'dashboard' || activeTab === 'my-tors') && (
                <DashboardView
                  tors={tors}
                  stats={stats}
                  loading={loading}
                  onSelectTor={handleSelectTor}
                  onCreateTor={() => handleOpenCreateTor()}
                  searchTerm={searchTerm}
                  setSearchTerm={setSearchTerm}
                  programs={programs}
                  outcomes={outcomes}
                  outputs={outputs}
                  activities={activities}
                  subActivities={subActivities}
                  onNavigateToPrograms={() => setActiveTab('programs')}
                  onOpenCreateTorForActivity={(ocId: string, opId: string, actId: string) =>
                    handleOpenCreateTor({ outcomeId: ocId, outputId: opId, activityId: actId })
                  }
                  onRefreshData={loadData}
                />
              )}

              {activeTab === 'programs' && (
                <ProgramStructureView
                  programs={programs}
                  outcomes={outcomes}
                  outputs={outputs}
                  activities={activities}
                  subActivities={subActivities}
                  tors={tors}
                  onRefresh={loadData}
                  onSelectTor={handleSelectTor}
                  onOpenCreateTorForActivity={(ocId: string, opId: string, actId: string) =>
                    handleOpenCreateTor({ outcomeId: ocId, outputId: opId, activityId: actId })
                  }
                />
              )}

              {activeTab === 'calendar' && (
                <AttendanceTimesheetView
                  key="attendance-calendar"
                  initialSubTab="calendar"
                  pureCalendarMode={true}
                />
              )}

              {activeTab === 'attendance' && (
                <AttendanceTimesheetView key="attendance-daily" initialSubTab="daily" />
              )}

              {activeTab === 'employee-profile' && (
                <AttendanceTimesheetView key="attendance-profile" initialSubTab="employee_profile" />
              )}

              {activeTab === 'work-recap' && (
                <AttendanceTimesheetView key="attendance-recap" initialSubTab="work_recap" />
              )}

              {activeTab === 'participants' && (
                <ParticipantDatabaseView programs={programs} />
              )}

              {activeTab === 'monitoring-tools' && (
                <MonitoringToolsView
                  programs={programs}
                  outcomes={outcomes}
                  outputs={outputs}
                  activities={activities}
                  users={allUsers}
                  tors={tors}
                  onSelectTor={handleSelectTor}
                  onOpenCreateTorForActivity={(ocId: string, opId: string, actId: string) =>
                    handleOpenCreateTor({ outcomeId: ocId, outputId: opId, activityId: actId })
                  }
                  onOpenApprovalForActivity={
                    canAccessApprovalMenu
                      ? (activityId: string) => {
                           setApprovalFilterActivityId(activityId);
                           setActiveTab('approvals');
                         }
                      : undefined
                  }
                  onRaciChanged={loadData}
                  responsibleApprovalItems={responsibleApprovalItems}
                  notifications={approvalNotifications}
                  onMarkNotificationRead={handleMarkNotificationRead}
                />
              )}

              {activeTab === 'finance' && (
                <FinanceWorkspaceView
                  programs={programs}
                  outcomes={outcomes}
                  outputs={outputs}
                  activities={activities}
                  subActivities={subActivities}
                  tors={tors}
                  onRefreshData={loadData}
                  onSelectTor={handleSelectTor}
                  onCreateTor={handleOpenCreateTor}
                />
              )}

              {activeTab === 'approvals' && (
                <ApprovalCenterView
                  tors={tors}
                  programs={programs}
                  outcomes={outcomes}
                  outputs={outputs}
                  activities={activities}
                  initialFilterActivityId={approvalFilterActivityId}
                  onSelectTor={handleSelectTor}
                  onCreateTor={() => handleOpenCreateTor()}
                  onNavigateToMonitoringTools={() => setActiveTab('monitoring-tools')}
                  onRefreshGlobalData={loadData}
                />
              )}

              {activeTab === 'users' && (
                <UserManagementView
                  onRefresh={() => {
                    refreshUsers();
                    loadData();
                  }}
                />
              )}

              {activeTab === 'audit' && <AuditTrailView logs={auditLogs} />}
            </>
          )}
        </main>
      </div>

      {/* Global TOR Creation Form Modal */}
      {showCreateTorModal && (
        <TorFormModal
          programs={programs}
          outcomes={outcomes}
          outputs={outputs}
          activities={activities}
          subActivities={subActivities}
          users={allUsers}
          isOpen={showCreateTorModal}
          onClose={() => setShowCreateTorModal(false)}
          onSuccess={handleTorCreatedSuccess}
          initialActivitySelection={initialTorActivitySelection}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}

