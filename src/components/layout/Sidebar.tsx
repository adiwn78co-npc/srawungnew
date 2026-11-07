import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { useOrganizationSettings } from '../../lib/organizationSettings.js';
import { api } from '../../lib/api.js';
import { AttendanceSystemBundle } from '../../types/index.js';
import {
  LayoutDashboard,
  Layers,
  CheckSquare,
  Calendar,
  Users,
  History,
  ClipboardCheck,
  ContactRound,
  Clock,
  Smartphone,
  X,
} from 'lucide-react';

function formatClockTimeHMS(isoOrTime?: string): string {
  if (!isoOrTime) return '--:--:--';
  if (/^\d{2}:\d{2}:\d{2}/.test(isoOrTime)) return isoOrTime;
  const d = new Date(isoOrTime);
  if (isNaN(d.getTime())) return isoOrTime;
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatLiveDurationHMS(startIso?: string, endIso?: string, nowMs?: number): string {
  if (!startIso) return '00:00:00';
  const startMs = new Date(startIso).getTime();
  const targetEndMs = endIso ? new Date(endIso).getTime() : nowMs || Date.now();
  if (isNaN(startMs) || isNaN(targetEndMs) || targetEndMs <= startMs) {
    return '00:00:00';
  }
  const totalSeconds = Math.floor((targetEndMs - startMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export type NavTab =
  | 'dashboard'
  | 'calendar'
  | 'attendance'
  | 'employee-profile'
  | 'work-recap'
  | 'programs'
  | 'participants'
  | 'monitoring-tools'
  | 'my-tors'
  | 'finance'
  | 'approvals'
  | 'users'
  | 'audit';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingApprovalsCount: number;
  monitoringFollowUpCount?: number;
  canAccessApprovalMenu?: boolean;
  approvalMenuLabel?: string;
  isMobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
  showBackToMobileQuickMode?: boolean;
  onBackToMobileQuickMode?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  pendingApprovalsCount,
  monitoringFollowUpCount = 0,
  canAccessApprovalMenu = false,
  approvalMenuLabel = 'Your Next Steps',
  isMobileDrawerOpen = false,
  onCloseMobileDrawer,
  showBackToMobileQuickMode = false,
  onBackToMobileQuickMode,
}) => {
  const { currentUser, isAdmin } = useAuth();
  const { sidebarBrandName } = useOrganizationSettings();

  const [attendanceBundle, setAttendanceBundle] = useState<AttendanceSystemBundle | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const lockedTodayDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Real-time 1-second ticker connected to Your Contribution
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load initial attendance state & listen for real-time updates from Your Contribution
  useEffect(() => {
    let mounted = true;
    api
      .getAttendanceSystem()
      .then((data) => {
        if (mounted && data) setAttendanceBundle(data);
      })
      .catch(() => {
        // ignore silent background fetch error
      });

    const handleBundleUpdate = (e: Event) => {
      const customEvt = e as CustomEvent<AttendanceSystemBundle>;
      if (customEvt.detail) {
        setAttendanceBundle(customEvt.detail);
      }
    };

    window.addEventListener('wijna-attendance-bundle-updated', handleBundleUpdate);
    return () => {
      mounted = false;
      window.removeEventListener('wijna-attendance-bundle-updated', handleBundleUpdate);
    };
  }, [currentUser?.id]);

  const myTodayRecord = useMemo(() => {
    if (!attendanceBundle || !currentUser) return undefined;
    return attendanceBundle.records.find(
      (r) => r.userId === currentUser.id && r.date === lockedTodayDate
    );
  }, [attendanceBundle, currentUser, lockedTodayDate]);

  const hasClockedIn = Boolean(myTodayRecord?.clockInTime);
  const hasClockedOut = Boolean(myTodayRecord?.clockOutTime);
  const liveClockNowStr = useMemo(
    () =>
      new Date(nowMs).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    [nowMs]
  );
  const liveDurationHms = useMemo(
    () =>
      formatLiveDurationHMS(
        myTodayRecord?.clockInTime,
        myTodayRecord?.clockOutTime,
        nowMs
      ),
    [myTodayRecord?.clockInTime, myTodayRecord?.clockOutTime, nowMs]
  );

  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Your Progress',
      icon: LayoutDashboard,
      show: true,
    },
    {
      id: 'programs' as NavTab,
      label: 'Our Impact',
      icon: Layers,
      show: true,
    },
    {
      id: 'participants' as NavTab,
      label: 'People We Reach & Serve',
      icon: ContactRound,
      show: true,
    },
    {
      id: 'monitoring-tools' as NavTab,
      label: 'Your Missions',
      icon: ClipboardCheck,
      badge: monitoringFollowUpCount > 0 ? monitoringFollowUpCount : undefined,
      show: true,
    },
    {
      id: 'approvals' as NavTab,
      label: approvalMenuLabel || 'Your Next Steps',
      icon: CheckSquare,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
      show: canAccessApprovalMenu,
    },
    {
      id: 'calendar' as NavTab,
      label: 'Calendar',
      icon: Calendar,
      show: true,
    },
    {
      id: 'users' as NavTab,
      label: 'System Organisator',
      icon: Users,
      show: isAdmin,
    },
    {
      id: 'audit' as NavTab,
      label: 'Our Journey',
      icon: History,
      show: true,
    },
  ];

  const isAttendanceActive = activeTab === 'attendance';

  const sidebarContent = (
    <aside className="w-64 xl:w-60 shrink-0 bg-[#F7F7F5] text-[#37352F] h-full xl:h-screen overflow-y-auto flex flex-col border-r border-[#EAEAEA] select-none print:hidden">
      {/* Brand & Organization Header - Centralized via System Organisator */}
      <div className="p-4 border-b border-[#EAEAEA] flex items-center justify-between gap-2">
        <div className="overflow-hidden min-w-0">
          <h1
            className="font-semibold text-sm text-[#252525] tracking-tight leading-snug"
            title={sidebarBrandName}
          >
            {sidebarBrandName}
          </h1>
        </div>
        {onCloseMobileDrawer && (
          <button
            type="button"
            onClick={onCloseMobileDrawer}
            className="xl:hidden p-1.5 rounded-md text-[#787774] hover:text-[#252525] hover:bg-[#EAEAE8] cursor-pointer"
            title="Tutup Menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Quick Switch back to Simplified Mobile View when in Full Web Version on Mobile/Tablet */}
      {showBackToMobileQuickMode && onBackToMobileQuickMode && (
        <div className="px-2.5 pt-2.5 xl:hidden">
          <button
            type="button"
            onClick={() => {
              onBackToMobileQuickMode();
              if (onCloseMobileDrawer) onCloseMobileDrawer();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#1F7A63] hover:bg-[#17614E] text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>Tampilan Ringkas Mobile</span>
          </button>
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        <div className="px-2 py-1 text-[11px] font-semibold text-[#787774] uppercase tracking-wider">
          Menu Utama
        </div>
        {navItems
          .filter((item) => item.show)
          .map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  if (onCloseMobileDrawer) onCloseMobileDrawer();
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 xl:py-2 min-h-[44px] xl:min-h-0 rounded-md text-[14px] font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#EAEAE8] text-[#252525] font-semibold'
                    : 'text-[#5A5A58] hover:text-[#252525] hover:bg-[#EFEFEA]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-[#3867F5]' : 'text-[#787774]'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                      isActive
                        ? 'bg-[#3867F5] text-white'
                        : 'bg-[#F28B24] text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
      </nav>

      {/* Bottom Section: Your Contribution + Same-Tone Clock-In Notification & Real-Time Clock-In */}
      <div className="mt-auto p-2.5 border-t border-[#EAEAEA] space-y-1.5 bg-[#F7F7F5]">
        {/* Notification / Real-Time Clock-In Status with the Same Sidebar Tone */}
        <div
          onClick={() => {
            onSelectTab('attendance');
            if (onCloseMobileDrawer) onCloseMobileDrawer();
          }}
          className="px-3 py-2 rounded-md bg-[#EAEAE8] border border-[#E0E0DC] text-[#37352F] cursor-pointer hover:bg-[#E4E4E1] transition-colors"
        >
          {!hasClockedIn ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-semibold text-[#252525]">
                  Silakan Clock In dahulu
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#3867F5] shrink-0" />
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#5A5A58]">
                <span>Waktu Real-Time</span>
                <span className="font-mono font-semibold text-[#252525] tabular-nums">
                  {liveClockNowStr}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#5A5A58]">
                <span>Waktu Clock In</span>
                <span className="font-mono font-semibold text-[#252525] tabular-nums">
                  {formatClockTimeHMS(myTodayRecord?.clockInTime)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#5A5A58]">
                <span>{hasClockedOut ? 'Durasi Selesai' : 'Durasi Real-Time'}</span>
                <span className="font-mono font-semibold text-[#3867F5] tabular-nums">
                  {liveDurationHms}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Your Contribution Button at the Bottom */}
        <button
          type="button"
          onClick={() => {
            onSelectTab('attendance');
            if (onCloseMobileDrawer) onCloseMobileDrawer();
          }}
          className={`w-full flex items-center justify-between px-3 py-2.5 xl:py-2 min-h-[44px] xl:min-h-0 rounded-md text-[14px] font-medium transition-colors cursor-pointer ${
            isAttendanceActive
              ? 'bg-[#EAEAE8] text-[#252525] font-semibold'
              : 'text-[#5A5A58] hover:text-[#252525] hover:bg-[#EFEFEA]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Clock
              className={`w-4 h-4 shrink-0 ${
                isAttendanceActive ? 'text-[#3867F5]' : 'text-[#787774]'
              }`}
            />
            <span>Your Contribution</span>
          </div>
          {!hasClockedIn && (
            <span className="w-2 h-2 rounded-full bg-[#3867F5] shrink-0" title="Belum Clock In" />
          )}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Persistent Sidebar on Desktop only (xl and up) */}
      <div className="hidden xl:block sticky top-0 h-screen shrink-0">
        {sidebarContent}
      </div>

      {/* Responsive Slide-Over Drawer on Mobile & Tablet (< xl) when Full Web Version is opened */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 xl:hidden flex">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={onCloseMobileDrawer}
          />
          <div className="relative z-10 h-full flex">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};

