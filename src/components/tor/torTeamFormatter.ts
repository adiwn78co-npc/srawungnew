import { TorRoleItem } from '../../types/index.js';

export interface TorTeamSummarySource {
  rolesResponsibilities?: TorRoleItem[] | null;
  implementingTeam?: string[] | null;
  organizerPersonInCharge?: string | null;
}

const LEGACY_ORGANIZER_LINE_PATTERNS: RegExp[] = [
  /^penyelenggara\s*:/i,
  /^penanggung\s*jawab/i,
  /^pic\s*utama/i,
  /^pembuat\s*dokumen/i,
  /^koordinasi\s*tor/i,
  /^organizer\b/i,
  /^person\s*in\s*charge/i,
  /^(tim\s*pelaksana(\s*&\s*peran|\s*wilayah)?|pembagian\s*peran\s*tim)\s*:?\s*$/i,
  /^\(belum ada rincian tim pelaksana\)$/i,
];

/**
 * Menghasilkan daftar tim pelaksana secara langsung tanpa keterangan
 * "Organizer & Person in Charge", "Penyelenggara", maupun "Penanggung Jawab Utama (PIC)".
 */
export function formatTorTeamSummary(
  source?: TorTeamSummarySource | null,
  emptyFallback = '-'
): string {
  if (!source) return emptyFallback;

  const roles = Array.isArray(source.rolesResponsibilities)
    ? source.rolesResponsibilities.filter(
        (r) =>
          Boolean(r?.nameInstitution?.trim()) ||
          Boolean(r?.picName?.trim()) ||
          Boolean(r?.role?.trim())
      )
    : [];

  if (roles.length > 0) {
    return roles
      .map((r, idx) => {
        const namePart =
          r.nameInstitution?.trim() ||
          (r.institution?.trim()
            ? `${(r.picName || '').trim()} — ${r.institution.trim()}`
            : (r.picName || '').trim());
        const rolePart = (r.role || '').trim();
        if (namePart && rolePart) {
          return `${idx + 1}. ${namePart} — ${rolePart}`;
        }
        return `${idx + 1}. ${namePart || rolePart}`;
      })
      .join('\n');
  }

  const teamMembers = Array.isArray(source.implementingTeam)
    ? source.implementingTeam.map((m) => (m || '').trim()).filter(Boolean)
    : [];

  if (teamMembers.length > 0) {
    return teamMembers.map((member, idx) => `${idx + 1}. ${member}`).join('\n');
  }

  const rawText = (source.organizerPersonInCharge || '').trim();
  const hasForeign = /PIPKA|GKMI|air purifier/i.test(rawText);
  if (rawText && !hasForeign) {
    const cleanedLines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !LEGACY_ORGANIZER_LINE_PATTERNS.some((re) => re.test(line)))
      .map((line) => line.replace(/^tim\s*pelaksana\s*:\s*/i, '').trim())
      .filter((line) => Boolean(line) && line !== '-');

    if (cleanedLines.length > 0) {
      return cleanedLines.join('\n');
    }
  }

  return emptyFallback;
}
