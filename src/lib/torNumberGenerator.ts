// Utilitas Generator Nomor TOR Otomatis WIJNA
// Format Standar: TOR/[Nomor Urut]/WIJNA/[Kode Program]/[Kode Outcome].[Kode Output].[Nomor Activity]/[Bulan Romawi]/[Tahun]
// Contoh Resmi: TOR/001/WIJNA/PET/1.2.3/X/2026

export const ROMAN_MONTHS: Record<number, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
  9: 'IX',
  10: 'X',
  11: 'XI',
  12: 'XII',
};

/**
 * Konversi bulan (1-12) atau objek Date ke angka Romawi (I - XII)
 */
export function getRomanMonth(dateInput?: Date | string | number): string {
  if (typeof dateInput === 'number') {
    return ROMAN_MONTHS[dateInput] || 'I';
  }
  const date = dateInput ? new Date(dateInput) : new Date();
  const month = isNaN(date.getTime()) ? new Date().getMonth() + 1 : date.getMonth() + 1;
  return ROMAN_MONTHS[month] || 'I';
}

/**
 * Hasilkan Kode Program dari huruf pertama setiap kata dalam nama program, menggunakan huruf kapital.
 * Contoh: "Peace Education Training" -> "PET"
 * Contoh: "Program Air Lestari & Kesehatan Lingkungan 2026" -> "PALKL"
 */
export function generateProgramCode(programName?: string, explicitCode?: string): string {
  if (explicitCode && explicitCode.trim()) {
    return explicitCode.trim().toUpperCase();
  }
  if (!programName || !programName.trim()) {
    return '';
  }

  // Pisahkan berdasarkan spasi atau pemisah kata
  const words = programName.trim().split(/[\s\-_/]+/);
  const codeChars: string[] = [];

  for (const word of words) {
    // Ambil karakter alfanumerik pertama
    const cleanWord = word.replace(/[^a-zA-Z0-9]/g, '');
    if (cleanWord.length > 0) {
      // Abaikan angka murni 4 digit seperti tahun (misal 2026) kecuali jika tidak ada kata lain
      if (/^\d{4}$/.test(cleanWord) && codeChars.length > 0) {
        continue;
      }
      codeChars.push(cleanWord[0].toUpperCase());
    }
  }

  return codeChars.join('');
}

export interface HierarchyResolutionParams {
  programId?: string;
  outcomeId?: string;
  outputId?: string;
  activityId?: string;
  programs?: Array<{ id: string; name: string; code?: string }>;
  outcomes?: Array<{ id: string; programId: string; name?: string }>;
  outputs?: Array<{ id: string; outcomeId: string; name?: string }>;
  activities?: Array<{ id: string; outputId: string; name?: string }>;
}

/**
 * Menghitung kode hierarki [Kode Outcome].[Kode Output].[Nomor Activity]
 * Contoh: Outcome 1, Output 2, Activity 3 -> "1.2.3"
 */
export function computeHierarchyCode(params: HierarchyResolutionParams): {
  outcomeNum: number | null;
  outputNum: number | null;
  activityNum: number | null;
  hierarchyCode: string;
  isComplete: boolean;
} {
  const {
    programId,
    outcomeId,
    outputId,
    activityId,
    outcomes = [],
    outputs = [],
    activities = [],
  } = params;

  let outcomeNum: number | null = null;
  let outputNum: number | null = null;
  let activityNum: number | null = null;

  if (outcomeId) {
    const progOutcomes = outcomes.filter((o) => !programId || o.programId === programId);
    const idx = progOutcomes.findIndex((o) => o.id === outcomeId);
    if (idx >= 0) {
      outcomeNum = idx + 1;
    } else {
      const match = outcomeId.match(/(\d+)$/);
      outcomeNum = match ? parseInt(match[1], 10) : 1;
    }
  }

  if (outputId) {
    const outOutputs = outputs.filter((op) => !outcomeId || op.outcomeId === outcomeId);
    const idx = outOutputs.findIndex((op) => op.id === outputId);
    if (idx >= 0) {
      outputNum = idx + 1;
    } else {
      const match = outputId.match(/(\d+)$/);
      outputNum = match ? parseInt(match[1], 10) : 1;
    }
  }

  if (activityId) {
    const outpActs = activities.filter((a) => !outputId || a.outputId === outputId);
    const idx = outpActs.findIndex((a) => a.id === activityId);
    if (idx >= 0) {
      activityNum = idx + 1;
    } else {
      const match = activityId.match(/(\d+)$/);
      activityNum = match ? parseInt(match[1], 10) : 1;
    }
  }

  const isComplete = Boolean(outcomeNum !== null && outputNum !== null && activityNum !== null);
  const outcomePart = outcomeNum !== null ? String(outcomeNum) : '[Outcome]';
  const outputPart = outputNum !== null ? String(outputNum) : '[Output]';
  const actPart = activityNum !== null ? String(activityNum) : '[Activity]';

  const hierarchyCode = `${outcomePart}.${outputPart}.${actPart}`;

  return {
    outcomeNum,
    outputNum,
    activityNum,
    hierarchyCode,
    isComplete,
  };
}

/**
 * Buat string lengkap nomor TOR WIJNA
 * Format: TOR/[Nomor Urut]/WIJNA/[Kode Program]/[Kode Outcome].[Kode Output].[Nomor Activity]/[Bulan Romawi]/[Tahun]
 * Contoh: TOR/001/WIJNA/PET/1.2.3/X/2026
 */
export function formatTorNumber(params: {
  sequence: number | string;
  programCode: string;
  hierarchyCode: string;
  romanMonth: string;
  year: number | string;
}): string {
  const seqPadded =
    typeof params.sequence === 'number'
      ? String(params.sequence).padStart(3, '0')
      : String(params.sequence).padStart(3, '0');

  const prog = params.programCode.trim() || 'PROG';
  const hier = params.hierarchyCode.trim() || '1.1.1';
  const month = params.romanMonth.trim() || 'I';
  const yr = String(params.year).trim() || new Date().getFullYear().toString();

  return `TOR/${seqPadded}/WIJNA/${prog}/${hier}/${month}/${yr}`;
}

export interface TorNumberPreviewResult {
  previewNumber: string;
  isComplete: boolean;
  statusMessage: string;
  sequenceStr: string;
  programCode: string;
  hierarchyCode: string;
  romanMonth: string;
  year: string;
}

/**
 * Menghasilkan pratinjau nomor TOR untuk formulir atau draft
 * Jika Program, Outcome, Output, atau Activity belum dipilih, tampilkan status bahwa nomor TOR belum lengkap
 */
export function getTorDraftPreview(params: {
  programName?: string;
  explicitProgramCode?: string;
  programId?: string;
  outcomeId?: string;
  outputId?: string;
  activityId?: string;
  outcomes?: Array<{ id: string; programId: string; name?: string }>;
  outputs?: Array<{ id: string; outcomeId: string; name?: string }>;
  activities?: Array<{ id: string; outputId: string; name?: string }>;
  sequence?: number | string;
  date?: Date | string;
}): TorNumberPreviewResult {
  const d = params.date ? new Date(params.date) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const romanMonth = getRomanMonth(validDate);
  const year = validDate.getFullYear().toString();
  const sequenceStr = params.sequence
    ? String(params.sequence).padStart(3, '0')
    : '001';

  const programCode = generateProgramCode(params.programName, params.explicitProgramCode);
  const { hierarchyCode, isComplete: isHierarchyComplete, outcomeNum, outputNum, activityNum } =
    computeHierarchyCode({
      programId: params.programId,
      outcomeId: params.outcomeId,
      outputId: params.outputId,
      activityId: params.activityId,
      outcomes: params.outcomes,
      outputs: params.outputs,
      activities: params.activities,
    });

  const hasProgram = Boolean(programCode && programCode.length > 0);

  if (!hasProgram && !isHierarchyComplete) {
    return {
      previewNumber: `TOR/${sequenceStr}/WIJNA/[Kode Program]/[Outcome].[Output].[Activity]/${romanMonth}/${year}`,
      isComplete: false,
      statusMessage: 'Nomor TOR belum lengkap: Pilih Program, Outcome, Output, dan Activity',
      sequenceStr,
      programCode: '',
      hierarchyCode: '[Outcome].[Output].[Activity]',
      romanMonth,
      year,
    };
  }

  if (!hasProgram) {
    return {
      previewNumber: `TOR/${sequenceStr}/WIJNA/[Kode Program]/${hierarchyCode}/${romanMonth}/${year}`,
      isComplete: false,
      statusMessage: 'Nomor TOR belum lengkap: Silakan pilih Program Induk',
      sequenceStr,
      programCode: '',
      hierarchyCode,
      romanMonth,
      year,
    };
  }

  if (!isHierarchyComplete) {
    const missing: string[] = [];
    if (!outcomeNum) missing.push('Outcome');
    if (!outputNum) missing.push('Output');
    if (!activityNum) missing.push('Activity');

    return {
      previewNumber: `TOR/${sequenceStr}/WIJNA/${programCode}/${hierarchyCode}/${romanMonth}/${year}`,
      isComplete: false,
      statusMessage: `Nomor TOR belum lengkap: Pilih ${missing.join(', ')}`,
      sequenceStr,
      programCode,
      hierarchyCode,
      romanMonth,
      year,
    };
  }

  const preview = formatTorNumber({
    sequence: sequenceStr,
    programCode,
    hierarchyCode,
    romanMonth,
    year,
  });

  return {
    previewNumber: preview,
    isComplete: true,
    statusMessage: 'Nomor TOR lengkap (Format Otomatis WIJNA)',
    sequenceStr,
    programCode,
    hierarchyCode,
    romanMonth,
    year,
  };
}
