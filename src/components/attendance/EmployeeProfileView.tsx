import React, { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  HeartHandshake,
  GraduationCap,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  ExternalLink,
  Edit3,
  X,
  Check,
  Building2,
  Mail,
  Link2,
  FileText,
} from 'lucide-react';
import {
  User,
  AttendanceSystemBundle,
  Program,
  Outcome,
  Output,
  OutputRaciRecord,
  EmployeeTrainingRecord,
} from '../../types/index.js';
import { api } from '../../lib/api.js';

interface EmployeeProfileViewProps {
  bundle: AttendanceSystemBundle;
  currentUser: User | null;
  allUsers: User[];
  isHR: boolean;
  isDirector: boolean;
  onBundleChange: (nextBundle: AttendanceSystemBundle) => void;
  onShowToast: (msg: string) => void;
  onShowError: (msg: string) => void;
}

interface TrainingDraftRow {
  trainingTitle: string;
  organizer: string;
  startDate: string;
  durationHours: number;
  certificateOrEvidenceUrl: string;
}

function createEmptyTrainingRow(): TrainingDraftRow {
  const today = new Date().toISOString().slice(0, 10);
  return {
    trainingTitle: '',
    organizer: '',
    startDate: today,
    durationHours: 16,
    certificateOrEvidenceUrl: '',
  };
}

function formatDateShortId(yyyyMmDd?: string): string {
  if (!yyyyMmDd) return '-';
  const d = new Date(`${yyyyMmDd.slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const EmployeeProfileView: React.FC<EmployeeProfileViewProps> = ({
  bundle,
  currentUser,
  allUsers,
  isHR,
  isDirector,
  onBundleChange,
  onShowToast,
  onShowError,
}) => {
  const activeEmployees = useMemo(
    () =>
      allUsers.filter(
        (u) => u.isActive && u.role !== 'admin' && u.role !== 'system_admin'
      ),
    [allUsers]
  );

  const [selectedUserId, setSelectedUserId] = useState<string>(
    () =>
      (currentUser &&
      currentUser.role !== 'admin' &&
      currentUser.role !== 'system_admin'
        ? currentUser.id
        : activeEmployees[0]?.id) || ''
  );

  useEffect(() => {
    if (
      currentUser &&
      currentUser.role !== 'admin' &&
      currentUser.role !== 'system_admin' &&
      !selectedUserId
    ) {
      setSelectedUserId(currentUser.id);
    } else if (!selectedUserId && activeEmployees.length > 0) {
      setSelectedUserId(activeEmployees[0].id);
    }
  }, [currentUser, activeEmployees, selectedUserId]);

  const selectedEmployee = useMemo(
    () =>
      activeEmployees.find((u) => u.id === selectedUserId) ||
      currentUser ||
      activeEmployees[0] ||
      null,
    [activeEmployees, selectedUserId, currentUser]
  );

  // Load Program Structure + Output RACI Records for Automatic Entrusted Output Calculation
  const [programs, setPrograms] = useState<Program[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [outputRaciRecords, setOutputRaciRecords] = useState<OutputRaciRecord[]>([]);
  const [loadingOutputs, setLoadingOutputs] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    const loadProgramAndRaci = async () => {
      try {
        setLoadingOutputs(true);
        const [progRes, raciRes] = await Promise.all([
          api.getPrograms().catch(() => null),
          api.getMonitoringConnect().catch(() => null),
        ]);
        if (!mounted) return;
        if (progRes) {
          setPrograms(Array.isArray(progRes.programs) ? progRes.programs : []);
          setOutcomes(Array.isArray(progRes.outcomes) ? progRes.outcomes : []);
          setOutputs(Array.isArray(progRes.outputs) ? progRes.outputs : []);
        }
        if (raciRes && Array.isArray(raciRes.outputRaciRecords)) {
          setOutputRaciRecords(raciRes.outputRaciRecords);
        }
      } finally {
        if (mounted) setLoadingOutputs(false);
      }
    };
    loadProgramAndRaci();
    return () => {
      mounted = false;
    };
  }, []);

  // =========================================================================
  // 1. OUTPUT YANG DIPERCAYAKAN (OTOMATIS DARI RACI & STRUKTUR PROGRAM)
  // =========================================================================
  const entrustedOutputs = useMemo(() => {
    if (!selectedEmployee) return [];
    const empId = selectedEmployee.id;
    const empNameLower = selectedEmployee.name.toLowerCase();

    const raciMap = new Map<string, OutputRaciRecord>();
    for (const r of outputRaciRecords) {
      raciMap.set(r.outputId, r);
    }

    const result: Array<{
      output: Output;
      program?: Program;
      roles: string[];
    }> = [];

    for (const op of outputs) {
      const raci = raciMap.get(op.id);
      const roles: string[] = [];

      if (raci) {
        if (raci.responsibleUserId === empId) roles.push('R (Pelaksana)');
        if (raci.accountableUserId === empId) roles.push('A1 (Program)');
        if (raci.accountableFinanceUserId === empId) roles.push('A2 (Finance)');
        if (
          Array.isArray(raci.consultedUsers) &&
          raci.consultedUsers.some((c) => c.toLowerCase().includes(empNameLower))
        ) {
          roles.push('C (Consulted)');
        }
        if (
          Array.isArray(raci.informedUsers) &&
          raci.informedUsers.some((i) => i.toLowerCase().includes(empNameLower))
        ) {
          roles.push('I (Informed)');
        }
      } else if (
        op.picId === empId ||
        (op.picName && op.picName.toLowerCase().includes(empNameLower))
      ) {
        roles.push('PIC Output');
      }

      if (roles.length > 0) {
        const outcome = outcomes.find((o) => o.id === op.outcomeId);
        const program = programs.find(
          (p) => p.id === (outcome?.programId || raci?.programId)
        );
        result.push({
          output: op,
          program,
          roles,
        });
      }
    }

    return result;
  }, [selectedEmployee, outputs, outcomes, programs, outputRaciRecords]);

  // =========================================================================
  // 2. SISA & DETAIL CUTI KARYAWAN (OTOMATIS SESUAI WORKFLOW PERAN)
  // =========================================================================
  const leaveSummary = useMemo(() => {
    if (!selectedEmployee) {
      return {
        policiesBreakdown: [],
        employeeRequests: [],
        totalUsed: 0,
        totalRemaining: 0,
        annualRegulerRemaining: 0,
        annualRegulerAllocated: 12,
      };
    }

    const policies = (bundle.leavePolicies || []).filter((p) => p.isActive !== false);
    const empRequests = (bundle.leaveRequests || []).filter(
      (l) => l.userId === selectedEmployee.id
    );
    const approvedReqs = empRequests.filter(
      (l) =>
        l.status === 'Approved' ||
        l.status === 'Disetujui Director' ||
        l.status === 'Submitted for Review' ||
        l.status === 'Reviewed by Director' ||
        l.status === 'Notified to Finance' ||
        l.status === 'Acknowledged by Finance'
    );
    const pendingReqs = empRequests.filter(
      (l) =>
        l.status === 'Pending' ||
        l.status === 'Menunggu Review HR' ||
        l.status === 'Menunggu Keputusan Director'
    );

    const policiesBreakdown = policies.map((pol) => {
      const used = approvedReqs
        .filter((l) => l.categoryId === pol.id || l.categoryName === pol.name)
        .reduce((sum, l) => sum + (Number(l.totalDays) || 0), 0);
      const pending = pendingReqs
        .filter((l) => l.categoryId === pol.id || l.categoryName === pol.name)
        .reduce((sum, l) => sum + (Number(l.totalDays) || 0), 0);
      const remaining = Math.max(0, pol.allocationDaysPerYear - used);

      return {
        policy: pol,
        allocated: pol.allocationDaysPerYear,
        used,
        pending,
        remaining,
      };
    });

    const totalUsed = policiesBreakdown.reduce((s, b) => s + b.used, 0);
    const totalRemaining = policiesBreakdown.reduce((s, b) => s + b.remaining, 0);
    const annualPol =
      policiesBreakdown.find((b) => b.policy.code === 'CT-REG') || policiesBreakdown[0];

    return {
      policiesBreakdown,
      employeeRequests: empRequests,
      totalUsed,
      totalRemaining,
      annualRegulerRemaining: annualPol ? annualPol.remaining : 0,
      annualRegulerAllocated: annualPol ? annualPol.allocated : 12,
    };
  }, [selectedEmployee, bundle.leavePolicies, bundle.leaveRequests]);

  // =========================================================================
  // 3. DAFTAR PELATIHAN YANG SUDAH DIIKUTI (MANUAL HR → DISETUJUI DIRECTOR)
  // Khusus selain Direktur (Direktur hanya memegang Oversight Program General Info)
  // =========================================================================
  const isSelectedDirector =
    selectedEmployee?.role === 'director' || selectedEmployee?.id === 'user-director';

  const allTrainings = useMemo(
    () =>
      (bundle.employeeTrainings || []).filter(
        (t) => t.userId !== 'user-director'
      ),
    [bundle.employeeTrainings]
  );

  const employeeTrainings = useMemo(() => {
    if (!selectedEmployee || isSelectedDirector) return [];
    return allTrainings.filter((t) => t.userId === selectedEmployee.id);
  }, [allTrainings, selectedEmployee, isSelectedDirector]);

  const pendingTrainingsCount = useMemo(
    () =>
      employeeTrainings.filter((t) => t.status === 'Menunggu Persetujuan Director').length,
    [employeeTrainings]
  );

  const pendingCountByUserMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of allTrainings) {
      if (t.userId !== 'user-director' && t.status === 'Menunggu Persetujuan Director') {
        map[t.userId] = (map[t.userId] || 0) + 1;
      }
    }
    return map;
  }, [allTrainings]);

  // =========================================================================
  // 4. LINK DOKUMEN PROFIL KARYAWAN LEBIH LANJUT (DIISI OLEH HR)
  // =========================================================================
  const currentProfileLink = useMemo(() => {
    if (!selectedEmployee || !bundle.employeeProfileLinks) return null;
    return bundle.employeeProfileLinks[selectedEmployee.id] || null;
  }, [selectedEmployee, bundle.employeeProfileLinks]);

  const [editingProfileLink, setEditingProfileLink] = useState<boolean>(false);
  const [linkLabelInput, setLinkLabelInput] = useState<string>('');
  const [linkUrlInput, setLinkUrlInput] = useState<string>('');
  const [savingLink, setSavingLink] = useState<boolean>(false);

  const handleOpenEditProfileLink = () => {
    setLinkLabelInput(
      currentProfileLink?.label ||
        `Dokumen & Portofolio Karyawan — ${selectedEmployee?.name || ''}`
    );
    setLinkUrlInput(currentProfileLink?.url || '');
    setEditingProfileLink(true);
  };

  const handleSaveProfileLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    setSavingLink(true);
    try {
      const res = await api.saveEmployeeProfileLink({
        userId: selectedEmployee.id,
        label: linkLabelInput.trim(),
        url: linkUrlInput.trim(),
      });
      onBundleChange(res.bundle);
      setEditingProfileLink(false);
      onShowToast(`Tautan dokumen profil ${selectedEmployee.name} berhasil disimpan oleh HR.`);
    } catch (err: any) {
      onShowError(err.message || 'Gagal menyimpan tautan dokumen profil.');
    } finally {
      setSavingLink(false);
    }
  };

  // State Form Tambah/Edit Daftar Pelatihan oleh HR
  const [showTrainingForm, setShowTrainingForm] = useState<boolean>(false);
  const [editingTrainingId, setEditingTrainingId] = useState<string | undefined>(undefined);
  const [trainingRows, setTrainingRows] = useState<TrainingDraftRow[]>([
    createEmptyTrainingRow(),
  ]);
  const [submittingTraining, setSubmittingTraining] = useState<boolean>(false);
  const [processingDecisionId, setProcessingDecisionId] = useState<string | null>(null);

  const handleOpenAddTrainings = () => {
    setEditingTrainingId(undefined);
    setTrainingRows([createEmptyTrainingRow()]);
    setShowTrainingForm(true);
  };

  const handleOpenEditTraining = (rec: EmployeeTrainingRecord) => {
    setEditingTrainingId(rec.id);
    setTrainingRows([
      {
        trainingTitle: rec.trainingTitle,
        organizer: rec.organizer,
        startDate: rec.startDate,
        durationHours: rec.durationHours || 16,
        certificateOrEvidenceUrl: rec.certificateOrEvidenceUrl || '',
      },
    ]);
    setShowTrainingForm(true);
  };

  const handleAddDraftRow = () => {
    setTrainingRows((prev) => [...prev, createEmptyTrainingRow()]);
  };

  const handleRemoveDraftRow = (idx: number) => {
    if (trainingRows.length <= 1) return;
    setTrainingRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateDraftRow = <K extends keyof TrainingDraftRow>(
    idx: number,
    field: K,
    value: TrainingDraftRow[K]
  ) => {
    setTrainingRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    );
  };

  const handleSaveTrainingsByHr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || isSelectedDirector) return;

    const validRows = trainingRows.filter((r) => r.trainingTitle.trim().length > 0);
    if (validRows.length === 0) {
      onShowError('Masukkan minimal 1 judul pelatihan yang diikuti.');
      return;
    }

    setSubmittingTraining(true);
    try {
      const res = await api.saveEmployeeTraining({
        id: editingTrainingId,
        userId: selectedEmployee.id,
        items: validRows.map((r) => ({
          trainingTitle: r.trainingTitle.trim(),
          organizer: r.organizer.trim() || 'Penyelenggara Pelatihan',
          category: 'Pengembangan Kapasitas',
          startDate: r.startDate,
          endDate: r.startDate,
          durationHours: Math.max(1, Number(r.durationHours) || 8),
          certificateOrEvidenceUrl: r.certificateOrEvidenceUrl.trim() || undefined,
        })),
      });
      onBundleChange(res.bundle);
      setShowTrainingForm(false);
      setEditingTrainingId(undefined);
      onShowToast(
        editingTrainingId
          ? `Data pelatihan ${selectedEmployee.name} berhasil diperbarui oleh HR.`
          : `${validRows.length} pelatihan ditambahkan ke daftar pelatihan ${selectedEmployee.name} (Menunggu ACC Director).`
      );
    } catch (err: any) {
      onShowError(err.message || 'Gagal menyimpan daftar pelatihan.');
    } finally {
      setSubmittingTraining(false);
    }
  };

  const handleDeleteTraining = async (id: string) => {
    try {
      const res = await api.deleteEmployeeTraining(id);
      onBundleChange(res.bundle);
      onShowToast('Pelatihan dihapus dari daftar.');
    } catch (err: any) {
      onShowError(err.message || 'Gagal menghapus pelatihan.');
    }
  };

  const handleDirectorDecision = async (
    trainingId: string,
    decision: 'approve' | 'revision' | 'reject'
  ) => {
    if (!selectedEmployee) return;
    setProcessingDecisionId(trainingId);
    try {
      const res = await api.decideEmployeeTraining(trainingId, {
        decision,
        userId: selectedEmployee.id,
      });
      onBundleChange(res.bundle);
      onShowToast(
        trainingId === 'ALL_PENDING'
          ? `Seluruh daftar pelatihan ${selectedEmployee.name} telah disetujui oleh Director.`
          : decision === 'approve'
          ? 'Pelatihan disetujui oleh Director.'
          : 'Status pelatihan diperbarui oleh Director.'
      );
    } catch (err: any) {
      onShowError(err.message || 'Gagal memproses persetujuan Director.');
    } finally {
      setProcessingDecisionId(null);
    }
  };

  if (!selectedEmployee) {
    return null;
  }

  return (
    <div className="space-y-2.5 text-[#2F3437]">
      {/* =================================================================== */}
      {/* BAR KONTROL DI TENGAH-TENGAH DI ATAS KOTAK ATAS                     */}
      {/* =================================================================== */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {currentProfileLink?.url ? (
          <a
            href={currentProfileLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#EBF7F5] hover:bg-[#DCF2EE] border border-[#BCE3DC] text-xs font-semibold text-[#0F7B6C] transition-colors whitespace-nowrap shadow-2xs"
            title={`${currentProfileLink.label} — Diisi oleh ${currentProfileLink.updatedByName}`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="max-w-[260px] truncate">
              {currentProfileLink.label || 'Dokumen Profil Lebih Lanjut'}
            </span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-[#E6E5E0] text-xs text-[#787774] whitespace-nowrap shadow-2xs">
            <Link2 className="w-3.5 h-3.5 text-[#9A9996] shrink-0" />
            <span>Belum ada link dokumen HR</span>
          </span>
        )}

        {(isHR || isDirector) && (
          <button
            type="button"
            onClick={handleOpenEditProfileLink}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#D3D3D0] bg-white hover:bg-[#F4F3EF] text-xs font-medium text-[#2F3437] cursor-pointer transition-colors whitespace-nowrap shadow-2xs"
            title="Diisi oleh HR: Tautan dokumen/folder profil karyawan lebih lanjut"
          >
            <Edit3 className="w-3.5 h-3.5 text-[#64748B]" />
            <span>{currentProfileLink?.url ? 'Edit Link HR' : '+ Link HR'}</span>
          </button>
        )}

        <select
          value={selectedEmployee.id}
          onChange={(e) => {
            setSelectedUserId(e.target.value);
            setShowTrainingForm(false);
            setEditingProfileLink(false);
          }}
          aria-label="Pilih Karyawan"
          className="h-8 px-3 text-xs font-medium text-[#1E293B] bg-white border border-[#D3D3D0] rounded-lg focus:outline-none focus:border-[#1D4ED8] cursor-pointer shadow-2xs"
        >
          {activeEmployees.map((u) => {
            const pend = pendingCountByUserMap[u.id] || 0;
            return (
              <option key={u.id} value={u.id}>
                {u.name} — {u.roleTitle}
                {pend > 0 ? ` (${pend} Pending)` : ''}
              </option>
            );
          })}
        </select>
      </div>

      {/* Form Inline Edit Link Dokumen Profil Lebih Lanjut (Khusus HR) */}
      {editingProfileLink && (isHR || isDirector) && (
        <form
          onSubmit={handleSaveProfileLink}
          className="p-3 bg-white border border-[#E2E8F0] rounded-xl shadow-2xs flex flex-col sm:flex-row sm:items-end gap-2.5"
        >
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Nama Dokumen / Portofolio Lebih Lanjut (Diisi HR)
            </label>
            <input
              type="text"
              placeholder="Contoh: Folder Dokumen & Portofolio Lengkap Karyawan (HR)"
              value={linkLabelInput}
              onChange={(e) => setLinkLabelInput(e.target.value)}
              className="w-full h-8 px-2.5 text-xs bg-white border border-[#CBD5E1] rounded-lg"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Tautan / Link Dokumen (Google Drive / Notion / OneDrive)
            </label>
            <input
              type="url"
              required
              placeholder="https://drive.google.com/drive/folders/..."
              value={linkUrlInput}
              onChange={(e) => setLinkUrlInput(e.target.value)}
              className="w-full h-8 px-2.5 text-xs bg-white border border-[#CBD5E1] rounded-lg"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="submit"
              disabled={savingLink}
              className="h-8 px-3 rounded-lg bg-[#0F7B6C] hover:bg-[#0B5E52] text-white text-xs font-semibold cursor-pointer"
            >
              {savingLink ? 'Menyimpan...' : 'Simpan Link'}
            </button>
            <button
              type="button"
              onClick={() => setEditingProfileLink(false)}
              className="h-8 px-2.5 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-xs text-[#475569] cursor-pointer"
            >
              Batal
            </button>
          </div>
        </form>
      )}

      {/* =================================================================== */}
      {/* KOTAK ATAS: IDENTITAS KARYAWAN SATU BARIS RAPI & PROPORSIONAL       */}
      {/* =================================================================== */}
      <div className="bg-white border border-[#E6E5E0] rounded-xl px-4 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] flex items-center justify-center font-mono font-bold text-xs shrink-0">
            {selectedEmployee.name
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase()}
          </div>

          <h2 className="text-sm font-bold text-[#1E293B] whitespace-nowrap">
            {selectedEmployee.name}
          </h2>

          <span className="px-2 py-0.5 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] font-semibold text-[#334155] whitespace-nowrap">
            {selectedEmployee.roleTitle}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B]">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Building2 className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
            <span>{selectedEmployee.department}</span>
          </span>
          <span className="text-[#CBD5E1] hidden sm:inline">•</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Mail className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
            <span>{selectedEmployee.email}</span>
          </span>
        </div>
      </div>

      {/* =================================================================== */}
      {/* KONTEN PROFIL: 3 KOLOM RAPI, PROPORSIONAL & TANPA WASTE SPACE       */}
      {/* =================================================================== */}
      {isSelectedDirector ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
          {/* KOLOM UTAMA DIREKTUR (7/12): OVERSIGHT PROGRAM & GENERAL INFORMATION */}
          <div className="lg:col-span-7 bg-white border border-[#E6E5E0] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between space-y-2.5">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-[#EFF6FF] border border-[#DBEAFE] text-[#1D4ED8] flex items-center justify-center shrink-0">
                    <Layers className="w-3.5 h-3.5" />
                  </span>
                  <h3 className="text-[11.5px] font-bold uppercase tracking-wider text-[#1E293B]">
                    Oversight Program — General Information
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] text-[11px] font-semibold tabular-nums shrink-0">
                  {programs.length} Program
                </span>
              </div>

              {loadingOutputs ? (
                <div className="py-3 text-xs text-[#787774]">
                  Memuat informasi umum program...
                </div>
              ) : programs.length === 0 ? (
                <div className="py-3 text-xs text-[#787774]">
                  Belum ada program terdaftar.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {programs.map((prog, idx) => (
                    <div
                      key={prog.id}
                      className="p-2.5 rounded-lg bg-[#FAFAF9] border border-[#EDEDEC] flex items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 rounded bg-white border border-[#E2E1DC] font-mono text-[10.5px] font-semibold text-[#64748B] flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-[#1E293B] leading-snug">
                          {prog.name}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-white border border-[#E2E1DC] text-[10.5px] font-medium text-[#475569] shrink-0">
                        Oversight
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* KOLOM PENDAMPING DIREKTUR (5/12): SISA & DETAIL CUTI */}
          <div className="lg:col-span-5 bg-white border border-[#E6E5E0] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between space-y-2.5">
            <div>
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-md bg-[#EBF7F5] border border-[#BCE3DC] text-[#0F7B6C] flex items-center justify-center shrink-0">
                    <HeartHandshake className="w-3.5 h-3.5" />
                  </span>
                  <h3 className="text-[11.5px] font-bold uppercase tracking-wider text-[#1E293B]">
                    Sisa &amp; Detail Cuti
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#EBF7F5] border border-[#BCE3DC] text-[#0F7B6C] text-[11px] font-semibold tabular-nums shrink-0">
                  Sisa {leaveSummary.annualRegulerRemaining}/{leaveSummary.annualRegulerAllocated} Hari
                </span>
              </div>

              <div className="divide-y divide-[#F1F0EC] mt-1">
                {leaveSummary.policiesBreakdown.map((item) => (
                  <div
                    key={item.policy.id}
                    className="py-1.5 flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-medium text-[#334155] leading-snug">
                      {item.policy.name}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                      {item.used > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-[#F1F5F9] text-[#475569] text-[10.5px] font-medium">
                          Pakai {item.used} hr
                        </span>
                      )}
                      <span className="min-w-[60px] text-right px-2 py-0.2 rounded bg-[#F0FDF4] border border-[#BBF7D0] font-mono text-[11px] font-semibold text-[#15803D]">
                        {item.remaining}/{item.allocated} hr
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
          {/* =============================================================== */}
          {/* KOLOM 1: OUTPUT YANG DIPERCAYAKAN                               */}
          {/* =============================================================== */}
          <div className="bg-white border border-[#E6E5E0] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-md bg-[#EFF6FF] border border-[#DBEAFE] text-[#1D4ED8] flex items-center justify-center shrink-0">
                    <Layers className="w-3.5 h-3.5" />
                  </span>
                  <h3 className="text-[11.5px] font-bold uppercase tracking-wider text-[#1E293B] truncate">
                    Output yang Dipercayakan
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] text-[11px] font-semibold tabular-nums shrink-0">
                  {entrustedOutputs.length} Output
                </span>
              </div>

              {loadingOutputs ? (
                <div className="py-2 text-xs text-[#787774]">Memuat data Output...</div>
              ) : entrustedOutputs.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-[#FAFAF9] border border-[#EDEDEC] text-xs text-[#64748B] leading-relaxed">
                  Peran fungsional lintas program:{' '}
                  <strong className="text-[#1E293B]">{selectedEmployee.roleTitle}</strong>{' '}
                  (mendukung seluruh output program organisasi).
                </div>
              ) : (
                <div className="space-y-2">
                  {entrustedOutputs.map((item, idx) => (
                    <div
                      key={item.output.id}
                      className="p-2.5 rounded-lg bg-[#FAFAF9] border border-[#EDEDEC] space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-1.5 min-w-0">
                          <span className="mt-0.5 w-4.5 h-4.5 rounded bg-white border border-[#E2E1DC] font-mono text-[10px] font-semibold text-[#64748B] flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-[#1E293B] leading-snug">
                            {item.output.name}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          {item.roles.map((r) => (
                            <span
                              key={r}
                              className="px-1.5 py-0.2 rounded bg-white border border-[#D3D3D0] text-[10px] font-semibold text-[#334155] whitespace-nowrap"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                      {item.program && (
                        <div className="pl-6 text-[11px] text-[#64748B] leading-snug">
                          {item.program.name}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2.5 pt-2 border-t border-[#F1F0EC] flex items-center justify-between text-[11px] text-[#64748B]">
              <span>Basis Penugasan:</span>
              <span className="font-medium text-[#334155]">Struktur Program &amp; RACI</span>
            </div>
          </div>

          {/* =============================================================== */}
          {/* KOLOM 2: SISA & DETAIL CUTI                                     */}
          {/* =============================================================== */}
          <div className="bg-white border border-[#E6E5E0] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-md bg-[#EBF7F5] border border-[#BCE3DC] text-[#0F7B6C] flex items-center justify-center shrink-0">
                    <HeartHandshake className="w-3.5 h-3.5" />
                  </span>
                  <h3 className="text-[11.5px] font-bold uppercase tracking-wider text-[#1E293B] truncate">
                    Sisa &amp; Detail Cuti
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#EBF7F5] border border-[#BCE3DC] text-[#0F7B6C] text-[11px] font-semibold tabular-nums shrink-0">
                  Sisa {leaveSummary.annualRegulerRemaining}/{leaveSummary.annualRegulerAllocated} Hari
                </span>
              </div>

              <div className="divide-y divide-[#F1F0EC] mt-1">
                {leaveSummary.policiesBreakdown.map((item) => (
                  <div
                    key={item.policy.id}
                    className="py-1.5 flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-medium text-[#334155] leading-snug truncate">
                      {item.policy.name}
                    </span>
                    <div className="flex items-center gap-1 shrink-0 tabular-nums">
                      {item.used > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-[#F1F5F9] text-[#475569] text-[10px] font-medium">
                          Pakai {item.used} hr
                        </span>
                      )}
                      {item.pending > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-50 border border-amber-200 text-[#B45309] text-[10px] font-semibold">
                          Pending {item.pending} hr
                        </span>
                      )}
                      <span className="min-w-[58px] text-right px-1.5 py-0.2 rounded bg-[#F0FDF4] border border-[#BBF7D0] font-mono text-[11px] font-semibold text-[#15803D]">
                        {item.remaining}/{item.allocated} hr
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2.5 pt-2 border-t border-[#F1F0EC] flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
              <span className="shrink-0">Terakhir:</span>
              {leaveSummary.employeeRequests.length > 0 ? (
                <span className="font-semibold text-[#1E293B] truncate">
                  {leaveSummary.employeeRequests[0].categoryName} (
                  {leaveSummary.employeeRequests[0].totalDays} hr ·{' '}
                  {leaveSummary.employeeRequests[0].status})
                </span>
              ) : (
                <span className="text-[#94A3B8]">Belum ada pengajuan</span>
              )}
            </div>
          </div>

          {/* =============================================================== */}
          {/* KOLOM 3: DAFTAR PELATIHAN                                       */}
          {/* =============================================================== */}
          <div className="bg-white border border-[#E6E5E0] rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F0EC]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-md bg-[#EFF6FF] border border-[#DBEAFE] text-[#1D4ED8] flex items-center justify-center shrink-0">
                    <GraduationCap className="w-3.5 h-3.5" />
                  </span>
                  <h3 className="text-[11.5px] font-bold uppercase tracking-wider text-[#1E293B] truncate">
                    Daftar Pelatihan ({employeeTrainings.length})
                  </h3>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isDirector && pendingTrainingsCount > 0 && (
                    <button
                      type="button"
                      disabled={processingDecisionId === 'ALL_PENDING'}
                      onClick={() => handleDirectorDecision('ALL_PENDING', 'approve')}
                      className="h-6 px-2 rounded-md bg-[#0F7B6C] hover:bg-[#0B5E52] text-white text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>ACC ({pendingTrainingsCount})</span>
                    </button>
                  )}

                  {isHR && (
                    <button
                      type="button"
                      onClick={handleOpenAddTrainings}
                      className="h-6 px-2 rounded-md bg-white hover:bg-[#F4F3EF] border border-[#D3D3D0] text-[#2F3437] text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Tambah (HR)</span>
                    </button>
                  )}
                </div>
              </div>

              {employeeTrainings.length === 0 ? (
                <div className="p-3 rounded-lg bg-[#FAFAF9] border border-[#EDEDEC] text-center text-xs text-[#787774]">
                  Belum ada pelatihan tercatat untuk {selectedEmployee.name}.
                </div>
              ) : (
                <div className="space-y-2">
                  {employeeTrainings.map((trn, idx) => {
                    const isApproved = trn.status === 'Disetujui Director';
                    const isPending = trn.status === 'Menunggu Persetujuan Director';
                    return (
                      <div
                        key={trn.id}
                        className="p-2.5 rounded-lg bg-[#FAFAF9] border border-[#EDEDEC] space-y-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-1.5 min-w-0">
                            <span className="mt-0.5 w-4.5 h-4.5 rounded bg-white border border-[#E2E1DC] font-mono text-[10px] font-semibold text-[#64748B] flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <h4 className="text-xs font-semibold text-[#1E293B] leading-snug">
                              {trn.trainingTitle}
                            </h4>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isApproved ? (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-[#EBF7F5] border border-[#BCE3DC] text-[#0F7B6C] text-[10px] font-semibold whitespace-nowrap"
                                title={`Disetujui oleh ${trn.directorDecisionByName || 'Director'}`}
                              >
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                <span>ACC</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-50 border border-amber-200 text-[#B45309] text-[10px] font-semibold whitespace-nowrap">
                                <Clock className="w-2.5 h-2.5" />
                                <span>Pending</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="pl-6 flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-[#64748B]">
                          <span className="leading-snug">
                            {trn.organizer} · {formatDateShortId(trn.startDate)}
                            {trn.durationHours ? ` · ${trn.durationHours} Jam` : ''}
                          </span>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {trn.certificateOrEvidenceUrl && (
                              <a
                                href={trn.certificateOrEvidenceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200 text-[#1D4ED8] text-[10.5px] font-semibold transition-colors whitespace-nowrap"
                              >
                                <span>Sertifikat</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}

                            {isDirector && isPending && (
                              <button
                                type="button"
                                disabled={processingDecisionId === trn.id}
                                onClick={() => handleDirectorDecision(trn.id, 'approve')}
                                className="px-1.5 py-0.2 rounded bg-[#0F7B6C] text-white text-[10px] font-semibold hover:bg-[#0B5E52] cursor-pointer whitespace-nowrap"
                              >
                                Setujui
                              </button>
                            )}

                            {isHR && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditTraining(trn)}
                                  className="text-[#64748B] hover:text-[#1E293B] cursor-pointer"
                                  title="Edit pelatihan"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTraining(trn.id)}
                                  className="text-[#94A3B8] hover:text-red-600 cursor-pointer"
                                  title="Hapus pelatihan"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-2.5 pt-2 border-t border-[#F1F0EC] flex items-center justify-between text-[11px] text-[#64748B]">
              <span>Total Jam Pelatihan:</span>
              <span className="font-semibold text-[#334155]">
                {employeeTrainings.reduce((sum, t) => sum + (Number(t.durationHours) || 0), 0)} Jam
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Form Ringkas Input Daftar Pelatihan oleh HR (Muncul Saat Klik + Tambah (HR)) */}
      {isHR && !isSelectedDirector && showTrainingForm && (
        <form
          onSubmit={handleSaveTrainingsByHr}
          className="p-3 bg-[#F8FAFC] border-t border-[#E2E8F0] space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#171717]">
              {editingTrainingId
                ? `Edit Pelatihan — ${selectedEmployee.name}`
                : `Tambah Daftar Pelatihan — ${selectedEmployee.name} (HR → ACC Director)`}
            </span>
            <div className="flex items-center gap-1.5">
              {!editingTrainingId && (
                <button
                  type="button"
                  onClick={handleAddDraftRow}
                  className="h-7 px-2 rounded border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[11px] font-semibold text-[#334155] inline-flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ Baris</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowTrainingForm(false);
                  setEditingTrainingId(undefined);
                }}
                className="p-1 text-[#64748B] hover:text-[#171717] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            {trainingRows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center bg-white p-2 rounded border border-[#E2E8F0]"
              >
                <div className="md:col-span-5">
                  <input
                    type="text"
                    required
                    placeholder={`Nama Pelatihan #${idx + 1} *`}
                    value={row.trainingTitle}
                    onChange={(e) =>
                      handleUpdateDraftRow(idx, 'trainingTitle', e.target.value)
                    }
                    className="w-full h-7 px-2 text-xs border border-[#CBD5E1] rounded"
                  />
                </div>
                <div className="md:col-span-3">
                  <input
                    type="text"
                    required
                    placeholder="Penyelenggara *"
                    value={row.organizer}
                    onChange={(e) =>
                      handleUpdateDraftRow(idx, 'organizer', e.target.value)
                    }
                    className="w-full h-7 px-2 text-xs border border-[#CBD5E1] rounded"
                  />
                </div>
                <div className="md:col-span-2">
                  <input
                    type="date"
                    required
                    value={row.startDate}
                    onChange={(e) =>
                      handleUpdateDraftRow(idx, 'startDate', e.target.value)
                    }
                    className="w-full h-7 px-2 text-xs border border-[#CBD5E1] rounded"
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-1">
                  <input
                    type="text"
                    placeholder="Link Sertifikat"
                    value={row.certificateOrEvidenceUrl}
                    onChange={(e) =>
                      handleUpdateDraftRow(idx, 'certificateOrEvidenceUrl', e.target.value)
                    }
                    className="w-full h-7 px-2 text-xs border border-[#CBD5E1] rounded"
                  />
                  {trainingRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDraftRow(idx)}
                      className="p-1 text-red-500 hover:text-red-700 cursor-pointer shrink-0"
                      title="Hapus baris"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowTrainingForm(false);
                setEditingTrainingId(undefined);
              }}
              className="h-7 px-2.5 rounded border border-[#CBD5E1] bg-white text-[11px] text-[#475569] cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submittingTraining}
              className="h-7 px-3 rounded bg-[#0F7B6C] hover:bg-[#0B5E52] text-white text-[11px] font-semibold cursor-pointer"
            >
              {submittingTraining ? 'Menyimpan...' : 'Simpan & Ajukan ke Director'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
