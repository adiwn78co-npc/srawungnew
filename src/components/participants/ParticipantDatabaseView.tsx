import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Users,
  Building2,
  UserPlus,
  Search,
  Eye,
  Pencil,
  Trash2,
  X,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  FolderGit2,
  Check,
  History,
  Clock,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  Program,
  AuditLog,
  MasterParticipantRecord,
  MasterParticipantType,
  MasterParticipantAgeGroup,
  MasterParticipantGender,
  MasterDisabilityStatus,
  MasterCommunityRole,
  MasterGroupCategory,
  MasterGroupProgramRole,
  GroupCompositionRowKey,
  GroupMemberCompositionMatrix,
  ParticipantProgramInvolvement,
} from '../../types/index.js';

const AGE_GROUP_OPTIONS: MasterParticipantAgeGroup[] = [
  'Anak-anak (0–12 tahun)',
  'Remaja (13–17 tahun)',
  'Pemuda (18–30 tahun)',
  'Dewasa (31–59 tahun)',
  'Lansia (60 tahun ke atas)',
];

const GENDER_OPTIONS: MasterParticipantGender[] = [
  'Laki-laki',
  'Perempuan',
  'Lainnya',
  'Memilih tidak menjawab',
];

const DISABILITY_OPTIONS: MasterDisabilityStatus[] = [
  'Tidak',
  'Ya',
  'Memilih tidak menjawab',
];

const COMMUNITY_ROLE_OPTIONS: MasterCommunityRole[] = [
  'Pemuda',
  'Tokoh Agama',
  'Pemimpin Adat',
  'Fasilitator',
  'Masyarakat Umum',
  'Lainnya',
];

const GROUP_CATEGORY_OPTIONS: MasterGroupCategory[] = [
  'Komunitas',
  'Organisasi',
  'Kelompok Masyarakat',
  'Kelompok Keagamaan',
  'Kelompok Adat',
  'Institusi',
  'Lainnya',
];

const GROUP_PROGRAM_ROLE_OPTIONS: MasterGroupProgramRole[] = [
  'Peserta',
  'Mitra',
  'Kelompok Sasaran',
  'Fasilitator Komunitas',
  'Lainnya',
];

const INVOLVEMENT_ROLE_OPTIONS: string[] = [
  'Peserta',
  'Penerima Manfaat',
  'Fasilitator',
  'Mitra',
  'Kelompok Sasaran',
  'Narasumber',
];

const COMPOSITION_ROWS: {
  key: GroupCompositionRowKey;
  label: string;
  ageFilterMatch: MasterParticipantAgeGroup;
}[] = [
  { key: 'anak', label: 'Anak-anak (0–12)', ageFilterMatch: 'Anak-anak (0–12 tahun)' },
  { key: 'remaja', label: 'Remaja (13–17)', ageFilterMatch: 'Remaja (13–17 tahun)' },
  { key: 'pemuda', label: 'Pemuda (18–30)', ageFilterMatch: 'Pemuda (18–30 tahun)' },
  { key: 'dewasa', label: 'Dewasa (31–59)', ageFilterMatch: 'Dewasa (31–59 tahun)' },
  { key: 'lansia', label: 'Lansia (60+)', ageFilterMatch: 'Lansia (60 tahun ke atas)' },
];

function createEmptyComposition(): GroupMemberCompositionMatrix {
  return {
    anak: { lakiLaki: 0, perempuan: 0, lainnya: 0, memilihTidakMenjawab: 0 },
    remaja: { lakiLaki: 0, perempuan: 0, lainnya: 0, memilihTidakMenjawab: 0 },
    pemuda: { lakiLaki: 0, perempuan: 0, lainnya: 0, memilihTidakMenjawab: 0 },
    dewasa: { lakiLaki: 0, perempuan: 0, lainnya: 0, memilihTidakMenjawab: 0 },
    lansia: { lakiLaki: 0, perempuan: 0, lainnya: 0, memilihTidakMenjawab: 0 },
  };
}

function getRowTotal(row: {
  lakiLaki: number;
  perempuan: number;
  lainnya: number;
  memilihTidakMenjawab: number;
}): number {
  return (Number(row?.lakiLaki) || 0) + (Number(row?.perempuan) || 0);
}

function getMatrixTotals(matrix: GroupMemberCompositionMatrix) {
  let lakiLaki = 0;
  let perempuan = 0;
  let lainnya = 0;
  let memilihTidakMenjawab = 0;

  for (const r of COMPOSITION_ROWS) {
    const cell = matrix?.[r.key] || {
      lakiLaki: 0,
      perempuan: 0,
      lainnya: 0,
      memilihTidakMenjawab: 0,
    };
    lakiLaki += Number(cell.lakiLaki) || 0;
    perempuan += Number(cell.perempuan) || 0;
    lainnya += Number(cell.lainnya) || 0;
    memilihTidakMenjawab += Number(cell.memilihTidakMenjawab) || 0;
  }

  const grandTotal = lakiLaki + perempuan + lainnya + memilihTidakMenjawab;
  return { lakiLaki, perempuan, lainnya, memilihTidakMenjawab, grandTotal };
}

function parseRolesArray<T extends string>(
  rolesArr: T[] | undefined,
  roleStr: string | undefined,
  fallback: T
): T[] {
  if (Array.isArray(rolesArr) && rolesArr.length > 0) {
    return rolesArr;
  }
  if (roleStr && roleStr.trim()) {
    const parsed = roleStr
      .split(',')
      .map((s) => s.trim() as T)
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  return [fallback];
}

function formatRolesDisplay(
  rolesArr: string[] | undefined,
  roleStr: string | undefined,
  notes: string | undefined
): string {
  const list =
    Array.isArray(rolesArr) && rolesArr.length > 0
      ? rolesArr
      : roleStr
      ? roleStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  if (list.length === 0) return '-';
  return list
    .map((r) => (r === 'Lainnya' && notes?.trim() ? `Lainnya (${notes.trim()})` : r))
    .join(', ');
}

interface ParticipantDatabaseViewProps {
  programs?: Program[];
}

export const ParticipantDatabaseView: React.FC<ParticipantDatabaseViewProps> = ({
  programs: externalPrograms,
}) => {
  const { currentUser } = useAuth();
  const canViewAuditTrail =
    currentUser?.role === 'director' ||
    currentUser?.role === 'hr' ||
    currentUser?.role === 'finance' ||
    currentUser?.role === 'admin';
  const [records, setRecords] = useState<MasterParticipantRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [showAuditTrail, setShowAuditTrail] = useState<boolean>(false);
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('ALL');
  const [programsList, setProgramsList] = useState<Program[]>(externalPrograms || []);
  const [nextIndividualCode, setNextIndividualCode] = useState<string>('IND-0001');
  const [nextGroupCode, setNextGroupCode] = useState<string>('KLP-0001');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterProgramId, setFilterProgramId] = useState<string>('ALL');
  const [filterRegion, setFilterRegion] = useState<string>('ALL');
  const [filterAgeGroup, setFilterAgeGroup] = useState<string>('ALL');
  const [filterGender, setFilterGender] = useState<string>('ALL');

  // Form Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [editingRecord, setEditingRecord] = useState<MasterParticipantRecord | null>(null);
  const [selectedType, setSelectedType] = useState<MasterParticipantType | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form A: Individu fields
  const [fullName, setFullName] = useState<string>('');
  const [organizationInstitution, setOrganizationInstitution] = useState<string>('');
  const [ageGroup, setAgeGroup] = useState<MasterParticipantAgeGroup>('Dewasa (31–59 tahun)');
  const [gender, setGender] = useState<MasterParticipantGender>('Laki-laki');
  const [disability, setDisability] = useState<MasterDisabilityStatus>('Tidak');
  const [disabilityNotes, setDisabilityNotes] = useState<string>('');
  const [communityRoles, setCommunityRoles] = useState<MasterCommunityRole[]>([
    'Masyarakat Umum',
  ]);
  const [communityRoleNotes, setCommunityRoleNotes] = useState<string>('');
  const [indRegionCommunity, setIndRegionCommunity] = useState<string>('');

  // Form B: Kelompok/Organisasi fields
  const [groupName, setGroupName] = useState<string>('');
  const [groupCategory, setGroupCategory] = useState<MasterGroupCategory>('Komunitas');
  const [groupCategoryNotes, setGroupCategoryNotes] = useState<string>('');
  const [grpRegionCommunity, setGrpRegionCommunity] = useState<string>('');
  const [contactPerson, setContactPerson] = useState<string>('');
  const [programRoles, setProgramRoles] = useState<MasterGroupProgramRole[]>(['Peserta']);
  const [programRoleNotes, setProgramRoleNotes] = useState<string>('');
  const [memberComposition, setMemberComposition] = useState<GroupMemberCompositionMatrix>(
    createEmptyComposition()
  );

  // Program Involvements inside Add/Edit Form (multi-select programs + multi-select roles per program)
  const [formProgramInvolvements, setFormProgramInvolvements] = useState<
    ParticipantProgramInvolvement[]
  >([]);

  // Quick Multi-Program Modal state
  const [linkingRecord, setLinkingRecord] = useState<MasterParticipantRecord | null>(null);
  const [quickInvolvements, setQuickInvolvements] = useState<ParticipantProgramInvolvement[]>([]);
  const [linkingSubmitting, setLinkingSubmitting] = useState<boolean>(false);

  // Detail & Delete Modal states
  const [viewingRecord, setViewingRecord] = useState<MasterParticipantRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<MasterParticipantRecord | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (Array.isArray(externalPrograms) && externalPrograms.length > 0) {
      setProgramsList(externalPrograms);
    }
  }, [externalPrograms]);

  const loadDatabase = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [res, fetchedProgs] = await Promise.all([
        api.getParticipantDatabase(),
        !externalPrograms || externalPrograms.length === 0
          ? api.getPrograms().catch(() => [] as Program[])
          : Promise.resolve(externalPrograms),
      ]);
      const nextRecords = res.records || [];
      setRecords(nextRecords);
      setAuditLogs(Array.isArray(res.auditLogs) ? res.auditLogs : []);
      setNextIndividualCode(res.nextIndividualCode || 'IND-0001');
      setNextGroupCode(res.nextGroupCode || 'KLP-0001');
      if (Array.isArray(fetchedProgs) && fetchedProgs.length > 0) {
        setProgramsList(fetchedProgs);
      }
      if (viewingRecord) {
        const refreshed = nextRecords.find((r) => r.id === viewingRecord.id);
        if (refreshed) setViewingRecord(refreshed);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memuat Database Peserta.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDatabase();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  // Summary metrics
  const summaryStats = useMemo(() => {
    let totalIndividu = 0;
    let totalKelompok = 0;
    let totalAnggotaKelompok = 0;

    for (const r of records) {
      if (r.participantType === 'INDIVIDU') {
        totalIndividu += 1;
      } else if (r.participantType === 'KELOMPOK/ORGANISASI') {
        totalKelompok += 1;
        const matrixTotals = getMatrixTotals(r.memberComposition);
        totalAnggotaKelompok += matrixTotals.grandTotal;
      }
    }

    return {
      totalIndividu,
      totalKelompok,
      totalAnggotaKelompok,
    };
  }, [records]);

  // Distinct Wilayah/Komunitas options
  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      const reg = (r.regionCommunity || '').trim();
      if (reg) set.add(reg);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const getResolvedInvolvements = (
    rec: MasterParticipantRecord
  ): ParticipantProgramInvolvement[] => {
    const list = Array.isArray(rec.programInvolvements) ? rec.programInvolvements : [];
    return list.map((inv) => {
      const matched = programsList.find((p) => p.id === inv.programId);
      const roles =
        Array.isArray(inv.rolesInProgram) && inv.rolesInProgram.length > 0
          ? inv.rolesInProgram
          : inv.roleInProgram
          ? inv.roleInProgram
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      return {
        ...inv,
        programName: matched?.name || inv.programName,
        programCode: matched?.code || inv.programCode,
        rolesInProgram: roles,
        roleInProgram: roles.length > 0 ? roles.join(', ') : inv.roleInProgram,
      };
    });
  };

  // Filtered records
  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return records.filter((rec) => {
      if (q) {
        const nameTarget =
          rec.participantType === 'INDIVIDU'
            ? rec.fullName.toLowerCase()
            : rec.groupName.toLowerCase();
        const codeTarget = rec.participantCode.toLowerCase();
        if (!nameTarget.includes(q) && !codeTarget.includes(q)) return false;
      }

      if (filterType !== 'ALL' && rec.participantType !== filterType) {
        return false;
      }

      if (filterProgramId !== 'ALL') {
        const involvements = rec.programInvolvements || [];
        const isInvolved = involvements.some((inv) => inv.programId === filterProgramId);
        if (!isInvolved) return false;
      }

      if (filterRegion !== 'ALL') {
        if ((rec.regionCommunity || '').trim() !== filterRegion) {
          return false;
        }
      }

      if (rec.participantType === 'INDIVIDU') {
        if (filterAgeGroup !== 'ALL' && rec.ageGroup !== filterAgeGroup) {
          return false;
        }
        if (filterGender !== 'ALL' && rec.gender !== filterGender) {
          return false;
        }
      } else {
        const genderKeyMap: Record<
          MasterParticipantGender,
          keyof GroupMemberCompositionMatrix['anak']
        > = {
          'Laki-laki': 'lakiLaki',
          Perempuan: 'perempuan',
          Lainnya: 'lainnya',
          'Memilih tidak menjawab': 'memilihTidakMenjawab',
        };

        if (filterAgeGroup !== 'ALL' && filterGender !== 'ALL') {
          const matchedRow = COMPOSITION_ROWS.find((r) => r.ageFilterMatch === filterAgeGroup);
          const gKey = genderKeyMap[filterGender as MasterParticipantGender];
          if (!matchedRow || !gKey) return false;
          const count = Number(rec.memberComposition?.[matchedRow.key]?.[gKey]) || 0;
          if (count <= 0) return false;
        } else if (filterAgeGroup !== 'ALL') {
          const matchedRow = COMPOSITION_ROWS.find((r) => r.ageFilterMatch === filterAgeGroup);
          if (!matchedRow) return false;
          const rowTotal = getRowTotal(rec.memberComposition?.[matchedRow.key]);
          if (rowTotal <= 0) return false;
        } else if (filterGender !== 'ALL') {
          const gKey = genderKeyMap[filterGender as MasterParticipantGender];
          if (!gKey) return false;
          const totals = getMatrixTotals(rec.memberComposition);
          if ((totals[gKey] || 0) <= 0) return false;
        }
      }

      return true;
    });
  }, [
    records,
    searchQuery,
    filterType,
    filterProgramId,
    filterRegion,
    filterAgeGroup,
    filterGender,
  ]);

  const handleOpenAddModal = () => {
    setEditingRecord(null);
    setSelectedType(null);
    setFormError(null);

    setFullName('');
    setOrganizationInstitution('');
    setAgeGroup('Dewasa (31–59 tahun)');
    setGender('Laki-laki');
    setDisability('Tidak');
    setDisabilityNotes('');
    setCommunityRoles(['Masyarakat Umum']);
    setCommunityRoleNotes('');
    setIndRegionCommunity('');

    setGroupName('');
    setGroupCategory('Komunitas');
    setGroupCategoryNotes('');
    setGrpRegionCommunity('');
    setContactPerson('');
    setProgramRoles(['Peserta']);
    setProgramRoleNotes('');
    setMemberComposition(createEmptyComposition());

    setFormProgramInvolvements([]);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (rec: MasterParticipantRecord) => {
    setEditingRecord(rec);
    setSelectedType(rec.participantType);
    setFormError(null);
    setFormProgramInvolvements(getResolvedInvolvements(rec));

    if (rec.participantType === 'INDIVIDU') {
      setFullName(rec.fullName);
      setOrganizationInstitution(rec.organizationInstitution || '');
      setAgeGroup(rec.ageGroup);
      setGender(rec.gender);
      setDisability(rec.disability);
      setDisabilityNotes(rec.disabilityNotes || '');
      setCommunityRoles(
        parseRolesArray<MasterCommunityRole>(
          rec.communityRoles,
          rec.communityRole,
          'Masyarakat Umum'
        )
      );
      setCommunityRoleNotes(rec.communityRoleNotes || '');
      setIndRegionCommunity(rec.regionCommunity || '');
    } else {
      setGroupName(rec.groupName);
      setGroupCategory(rec.groupCategory);
      setGroupCategoryNotes(rec.groupCategoryNotes || '');
      setGrpRegionCommunity(rec.regionCommunity || '');
      setContactPerson(rec.contactPerson || '');
      setProgramRoles(
        parseRolesArray<MasterGroupProgramRole>(rec.programRoles, rec.programRole, 'Peserta')
      );
      setProgramRoleNotes(rec.programRoleNotes || '');
      const cloned = createEmptyComposition();
      for (const r of COMPOSITION_ROWS) {
        const src = rec.memberComposition?.[r.key];
        if (src) {
          cloned[r.key] = {
            lakiLaki: Number(src.lakiLaki) || 0,
            perempuan: Number(src.perempuan) || 0,
            lainnya: Number(src.lainnya) || 0,
            memilihTidakMenjawab: Number(src.memilihTidakMenjawab) || 0,
          };
        }
      }
      setMemberComposition(cloned);
    }

    setIsFormModalOpen(true);
  };

  // Multi-select toggle for Peran Komunitas (Individu)
  const handleToggleCommunityRole = (role: MasterCommunityRole) => {
    setCommunityRoles((prev) => {
      if (prev.includes(role)) {
        if (prev.length === 1) return prev; // Keep at least 1 role selected
        return prev.filter((r) => r !== role);
      }
      return [...prev, role];
    });
  };

  // Multi-select toggle for Peran dalam Program (Kelompok/Organisasi)
  const handleToggleGroupProgramRole = (role: MasterGroupProgramRole) => {
    setProgramRoles((prev) => {
      if (prev.includes(role)) {
        if (prev.length === 1) return prev;
        return prev.filter((r) => r !== role);
      }
      return [...prev, role];
    });
  };

  // Toggle program involvement (1 peserta bisa beberapa program)
  const handleToggleFormProgram = (prog: Program) => {
    setFormProgramInvolvements((prev) => {
      const exists = prev.some((inv) => inv.programId === prog.id);
      if (exists) {
        return prev.filter((inv) => inv.programId !== prog.id);
      }
      return [
        ...prev,
        {
          programId: prog.id,
          programCode: prog.code,
          programName: prog.name,
          rolesInProgram: ['Peserta'],
          roleInProgram: 'Peserta',
          joinedAt: new Date().toISOString().slice(0, 10),
        },
      ];
    });
  };

  // Toggle multiple roles inside a specific checked Program in Form
  const handleToggleFormProgramRole = (programId: string, roleName: string) => {
    setFormProgramInvolvements((prev) =>
      prev.map((inv) => {
        if (inv.programId !== programId) return inv;
        const currentRoles =
          Array.isArray(inv.rolesInProgram) && inv.rolesInProgram.length > 0
            ? inv.rolesInProgram
            : inv.roleInProgram
            ? inv.roleInProgram
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
        const exists = currentRoles.includes(roleName);
        const nextRoles = exists
          ? currentRoles.filter((r) => r !== roleName)
          : [...currentRoles, roleName];
        return {
          ...inv,
          rolesInProgram: nextRoles,
          roleInProgram: nextRoles.join(', '),
        };
      })
    );
  };

  const handleCompositionCellChange = (
    rowKey: GroupCompositionRowKey,
    colKey: 'lakiLaki' | 'perempuan',
    rawValue: string
  ) => {
    const cleaned = rawValue.replace(/[^0-9]/g, '');
    const numeric = cleaned === '' ? 0 : Math.max(0, parseInt(cleaned, 10) || 0);
    setMemberComposition((prev) => ({
      ...prev,
      [rowKey]: {
        ...prev[rowKey],
        [colKey]: numeric,
      },
    }));
  };

  const handleLainnyaWithoutAgeChange = (rawValue: string) => {
    const cleaned = rawValue.replace(/[^0-9]/g, '');
    const numeric = cleaned === '' ? 0 : Math.max(0, parseInt(cleaned, 10) || 0);
    setMemberComposition((prev) => ({
      anak: { ...prev.anak, lainnya: 0, memilihTidakMenjawab: 0 },
      remaja: { ...prev.remaja, lainnya: 0, memilihTidakMenjawab: 0 },
      pemuda: { ...prev.pemuda, lainnya: 0, memilihTidakMenjawab: 0 },
      dewasa: { ...prev.dewasa, lainnya: numeric, memilihTidakMenjawab: 0 },
      lansia: { ...prev.lansia, lainnya: 0, memilihTidakMenjawab: 0 },
    }));
  };

  const handleSaveParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedType) {
      setFormError('Silakan pilih jenis peserta terlebih dahulu.');
      return;
    }

    if (selectedType === 'INDIVIDU') {
      if (!fullName.trim()) {
        setFormError('Nama Lengkap wajib diisi.');
        return;
      }
    } else {
      if (!groupName.trim()) {
        setFormError('Nama Kelompok/Organisasi wajib diisi.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (selectedType === 'INDIVIDU') {
        const finalRoles =
          communityRoles.length > 0 ? communityRoles : (['Masyarakat Umum'] as MasterCommunityRole[]);
        const payload: Partial<MasterParticipantRecord> = {
          participantType: 'INDIVIDU',
          fullName: fullName.trim(),
          organizationInstitution: organizationInstitution.trim(),
          ageGroup,
          gender,
          disability,
          disabilityNotes: disability === 'Ya' ? disabilityNotes.trim() : '',
          communityRole: finalRoles.join(', '),
          communityRoles: finalRoles,
          communityRoleNotes: finalRoles.includes('Lainnya') ? communityRoleNotes.trim() : '',
          regionCommunity: indRegionCommunity.trim(),
          programInvolvements: formProgramInvolvements,
        };

        if (editingRecord) {
          await api.updateParticipantRecord(editingRecord.id, payload);
          showToast('Data peserta berhasil diperbarui.');
        } else {
          await api.createParticipantRecord(payload);
          showToast('Data peserta berhasil ditambahkan.');
        }
      } else {
        const totals = getMatrixTotals(memberComposition);
        const finalGroupRoles =
          programRoles.length > 0 ? programRoles : (['Peserta'] as MasterGroupProgramRole[]);
        const payload: Partial<MasterParticipantRecord> = {
          participantType: 'KELOMPOK/ORGANISASI',
          groupName: groupName.trim(),
          groupCategory,
          groupCategoryNotes: groupCategory === 'Lainnya' ? groupCategoryNotes.trim() : '',
          regionCommunity: grpRegionCommunity.trim(),
          contactPerson: contactPerson.trim(),
          programRole: finalGroupRoles.join(', '),
          programRoles: finalGroupRoles,
          programRoleNotes: finalGroupRoles.includes('Lainnya') ? programRoleNotes.trim() : '',
          memberComposition,
          totalMembers: totals.grandTotal,
          programInvolvements: formProgramInvolvements,
        };

        if (editingRecord) {
          await api.updateParticipantRecord(editingRecord.id, payload);
          showToast('Data kelompok/organisasi berhasil diperbarui.');
        } else {
          await api.createParticipantRecord(payload);
          showToast('Data kelompok/organisasi berhasil ditambahkan.');
        }
      }

      setIsFormModalOpen(false);
      setEditingRecord(null);
      await loadDatabase();
    } catch (err: any) {
      setFormError(err.message || 'Gagal menyimpan data peserta.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenQuickLinkModal = (rec: MasterParticipantRecord) => {
    setLinkingRecord(rec);
    setQuickInvolvements(getResolvedInvolvements(rec));
  };

  const handleToggleQuickProgram = (prog: Program) => {
    setQuickInvolvements((prev) => {
      const exists = prev.some((inv) => inv.programId === prog.id);
      if (exists) {
        return prev.filter((inv) => inv.programId !== prog.id);
      }
      return [
        ...prev,
        {
          programId: prog.id,
          programCode: prog.code,
          programName: prog.name,
          rolesInProgram: ['Peserta'],
          roleInProgram: 'Peserta',
          joinedAt: new Date().toISOString().slice(0, 10),
        },
      ];
    });
  };

  const handleToggleQuickProgramRole = (programId: string, roleName: string) => {
    setQuickInvolvements((prev) =>
      prev.map((inv) => {
        if (inv.programId !== programId) return inv;
        const currentRoles =
          Array.isArray(inv.rolesInProgram) && inv.rolesInProgram.length > 0
            ? inv.rolesInProgram
            : inv.roleInProgram
            ? inv.roleInProgram
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
        const exists = currentRoles.includes(roleName);
        const nextRoles = exists
          ? currentRoles.filter((r) => r !== roleName)
          : [...currentRoles, roleName];
        return {
          ...inv,
          rolesInProgram: nextRoles,
          roleInProgram: nextRoles.join(', '),
        };
      })
    );
  };

  const handleSaveQuickPrograms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkingRecord) return;
    setLinkingSubmitting(true);
    try {
      await api.updateParticipantRecord(linkingRecord.id, {
        ...linkingRecord,
        programInvolvements: quickInvolvements,
      });
      showToast('Program & peran peserta diperbarui.');
      setLinkingRecord(null);
      await loadDatabase();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memperbarui keterlibatan program.');
    } finally {
      setLinkingSubmitting(false);
    }
  };

  const handleUnlinkFromProgram = async (participantId: string, programId: string) => {
    try {
      await api.unlinkParticipantFromProgram(programId, participantId);
      showToast('Program dilepaskan dari peserta.');
      await loadDatabase();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal melepaskan program.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingRecord) return;
    setDeleting(true);
    try {
      await api.deleteParticipantRecord(deletingRecord.id);
      if (viewingRecord?.id === deletingRecord.id) {
        setViewingRecord(null);
      }
      setDeletingRecord(null);
      showToast('Data peserta berhasil dihapus.');
      await loadDatabase();
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menghapus data peserta.');
    } finally {
      setDeleting(false);
    }
  };

  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importingDb, setImportingDb] = useState<boolean>(false);

  const handleDownloadParticipantDatabaseExcel = () => {
    try {
      const exportRows = records.map((rec) => {
        const involvementsStr = getResolvedInvolvements(rec)
          .map(
            (inv) =>
              `${inv.programName || inv.programId} (${
                Array.isArray(inv.rolesInProgram) && inv.rolesInProgram.length > 0
                  ? inv.rolesInProgram.join(', ')
                  : inv.roleInProgram || 'Peserta'
              })`
          )
          .join('; ');

        if (rec.participantType === 'INDIVIDU') {
          return {
            'ID Peserta': rec.participantCode,
            'Jenis Peserta': 'INDIVIDU',
            'Nama Peserta / Kelompok': rec.fullName,
            'Organisasi / Kategori': rec.organizationInstitution || '',
            'Wilayah / Komunitas': rec.regionCommunity || '',
            'Kelompok Usia': rec.ageGroup || 'Dewasa (31–59 tahun)',
            'Jenis Kelamin': rec.gender || 'Laki-laki',
            Disabilitas: rec.disability || 'Tidak',
            'Keterangan Disabilitas': rec.disabilityNotes || '',
            'Peran Komunitas / Program':
              Array.isArray(rec.communityRoles) && rec.communityRoles.length > 0
                ? rec.communityRoles.join(', ')
                : rec.communityRole || 'Masyarakat Umum',
            'Penanggung Jawab / Kontak': '',
            'Anak Laki-laki': 0,
            'Anak Perempuan': 0,
            'Remaja Laki-laki': 0,
            'Remaja Perempuan': 0,
            'Pemuda Laki-laki': 0,
            'Pemuda Perempuan': 0,
            'Dewasa Laki-laki': 0,
            'Dewasa Perempuan': 0,
            'Lansia Laki-laki': 0,
            'Lansia Perempuan': 0,
            'Total Anggota': 1,
            'Program & Peran': involvementsStr,
          };
        }

        const comp = rec.memberComposition || createEmptyComposition();
        const totals = getMatrixTotals(comp);
        return {
          'ID Peserta': rec.participantCode,
          'Jenis Peserta': 'KELOMPOK/ORGANISASI',
          'Nama Peserta / Kelompok': rec.groupName,
          'Organisasi / Kategori': rec.groupCategory || 'Komunitas',
          'Wilayah / Komunitas': rec.regionCommunity || '',
          'Kelompok Usia': '',
          'Jenis Kelamin': '',
          Disabilitas: '',
          'Keterangan Disabilitas': '',
          'Peran Komunitas / Program':
            Array.isArray(rec.programRoles) && rec.programRoles.length > 0
              ? rec.programRoles.join(', ')
              : rec.programRole || 'Peserta',
          'Penanggung Jawab / Kontak': rec.contactPerson || '',
          'Anak Laki-laki': Number(comp.anak?.lakiLaki) || 0,
          'Anak Perempuan': Number(comp.anak?.perempuan) || 0,
          'Remaja Laki-laki': Number(comp.remaja?.lakiLaki) || 0,
          'Remaja Perempuan': Number(comp.remaja?.perempuan) || 0,
          'Pemuda Laki-laki': Number(comp.pemuda?.lakiLaki) || 0,
          'Pemuda Perempuan': Number(comp.pemuda?.perempuan) || 0,
          'Dewasa Laki-laki': Number(comp.dewasa?.lakiLaki) || 0,
          'Dewasa Perempuan': Number(comp.dewasa?.perempuan) || 0,
          'Lansia Laki-laki': Number(comp.lansia?.lakiLaki) || 0,
          'Lansia Perempuan': Number(comp.lansia?.perempuan) || 0,
          'Total Anggota': totals.grandTotal || rec.totalMembers || 0,
          'Program & Peran': involvementsStr,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Database Peserta');
      const todaySlug = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `Database_Peserta_WIJNA_${todaySlug}.xlsx`);
      showToast('Database Peserta berhasil diunduh (.xlsx).');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengunduh Database Peserta.');
    }
  };

  const handleImportParticipantDatabaseFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportingDb(true);
    setErrorMessage(null);
    try {
      let rawRows: Record<string, any>[] = [];
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        rawRows = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.records)
          ? parsed.records
          : [];
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, {
          defval: '',
        });
      }

      if (!rawRows || rawRows.length === 0) {
        setErrorMessage('File yang diimpor tidak memiliki baris data peserta.');
        return;
      }

      let importedCount = 0;
      for (const row of rawRows) {
        const rawCode = String(
          row['ID Peserta'] || row['ID'] || row['participantCode'] || ''
        ).trim();
        const rawType = String(
          row['Jenis Peserta'] || row['JENIS'] || row['participantType'] || ''
        )
          .trim()
          .toUpperCase();
        const isGroup =
          rawType.includes('KELOMPOK') ||
          rawType.includes('ORGANISASI') ||
          rawCode.toUpperCase().startsWith('GRP') ||
          rawCode.toUpperCase().startsWith('KLP') ||
          Boolean(row['groupName']);

        const nameVal = String(
          row['Nama Peserta / Kelompok'] ||
            row['NAMA PESERTA & PERAN'] ||
            row['Nama Peserta'] ||
            row['fullName'] ||
            row['groupName'] ||
            ''
        ).trim();

        if (!nameVal) continue;

        const regionVal = String(
          row['Wilayah / Komunitas'] ||
            row['WILAYAH/KOMUNITAS'] ||
            row['regionCommunity'] ||
            ''
        ).trim();

        // Parse Program & Peran if present
        let involvements: ParticipantProgramInvolvement[] = [];
        if (Array.isArray(row.programInvolvements)) {
          involvements = row.programInvolvements;
        } else {
          const progRaw = String(row['Program & Peran'] || row['PROGRAM & PERAN'] || '').trim();
          if (progRaw) {
            const parts = progRaw
              .split(';')
              .map((s) => s.trim())
              .filter(Boolean);
            for (const part of parts) {
              const matchParen = part.match(/^(.*?)\s*\((.*?)\)$/);
              const pName = (matchParen ? matchParen[1] : part).trim();
              const rolesStr = (matchParen ? matchParen[2] : 'Peserta').trim();
              const matchedProg =
                programsList.find(
                  (p) =>
                    p.name.toLowerCase() === pName.toLowerCase() ||
                    p.code?.toLowerCase() === pName.toLowerCase() ||
                    p.name.toLowerCase().includes(pName.toLowerCase())
                ) || programsList[0];
              if (matchedProg) {
                const rList = rolesStr
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean);
                involvements.push({
                  programId: matchedProg.id,
                  programCode: matchedProg.code,
                  programName: matchedProg.name,
                  rolesInProgram: rList.length > 0 ? rList : ['Peserta'],
                  roleInProgram: rList.length > 0 ? rList.join(', ') : 'Peserta',
                  joinedAt: new Date().toISOString().slice(0, 10),
                });
              }
            }
          }
        }

        const existingMatch = records.find((r) => {
          if (rawCode && r.participantCode.toLowerCase() === rawCode.toLowerCase()) {
            return true;
          }
          if (isGroup && r.participantType === 'KELOMPOK/ORGANISASI') {
            return r.groupName.trim().toLowerCase() === nameVal.toLowerCase();
          }
          if (!isGroup && r.participantType === 'INDIVIDU') {
            return r.fullName.trim().toLowerCase() === nameVal.toLowerCase();
          }
          return false;
        });

        if (!isGroup) {
          const rolesStr = String(
            row['Peran Komunitas / Program'] || row['communityRole'] || 'Masyarakat Umum'
          ).trim();
          const rolesArr = rolesStr
            .split(',')
            .map((s) => s.trim() as MasterCommunityRole)
            .filter(Boolean);
          const payload: Partial<MasterParticipantRecord> = {
            participantType: 'INDIVIDU',
            fullName: nameVal,
            organizationInstitution: String(
              row['Organisasi / Kategori'] || row['organizationInstitution'] || ''
            ).trim(),
            ageGroup: (row['Kelompok Usia'] ||
              row['ageGroup'] ||
              'Dewasa (31–59 tahun)') as MasterParticipantAgeGroup,
            gender: (row['Jenis Kelamin'] ||
              row['gender'] ||
              'Laki-laki') as MasterParticipantGender,
            disability: (row['Disabilitas'] ||
              row['disability'] ||
              'Tidak') as MasterDisabilityStatus,
            disabilityNotes: String(
              row['Keterangan Disabilitas'] || row['disabilityNotes'] || ''
            ).trim(),
            communityRole: rolesArr.join(', ') || 'Masyarakat Umum',
            communityRoles: rolesArr.length > 0 ? rolesArr : ['Masyarakat Umum'],
            regionCommunity: regionVal,
            programInvolvements:
              involvements.length > 0
                ? involvements
                : existingMatch?.programInvolvements || [],
          };

          if (existingMatch) {
            await api.updateParticipantRecord(existingMatch.id, payload);
          } else {
            await api.createParticipantRecord(payload);
          }
          importedCount += 1;
        } else {
          const comp: GroupMemberCompositionMatrix = row.memberComposition
            ? row.memberComposition
            : {
                anak: {
                  lakiLaki: Number(row['Anak Laki-laki']) || 0,
                  perempuan: Number(row['Anak Perempuan']) || 0,
                  lainnya: 0,
                  memilihTidakMenjawab: 0,
                },
                remaja: {
                  lakiLaki: Number(row['Remaja Laki-laki']) || 0,
                  perempuan: Number(row['Remaja Perempuan']) || 0,
                  lainnya: 0,
                  memilihTidakMenjawab: 0,
                },
                pemuda: {
                  lakiLaki: Number(row['Pemuda Laki-laki']) || 0,
                  perempuan: Number(row['Pemuda Perempuan']) || 0,
                  lainnya: 0,
                  memilihTidakMenjawab: 0,
                },
                dewasa: {
                  lakiLaki: Number(row['Dewasa Laki-laki']) || 0,
                  perempuan: Number(row['Dewasa Perempuan']) || 0,
                  lainnya: 0,
                  memilihTidakMenjawab: 0,
                },
                lansia: {
                  lakiLaki: Number(row['Lansia Laki-laki']) || 0,
                  perempuan: Number(row['Lansia Perempuan']) || 0,
                  lainnya: 0,
                  memilihTidakMenjawab: 0,
                },
              };
          const matrixTotals = getMatrixTotals(comp);
          const fallbackTotal = Number(row['Total Anggota'] || row['totalMembers']) || 0;
          if (matrixTotals.grandTotal === 0 && fallbackTotal > 0) {
            comp.dewasa.lakiLaki = Math.floor(fallbackTotal / 2);
            comp.dewasa.perempuan = fallbackTotal - comp.dewasa.lakiLaki;
          }
          const finalTotals = getMatrixTotals(comp);
          const rolesStr = String(
            row['Peran Komunitas / Program'] || row['programRole'] || 'Peserta'
          ).trim();
          const rolesArr = rolesStr
            .split(',')
            .map((s) => s.trim() as MasterGroupProgramRole)
            .filter(Boolean);

          const payload: Partial<MasterParticipantRecord> = {
            participantType: 'KELOMPOK/ORGANISASI',
            groupName: nameVal,
            groupCategory: (row['Organisasi / Kategori'] ||
              row['groupCategory'] ||
              'Komunitas') as MasterGroupCategory,
            regionCommunity: regionVal,
            contactPerson: String(
              row['Penanggung Jawab / Kontak'] || row['contactPerson'] || ''
            ).trim(),
            programRole: rolesArr.join(', ') || 'Peserta',
            programRoles: rolesArr.length > 0 ? rolesArr : ['Peserta'],
            memberComposition: comp,
            totalMembers: finalTotals.grandTotal,
            programInvolvements:
              involvements.length > 0
                ? involvements
                : existingMatch?.programInvolvements || [],
          };

          if (existingMatch) {
            await api.updateParticipantRecord(existingMatch.id, payload);
          } else {
            await api.createParticipantRecord(payload);
          }
          importedCount += 1;
        }
      }

      await loadDatabase();
      showToast(`Berhasil mengimpor ${importedCount} data peserta ke database.`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengimpor file Database Peserta.');
    } finally {
      setImportingDb(false);
    }
  };

  const activeFormMatrixTotals = useMemo(
    () => getMatrixTotals(memberComposition),
    [memberComposition]
  );

  const hasActiveFilters =
    Boolean(searchQuery) ||
    filterType !== 'ALL' ||
    filterProgramId !== 'ALL' ||
    filterRegion !== 'ALL' ||
    filterAgeGroup !== 'ALL' ||
    filterGender !== 'ALL';

  return (
    <div className="space-y-3">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-[#1F2937] text-white px-3.5 py-2.5 rounded-md shadow-lg border border-[#374151] text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-500 hover:text-red-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Unified Proportional Summary, Filter Toolbar & Table */}
      <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
        {/* Slim Header: Proportional Summary Metrics + Action Buttons */}
        <div className="px-3.5 py-2 border-b border-[#EFEFED] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#F7F7F5] border border-[#E5E5E3]">
              <UserCheck className="w-3 h-3 text-[#2563EB] shrink-0" />
              <span className="text-[#6B6B68]">Individu:</span>
              <span className="font-bold text-[#252525] tabular-nums">
                {summaryStats.totalIndividu}
              </span>
            </div>

            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#F7F7F5] border border-[#E5E5E3]">
              <Building2 className="w-3 h-3 text-[#0F7B6C] shrink-0" />
              <span className="text-[#6B6B68]">Kelompok/Organisasi:</span>
              <span className="font-bold text-[#252525] tabular-nums">
                {summaryStats.totalKelompok}
              </span>
            </div>

            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#F7F7F5] border border-[#E5E5E3]">
              <Users className="w-3 h-3 text-amber-700 shrink-0" />
              <span className="text-[#6B6B68]">Anggota Kelompok:</span>
              <span className="font-bold text-[#252525] tabular-nums">
                {summaryStats.totalAnggotaKelompok}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <input
              ref={importFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.json"
              onChange={handleImportParticipantDatabaseFile}
              className="hidden"
            />

            <button
              type="button"
              onClick={handleDownloadParticipantDatabaseExcel}
              className="h-7 inline-flex items-center justify-center gap-1.5 px-2.5 rounded border border-[#D9D9D6] bg-white hover:bg-[#FAFAF9] text-[#252525] text-[11.5px] font-medium transition-colors cursor-pointer"
              title="Unduh seluruh Database Peserta ke file Excel (.xlsx)"
            >
              <Download className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
              <span>Unduh Database (.xlsx)</span>
            </button>

            <button
              type="button"
              disabled={importingDb}
              onClick={() => importFileInputRef.current?.click()}
              className="h-7 inline-flex items-center justify-center gap-1.5 px-2.5 rounded border border-[#2B6E3F] bg-[#2B6E3F] hover:bg-[#235A33] text-white text-[11.5px] font-medium transition-colors cursor-pointer"
              title="Import data peserta dari file Database Excel (.xlsx / .csv / .json) yang sudah ada"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>{importingDb ? 'Mengimpor...' : 'Import Database'}</span>
            </button>

            {canViewAuditTrail && (
              <button
                type="button"
                onClick={() => setShowAuditTrail((prev) => !prev)}
                className={`h-7 inline-flex items-center justify-center gap-1.5 px-2.5 rounded border text-[11.5px] font-medium transition-colors cursor-pointer ${
                  showAuditTrail
                    ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]'
                    : 'bg-white border-[#D9D9D6] text-[#475569] hover:bg-[#FAFAF9]'
                }`}
                title={showAuditTrail ? 'Sembunyikan Audit Trail' : 'Tampilkan Audit Trail'}
              >
                <History className="w-3.5 h-3.5 shrink-0" />
                <span>Audit Trail ({auditLogs.length})</span>
                {showAuditTrail ? (
                  <ChevronUp className="w-3 h-3 shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 shrink-0" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenAddModal}
              className="h-7 inline-flex items-center justify-center gap-1 px-2.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11.5px] font-medium transition-colors shrink-0 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Tambah Peserta</span>
            </button>
          </div>
        </div>

        {/* Proportional Search & Filter Bar (No Truncated Dropdown Labels) */}
        <div className="px-3.5 py-2 bg-[#FAFAF9] border-b border-[#E5E5E3]">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Search by Name */}
            <div className="relative flex-1 min-w-[170px]">
              <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama atau kode peserta..."
                className="w-full h-7 pl-7 pr-2.5 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            {/* Filter Program */}
            <select
              value={filterProgramId}
              onChange={(e) => setFilterProgramId(e.target.value)}
              className="h-7 px-2 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB] text-[#252525] max-w-[180px] truncate"
              aria-label="Filter Program"
            >
              <option value="ALL">Semua Program</option>
              {programsList.map((prog) => (
                <option key={prog.id} value={prog.id}>
                  {prog.name}
                </option>
              ))}
            </select>

            {/* Filter Jenis Peserta */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="h-7 px-2 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB] text-[#252525]"
              aria-label="Filter Jenis Peserta"
            >
              <option value="ALL">Semua Jenis Peserta</option>
              <option value="INDIVIDU">Individu</option>
              <option value="KELOMPOK/ORGANISASI">Kelompok/Organisasi</option>
            </select>

            {/* Filter Wilayah/Komunitas */}
            <select
              value={filterRegion}
              onChange={(e) => setFilterRegion(e.target.value)}
              className="h-7 px-2 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB] text-[#252525]"
              aria-label="Filter Wilayah/Komunitas"
            >
              <option value="ALL">Semua Wilayah/Komunitas</option>
              {regionOptions.map((reg) => (
                <option key={reg} value={reg}>
                  {reg}
                </option>
              ))}
            </select>

            {/* Filter Kelompok Usia */}
            <select
              value={filterAgeGroup}
              onChange={(e) => setFilterAgeGroup(e.target.value)}
              className="h-7 px-2 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB] text-[#252525]"
              aria-label="Filter Kelompok Usia"
            >
              <option value="ALL">Semua Kelompok Usia</option>
              {AGE_GROUP_OPTIONS.map((age) => (
                <option key={age} value={age}>
                  {age}
                </option>
              ))}
            </select>

            {/* Filter Jenis Kelamin */}
            <select
              value={filterGender}
              onChange={(e) => setFilterGender(e.target.value)}
              className="h-7 px-2 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB] text-[#252525]"
              aria-label="Filter Jenis Kelamin"
            >
              <option value="ALL">Semua Jenis Kelamin</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFilterType('ALL');
                  setFilterProgramId('ALL');
                  setFilterRegion('ALL');
                  setFilterAgeGroup('ALL');
                  setFilterGender('ALL');
                }}
                className="h-7 px-2 text-[11px] text-[#2563EB] hover:bg-blue-50 rounded font-medium cursor-pointer shrink-0"
              >
                Reset ({filteredRecords.length}/{records.length})
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="py-5 px-4 text-center text-xs text-[#787774]">
            Memuat Database Peserta...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-5 px-4 text-center">
            <p className="text-xs text-[#6B6B68]">
              {records.length === 0
                ? 'Belum ada data peserta terdaftar.'
                : 'Tidak ada data yang sesuai filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase tracking-wider">
                  <th className="py-2.5 px-3.5">ID</th>
                  <th className="py-2.5 px-3.5">Nama Peserta & Peran</th>
                  <th className="py-2.5 px-3.5">Jenis</th>
                  <th className="py-2.5 px-3.5">Wilayah/Komunitas</th>
                  <th className="py-2.5 px-3.5">Demografi / Komposisi</th>
                  <th className="py-2.5 px-3.5">Program & Peran</th>
                  <th className="py-2.5 px-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEFED] text-xs">
                {filteredRecords.map((rec) => {
                  const isIndividu = rec.participantType === 'INDIVIDU';
                  const grpTotals = !isIndividu ? getMatrixTotals(rec.memberComposition) : null;
                  const involvements = getResolvedInvolvements(rec);

                  return (
                    <tr key={rec.id} className="hover:bg-[#FAFAF9] transition-colors">
                      <td className="py-2.5 px-3.5 font-mono font-semibold text-[#252525] whitespace-nowrap">
                        {rec.participantCode}
                      </td>
                      <td className="py-2.5 px-3.5">
                        {isIndividu ? (
                          <div>
                            <div className="font-semibold text-[#252525]">{rec.fullName}</div>
                            <div className="text-[11px] text-[#6B6B68]">
                              {rec.organizationInstitution
                                ? `${rec.organizationInstitution} • `
                                : ''}
                              Peran:{' '}
                              {formatRolesDisplay(
                                rec.communityRoles,
                                rec.communityRole,
                                rec.communityRoleNotes
                              )}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-[#252525]">{rec.groupName}</div>
                            <div className="text-[11px] text-[#6B6B68]">
                              {rec.groupCategory === 'Lainnya' && rec.groupCategoryNotes
                                ? rec.groupCategoryNotes
                                : rec.groupCategory}
                              {rec.contactPerson ? ` • PJ: ${rec.contactPerson}` : ''}
                              {' • Peran: '}
                              {formatRolesDisplay(
                                rec.programRoles,
                                rec.programRole,
                                rec.programRoleNotes
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        {isIndividu ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            Individu
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                            Kelompok/Organisasi
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 text-[#37352F]">
                        {rec.regionCommunity || <span className="text-[#9B9A97]">-</span>}
                      </td>
                      <td className="py-2.5 px-3.5 text-[#37352F]">
                        {isIndividu ? (
                          <div>
                            {rec.gender === 'Lainnya' || rec.gender === 'Memilih tidak menjawab' ? (
                              <span className="font-medium text-[#5A5A58]">
                                {rec.gender} (Tanpa Umur)
                              </span>
                            ) : (
                              <>
                                <span>{rec.gender}</span> • <span>{rec.ageGroup}</span>
                              </>
                            )}
                            {rec.disability === 'Ya' && (
                              <span className="text-[#6B6B68]">
                                {' '}
                                • Disabilitas
                                {rec.disabilityNotes ? ` (${rec.disabilityNotes})` : ''}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span className="font-semibold text-[#252525]">
                              {grpTotals?.grandTotal ?? 0} Anggota
                            </span>{' '}
                            <span className="text-[#6B6B68]">
                              (L:{grpTotals?.lakiLaki ?? 0} P:{grpTotals?.perempuan ?? 0}
                              {(grpTotals?.lainnya ?? 0) + (grpTotals?.memilihTidakMenjawab ?? 0) > 0
                                ? ` Lainnya:${(grpTotals?.lainnya ?? 0) + (grpTotals?.memilihTidakMenjawab ?? 0)}`
                                : ''}
                              )
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {involvements.map((inv) => (
                            <span
                              key={inv.programId}
                              className="inline-flex items-center gap-1 max-w-[230px] truncate px-2 py-0.5 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[11px] text-[#37352F]"
                              title={`${inv.programName}${
                                inv.roleInProgram ? ` (${inv.roleInProgram})` : ''
                              }`}
                            >
                              <span className="truncate font-medium">{inv.programName}</span>
                              {inv.roleInProgram && (
                                <span className="text-[#2563EB] shrink-0">
                                  • {inv.roleInProgram}
                                </span>
                              )}
                            </span>
                          ))}
                          {programsList.length > 0 && (
                            <button
                              type="button"
                              onClick={() => handleOpenQuickLinkModal(rec)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[#2563EB] hover:bg-blue-50 border border-blue-200 cursor-pointer"
                            >
                              <FolderGit2 className="w-3 h-3" />
                              <span>
                                {involvements.length === 0 ? '+ Pilih Program' : 'Atur'}
                              </span>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setViewingRecord(rec)}
                            title="Detail"
                            className="p-1 rounded text-[#5A5A58] hover:text-[#252525] hover:bg-[#EFEFEA] cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(rec)}
                            title="Edit"
                            className="p-1 rounded text-[#5A5A58] hover:text-[#2563EB] hover:bg-blue-50 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingRecord(rec)}
                            title="Hapus"
                            className="p-1 rounded text-[#5A5A58] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* AUDIT TRAIL DATA PESERTA (PEOPLE WE REACH & SERVE) - HIDE & SHOW      */}
      {/* ===================================================================== */}
      {canViewAuditTrail && (
      <div className="bg-white border border-[#E5E5E3] rounded-lg overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowAuditTrail((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowAuditTrail((prev) => !prev);
            }
          }}
          className={`px-3.5 py-2.5 bg-[#FAFAF9] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 cursor-pointer select-none transition-colors hover:bg-[#F4F4F2] ${
            showAuditTrail ? 'border-b border-[#E5E5E3]' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-[#252525]">
                Audit Trail Data Peserta (People We Reach & Serve)
              </h3>
              <span className="text-[11px] text-[#6B6B68] hidden md:inline">
                • Rekam jejak otomatis penambahan, pembaruan, penautan program, dan penghapusan
              </span>
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {showAuditTrail && (
              <>
                <div className="relative">
                  <Search className="w-3 h-3 text-[#787774] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={auditSearchQuery}
                    onChange={(e) => setAuditSearchQuery(e.target.value)}
                    placeholder="Cari di audit trail..."
                    className="h-7 pl-7 pr-2 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB] w-40"
                  />
                </div>

                <select
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  className="h-7 px-2 text-[11.5px] border border-[#D9D9D6] rounded bg-white focus:outline-none focus:border-[#2563EB] text-[#252525]"
                  aria-label="Filter Jenis Aksi Audit"
                >
                  <option value="ALL">Semua Aktivitas</option>
                  <option value="TAMBAH">Tambah Data Peserta</option>
                  <option value="PERBARUI">Perbarui Data Peserta</option>
                  <option value="PROGRAM">Keterlibatan Program</option>
                  <option value="HAPUS">Hapus Data Peserta</option>
                </select>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowAuditTrail((prev) => !prev)}
              className="h-7 inline-flex items-center gap-1 px-2.5 rounded border border-[#D9D9D6] bg-white hover:bg-[#F7F7F5] text-[11px] font-medium text-[#37352F] cursor-pointer"
            >
              <span>{showAuditTrail ? 'Sembunyikan' : 'Tampilkan'}</span>
              {showAuditTrail ? (
                <ChevronUp className="w-3.5 h-3.5 text-[#6B6B68]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[#6B6B68]" />
              )}
            </button>
          </div>
        </div>

        {showAuditTrail &&
          (() => {
            const q = auditSearchQuery.trim().toLowerCase();
            const filteredAuditLogs = auditLogs.filter((log) => {
              const actUpper = (log.action || '').toUpperCase();
              if (auditActionFilter === 'TAMBAH' && !actUpper.includes('TAMBAH')) return false;
              if (auditActionFilter === 'PERBARUI' && !actUpper.includes('PERBARUI')) return false;
              if (
                auditActionFilter === 'PROGRAM' &&
                !actUpper.includes('HUBUNGKAN') &&
                !actUpper.includes('LEPASKAN')
              )
                return false;
              if (auditActionFilter === 'HAPUS' && !actUpper.includes('HAPUS')) return false;

              if (q) {
                const hay = `${log.actorName} ${log.actorRole} ${log.action} ${log.details}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });

            if (filteredAuditLogs.length === 0) {
              return (
                <div className="py-4 px-4 text-center text-xs text-[#6B6B68]">
                  {auditLogs.length === 0
                    ? 'Belum ada riwayat aktivitas pada Database Peserta.'
                    : 'Tidak ada catatan audit trail yang sesuai filter.'}
                </div>
              );
            }

            return (
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#F7F7F5] border-b border-[#E5E5E3] text-[11px] font-semibold text-[#6B6B68] uppercase tracking-wider sticky top-0">
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Waktu</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Pelaku & Jabatan</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Aksi</th>
                      <th className="py-2.5 px-3.5">Rincian Perubahan Data Peserta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFED] text-xs">
                    {filteredAuditLogs.map((log) => {
                      const actUpper = (log.action || '').toUpperCase();
                      let badgeStyle =
                        'bg-[#F4F4F2] text-[#37352F] border-[#E5E5E3]';
                      if (actUpper.includes('TAMBAH')) {
                        badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                      } else if (actUpper.includes('PERBARUI')) {
                        badgeStyle = 'bg-blue-50 text-blue-700 border-blue-200';
                      } else if (actUpper.includes('HAPUS')) {
                        badgeStyle = 'bg-red-50 text-red-700 border-red-200';
                      } else if (actUpper.includes('HUBUNGKAN') || actUpper.includes('LEPASKAN')) {
                        badgeStyle = 'bg-amber-50 text-amber-800 border-amber-200';
                      }

                      const formattedTime = (() => {
                        try {
                          const d = new Date(log.timestamp);
                          return d.toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                        } catch {
                          return log.timestamp;
                        }
                      })();

                      return (
                        <tr key={log.id} className="hover:bg-[#FAFAF9] transition-colors">
                          <td className="py-2.5 px-3.5 whitespace-nowrap text-[#5A5A58] font-mono text-[11px]">
                            <div className="inline-flex items-center gap-1.5">
                              <Clock className="w-3 h-3 text-[#9B9A97]" />
                              <span>{formattedTime}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <div className="font-semibold text-[#252525]">{log.actorName}</div>
                            <div className="text-[11px] text-[#6B6B68]">{log.actorRole}</div>
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${badgeStyle}`}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-[#37352F]">{log.details}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
      </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL TAMBAH / EDIT PESERTA                                           */}
      {/* ===================================================================== */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-[#E5E5E3] flex items-center justify-between bg-[#FAFAF9]">
              <h2 className="text-sm font-bold text-[#252525]">
                {editingRecord
                  ? `Edit Peserta (${editingRecord.participantCode})`
                  : 'Tambah Peserta'}
              </h2>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                className="p-1 rounded text-[#787774] hover:text-[#252525] hover:bg-[#EFEFEA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveParticipant} className="p-5 overflow-y-auto space-y-4 flex-1">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs font-medium">
                  {formError}
                </div>
              )}

              {/* Pemilih Jenis Peserta */}
              <div>
                <label className="block text-xs font-semibold text-[#37352F] mb-1.5">
                  Jenis Peserta <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={Boolean(editingRecord)}
                    onClick={() => setSelectedType('INDIVIDU')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border text-left transition-all ${
                      selectedType === 'INDIVIDU'
                        ? 'border-[#2563EB] bg-blue-50/60 text-[#1D4ED8] font-bold'
                        : 'border-[#D9D9D6] hover:border-[#9B9A97] bg-white text-[#252525] font-medium'
                    } ${editingRecord ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <UserCheck className="w-4 h-4 shrink-0" />
                    <span className="text-xs">1. INDIVIDU</span>
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(editingRecord)}
                    onClick={() => setSelectedType('KELOMPOK/ORGANISASI')}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border text-left transition-all ${
                      selectedType === 'KELOMPOK/ORGANISASI'
                        ? 'border-[#0F7B6C] bg-teal-50/60 text-[#0F7B6C] font-bold'
                        : 'border-[#D9D9D6] hover:border-[#9B9A97] bg-white text-[#252525] font-medium'
                    } ${editingRecord ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span className="text-xs">2. KELOMPOK/ORGANISASI</span>
                  </button>
                </div>
              </div>

              {/* A. FORM DATA PESERTA INDIVIDU */}
              {selectedType === 'INDIVIDU' && (
                <div className="space-y-3.5 pt-3 border-t border-[#EFEFED]">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        ID Peserta
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={
                          editingRecord && editingRecord.participantType === 'INDIVIDU'
                            ? editingRecord.participantCode
                            : nextIndividualCode
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#F4F4F2] border border-[#D9D9D6] rounded text-[#5A5A58]"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Nama Lengkap <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Nama lengkap peserta"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Organisasi/Institusi (Opsional)
                      </label>
                      <input
                        type="text"
                        value={organizationInstitution}
                        onChange={(e) => setOrganizationInstitution(e.target.value)}
                        placeholder="Nama organisasi/institusi"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Wilayah/Komunitas
                      </label>
                      <input
                        type="text"
                        value={indRegionCommunity}
                        onChange={(e) => setIndRegionCommunity(e.target.value)}
                        placeholder="Wilayah atau komunitas"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Jenis Kelamin
                      </label>
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value as MasterParticipantGender)}
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                      >
                        {GENDER_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Kelompok Usia (L/P)
                      </label>
                      {gender === 'Lainnya' || gender === 'Memilih tidak menjawab' ? (
                        <input
                          type="text"
                          readOnly
                          value="Tanpa Umur (Lainnya)"
                          className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-[#F4F4F2] text-[#787774]"
                        />
                      ) : (
                        <select
                          value={ageGroup}
                          onChange={(e) => setAgeGroup(e.target.value as MasterParticipantAgeGroup)}
                          className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                        >
                          {AGE_GROUP_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Disabilitas
                      </label>
                      <select
                        value={disability}
                        onChange={(e) => setDisability(e.target.value as MasterDisabilityStatus)}
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                      >
                        {DISABILITY_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {disability === 'Ya' && (
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Keterangan Disabilitas (Opsional)
                      </label>
                      <input
                        type="text"
                        value={disabilityNotes}
                        onChange={(e) => setDisabilityNotes(e.target.value)}
                        placeholder="Keterangan disabilitas"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded"
                      />
                    </div>
                  )}

                  {/* Peran Komunitas — Multi-select (bisa lebih dari satu) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#37352F]">
                        Peran dalam Komunitas (Bisa pilih lebih dari satu)
                      </label>
                      <span className="text-[11px] text-[#6B6B68]">
                        {communityRoles.length} peran dipilih
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {COMMUNITY_ROLE_OPTIONS.map((roleOpt) => {
                        const active = communityRoles.includes(roleOpt);
                        return (
                          <button
                            key={roleOpt}
                            type="button"
                            onClick={() => handleToggleCommunityRole(roleOpt)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs transition-colors cursor-pointer ${
                              active
                                ? 'bg-blue-50 border-[#2563EB] text-[#1D4ED8] font-semibold'
                                : 'bg-white border-[#D9D9D6] text-[#37352F] hover:bg-[#FAFAF9]'
                            }`}
                          >
                            <div
                              className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                                active
                                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                                  : 'bg-white border-[#D9D9D6]'
                              }`}
                            >
                              {active && <Check className="w-2.5 h-2.5" />}
                            </div>
                            <span>{roleOpt}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {communityRoles.includes('Lainnya') && (
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Keterangan Peran Lainnya
                      </label>
                      <input
                        type="text"
                        value={communityRoleNotes}
                        onChange={(e) => setCommunityRoleNotes(e.target.value)}
                        placeholder="Tuliskan peran lainnya"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* B. FORM DATA KELOMPOK/ORGANISASI */}
              {selectedType === 'KELOMPOK/ORGANISASI' && (
                <div className="space-y-3.5 pt-3 border-t border-[#EFEFED]">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        ID Kelompok
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={
                          editingRecord &&
                          editingRecord.participantType === 'KELOMPOK/ORGANISASI'
                            ? editingRecord.participantCode
                            : nextGroupCode
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#F4F4F2] border border-[#D9D9D6] rounded text-[#5A5A58]"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Nama Kelompok/Organisasi <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        placeholder="Nama kelompok atau organisasi"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded focus:outline-none focus:border-[#0F7B6C]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Jenis Kelompok
                      </label>
                      <select
                        value={groupCategory}
                        onChange={(e) => setGroupCategory(e.target.value as MasterGroupCategory)}
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded bg-white"
                      >
                        {GROUP_CATEGORY_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Wilayah/Komunitas
                      </label>
                      <input
                        type="text"
                        value={grpRegionCommunity}
                        onChange={(e) => setGrpRegionCommunity(e.target.value)}
                        placeholder="Wilayah/komunitas"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Kontak / PJ
                      </label>
                      <input
                        type="text"
                        value={contactPerson}
                        onChange={(e) => setContactPerson(e.target.value)}
                        placeholder="Nama / No. HP"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded"
                      />
                    </div>
                  </div>

                  {groupCategory === 'Lainnya' && (
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Keterangan Jenis Kelompok
                      </label>
                      <input
                        type="text"
                        value={groupCategoryNotes}
                        onChange={(e) => setGroupCategoryNotes(e.target.value)}
                        placeholder="Tuliskan jenis kelompok lainnya"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded"
                      />
                    </div>
                  )}

                  {/* Peran dalam Program — Multi-select (bisa lebih dari satu) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#37352F]">
                        Peran Kelompok dalam Program (Bisa pilih lebih dari satu)
                      </label>
                      <span className="text-[11px] text-[#6B6B68]">
                        {programRoles.length} peran dipilih
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {GROUP_PROGRAM_ROLE_OPTIONS.map((roleOpt) => {
                        const active = programRoles.includes(roleOpt);
                        return (
                          <button
                            key={roleOpt}
                            type="button"
                            onClick={() => handleToggleGroupProgramRole(roleOpt)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs transition-colors cursor-pointer ${
                              active
                                ? 'bg-teal-50 border-[#0F7B6C] text-[#0F7B6C] font-semibold'
                                : 'bg-white border-[#D9D9D6] text-[#37352F] hover:bg-[#FAFAF9]'
                            }`}
                          >
                            <div
                              className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                                active
                                  ? 'bg-[#0F7B6C] border-[#0F7B6C] text-white'
                                  : 'bg-white border-[#D9D9D6]'
                              }`}
                            >
                              {active && <Check className="w-2.5 h-2.5" />}
                            </div>
                            <span>{roleOpt}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {programRoles.includes('Lainnya') && (
                    <div>
                      <label className="block text-xs font-medium text-[#37352F] mb-1">
                        Keterangan Peran Lainnya
                      </label>
                      <input
                        type="text"
                        value={programRoleNotes}
                        onChange={(e) => setProgramRoleNotes(e.target.value)}
                        placeholder="Tuliskan peran lainnya"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9D9D6] rounded"
                      />
                    </div>
                  )}

                  {/* Komposisi Anggota Kelompok */}
                  <div className="space-y-2 pt-2 border-t border-[#EFEFED]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#37352F]">
                        Komposisi Anggota Kelompok
                      </span>
                      <span className="px-2.5 py-0.5 rounded bg-teal-50 border border-teal-200 text-xs font-bold text-teal-800">
                        Total Anggota: {activeFormMatrixTotals.grandTotal}
                      </span>
                    </div>

                    <div className="overflow-x-auto border border-[#D9D9D6] rounded">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-[#F7F7F5] border-b border-[#D9D9D6] text-[#37352F] font-semibold">
                            <th className="py-1.5 px-2.5 border-r border-[#E5E5E3]">
                              Kelompok Usia (Laki-laki & Perempuan)
                            </th>
                            <th className="py-1.5 px-2 text-center border-r border-[#E5E5E3]">
                              Laki-laki
                            </th>
                            <th className="py-1.5 px-2 text-center border-r border-[#E5E5E3]">
                              Perempuan
                            </th>
                            <th className="py-1.5 px-2.5 text-center bg-[#EFEFED] font-bold">
                              Total Usia (L+P)
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E5E5E3]">
                          {COMPOSITION_ROWS.map((row) => {
                            const cell = memberComposition[row.key];
                            const rowTotal = getRowTotal(cell);
                            return (
                              <tr key={row.key}>
                                <td className="py-1.5 px-2.5 font-medium text-[#252525] border-r border-[#E5E5E3] whitespace-nowrap">
                                  {row.label}
                                </td>
                                {(['lakiLaki', 'perempuan'] as const).map((colKey) => (
                                  <td
                                    key={colKey}
                                    className="p-1 border-r border-[#E5E5E3] text-center"
                                  >
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={cell[colKey]}
                                      onChange={(e) =>
                                        handleCompositionCellChange(
                                          row.key,
                                          colKey,
                                          e.target.value
                                        )
                                      }
                                      className="w-20 px-1.5 py-1 text-center text-xs font-mono border border-[#D9D9D6] rounded bg-white"
                                    />
                                  </td>
                                ))}
                                <td className="py-1.5 px-2.5 text-center font-mono font-bold text-[#252525] bg-[#F7F7F5]">
                                  {rowTotal}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-[#FAFAF9]">
                            <td
                              colSpan={3}
                              className="py-1.5 px-2.5 font-medium text-[#5A5A58] border-r border-[#E5E5E3]"
                            >
                              Lainnya (Tanpa Kelompok Usia)
                            </td>
                            <td className="p-1 text-center bg-[#F7F7F5]">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={
                                  activeFormMatrixTotals.lainnya +
                                  activeFormMatrixTotals.memilihTidakMenjawab
                                }
                                onChange={(e) => handleLainnyaWithoutAgeChange(e.target.value)}
                                className="w-20 px-1.5 py-1 text-center text-xs font-mono border border-[#D9D9D6] rounded bg-white"
                              />
                            </td>
                          </tr>
                        </tbody>
                        <tfoot>
                          <tr className="bg-[#EFEFED] border-t border-[#D9D9D6] font-bold text-[#252525]">
                            <td className="py-1.5 px-2.5 border-r border-[#D9D9D6]">TOTAL</td>
                            <td className="py-1.5 px-2 text-center font-mono border-r border-[#D9D9D6]">
                              {activeFormMatrixTotals.lakiLaki}
                            </td>
                            <td className="py-1.5 px-2 text-center font-mono border-r border-[#D9D9D6]">
                              {activeFormMatrixTotals.perempuan}
                            </td>
                            <td className="py-1.5 px-2.5 text-center font-mono text-teal-800 bg-teal-50">
                              {activeFormMatrixTotals.grandTotal}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* PILIH PROGRAM & PERAN DI PROGRAM (BISA LEBIH DARI SATU) */}
              {selectedType && programsList.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-[#EFEFED]">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[#37352F]">
                      Program yang Diikuti & Peran (Bisa pilih lebih dari satu)
                    </label>
                    <span className="text-[11px] font-medium text-[#6B6B68]">
                      {formProgramInvolvements.length} program dipilih
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-52 overflow-y-auto p-2 rounded border border-[#E5E5E3] bg-[#FAFAF9]">
                    {programsList.map((prog) => {
                      const inv = formProgramInvolvements.find((i) => i.programId === prog.id);
                      const checked = Boolean(inv);
                      const selectedProgRoles =
                        inv?.rolesInProgram && inv.rolesInProgram.length > 0
                          ? inv.rolesInProgram
                          : inv?.roleInProgram
                          ? inv.roleInProgram
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                          : [];

                      return (
                        <div
                          key={prog.id}
                          className={`rounded border transition-colors ${
                            checked
                              ? 'bg-blue-50/50 border-[#2563EB]'
                              : 'bg-white border-[#E5E5E3] hover:border-[#D9D9D6]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleToggleFormProgram(prog)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs cursor-pointer"
                          >
                            <div
                              className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                                checked
                                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                                  : 'bg-white border-[#D9D9D6]'
                              }`}
                            >
                              {checked && <Check className="w-3 h-3" />}
                            </div>
                            <span
                              className={`truncate ${
                                checked ? 'text-[#1D4ED8] font-semibold' : 'text-[#37352F]'
                              }`}
                            >
                              {prog.name}
                            </span>
                          </button>

                          {checked && (
                            <div className="px-2.5 pb-2 pt-1 border-t border-blue-100 flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] text-[#6B6B68] mr-1">
                                Peran (bisa &gt;1):
                              </span>
                              {INVOLVEMENT_ROLE_OPTIONS.map((rName) => {
                                const roleChecked = selectedProgRoles.includes(rName);
                                return (
                                  <button
                                    key={rName}
                                    type="button"
                                    onClick={() => handleToggleFormProgramRole(prog.id, rName)}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                                      roleChecked
                                        ? 'bg-[#2563EB] text-white border-[#2563EB] font-medium'
                                        : 'bg-white text-[#5A5A58] border-[#D9D9D6] hover:bg-blue-50'
                                    }`}
                                  >
                                    {roleChecked && <Check className="w-2.5 h-2.5" />}
                                    <span>{rName}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-3 border-t border-[#E5E5E3] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-3.5 py-1.5 rounded border border-[#D9D9D6] text-xs font-semibold text-[#5A5A58] hover:bg-[#F4F4F2] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={!selectedType || submitting}
                  className="px-4 py-1.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL PILIH PROGRAM & PERAN CEPAT (BISA LEBIH DARI SATU)              */}
      {/* ===================================================================== */}
      {linkingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E5E5E3] flex items-center justify-between bg-[#FAFAF9]">
              <h3 className="text-xs font-bold text-[#252525]">
                Atur Program & Peran —{' '}
                {linkingRecord.participantType === 'INDIVIDU'
                  ? linkingRecord.fullName
                  : linkingRecord.groupName}
              </h3>
              <button
                type="button"
                onClick={() => setLinkingRecord(null)}
                className="p-1 rounded text-[#787774] hover:text-[#252525] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuickPrograms} className="p-4 space-y-3 text-xs">
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {programsList.map((prog) => {
                  const inv = quickInvolvements.find((i) => i.programId === prog.id);
                  const checked = Boolean(inv);
                  const selectedProgRoles =
                    inv?.rolesInProgram && inv.rolesInProgram.length > 0
                      ? inv.rolesInProgram
                      : inv?.roleInProgram
                      ? inv.roleInProgram
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : [];

                  return (
                    <div
                      key={prog.id}
                      className={`rounded border transition-colors ${
                        checked
                          ? 'bg-blue-50/50 border-[#2563EB]'
                          : 'bg-white border-[#E5E5E3] hover:bg-[#FAFAF9]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleQuickProgram(prog)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer"
                      >
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                            checked
                              ? 'bg-[#2563EB] border-[#2563EB] text-white'
                              : 'bg-white border-[#D9D9D6]'
                          }`}
                        >
                          {checked && <Check className="w-3 h-3" />}
                        </div>
                        <span
                          className={`truncate ${
                            checked ? 'text-[#1D4ED8] font-semibold' : 'text-[#37352F]'
                          }`}
                        >
                          {prog.name}
                        </span>
                      </button>

                      {checked && (
                        <div className="px-3 pb-2.5 pt-1.5 border-t border-blue-100 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-[#6B6B68] mr-1">
                            Peran (bisa &gt;1):
                          </span>
                          {INVOLVEMENT_ROLE_OPTIONS.map((rName) => {
                            const roleChecked = selectedProgRoles.includes(rName);
                            return (
                              <button
                                key={rName}
                                type="button"
                                onClick={() => handleToggleQuickProgramRole(prog.id, rName)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                                  roleChecked
                                    ? 'bg-[#2563EB] text-white border-[#2563EB] font-medium'
                                    : 'bg-white text-[#5A5A58] border-[#D9D9D6] hover:bg-blue-50'
                                }`}
                              >
                                {roleChecked && <Check className="w-2.5 h-2.5" />}
                                <span>{rName}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#EFEFED]">
                <span className="text-[11px] text-[#6B6B68]">
                  {quickInvolvements.length} program dipilih
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLinkingRecord(null)}
                    className="px-3 py-1.5 rounded border border-[#D9D9D6] font-semibold text-[#5A5A58] hover:bg-[#F4F4F2] cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={linkingSubmitting}
                    className="px-3.5 py-1.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white font-semibold cursor-pointer"
                  >
                    {linkingSubmitting ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL LIHAT DETAIL PESERTA                                            */}
      {/* ===================================================================== */}
      {viewingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E5E3] flex items-center justify-between bg-[#FAFAF9]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#EFEFED] text-[#252525]">
                  {viewingRecord.participantCode}
                </span>
                <span className="text-xs font-bold text-[#252525]">
                  {viewingRecord.participantType === 'INDIVIDU'
                    ? viewingRecord.fullName
                    : viewingRecord.groupName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingRecord(null)}
                className="p-1 rounded text-[#787774] hover:text-[#252525] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {viewingRecord.participantType === 'INDIVIDU' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-[#FAFAF9] p-3.5 rounded border border-[#EFEFED]">
                  <div>
                    <div className="text-[#6B6B68]">Jenis Peserta</div>
                    <div className="font-semibold text-[#252525]">Individu</div>
                  </div>
                  <div>
                    <div className="text-[#6B6B68]">Kelompok Usia</div>
                    <div className="font-semibold text-[#252525]">
                      {viewingRecord.gender === 'Lainnya' ||
                      viewingRecord.gender === 'Memilih tidak menjawab'
                        ? 'Tanpa Umur (Lainnya)'
                        : viewingRecord.ageGroup}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#6B6B68]">Jenis Kelamin</div>
                    <div className="font-semibold text-[#252525]">{viewingRecord.gender}</div>
                  </div>
                  <div>
                    <div className="text-[#6B6B68]">Disabilitas</div>
                    <div className="font-semibold text-[#252525]">
                      {viewingRecord.disability}
                      {viewingRecord.disability === 'Ya' && viewingRecord.disabilityNotes
                        ? ` (${viewingRecord.disabilityNotes})`
                        : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#6B6B68]">Wilayah/Komunitas</div>
                    <div className="font-semibold text-[#252525]">
                      {viewingRecord.regionCommunity || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#6B6B68]">Organisasi/Institusi</div>
                    <div className="font-semibold text-[#252525]">
                      {viewingRecord.organizationInstitution || '-'}
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <div className="text-[#6B6B68]">Peran dalam Komunitas</div>
                    <div className="font-semibold text-[#252525]">
                      {formatRolesDisplay(
                        viewingRecord.communityRoles,
                        viewingRecord.communityRole,
                        viewingRecord.communityRoleNotes
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 bg-[#FAFAF9] p-3.5 rounded border border-[#EFEFED]">
                    <div>
                      <div className="text-[#6B6B68]">Jenis Kelompok</div>
                      <div className="font-semibold text-[#252525]">
                        {viewingRecord.groupCategory === 'Lainnya' &&
                        viewingRecord.groupCategoryNotes
                          ? viewingRecord.groupCategoryNotes
                          : viewingRecord.groupCategory}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6B68]">Wilayah/Komunitas</div>
                      <div className="font-semibold text-[#252525]">
                        {viewingRecord.regionCommunity || '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6B68]">Kontak / PJ</div>
                      <div className="font-semibold text-[#252525]">
                        {viewingRecord.contactPerson || '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6B6B68]">Peran dalam Program</div>
                      <div className="font-semibold text-[#252525]">
                        {formatRolesDisplay(
                          viewingRecord.programRoles,
                          viewingRecord.programRole,
                          viewingRecord.programRoleNotes
                        )}
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const detailTotals = getMatrixTotals(viewingRecord.memberComposition);
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#37352F]">
                            Komposisi Anggota Kelompok
                          </span>
                          <span className="font-bold text-teal-800">
                            Total: {detailTotals.grandTotal} Anggota
                          </span>
                        </div>
                        <div className="overflow-x-auto border border-[#D9D9D6] rounded">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#F7F7F5] border-b border-[#D9D9D6] text-[#37352F] font-semibold">
                                <th className="py-1.5 px-2.5 border-r border-[#E5E5E3]">
                                  Kelompok Usia (L & P)
                                </th>
                                <th className="py-1.5 px-2 text-center border-r border-[#E5E5E3]">
                                  Laki-laki
                                </th>
                                <th className="py-1.5 px-2 text-center border-r border-[#E5E5E3]">
                                  Perempuan
                                </th>
                                <th className="py-1.5 px-2.5 text-center bg-[#EFEFED] font-bold">
                                  Total Usia (L+P)
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E5E5E3]">
                              {COMPOSITION_ROWS.map((r) => {
                                const cell = viewingRecord.memberComposition?.[r.key] || {
                                  lakiLaki: 0,
                                  perempuan: 0,
                                  lainnya: 0,
                                  memilihTidakMenjawab: 0,
                                };
                                const rTotal = getRowTotal(cell);
                                return (
                                  <tr key={r.key}>
                                    <td className="py-1.5 px-2.5 font-medium text-[#252525] border-r border-[#E5E5E3]">
                                      {r.label}
                                    </td>
                                    <td className="py-1.5 px-2 text-center font-mono border-r border-[#E5E5E3]">
                                      {cell.lakiLaki}
                                    </td>
                                    <td className="py-1.5 px-2 text-center font-mono border-r border-[#E5E5E3]">
                                      {cell.perempuan}
                                    </td>
                                    <td className="py-1.5 px-2.5 text-center font-mono font-bold bg-[#F7F7F5]">
                                      {rTotal}
                                    </td>
                                  </tr>
                                );
                              })}
                              <tr className="bg-[#FAFAF9]">
                                <td
                                  colSpan={3}
                                  className="py-1.5 px-2.5 font-medium text-[#5A5A58] border-r border-[#E5E5E3]"
                                >
                                  Lainnya (Tanpa Kelompok Usia)
                                </td>
                                <td className="py-1.5 px-2.5 text-center font-mono font-bold bg-[#F7F7F5]">
                                  {detailTotals.lainnya + detailTotals.memilihTidakMenjawab}
                                </td>
                              </tr>
                            </tbody>
                            <tfoot>
                              <tr className="bg-[#EFEFED] border-t border-[#D9D9D6] font-bold text-[#252525]">
                                <td className="py-1.5 px-2.5 border-r border-[#D9D9D6]">TOTAL</td>
                                <td className="py-1.5 px-2 text-center font-mono border-r border-[#D9D9D6]">
                                  {detailTotals.lakiLaki}
                                </td>
                                <td className="py-1.5 px-2 text-center font-mono border-r border-[#D9D9D6]">
                                  {detailTotals.perempuan}
                                </td>
                                <td className="py-1.5 px-2.5 text-center font-mono text-teal-800 bg-teal-50">
                                  {detailTotals.grandTotal}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Program yang Diikuti & Peran */}
              {(() => {
                const detailInvolvements = getResolvedInvolvements(viewingRecord);
                return (
                  <div className="space-y-2 pt-2 border-t border-[#EFEFED]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#37352F]">
                        Program yang Diikuti ({detailInvolvements.length})
                      </span>
                      {programsList.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleOpenQuickLinkModal(viewingRecord)}
                          className="text-[#2563EB] hover:underline font-semibold cursor-pointer"
                        >
                          + Pilih / Atur Program & Peran
                        </button>
                      )}
                    </div>

                    {detailInvolvements.length === 0 ? (
                      <div className="text-[#787774] italic">Belum ada program yang dipilih.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {detailInvolvements.map((inv) => (
                          <span
                            key={inv.programId}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#F4F4F2] border border-[#E5E5E3] text-[#252525] font-medium"
                          >
                            <span>{inv.programName}</span>
                            {inv.roleInProgram && (
                              <span className="text-[#2563EB] font-semibold">
                                ({inv.roleInProgram})
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                handleUnlinkFromProgram(viewingRecord.id, inv.programId)
                              }
                              className="text-[#787774] hover:text-red-600 cursor-pointer"
                              title="Lepaskan program"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-3 border-t border-[#E5E5E3] bg-[#FAFAF9] flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const target = viewingRecord;
                  setViewingRecord(null);
                  setDeletingRecord(target);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingRecord;
                    setViewingRecord(null);
                    handleOpenEditModal(target);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewingRecord(null)}
                  className="px-3 py-1.5 rounded border border-[#D9D9D6] text-xs font-semibold text-[#5A5A58] hover:bg-[#EFEFEA] cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL KONFIRMASI HAPUS DATA                                           */}
      {/* ===================================================================== */}
      {deletingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#252525]">Hapus Data Peserta?</h3>
                <p className="text-xs text-[#6B6B68] mt-1">
                  Hapus{' '}
                  <strong>
                    [{deletingRecord.participantCode}]{' '}
                    {deletingRecord.participantType === 'INDIVIDU'
                      ? deletingRecord.fullName
                      : deletingRecord.groupName}
                  </strong>{' '}
                  dari Database Peserta?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EFEFED]">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeletingRecord(null)}
                className="px-3 py-1.5 rounded border border-[#D9D9D6] text-xs font-semibold text-[#5A5A58] hover:bg-[#F4F4F2] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                {deleting ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
