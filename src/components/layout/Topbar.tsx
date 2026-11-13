import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { ApprovalNotificationItem } from '../../types/index.js';
import {
  ChevronDown,
  RefreshCw,
  Bell,
  CheckCheck,
  UserCheck,
  Menu,
  Monitor,
  Smartphone,
  LogOut,
  X,
  KeyRound,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';

interface TopbarProps {
  pageTitle: string;
  onSearch?: (term: string) => void;
  searchTerm?: string;
  onRefreshData?: () => void;
  notifications?: ApprovalNotificationItem[];
  onSelectNotification?: (notif: ApprovalNotificationItem) => void;
  onMarkAllNotificationsRead?: () => void;
  onOpenEmployeeProfile?: () => void;
  isMobileQuickMode?: boolean;
  onOpenFullWebVersion?: () => void;
  onBackToMobileQuickMode?: () => void;
  onOpenMobileDrawer?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  pageTitle,
  onRefreshData,
  notifications = [],
  onSelectNotification,
  onMarkAllNotificationsRead,
  onOpenEmployeeProfile,
  isMobileQuickMode = false,
  onOpenFullWebVersion,
  onBackToMobileQuickMode,
  onOpenMobileDrawer,
}) => {
  const { currentUser, changePassword, logout } = useAuth();
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  // Self-service Change Password Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const uniqueNotifications = React.useMemo(() => {
    const seen = new Set<string>();
    return notifications.filter((n) => {
      const cleanedMsg = (n.message || '').replace(/^\[[^\]]+\]\s*/, '').trim();
      const key = `${n.approvalItemId}|${n.eventType}|${cleanedMsg}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [notifications]);

  const unreadCount = uniqueNotifications.filter(
    (n) => !currentUser || !(n.isReadByUserIds || []).includes(currentUser.id)
  ).length;

  const openChangePasswordModal = () => {
    setShowUserDropdown(false);
    setShowNotifDropdown(false);
    setCurrentPasswordInput('');
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    setPasswordError(null);
    setPasswordSuccess(null);
    setShowPasswordModal(true);
  };

  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    const trimmedNew = newPasswordInput.trim();
    if (!currentPasswordInput) {
      setPasswordError('Masukkan password Anda saat ini.');
      return;
    }
    if (trimmedNew.length < 6) {
      setPasswordError('Password baru minimal harus terdiri dari 6 karakter.');
      return;
    }
    if (trimmedNew !== confirmPasswordInput.trim()) {
      setPasswordError('Konfirmasi password baru tidak cocok.');
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword(currentPasswordInput, trimmedNew);
      setPasswordSuccess('Password berhasil diperbarui! Pengingat password default telah dinonaktifkan.');
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess(null);
      }, 1400);
    } catch (err: any) {
      setPasswordError(err?.message || 'Gagal memperbarui password.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <>
      <header className="h-14 bg-white/95 backdrop-blur-md border-b border-[#EAEAEA] px-3 sm:px-6 flex items-center justify-between gap-2 shrink-0 sticky top-0 z-20">
        {/* Left Zone: Menu Drawer (Phone only) & Page Title */}
        <div className="flex items-center gap-2 min-w-0">
          {!isMobileQuickMode && onOpenMobileDrawer && (
            <button
              type="button"
              onClick={onOpenMobileDrawer}
              className="sm:hidden p-2 -ml-1 rounded-lg text-[#37352F] hover:bg-[#F3F3F1] transition-colors cursor-pointer shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Buka Menu Navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="min-w-0">
            <h2 className="text-sm sm:text-lg font-bold text-[#252525] tracking-tight truncate">
              {pageTitle}
            </h2>
          </div>
        </div>

        {/* Right Zone: Notifications, Refresh, and User Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">

          {onRefreshData && (
            <button
              onClick={onRefreshData}
              title="Muat Ulang Data"
              className="hidden sm:inline-flex p-1.5 text-[#787774] hover:text-[#252525] hover:bg-[#F3F3F1] rounded-md transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Notification Bell Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNotifDropdown((prev) => !prev);
                setShowUserDropdown(false);
              }}
              title={
                isMobileQuickMode
                  ? 'Notifikasi Informasi (Tindak lanjut khusus versi Website)'
                  : 'Notifikasi Persetujuan & Tindak Lanjut'
              }
              className="relative p-2 text-[#57564F] hover:text-[#252525] hover:bg-[#F3F3F1] rounded-md transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#E03E3E] text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifDropdown && (
              <>
                <div
                  className="fixed inset-0 z-30 bg-black/10 sm:bg-transparent"
                  onClick={() => setShowNotifDropdown(false)}
                />
                <div className="fixed left-2.5 right-2.5 top-[58px] w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-96 sm:max-w-[92vw] bg-white border border-[#EAEAEA] rounded-xl shadow-xl z-40 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3.5 py-2.5 bg-[#FAF9F6] border-b border-[#EAEAEA] flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[#2F3437] leading-snug">
                        {isMobileQuickMode
                          ? 'Notifikasi Informasi'
                          : 'Notifikasi Persetujuan & Tindak Lanjut'}
                      </div>
                      <div className="text-[11px] text-[#787774] leading-snug mt-0.5 break-words">
                        {isMobileQuickMode
                          ? 'Hanya informasi — tindak lanjut dilakukan di versi Website'
                          : 'Klik notifikasi untuk langsung membuka & menindaklanjuti dokumen'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {unreadCount > 0 && onMarkAllNotificationsRead && (
                        <button
                          type="button"
                          onClick={() => onMarkAllNotificationsRead()}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2383E2] hover:underline shrink-0 cursor-pointer"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          <span>Tandai Dibaca</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowNotifDropdown(false)}
                        className="sm:hidden p-1 rounded-md text-[#787774] hover:text-[#252525] hover:bg-[#EFEFED] cursor-pointer"
                        title="Tutup Notifikasi"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[68vh] sm:max-h-80 overflow-y-auto divide-y divide-[#EAEAEA]">
                    {uniqueNotifications.length === 0 ? (
                      <div className="py-8 px-4 text-center text-xs text-[#787774] leading-relaxed">
                        Belum ada notifikasi persetujuan atau tindak lanjut.
                      </div>
                    ) : (
                      uniqueNotifications.map((notif) => {
                        const isUnread =
                          !currentUser ||
                          !(notif.isReadByUserIds || []).includes(currentUser.id);
                        const dotColor =
                          notif.eventType === 'FINAL_COMPLETED' ||
                          notif.eventType === 'APPROVED'
                            ? 'bg-[#0F7B6C]'
                            : notif.eventType === 'REVISION_REQUIRED' ||
                              notif.eventType === 'REJECTED'
                            ? 'bg-[#E03E3E]'
                            : 'bg-[#D9730D]';

                        if (isMobileQuickMode) {
                          return (
                            <div
                              key={notif.id}
                              className={`w-full text-left px-4 py-3 flex items-start gap-2.5 select-none ${
                                isUnread ? 'bg-[#FAF9F6]' : 'bg-white opacity-85'
                              }`}
                            >
                              <span
                                className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold text-[#2F3437] truncate">
                                    {notif.categoryLabel}
                                  </span>
                                  <span className="text-[10px] font-mono text-[#787774] shrink-0">
                                    {notif.referenceNumber}
                                  </span>
                                </div>
                                <p className="text-xs text-[#37352F] mt-0.5 leading-snug">
                                  {(notif.message || '')
                                    .replace(/^\[[^\]]+\]\s*/, '')
                                    .replace(
                                      /"(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/gi,
                                      '"'
                                    )}
                                </p>
                                <div className="mt-1.5 flex items-center justify-between">
                                  <span className="text-[10px] text-[#787774]">
                                    {new Date(notif.createdAt).toLocaleDateString('id-ID', {
                                      day: '2-digit',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                  <span className="text-[10px] font-medium text-[#787774]">
                                    Tindak lanjut khusus Website
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <button
                            key={notif.id}
                            type="button"
                            onClick={() => {
                              setShowNotifDropdown(false);
                              if (onSelectNotification) {
                                onSelectNotification(notif);
                              }
                            }}
                            className={`w-full text-left px-4 py-3 hover:bg-[#F7F7F5] transition-colors flex items-start gap-2.5 cursor-pointer ${
                              isUnread ? 'bg-[#FAF9F6]' : 'bg-white opacity-85'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-[#2F3437] truncate">
                                  {notif.categoryLabel}
                                </span>
                                <span className="text-[10px] font-mono text-[#787774] shrink-0">
                                  {notif.referenceNumber}
                                </span>
                              </div>
                              <p className="text-xs text-[#37352F] mt-0.5 leading-snug">
                                {(notif.message || '')
                                  .replace(/^\[[^\]]+\]\s*/, '')
                                  .replace(
                                    /"(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/gi,
                                    '"'
                                  )}
                              </p>
                              <div className="mt-1.5 flex items-center justify-between">
                                <span className="text-[10px] text-[#787774]">
                                  {new Date(notif.createdAt).toLocaleDateString('id-ID', {
                                    day: '2-digit',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                <span className="text-[11px] font-semibold text-[#2383E2]">
                                  {notif.eventType === 'REVISION_REQUIRED'
                                    ? 'Langsung Edit →'
                                    : 'Tindak Lanjuti →'}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User Profile Menu */}
          <div className="relative">
            <button
              onClick={() => {
                setShowUserDropdown(!showUserDropdown);
                setShowNotifDropdown(false);
              }}
              className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-[#F3F3F1] transition-all text-left border border-transparent hover:border-[#EAEAEA] cursor-pointer"
            >
              <div className="w-7 h-7 rounded-full bg-[#EAEAE8] text-[#252525] font-semibold flex items-center justify-center text-xs relative">
                {(currentUser?.name || '')
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('') || 'U'}
              </div>
              <div className="hidden sm:block text-left pr-0.5">
                <div className="text-[13px] font-semibold text-[#252525] leading-tight">
                  {currentUser?.name || 'Pengguna'}
                </div>
                <div className="text-[11px] text-[#787774] leading-tight mt-0.5">
                  {currentUser?.roleTitle}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#787774]" />
            </button>

            {showUserDropdown && (
              <>
                <div
                  className="fixed inset-0 z-30 bg-black/10 sm:bg-transparent"
                  onClick={() => setShowUserDropdown(false)}
                />
                <div className="fixed left-2.5 right-2.5 top-[58px] w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-80 bg-white border border-[#EAEAEA] rounded-xl shadow-xl z-40 py-2 divide-y divide-[#EAEAEA] animate-in fade-in zoom-in-95 duration-100">
                  {/* Active User Info Header */}
                  <div className="px-4 py-2.5 bg-[#FAFAF9]">
                    <div className="text-xs font-bold text-[#252525]">{currentUser?.name}</div>
                    <div className="text-[11px] text-[#57564F] mt-0.5">
                      {currentUser?.roleTitle} · {currentUser?.department}
                    </div>
                    <div className="text-[10.5px] font-mono text-[#787774] mt-0.5">
                      @{currentUser?.username || currentUser?.email?.split('@')[0]} ·{' '}
                      {currentUser?.email}
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="px-3 py-2 bg-white space-y-1.5">
                    {onOpenEmployeeProfile && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserDropdown(false);
                          onOpenEmployeeProfile();
                        }}
                        className="w-full px-3 py-2 rounded-md bg-[#FAF9F6] hover:bg-[#EFECE6] border border-[#E5E3DC] text-left flex items-center justify-between text-xs font-semibold text-[#252525] transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-2">
                          <UserCheck className="w-4 h-4 text-[#5A5A58]" />
                          <span>Buka Profil Karyawan</span>
                        </span>
                        <span className="text-[11px] font-normal text-[#787774]">
                          Output · Cuti · Pelatihan →
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={openChangePasswordModal}
                      className="w-full px-3 py-2 rounded-md border bg-[#FAF9F6] hover:bg-[#EFECE6] border-[#E5E3DC] text-[#252525] text-left flex items-center justify-between text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-[#0F766E]" />
                        <span>Ganti Password Akun</span>
                      </span>
                      <span className="text-[11px] font-normal text-[#787774]">
                        Enkripsi Scrypt →
                      </span>
                    </button>

                    {isMobileQuickMode && onOpenFullWebVersion && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserDropdown(false);
                          onOpenFullWebVersion();
                        }}
                        className="w-full px-3 py-2 rounded-md bg-[#FAF9F6] hover:bg-[#EFECE6] border border-[#E5E3DC] text-left flex items-center justify-between text-xs font-semibold text-[#252525] transition-colors cursor-pointer sm:hidden"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Monitor className="w-4 h-4 text-[#3867F5]" />
                          <span>Buka Versi Web Penuh</span>
                        </span>
                        <span className="text-[11px] font-normal text-[#787774]">
                          Semua Fitur →
                        </span>
                      </button>
                    )}
                    {!isMobileQuickMode && onBackToMobileQuickMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserDropdown(false);
                          onBackToMobileQuickMode();
                        }}
                        className="w-full px-3 py-2 rounded-md bg-[#F0FAF6] hover:bg-[#E2F2EB] border border-[#BCE3DC] text-left flex items-center justify-between text-xs font-semibold text-[#0F7B6C] transition-colors cursor-pointer sm:hidden"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-[#0F7B6C]" />
                          <span>Tampilan Ringkas Mobile</span>
                        </span>
                        <span className="text-[11px] font-normal text-[#0F7B6C]">
                          3 Fitur Utama →
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Logout Button */}
                  <div className="px-3 pt-2 pb-1 bg-[#FAFAF9]">
                    <button
                      type="button"
                      onClick={() => {
                        setShowUserDropdown(false);
                        logout();
                      }}
                      className="w-full px-3 py-2 rounded-md bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2">
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Keluar Sistem (Logout)</span>
                      </span>
                      <span className="text-[11px] font-normal text-rose-600">
                        Halaman Login →
                      </span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Modal Ganti Password Mandiri */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white rounded-2xl border border-[#E5E5E3] shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 border-b border-[#EAEAEA] bg-[#FAF9F6] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#0F766E]" />
                <h3 className="text-sm font-bold text-[#252525]">
                  Ganti Password Akun ({currentUser?.name})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                className="p-1 rounded-lg text-[#787774] hover:text-[#252525] hover:bg-[#EFEFED] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewPassword} className="p-5 space-y-3.5 text-xs">

              {passwordError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                  {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{passwordSuccess}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-[#37352F] mb-1">
                  Password Saat Ini
                </label>
                <div className="relative">
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    required
                    value={currentPasswordInput}
                    onChange={(e) => setCurrentPasswordInput(e.target.value)}
                    placeholder="Masukkan password saat ini"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-[#252525] focus:outline-none focus:border-[#0F766E]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#37352F] mb-1">
                  Password Baru (Minimal 6 Karakter)
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="Masukkan password baru"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-[#252525] focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#37352F] mb-1">
                  Konfirmasi Password Baru
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                  placeholder="Ketik ulang password baru"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-[#252525] focus:outline-none focus:border-[#0F766E]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="px-4 py-2 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {savingPassword ? 'Menyimpan...' : 'Simpan Password Baru'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
