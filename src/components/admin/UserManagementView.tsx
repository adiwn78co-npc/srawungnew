import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  User,
  UserRole,
  UserAccountStatus,
  Output,
  OutputRaciRecord,
  ActivityMonitoringRecord,
} from '../../types/index.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { useOrganizationSettings } from '../../lib/organizationSettings.js';
import {
  UserPlus,
  Edit2,
  Shield,
  Check,
  X,
  Search,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Users,
  RefreshCw,
  Building2,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'System Organisator (Administrator)',
  director: 'Executive Director',
  hr: 'HR & People Operations',
  finance: 'Finance & Accounting Manager',
  program_manager: 'Program Manager',
  meal: 'MEAL Specialist',
  staff: 'Project Officer / Field Staff',
};

const ROLE_BADGE_STYLES: Record<UserRole, string> = {
  admin: 'bg-slate-100 text-slate-800 border-slate-300',
  director: 'bg-purple-50 text-purple-800 border-purple-200',
  hr: 'bg-teal-50 text-teal-800 border-teal-200',
  finance: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  program_manager: 'bg-blue-50 text-blue-800 border-blue-200',
  meal: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  staff: 'bg-amber-50 text-amber-800 border-amber-200',
};

const DEFAULT_PERMISSIONS_BY_ROLE: Record<UserRole, User['permissions']> = {
  admin: {
    canManagePrograms: false,
    canCreateTor: false,
    canApproveTor: false,
    canManageUsers: true,
    canViewAllTors: true,
  },
  director: {
    canManagePrograms: true,
    canCreateTor: true,
    canApproveTor: true,
    canManageUsers: false,
    canViewAllTors: true,
  },
  hr: {
    canManagePrograms: false,
    canCreateTor: true,
    canApproveTor: false,
    canManageUsers: false,
    canViewAllTors: true,
  },
  finance: {
    canManagePrograms: false,
    canCreateTor: true,
    canApproveTor: true,
    canManageUsers: false,
    canViewAllTors: true,
  },
  program_manager: {
    canManagePrograms: true,
    canCreateTor: true,
    canApproveTor: true,
    canManageUsers: false,
    canViewAllTors: true,
  },
  meal: {
    canManagePrograms: true,
    canCreateTor: true,
    canApproveTor: false,
    canManageUsers: false,
    canViewAllTors: true,
  },
  staff: {
    canManagePrograms: false,
    canCreateTor: true,
    canApproveTor: false,
    canManageUsers: false,
    canViewAllTors: false,
  },
};

function resolveSafePermissions(
  role?: UserRole,
  rawPermissions?: Partial<User['permissions']> | null
): User['permissions'] {
  const base =
    (role && DEFAULT_PERMISSIONS_BY_ROLE[role]) || DEFAULT_PERMISSIONS_BY_ROLE.staff;
  const merged: User['permissions'] = {
    canManagePrograms: rawPermissions?.canManagePrograms ?? base.canManagePrograms,
    canCreateTor: rawPermissions?.canCreateTor ?? base.canCreateTor,
    canApproveTor: rawPermissions?.canApproveTor ?? base.canApproveTor,
    canManageUsers: rawPermissions?.canManageUsers ?? base.canManageUsers,
    canViewAllTors: rawPermissions?.canViewAllTors ?? base.canViewAllTors,
  };
  if (role === 'admin') {
    merged.canApproveTor = false;
    merged.canManageUsers = true;
  }
  return merged;
}

interface UserManagementViewProps {
  onRefresh?: () => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({ onRefresh }) => {
  const { currentUser, refreshUsers } = useAuth();
  const { settings: orgSettings, updateSettings: updateOrgSettings } = useOrganizationSettings();
  const [orgNameInput, setOrgNameInput] = useState(orgSettings.organizationName);
  const [sidebarBrandInput, setSidebarBrandInput] = useState(orgSettings.sidebarBrandName);
  const [sidebarSubtitleInput, setSidebarSubtitleInput] = useState(orgSettings.sidebarSubtitle);
  const [savingOrgSettings, setSavingOrgSettings] = useState(false);

  useEffect(() => {
    setOrgNameInput(orgSettings.organizationName);
    setSidebarBrandInput(orgSettings.sidebarBrandName);
    setSidebarSubtitleInput(orgSettings.sidebarSubtitle);
  }, [orgSettings.organizationName, orgSettings.sidebarBrandName, orgSettings.sidebarSubtitle]);

  const [users, setUsers] = useState<User[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [raciMap, setRaciMap] = useState<Record<string, OutputRaciRecord>>({});
  const [activityMonitoringMap, setActivityMonitoringMap] = useState<
    Record<string, ActivityMonitoringRecord>
  >({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<User | null>(null);

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailManuallyEdited, setEmailManuallyEdited] = useState(false);
  const [username, setUsername] = useState('');
  const [usernameManuallyEdited, setUsernameManuallyEdited] = useState(false);
  const [initialPassword, setInitialPassword] = useState('Wijna@2026');
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl-staff-sfo');
  const [role, setRole] = useState<UserRole>('staff');
  const [roleTitle, setRoleTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [accountStatus, setAccountStatus] = useState<UserAccountStatus>('Aktif');
  const [permissions, setPermissions] = useState<User['permissions']>(
    DEFAULT_PERMISSIONS_BY_ROLE.staff
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // State Modal Reset Password oleh System Administrator
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  // Helper: buat email & username resmi otomatis dari Nama Lengkap & Gelar (mis: "Rina Kartika, S.Sos." -> "rina.kartika@wijna.org" & "rina.kartika")
  const generateSlugFromName = useCallback((rawName: string): string => {
    const withoutDegree = rawName
      .split(',')[0]
      .replace(/^(dr\.|prof\.|ir\.|h\.|hj\.|drs\.|dra\.)\s*/gi, '')
      .trim();
    return withoutDegree
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join('.');
  }, []);

  const generateEmailFromName = useCallback(
    (rawName: string): string => {
      const slug = generateSlugFromName(rawName);
      return slug ? `${slug}@wijna.org` : '';
    },
    [generateSlugFromName]
  );

  // Daftar Template Role & Jabatan dari Role/Pengguna yang Sudah Ada (Tinggal Ganti Nama)
  const roleTemplates = useMemo(() => {
    const baseTemplates: {
      id: string;
      label: string;
      referenceUser?: string;
      role: UserRole;
      roleTitle: string;
      department: string;
      permissions: User['permissions'];
    }[] = [
      {
        id: 'tpl-staff-sfo',
        label: 'Senior Field Officer (R)',
        referenceUser: 'Budi Santoso',
        role: 'staff',
        roleTitle: 'Senior Field Officer',
        department: 'Operasional Lapangan',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.staff },
      },
      {
        id: 'tpl-staff-cf',
        label: 'Community Facilitator (R)',
        referenceUser: 'Siti Rahmawati',
        role: 'staff',
        roleTitle: 'Community Facilitator',
        department: 'Pemberdayaan Masyarakat',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.staff },
      },
      {
        id: 'tpl-pm',
        label: 'Program Manager (A1)',
        referenceUser: 'Dimas Pratama, M.Sc.',
        role: 'program_manager',
        roleTitle: 'Program Manager',
        department: 'Divisi Manajemen Program',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.program_manager },
      },
      {
        id: 'tpl-meal',
        label: 'MEAL Coordinator',
        referenceUser: 'Maya Safitri, S.Sos.',
        role: 'meal',
        roleTitle: 'MEAL Coordinator',
        department: 'Monitoring, Evaluation, Accountability & Learning',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.meal },
      },
      {
        id: 'tpl-finance',
        label: 'Finance & HR Manager (A2)',
        referenceUser: 'Ratna Kusuma, S.E.',
        role: 'finance',
        roleTitle: 'Finance & HR Manager',
        department: 'Keuangan, HR & Kepatuhan',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.finance },
      },
      {
        id: 'tpl-hr',
        label: 'HR & People Operations',
        referenceUser: 'Divisi SDM',
        role: 'hr',
        roleTitle: 'HR & People Operations',
        department: 'Keuangan, HR & Kepatuhan',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.hr },
      },
      {
        id: 'tpl-director',
        label: 'Executive Director',
        referenceUser: 'Dr. Hendra Wijaya',
        role: 'director',
        roleTitle: 'Executive Director',
        department: 'Direktorat Eksekutif',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.director },
      },
      {
        id: 'tpl-admin',
        label: 'System Administrator',
        referenceUser: 'Bambang Sudiro',
        role: 'admin',
        roleTitle: 'System Administrator',
        department: 'Teknologi & Tata Kelola Sistem',
        permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE.admin },
      },
    ];

    // Tambahkan template dinamis dari pengguna yang sudah ada jika memiliki kombinasi jabatan/unit kerja unik
    const seenKeys = new Set(
      baseTemplates.map(
        (t) => `${t.role}|${t.roleTitle.toLowerCase()}|${t.department.toLowerCase()}`
      )
    );
    for (const u of users) {
      const key = `${u.role}|${(u.roleTitle || '').toLowerCase()}|${(u.department || '').toLowerCase()}`;
      if (!seenKeys.has(key) && u.roleTitle) {
        seenKeys.add(key);
        baseTemplates.push({
          id: `tpl-user-${u.id}`,
          label: u.roleTitle,
          referenceUser: u.name,
          role: u.role,
          roleTitle: u.roleTitle,
          department: u.department || 'Divisi Program Lapangan',
          permissions: resolveSafePermissions(u.role, u.permissions),
        });
      }
    }

    return baseTemplates;
  }, [users]);

  const loadUsersAndMonitoring = useCallback(async () => {
    setLoading(true);
    try {
      const [usersData, monData, progData] = await Promise.all([
        api.getUsers(),
        api.getMonitoringConnect(),
        api.getPrograms(),
      ]);
      setUsers(usersData);
      setRaciMap(monData.outputRaciRecords || {});
      setActivityMonitoringMap(monData.activityMonitoringRecords || {});
      setOutputs(progData.outputs || []);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal memuat data pengguna & integrasi Monitoring Tools.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsersAndMonitoring();
  }, [loadUsersAndMonitoring]);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  // Hitung penugasan RACI & Monitoring Tools untuk setiap pengguna secara live
  const userMonitoringAssignmentsMap = useMemo(() => {
    const map: Record<
      string,
      {
        rOutputs: string[];
        a1Outputs: string[];
        a2Outputs: string[];
        cOutputs: string[];
        iOutputs: string[];
        monitoringToolsCount: number;
        totalAssignments: number;
      }
    > = {};

    const outputNameById = new Map<string, string>();
    for (const o of outputs) {
      outputNameById.set(o.id, o.name);
    }

    for (const u of users) {
      const rOutputs: string[] = [];
      const a1Outputs: string[] = [];
      const a2Outputs: string[] = [];
      const cOutputs: string[] = [];
      const iOutputs: string[] = [];

      for (const raci of Object.values(raciMap)) {
        const outLabel = outputNameById.get(raci.outputId) || raci.outputId;
        if (raci.responsibleUserId === u.id) {
          rOutputs.push(outLabel);
        }
        if (raci.accountableUserId === u.id) {
          a1Outputs.push(outLabel);
        }
        if (
          raci.accountableFinanceUserId === u.id ||
          (!raci.accountableFinanceUserId && u.role === 'finance' && u.isActive)
        ) {
          a2Outputs.push(outLabel);
        }
        if (
          Array.isArray(raci.consultedUsers) &&
          raci.consultedUsers.some(
            (c) => c.trim().toLowerCase() === u.name.trim().toLowerCase()
          )
        ) {
          cOutputs.push(outLabel);
        }
        if (
          Array.isArray(raci.informedUsers) &&
          raci.informedUsers.some(
            (i) => i.trim().toLowerCase() === u.name.trim().toLowerCase()
          )
        ) {
          iOutputs.push(outLabel);
        }
      }

      let monitoringToolsCount = 0;
      for (const actRec of Object.values(activityMonitoringMap)) {
        if (actRec.updatedById === u.id) {
          monitoringToolsCount += (actRec.tools || []).length;
        } else {
          for (const t of actRec.tools || []) {
            if (t.assignedById === u.id) {
              monitoringToolsCount += 1;
            }
          }
        }
      }

      const totalAssignments =
        rOutputs.length +
        a1Outputs.length +
        (raciMap && Object.values(raciMap).some((r) => r.accountableFinanceUserId === u.id)
          ? a2Outputs.length
          : 0) +
        cOutputs.length +
        iOutputs.length +
        monitoringToolsCount;

      map[u.id] = {
        rOutputs,
        a1Outputs,
        a2Outputs,
        cOutputs,
        iOutputs,
        monitoringToolsCount,
        totalAssignments,
      };
    }

    return map;
  }, [users, raciMap, activityMonitoringMap, outputs]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (statusFilter === 'ACTIVE' && !u.isActive) return false;
      if (statusFilter === 'INACTIVE' && u.isActive) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchName = (u.name || '').toLowerCase().includes(q);
        const matchEmail = (u.email || '').toLowerCase().includes(q);
        const matchRole = (u.roleTitle || '').toLowerCase().includes(q);
        const matchDept = (u.department || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchRole && !matchDept) return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  const applyRoleTemplate = (tplId: string) => {
    const tpl = roleTemplates.find((t) => t.id === tplId);
    if (!tpl) return;
    setSelectedTemplateId(tpl.id);
    setRole(tpl.role);
    setRoleTitle(tpl.roleTitle);
    setDepartment(tpl.department);
    setIsActive(true);
    setAccountStatus('Aktif');
    setPermissions({ ...tpl.permissions });
  };

  const handleOpenCreate = () => {
    const defaultTpl = roleTemplates[0];
    setEditingUser(null);
    setName('');
    setEmail('');
    setEmailManuallyEdited(false);
    setUsername('');
    setUsernameManuallyEdited(false);
    setInitialPassword('Wijna@2026');
    setShowInitialPassword(false);
    setSelectedTemplateId(defaultTpl?.id || 'tpl-staff-sfo');
    setRole(defaultTpl?.role || 'staff');
    setRoleTitle(defaultTpl?.roleTitle || 'Senior Field Officer');
    setDepartment(defaultTpl?.department || 'Operasional Lapangan');
    setIsActive(true);
    setAccountStatus('Aktif');
    setPermissions(
      defaultTpl ? { ...defaultTpl.permissions } : { ...DEFAULT_PERMISSIONS_BY_ROLE.staff }
    );
    setModalError(null);
    setShowModal(true);
  };

  const handleOpenCreateFromUserTemplate = (sourceUser: User) => {
    setEditingUser(null);
    setName('');
    setEmail('');
    setEmailManuallyEdited(false);
    setUsername('');
    setUsernameManuallyEdited(false);
    setInitialPassword('Wijna@2026');
    setShowInitialPassword(false);
    const matchingTpl = roleTemplates.find(
      (t) =>
        t.role === sourceUser.role &&
        t.roleTitle.toLowerCase() === (sourceUser.roleTitle || '').toLowerCase()
    );
    setSelectedTemplateId(matchingTpl?.id || `tpl-user-${sourceUser.id}`);
    setRole(sourceUser.role);
    setRoleTitle(sourceUser.roleTitle);
    setDepartment(sourceUser.department);
    setIsActive(true);
    setAccountStatus('Aktif');
    setPermissions(resolveSafePermissions(sourceUser.role, sourceUser.permissions));
    setModalError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setName(user.name || '');
    setEmail(user.email || '');
    setEmailManuallyEdited(true);
    setUsername(user.username || (user.email || '').split('@')[0] || '');
    setUsernameManuallyEdited(true);
    const matchingTpl = roleTemplates.find(
      (t) =>
        t.role === user.role &&
        t.roleTitle.toLowerCase() === (user.roleTitle || '').toLowerCase()
    );
    setSelectedTemplateId(matchingTpl?.id || '');
    setRole(user.role);
    setRoleTitle(user.roleTitle || '');
    setDepartment(user.department || '');
    const resolvedStatus: UserAccountStatus =
      user.accountStatus || (user.isActive === false ? 'Nonaktif' : 'Aktif');
    setAccountStatus(resolvedStatus);
    setIsActive(resolvedStatus === 'Aktif');
    setPermissions(resolveSafePermissions(user.role, user.permissions));
    setModalError(null);
    setShowModal(true);
  };

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    const matchingTpl = roleTemplates.find((t) => t.role === newRole);
    setSelectedTemplateId(matchingTpl?.id || '');
    setRoleTitle(matchingTpl?.roleTitle || ROLE_LABELS[newRole]);
    if (matchingTpl?.department) {
      setDepartment(matchingTpl.department);
    }
    setPermissions({ ...DEFAULT_PERMISSIONS_BY_ROLE[newRole] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setErrorMessage(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = (username.trim() || trimmedEmail.split('@')[0] || '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');
    const trimmedRoleTitle = roleTitle.trim() || ROLE_LABELS[role];
    const trimmedDepartment = department.trim() || 'Divisi Program Lapangan';

    if (!trimmedName || !trimmedEmail) {
      setModalError('Nama lengkap dan alamat email wajib diisi.');
      return;
    }

    if (!trimmedUsername || trimmedUsername.length < 3) {
      setModalError('Username wajib diisi (minimal 3 karakter huruf/angka).');
      return;
    }

    if (!editingUser && (!initialPassword || initialPassword.trim().length < 6)) {
      setModalError('Password awal wajib ditetapkan oleh Administrator (minimal 6 karakter).');
      return;
    }

    const dupEmail = users.find(
      (u) =>
        u.id !== editingUser?.id && (u.email || '').trim().toLowerCase() === trimmedEmail
    );
    if (dupEmail) {
      setModalError(
        `Email "${trimmedEmail}" sudah terdaftar atas nama ${dupEmail.name}. Gunakan email unik.`
      );
      return;
    }

    const dupUsername = users.find(
      (u) =>
        u.id !== editingUser?.id &&
        (u.username || (u.email || '').split('@')[0]).trim().toLowerCase() === trimmedUsername
    );
    if (dupUsername) {
      setModalError(
        `Username "@${trimmedUsername}" sudah digunakan oleh ${dupUsername.name}. Gunakan username unik.`
      );
      return;
    }

    const dupName = users.find(
      (u) =>
        u.id !== editingUser?.id &&
        (u.name || '').trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (dupName) {
      setModalError(
        `Nama pengguna "${trimmedName}" sudah terdaftar (${dupName.email}). Hindari duplikasi akun.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const nextIsActive = accountStatus === 'Aktif';
      if (editingUser) {
        await api.updateUser(editingUser.id, {
          name: trimmedName,
          email: trimmedEmail,
          username: trimmedUsername,
          role,
          roleTitle: trimmedRoleTitle,
          department: trimmedDepartment,
          accountStatus,
          isActive: nextIsActive,
          permissions,
        });
        showSuccess(
          `Data pengguna "${trimmedName}" (@${trimmedUsername}) berhasil diperbarui dan disinkronkan ke Monitoring Tools.`
        );
      } else {
        await api.createUser({
          name: trimmedName,
          email: trimmedEmail,
          username: trimmedUsername,
          initialPassword: initialPassword.trim(),
          role,
          roleTitle: trimmedRoleTitle,
          department: trimmedDepartment,
          accountStatus,
          isActive: nextIsActive,
          permissions,
        });
        showSuccess(
          `Akun pengguna baru "${trimmedName}" (@${trimmedUsername}) berhasil dibuat oleh Administrator dan siap digunakan login.`
        );
      }
      setShowModal(false);
      await loadUsersAndMonitoring();
      await refreshUsers();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setModalError(err?.message || 'Gagal menyimpan data pengguna.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeAccountStatus = async (user: User, nextStatus: UserAccountStatus) => {
    setErrorMessage(null);
    try {
      await api.updateUser(user.id, {
        accountStatus: nextStatus,
        isActive: nextStatus === 'Aktif',
      });
      showSuccess(
        nextStatus === 'Aktif'
          ? `Akun "${user.name}" berhasil diaktifkan kembali.`
          : nextStatus === 'Ditangguhkan'
          ? `Akun "${user.name}" telah ditangguhkan sementara (Suspended).`
          : `Akun "${user.name}" telah dinonaktifkan. Seluruh riwayat monitoring & RACI tetap tersimpan aman.`
      );
      await loadUsersAndMonitoring();
      await refreshUsers();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengubah status akun pengguna.');
    }
  };

  const handleOpenResetPassword = (user: User) => {
    setResetPasswordUser(user);
    setNewPasswordInput('Wijna@2026');
    setShowNewPassword(false);
    setResetPasswordError(null);
  };

  const handleConfirmResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser) return;
    setResetPasswordError(null);
    const trimmedPw = newPasswordInput.trim();
    if (!trimmedPw || trimmedPw.length < 6) {
      setResetPasswordError('Password baru minimal harus terdiri dari 6 karakter.');
      return;
    }
    setResettingPassword(true);
    try {
      await api.resetUserPassword(resetPasswordUser.id, trimmedPw);
      showSuccess(
        `Password untuk akun "${resetPasswordUser.name}" (@${
          resetPasswordUser.username || (resetPasswordUser.email || '').split('@')[0]
        }) berhasil direset oleh Administrator.`
      );
      setResetPasswordUser(null);
      await loadUsersAndMonitoring();
      await refreshUsers();
    } catch (err: any) {
      setResetPasswordError(err?.message || 'Gagal mereset password pengguna.');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDeleteUser = async (user: User) => {
    setErrorMessage(null);
    try {
      await api.deleteUser(user.id);
      setConfirmDeleteUser(null);
      showSuccess(`Akun pengguna "${user.name}" berhasil dihapus.`);
      await loadUsersAndMonitoring();
      await refreshUsers();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setConfirmDeleteUser(null);
      setErrorMessage(err?.message || 'Gagal menghapus akun pengguna.');
    }
  };

  if (currentUser?.role !== 'admin' && !currentUser?.permissions?.canManageUsers) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <Shield className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-900">Akses Terbatas</h3>
        <p className="text-sm text-slate-500 mt-1">
          Hanya System Administrator yang dapat mengakses modul Kelola Pengguna & Hak Akses.
        </p>
      </div>
    );
  }

  const totalActiveUsers = users.filter((u) => u.isActive).length;
  const totalInactiveUsers = users.filter((u) => !u.isActive).length;
  const totalRaciAssignedUsers = users.filter((u) => {
    const asg = userMonitoringAssignmentsMap[u.id];
    return (
      asg &&
      (asg.rOutputs.length > 0 ||
        asg.a1Outputs.length > 0 ||
        asg.cOutputs.length > 0 ||
        asg.iOutputs.length > 0)
    );
  }).length;

  const handleSaveOrgSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedOrg = orgNameInput.trim();
    if (!trimmedOrg) {
      setErrorMessage('Nama organisasi tidak boleh kosong.');
      return;
    }
    setSavingOrgSettings(true);
    setErrorMessage(null);
    try {
      const nextBrand = sidebarBrandInput.trim() || trimmedOrg;
      const nextSubtitle = sidebarSubtitleInput.trim() || 'HR & Program System';
      await updateOrgSettings(
        {
          organizationName: trimmedOrg,
          sidebarBrandName: nextBrand,
          sidebarSubtitle: nextSubtitle,
        },
        currentUser?.name
      );
      showSuccess(
        `Pengaturan nama organisasi terpusat ("${trimmedOrg}") berhasil disimpan dan diterapkan ke seluruh sistem & dokumen.`
      );
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal menyimpan pengaturan nama organisasi.');
    } finally {
      setSavingOrgSettings(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Pengaturan Nama Organisasi Terpusat (System Organisator) — Gambar 3 & Gambar 4 */}
      <form
        onSubmit={handleSaveOrgSettings}
        className="bg-white rounded-xl border border-[#EAEAEA] p-4 sm:p-5 shadow-2xs space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#252525] text-white flex items-center justify-center shrink-0 mt-0.5">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-[#2F3437]">
                  Pengaturan Nama Organisasi Terpusat (System Organisator)
                </h2>
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10.5px] font-semibold">
                  Sinkron Sidebar &amp; Kop Dokumen Resmi
                </span>
              </div>
              <p className="text-xs text-[#787774] mt-0.5">
                Atur nama organisasi terpusat yang tampil pada Sidebar kiri serta seluruh dokumen resmi (Laporan Keuangan, Cash Advance, ToR, dan Preview).
              </p>
            </div>
          </div>
          <button
            type="submit"
            disabled={savingOrgSettings}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#252525] hover:bg-[#37352F] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{savingOrgSettings ? 'Menyimpan...' : 'Simpan Nama Organisasi'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#EFEFED]">
          <div>
            <label className="block text-[11px] font-semibold text-[#57564F] mb-1">
              Nama Resmi Organisasi (Dokumen &amp; Laporan)
            </label>
            <input
              type="text"
              value={orgNameInput}
              onChange={(e) => {
                const val = e.target.value;
                setOrgNameInput(val);
                if (sidebarBrandInput === orgNameInput) {
                  setSidebarBrandInput(val);
                }
              }}
              placeholder="Contoh: Yayasan Inti Muda Indonesia (WIJNA)"
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-[#2F3437] font-medium focus:outline-none focus:border-[#0f2b5c]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#57564F] mb-1">
              Nama Organisasi di Header Sidebar
            </label>
            <input
              type="text"
              value={sidebarBrandInput}
              onChange={(e) => setSidebarBrandInput(e.target.value)}
              placeholder="Contoh: Yayasan Inti Muda Indonesia (WIJNA)"
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-[#2F3437] font-medium focus:outline-none focus:border-[#0f2b5c]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#57564F] mb-1">
              Subjudul Sistem di Sidebar
            </label>
            <input
              type="text"
              value={sidebarSubtitleInput}
              onChange={(e) => setSidebarSubtitleInput(e.target.value)}
              placeholder="Contoh: HR & Program System"
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-[#2F3437] font-medium focus:outline-none focus:border-[#0f2b5c]"
            />
          </div>
        </div>
      </form>

      {/* Header & Ringkasan Integrasi Monitoring Tools */}
      <div className="bg-white rounded-xl border border-[#EAEAEA] p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-[#2F3437]">
                Kelola Pengguna &amp; Integrasi Monitoring Tools (RBAC &amp; RACI)
              </h2>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                Tersinkronisasi Otomatis
              </span>
            </div>
            <p className="text-xs text-[#787774] mt-0.5">
              Perubahan nama, jabatan, unit kerja, status akun, dan hak akses langsung tersinkronisasi ke Monitoring Tools (RACI Output), Struktur Program, ToR, dan Approval Center.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadUsersAndMonitoring}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              title="Muat ulang data pengguna dan RACI"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sinkronkan</span>
            </button>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Tambah Pengguna Baru</span>
            </button>
          </div>
        </div>

        {/* Stat Strip Ringkas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-[#EFEFED]">
          <div className="px-3 py-2 rounded-lg bg-[#FAF9F6] border border-[#E6E5E2] flex items-center justify-between">
            <span className="text-xs text-[#57564F]">Total Pengguna</span>
            <span className="font-mono text-sm font-bold text-[#2F3437]">{users.length}</span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-emerald-50/60 border border-emerald-200 flex items-center justify-between">
            <span className="text-xs text-emerald-800">Akun Aktif</span>
            <span className="font-mono text-sm font-bold text-emerald-800">
              {totalActiveUsers}
            </span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-rose-50/60 border border-rose-200 flex items-center justify-between">
            <span className="text-xs text-rose-800">Akun Nonaktif</span>
            <span className="font-mono text-sm font-bold text-rose-800">
              {totalInactiveUsers}
            </span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-blue-50/60 border border-blue-200 flex items-center justify-between">
            <span className="text-xs text-blue-800">Terhubung RACI Output</span>
            <span className="font-mono text-sm font-bold text-blue-800">
              {totalRaciAssignedUsers} Staf
            </span>
          </div>
        </div>

        {/* Filter & Pencarian */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
          <div className="sm:col-span-6 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama pengguna, email, jabatan, atau divisi/unit kerja..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#0f2b5c]"
            />
          </div>
          <div className="sm:col-span-3">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#0f2b5c]"
            >
              <option value="ALL">Semua Role ({users.length})</option>
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((rKey) => (
                <option key={rKey} value={rKey}>
                  {ROLE_LABELS[rKey]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')
              }
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#0f2b5c]"
            >
              <option value="ALL">Semua Status Akun</option>
              <option value="ACTIVE">Hanya Akun Aktif</option>
              <option value="INACTIVE">Hanya Akun Nonaktif</option>
            </select>
          </div>
        </div>
      </div>

      {/* Feedback Banners */}
      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 hover:text-rose-700 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-800 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Nama &amp; Email</th>
                <th className="py-3 px-4">Jabatan &amp; Unit Kerja</th>
                <th className="py-3 px-4">Penugasan Monitoring Tools (RACI)</th>
                <th className="py-3 px-4">Hak Akses Sistem (Permissions)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Memuat daftar pengguna &amp; sinkronisasi RACI...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Tidak ada pengguna yang sesuai dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const monAsg = userMonitoringAssignmentsMap[user.id] || {
                    rOutputs: [],
                    a1Outputs: [],
                    a2Outputs: [],
                    cOutputs: [],
                    iOutputs: [],
                    monitoringToolsCount: 0,
                    totalAssignments: 0,
                  };
                  const canHardDelete =
                    user.id !== currentUser?.id &&
                    user.role !== 'admin' &&
                    monAsg.totalAssignments === 0;

                  return (
                    <tr
                      key={user.id}
                      className={`hover:bg-slate-50/60 transition-colors align-top ${
                        !user.isActive ? 'bg-slate-50/40 opacity-75' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                          <span>{user.name}</span>
                          {user.id === currentUser?.id && (
                            <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                              Anda
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                          @{user.username || (user.email || '').split('@')[0]} · {user.email || '-'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                              ROLE_BADGE_STYLES[user.role] || ROLE_BADGE_STYLES.staff
                            }`}
                          >
                            {ROLE_LABELS[user.role] || user.role}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-800 mt-1">{user.roleTitle}</div>
                        <div className="text-[11px] text-slate-500">{user.department}</div>
                      </td>

                      {/* Kolom Integrasi Penugasan Monitoring Tools (RACI) */}
                      <td className="py-3.5 px-4">
                        {user.role === 'admin' ? (
                          <span className="text-[11px] text-slate-400 italic">
                            Konfigurasi Sistem (Non-Operasional)
                          </span>
                        ) : user.role === 'director' ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200 text-[10.5px] font-semibold">
                              <ClipboardCheck className="w-3 h-3" />
                              <span>Otorisasi RACI &amp; Seluruh Output ({outputs.length})</span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {monAsg.rOutputs.length > 0 && (
                              <span
                                className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10.5px] font-semibold"
                                title={`R (Responsible) pada: ${monAsg.rOutputs.join(', ')}`}
                              >
                                R: {monAsg.rOutputs.length} Output
                              </span>
                            )}
                            {monAsg.a1Outputs.length > 0 && (
                              <span
                                className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10.5px] font-semibold"
                                title={`A1 (Accountable Program) pada: ${monAsg.a1Outputs.join(', ')}`}
                              >
                                A1: {monAsg.a1Outputs.length} Output
                              </span>
                            )}
                            {user.role === 'finance' && (
                              <span
                                className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10.5px] font-semibold"
                                title="A2 (Accountable Finance) otomatis untuk verifikasi keuangan"
                              >
                                A2 Finance ({monAsg.a2Outputs.length} Output)
                              </span>
                            )}
                            {monAsg.cOutputs.length > 0 && (
                              <span
                                className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10.5px] font-medium"
                                title={`Consulted (C) pada: ${monAsg.cOutputs.join(', ')}`}
                              >
                                C: {monAsg.cOutputs.length}
                              </span>
                            )}
                            {monAsg.iOutputs.length > 0 && (
                              <span
                                className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10.5px] font-medium"
                                title={`Informed (I) pada: ${monAsg.iOutputs.join(', ')}`}
                              >
                                I: {monAsg.iOutputs.length}
                              </span>
                            )}
                            {monAsg.rOutputs.length === 0 &&
                              monAsg.a1Outputs.length === 0 &&
                              user.role !== 'finance' &&
                              monAsg.cOutputs.length === 0 &&
                              monAsg.iOutputs.length === 0 && (
                                <span className="text-[11px] text-slate-400">
                                  Siap ditugaskan di Monitoring Tools
                                </span>
                              )}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {(() => {
                          const safePerms = resolveSafePermissions(user.role, user.permissions);
                          return (
                            <div className="flex flex-wrap gap-1">
                              {safePerms.canManagePrograms && (
                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10.5px] font-medium border border-indigo-200/60">
                                  Kelola Program &amp; RACI
                                </span>
                              )}
                              {safePerms.canCreateTor && (
                                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10.5px] font-medium border border-blue-200/60">
                                  Buat ToR &amp; Monitoring
                                </span>
                              )}
                              {safePerms.canApproveTor && (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10.5px] font-medium border border-emerald-200/60">
                                  Approval Dokumen
                                </span>
                              )}
                              {safePerms.canViewAllTors && (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10.5px] font-medium border border-slate-200">
                                  Akses Lintas Divisi
                                </span>
                              )}
                              {safePerms.canManageUsers && (
                                <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded text-[10.5px] font-medium border border-rose-200/60">
                                  Kelola Pengguna
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {(() => {
                          const resolvedStatus: UserAccountStatus =
                            user.accountStatus || (user.isActive === false ? 'Nonaktif' : 'Aktif');
                          return (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                resolvedStatus === 'Aktif'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : resolvedStatus === 'Ditangguhkan'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {resolvedStatus === 'Aktif' ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <X className="w-3 h-3" />
                              )}
                              {resolvedStatus}
                            </span>
                          );
                        })()}
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenCreateFromUserTemplate(user)}
                            className="px-2 py-1 text-[11px] font-semibold text-[#0f2b5c] bg-blue-50/80 hover:bg-blue-100 border border-blue-200/80 rounded-md transition-colors cursor-pointer"
                            title={`Buat pengguna baru dengan template jabatan "${user.roleTitle}" seperti ${user.name} (tinggal isi nama)`}
                          >
                            + Buat Serupa
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenResetPassword(user)}
                            className="px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors cursor-pointer inline-flex items-center gap-1"
                            title={`Reset Password untuk ${user.name}`}
                          >
                            <KeyRound className="w-3 h-3" />
                            <span>Reset Password</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(user)}
                            className="p-1.5 text-slate-600 hover:text-[#0f2b5c] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Edit Informasi, Role & Permission"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {user.id !== currentUser?.id && (
                            <select
                              value={
                                user.accountStatus ||
                                (user.isActive === false ? 'Nonaktif' : 'Aktif')
                              }
                              onChange={(e) =>
                                handleChangeAccountStatus(
                                  user,
                                  e.target.value as UserAccountStatus
                                )
                              }
                              className="text-[11px] px-2 py-1 rounded-md font-semibold border border-slate-200 bg-white text-slate-700 hover:border-slate-300 cursor-pointer"
                              title="Ubah Status Akun (Aktif / Ditangguhkan / Nonaktif)"
                            >
                              <option value="Aktif">Status: Aktif</option>
                              <option value="Ditangguhkan">Tangguhkan</option>
                              <option value="Nonaktif">Nonaktifkan</option>
                            </select>
                          )}
                          {canHardDelete && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteUser(user)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Hapus akun yang belum memiliki riwayat penugasan"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Konfirmasi Hapus Pengguna */}
      {confirmDeleteUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">
                Konfirmasi Hapus Akun Pengguna
              </h3>
              <button
                type="button"
                onClick={() => setConfirmDeleteUser(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-600 leading-relaxed">
              <p>
                Apakah Anda yakin ingin menghapus akun{' '}
                <strong className="text-slate-900">{confirmDeleteUser.name}</strong> (
                {confirmDeleteUser.email})?
              </p>
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                Catatan: Jika pengguna sudah memiliki riwayat penugasan RACI atau dokumen kerja, sistem akan otomatis menolak penghapusan permanen dan menyarankan fitur <strong>Nonaktifkan</strong> agar jejak audit tetap terjaga.
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteUser(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleDeleteUser(confirmDeleteUser)}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                Ya, Hapus Akun
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Pengguna */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#0f2b5c]" />
                <h3 className="font-bold text-slate-900 text-sm">
                  {editingUser ? 'Edit Informasi & Hak Akses Pengguna' : 'Tambah Pengguna Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Template Role & Jabatan Siap Pakai (Dari Role yang Sudah Ada — Tinggal Ganti Nama) */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="block text-xs font-bold text-[#0f2b5c]">
                      Template Role &amp; Jabatan Siap Pakai (Tinggal Isi Nama)
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      Pilih template dari role yang sudah ada untuk mengisi otomatis Jabatan, Unit Kerja, dan Hak Akses:
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {roleTemplates.map((tpl) => {
                    const isSelected =
                      selectedTemplateId === tpl.id ||
                      (role === tpl.role &&
                        roleTitle.trim().toLowerCase() === tpl.roleTitle.toLowerCase());
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyRoleTemplate(tpl.id)}
                        className={`px-2.5 py-2 rounded-lg border text-left transition-all cursor-pointer flex items-start justify-between gap-2 ${
                          isSelected
                            ? 'bg-[#0f2b5c] border-[#0f2b5c] text-white shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-100/70 text-slate-800'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">{tpl.label}</div>
                          <div
                            className={`text-[10.5px] truncate ${
                              isSelected ? 'text-blue-100' : 'text-slate-500'
                            }`}
                          >
                            {tpl.department}
                            {tpl.referenceUser ? ` · (ex: ${tpl.referenceUser.split(',')[0]})` : ''}
                          </div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nama Lengkap &amp; Gelar <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setName(nextName);
                      if (!editingUser && !emailManuallyEdited) {
                        setEmail(generateEmailFromName(nextName));
                      }
                      if (!editingUser && !usernameManuallyEdited) {
                        setUsername(generateSlugFromName(nextName));
                      }
                    }}
                    placeholder="Contoh: Rina Kartika, S.Sos."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0f2b5c]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Email Resmi <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailManuallyEdited(true);
                    }}
                    placeholder="rina.kartika@wijna.org"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0f2b5c]"
                  />
                </div>
              </div>

              {/* Kredensial Login (Username & Password Awal yang Ditetapkan Administrator) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl bg-blue-50/40 border border-blue-200/70">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Username Login <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
                      setUsernameManuallyEdited(true);
                    }}
                    placeholder="rina.kartika"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0f2b5c]"
                  />
                  <span className="block text-[10.5px] text-slate-500 mt-1">
                    Ditetapkan oleh Administrator untuk login.
                  </span>
                </div>

                {!editingUser ? (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Password Awal (Initial Password) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showInitialPassword ? 'text' : 'password'}
                        required
                        value={initialPassword}
                        onChange={(e) => setInitialPassword(e.target.value)}
                        placeholder="Minimal 6 karakter"
                        className="w-full pl-3 pr-9 py-2 text-sm font-mono border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0f2b5c]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowInitialPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        {showInitialPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <span className="block text-[10.5px] text-slate-500 mt-1">
                      Disimpan dengan enkripsi hash (scrypt).
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col justify-between">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Manajemen Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setShowModal(false);
                        handleOpenResetPassword(editingUser);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Reset Password Pengguna Ini</span>
                    </button>
                    <span className="block text-[10.5px] text-slate-500 mt-1">
                      Gunakan fitur Reset Password untuk mengganti kredensial.
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Role Sistem (Otoritas Dasar)
                  </label>
                  <select
                    value={role}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0f2b5c]"
                  >
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map((rKey) => (
                      <option key={rKey} value={rKey}>
                        {ROLE_LABELS[rKey]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nama Jabatan (Role Title) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0f2b5c]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Departemen / Unit Kerja <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Contoh: Divisi Air Bersih & Sanitasi"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0f2b5c]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Status Akses Akun Pengguna
                  </label>
                  <select
                    value={accountStatus}
                    disabled={editingUser?.id === currentUser?.id}
                    onChange={(e) => {
                      const nextSt = e.target.value as UserAccountStatus;
                      setAccountStatus(nextSt);
                      setIsActive(nextSt === 'Aktif');
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0f2b5c] disabled:bg-slate-100"
                  >
                    <option value="Aktif">Aktif (Dapat Login &amp; Ditugaskan)</option>
                    <option value="Ditangguhkan">Ditangguhkan / Suspended (Akses Diblokir Sementara)</option>
                    <option value="Nonaktif">Nonaktif (Staf Keluar/Pindah, Data Historis Aman)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
                  Konfigurasi Hak Akses Menu &amp; Fitur (Granular Permissions)
                </label>
                <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.canManagePrograms}
                      onChange={(e) =>
                        setPermissions({ ...permissions, canManagePrograms: e.target.checked })
                      }
                      className="rounded text-[#0f2b5c]"
                    />
                    <span className="text-slate-700 font-medium">
                      Dapat mengelola Struktur Program, Indikator &amp; Penugasan RACI Output
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.canCreateTor}
                      onChange={(e) =>
                        setPermissions({ ...permissions, canCreateTor: e.target.checked })
                      }
                      className="rounded text-[#0f2b5c]"
                    />
                    <span className="text-slate-700 font-medium">
                      Dapat menyusun Dokumen ToR, Cash Advance &amp; Monitoring Tools Kegiatan
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={role === 'admin'}
                      checked={role === 'admin' ? false : permissions.canApproveTor}
                      onChange={(e) =>
                        setPermissions({ ...permissions, canApproveTor: e.target.checked })
                      }
                      className="rounded text-[#0f2b5c] disabled:opacity-50"
                    />
                    <span className="text-slate-700 font-medium">
                      Dapat melakukan Verifikasi / Approval Dokumen (Sesuai RACI A1 / A2 / Direktur)
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.canViewAllTors}
                      onChange={(e) =>
                        setPermissions({ ...permissions, canViewAllTors: e.target.checked })
                      }
                      className="rounded text-[#0f2b5c]"
                    />
                    <span className="text-slate-700 font-medium">
                      Dapat memantau seluruh dokumen lintas divisi (Monitoring &amp; Oversight)
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={role === 'admin' ? true : permissions.canManageUsers}
                      disabled={role === 'admin'}
                      onChange={(e) =>
                        setPermissions({ ...permissions, canManageUsers: e.target.checked })
                      }
                      className="rounded text-[#0f2b5c] disabled:opacity-50"
                    />
                    <span className="text-slate-700 font-medium">
                      Dapat mengelola akun pengguna &amp; hak akses sistem (Administrator)
                    </span>
                  </label>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submitting
                    ? 'Menyimpan & Menyinkronkan...'
                    : editingUser
                    ? 'Simpan Perubahan'
                    : 'Buat Akun Pengguna'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reset Password Pengguna oleh System Administrator */}
      {resetPasswordUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-700" />
                <h3 className="font-bold text-slate-900 text-sm">
                  Reset Password Pengguna
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResetPasswordUser(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmResetPassword} className="p-5 space-y-4">
              {resetPasswordError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{resetPasswordError}</span>
                </div>
              )}

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-900">{resetPasswordUser.name}</div>
                <div className="text-slate-500 font-mono text-[11px]">
                  @{resetPasswordUser.username || (resetPasswordUser.email || '').split('@')[0]} · {resetPasswordUser.email || '-'}
                </div>
                <div className="text-slate-600 text-[11px]">
                  {resetPasswordUser.roleTitle} — {resetPasswordUser.department}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Password Baru <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="w-full pl-3 pr-10 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#0f2b5c]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Password baru akan di-hash secara aman dan dicatat dalam Audit Log sistem.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setResetPasswordUser(null)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="px-4 py-1.5 rounded-lg bg-[#0f2b5c] hover:bg-[#1e3a8a] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {resettingPassword ? 'Menyimpan...' : 'Simpan Password Baru'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
