import * as XLSX from 'xlsx';
import type {
  Activity,
  Indicator,
  Outcome,
  Output,
  Program,
  SubActivity,
} from '../types/index.ts';

export interface HierarchyExcelPreviewRow {
  rowNumber: number;
  outcomeNumber: string;
  outcomeName: string;
  outcomeDescription: string;
  outcomeIndicator: string;
  outcomeDataSource: string;
  outcomeCumulative: string;
  outcomePlannedBreakdown: string;
  outcomeReportingFrequency: string;
  outcomeBaseline: string;
  outcomeTarget: string;
  outcomeUnit: string;
  outputNumber: string;
  outputName: string;
  outputDescription: string;
  outputIndicator: string;
  outputDataSource: string;
  outputCumulative: string;
  outputPlannedBreakdown: string;
  outputReportingFrequency: string;
  outputBaseline: string;
  outputTarget: string;
  outputUnit: string;
  activityNumber: string;
  activityCode: string;
  activityName: string;
  activityDescription: string;
  activityAnticipatedInputs: string;
  activityPlannedParticipants: string;
  activityStartDate: string;
  activityEndDate: string;
  subActivityName: string;
  subActivityPic: string;
  status: 'valid' | 'duplicate' | 'invalid';
  statusMessage: string;
  isNewOutcome: boolean;
  isNewOutcomeIndicator: boolean;
  isNewOutput: boolean;
  isNewOutputIndicator: boolean;
  isNewActivity: boolean;
  isNewSubActivity: boolean;
}

export interface ParsedHierarchyWorkbookResult {
  sheetName: string;
  sheetCount: number;
  rawRowCount: number;
  headerMatched: boolean;
  detectedHeaders: string[];
  rows: HierarchyExcelPreviewRow[];
}

export interface HierarchyImportPlan {
  outcomesToUpsert: Outcome[];
  outputsToUpsert: Output[];
  activitiesToUpsert: Activity[];
  subActivitiesToUpsert: SubActivity[];
  createdOutcomesCount: number;
  updatedOutcomesCount: number;
  addedOutcomeIndicatorsCount: number;
  createdOutputsCount: number;
  updatedOutputsCount: number;
  addedOutputIndicatorsCount: number;
  createdActivitiesCount: number;
  updatedActivitiesCount: number;
  createdSubActivitiesCount: number;
  expandedOutcomeIds: string[];
  expandedOutputIds: string[];
}

const sanitizeCell = (val: unknown): string => {
  const str = String(val ?? '').trim();
  return str.replace(/^[=+\-@\t\r]+/, '').trim();
};

const normalizeDateStr = (val: string, fallback: string): string => {
  if (!val) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return fallback;
};

export const getCanonicalOcKey = (num: string, desc: string, fallbackName: string): string => {
  const cleanNum = (num || (fallbackName.match(/^(Outcome\s*[\d.]+)/i)?.[1] ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (cleanNum) return cleanNum;
  return (fallbackName || desc).trim().toLowerCase();
};

export const getCanonicalOpKey = (num: string, desc: string, fallbackName: string): string => {
  const cleanNum = (num || (fallbackName.match(/^(Output\s*[\d.]+)/i)?.[1] ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (cleanNum) return cleanNum;
  return (fallbackName || desc).trim().toLowerCase();
};

export const getCanonicalActKey = (num: string, actName: string): string => {
  const cleanNum = (num || (actName.match(/^(Activity\s*[\d.]+)/i)?.[1] ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const cleanTitle = actName
    .replace(/^Activity\s*[\d.]+\s*[:\-–]?\s*/i, '')
    .trim()
    .toLowerCase();
  if (cleanNum && cleanTitle) return `${cleanNum}__${cleanTitle}`;
  return cleanNum || cleanTitle || actName.trim().toLowerCase();
};

const HEADER_KEYWORD_REGEX =
  /^(nomor\s*outcome|no\.?\s*outcome|outcome\s*number|outcome\s*no|kode\s*outcome|outcome|nama\s*outcome|outcome\s*name|nomor\s*output|no\.?\s*output|output\s*number|output\s*no|kode\s*output|output|nama\s*output|output\s*name|activity|nama\s*activity|nama\s*kegiatan|activity\s*name|nomor\s*activity)$/i;

/**
 * Mendeteksi baris header aktual (mendukung file dengan judul di baris atas atau header 2 baris untuk Outcome vs Output)
 * lalu mengekstrak baris-baris objek dengan nama kolom yang telah dinormalisasi.
 */
function extractNormalizedRowsFromSheet(sheet: XLSX.WorkSheet): {
  headerRowNumber: number;
  headerMatched: boolean;
  detectedHeaders: string[];
  rows: Array<{ excelRowNumber: number; record: Record<string, string> }>;
} {
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
  });

  if (!Array.isArray(matrix) || matrix.length === 0) {
    return { headerRowNumber: 1, headerMatched: false, detectedHeaders: [], rows: [] };
  }

  let bestHeaderIdx = 0;
  let bestScore = 0;
  const maxScan = Math.min(matrix.length, 12);

  for (let rIdx = 0; rIdx < maxScan; rIdx++) {
    const rowCells = Array.isArray(matrix[rIdx]) ? matrix[rIdx] : [];
    let score = 0;
    for (const rawCell of rowCells) {
      const clean = String(rawCell ?? '').replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      if (HEADER_KEYWORD_REGEX.test(clean)) {
        score += 3;
      } else if (/^(description|deskripsi|progress\s*indicator|activity\s*description)$/i.test(clean)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestHeaderIdx = rIdx;
    }
  }

  const headerMatched = bestScore >= 3;
  const rawHeaderCells = Array.isArray(matrix[bestHeaderIdx]) ? matrix[bestHeaderIdx] : [];
  const parentGroupRow =
    bestHeaderIdx > 0 && Array.isArray(matrix[bestHeaderIdx - 1])
      ? matrix[bestHeaderIdx - 1]
      : [];

  // Disambiguasi kolom duplikat ketika grup kolom kanan berada di bawah bagian Output
  let passedOutputAnchor = false;
  let passedActivityAnchor = false;
  let activeGroupBanner = '';

  const normalizedHeaders: string[] = rawHeaderCells.map((cellVal, colIdx) => {
    const groupCell = String(parentGroupRow[colIdx] ?? '').replace(/\s+/g, ' ').trim();
    if (groupCell) {
      activeGroupBanner = groupCell.toLowerCase();
    }
    const baseHeader = String(cellVal ?? '').replace(/\s+/g, ' ').trim();
    if (!baseHeader) return `__EMPTY_${colIdx}`;

    if (/^(nomor\s*output|no\.?\s*output|output\s*number|output\s*no|kode\s*output|output|nama\s*output|output\s*name)$/i.test(baseHeader)) {
      passedOutputAnchor = true;
    }
    if (/^(activity|nama\s*activity|nama\s*kegiatan|activity\s*name|nomor\s*activity)$/i.test(baseHeader)) {
      passedActivityAnchor = true;
    }

    const inOutputSection =
      !passedActivityAnchor &&
      (passedOutputAnchor || /\boutput\b/i.test(activeGroupBanner));

    if (inOutputSection && !/\boutput\b/i.test(baseHeader)) {
      if (/^(description|deskripsi)$/i.test(baseHeader)) return 'Description Output';
      if (/^(progress\s*indicator|indikator)$/i.test(baseHeader)) return 'Progress indicator Output';
      if (/^(data\s*source|sumber\s*data)$/i.test(baseHeader)) return 'Data source Output';
      if (/^(cumulative\s*or\s*non-?cumulative|sifat\s*indikator)$/i.test(baseHeader)) {
        return 'Cumulative or non-cumulative Output';
      }
      if (/^(planned\s*data\s*breakdown|data\s*breakdown|disagregasi\s*data)$/i.test(baseHeader)) {
        return 'Planned data breakdown Output';
      }
      if (/^(reporting\s*frequency|frekuensi\s*pelaporan)$/i.test(baseHeader)) {
        return 'Reporting frequency Output';
      }
      if (/^baseline$/i.test(baseHeader)) return 'Baseline Output';
      if (/^(end\s*of\s*project\s*goal|target)$/i.test(baseHeader)) {
        return 'End of project goal Output';
      }
      if (/^(satuan|unit)$/i.test(baseHeader)) return 'Unit Output';
    }

    return baseHeader;
  });

  const usedHeaderNames = new Map<string, number>();
  const uniqueHeaders = normalizedHeaders.map((h) => {
    const count = usedHeaderNames.get(h) || 0;
    usedHeaderNames.set(h, count + 1);
    return count === 0 ? h : `${h}_${count}`;
  });

  const rows: Array<{ excelRowNumber: number; record: Record<string, string> }> = [];
  for (let rIdx = bestHeaderIdx + 1; rIdx < matrix.length && rows.length < 500; rIdx++) {
    const rowArr = Array.isArray(matrix[rIdx]) ? matrix[rIdx] : [];
    const record: Record<string, string> = {};
    let hasNonEmptyCell = false;
    for (let cIdx = 0; cIdx < uniqueHeaders.length; cIdx++) {
      const val = sanitizeCell(rowArr[cIdx]);
      if (val) hasNonEmptyCell = true;
      record[uniqueHeaders[cIdx]] = val;
    }
    if (hasNonEmptyCell) {
      rows.push({
        excelRowNumber: rIdx + 1,
        record,
      });
    }
  }

  return {
    headerRowNumber: bestHeaderIdx + 1,
    headerMatched,
    detectedHeaders: uniqueHeaders.filter((h) => !h.startsWith('__EMPTY')),
    rows,
  };
}

/**
 * Mem-parse buffer file Excel (.xlsx/.xls/.csv) menjadi baris preview & validasi Hirarki Program.
 * Dapat dijalankan secara identik di browser maupun di backend Node.js/Express.
 */
export function parseProgramHierarchyWorkbookBuffer(params: {
  buffer: ArrayBuffer | Uint8Array;
  program: Program;
  existingOutcomes: Outcome[];
  existingOutputs: Output[];
  existingActivities: Activity[];
  existingSubActivities: SubActivity[];
}): ParsedHierarchyWorkbookResult {
  const {
    buffer,
    program,
    existingOutcomes,
    existingOutputs,
    existingActivities,
    existingSubActivities,
  } = params;

  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (uint8.byteLength === 0) {
    throw new Error('File Excel kosong (0 byte).');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(uint8, { type: 'array' });
  } catch (err: any) {
    throw new Error(`Format workbook Excel rusak atau tidak dapat dibaca: ${err?.message || 'Unreadable workbook'}`);
  }

  if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    return {
      sheetName: '',
      sheetCount: 0,
      rawRowCount: 0,
      headerMatched: false,
      detectedHeaders: [],
      rows: [],
    };
  }

  // Prioritaskan sheet yang memiliki header hirarki valid
  const prioritizedSheetNames = [
    ...workbook.SheetNames.filter((n) =>
      /hirarki|hierarki|matriks|logframe|matrix|program|sheet1/i.test(n) &&
      !/rumus|panduan|guide|instruksi/i.test(n)
    ),
    ...workbook.SheetNames.filter(
      (n) =>
        !(
          /hirarki|hierarki|matriks|logframe|matrix|program|sheet1/i.test(n) &&
          !/rumus|panduan|guide|instruksi/i.test(n)
        )
    ),
  ];

  let chosenSheetName = prioritizedSheetNames[0];
  let extracted = extractNormalizedRowsFromSheet(workbook.Sheets[chosenSheetName]);

  if (!extracted.headerMatched) {
    for (const candidateName of prioritizedSheetNames.slice(1)) {
      const candidateExtracted = extractNormalizedRowsFromSheet(workbook.Sheets[candidateName]);
      if (candidateExtracted.headerMatched) {
        chosenSheetName = candidateName;
        extracted = candidateExtracted;
        break;
      }
    }
  }

  if (!extracted.headerMatched || extracted.rows.length === 0) {
    return {
      sheetName: chosenSheetName,
      sheetCount: workbook.SheetNames.length,
      rawRowCount: extracted.rows.length,
      headerMatched: extracted.headerMatched,
      detectedHeaders: extracted.detectedHeaders,
      rows: [],
    };
  }

  const progOutcomes = existingOutcomes.filter((o) => o.programId === program.id);
  const defaultStart = program.startDate || new Date().toISOString().slice(0, 10);
  const defaultEnd = program.endDate || defaultStart;

  const findCol = (row: Record<string, string>, pattern: RegExp): string => {
    const key = Object.keys(row).find((k) => pattern.test(k.trim()));
    return key ? sanitizeCell(row[key]) : '';
  };

  const outcomeOrder: string[] = progOutcomes.map((o) =>
    getCanonicalOcKey(o.outcomeNumber || '', o.description || '', o.name)
  );
  const outputOrderByOutcome = new Map<string, string[]>();
  const actCountByOutput = new Map<string, number>();

  progOutcomes.forEach((oc) => {
    const ocKey = getCanonicalOcKey(oc.outcomeNumber || '', oc.description || oc.name, oc.name);
    const ops = existingOutputs.filter((op) => op.outcomeId === oc.id);
    outputOrderByOutcome.set(
      ocKey,
      ops.map((op) => getCanonicalOpKey(op.outputNumber || '', op.description || '', op.name))
    );
    ops.forEach((op) => {
      const opNorm = getCanonicalOpKey(op.outputNumber || '', op.description || '', op.name);
      const opFullKey = `${ocKey}__${opNorm}`;
      const acts = existingActivities.filter((a) => a.outputId === op.id);
      actCountByOutput.set(opFullKey, acts.length);
    });
  });

  const existingOutcomeSet = new Set<string>();
  const existingOutcomeIndicatorSet = new Set<string>();
  const existingOutputSet = new Set<string>();
  const existingOutputIndicatorSet = new Set<string>();
  const existingActivitySet = new Set<string>();
  const existingSubSet = new Set<string>();

  progOutcomes.forEach((oc) => {
    const ocKey = getCanonicalOcKey(oc.outcomeNumber || '', oc.description || '', oc.name);
    existingOutcomeSet.add(ocKey);
    existingOutcomeSet.add(oc.name.trim().toLowerCase());
    if (oc.outcomeNumber) {
      existingOutcomeSet.add(oc.outcomeNumber.trim().toLowerCase());
    }
    (oc.indicators || []).forEach((ind) => {
      existingOutcomeIndicatorSet.add(`${ocKey}__${ind.name.trim().toLowerCase()}`);
    });

    existingOutputs
      .filter((op) => op.outcomeId === oc.id)
      .forEach((op) => {
        const opNorm = getCanonicalOpKey(op.outputNumber || '', op.description || '', op.name);
        const opKey = `${ocKey}__${opNorm}`;
        existingOutputSet.add(opKey);
        existingOutputSet.add(`${ocKey}__${op.name.trim().toLowerCase()}`);
        (op.indicators || []).forEach((ind) => {
          existingOutputIndicatorSet.add(`${opKey}__${ind.name.trim().toLowerCase()}`);
        });

        existingActivities
          .filter((a) => a.outputId === op.id)
          .forEach((act) => {
            const actNorm = getCanonicalActKey(act.activityNumber || '', act.name);
            const actKey = `${opKey}__${actNorm}`;
            existingActivitySet.add(actKey);
            existingActivitySet.add(`${opKey}__${act.name.trim().toLowerCase()}`);
            existingSubActivities
              .filter((s) => s.activityId === act.id)
              .forEach((sub) => {
                existingSubSet.add(`${actKey}__${sub.name.trim().toLowerCase()}`);
              });
          });
      });
  });

  const seenOutcomesInFile = new Set<string>();
  const seenOutcomeIndicatorsInFile = new Set<string>();
  const seenOutputsInFile = new Set<string>();
  const seenOutputIndicatorsInFile = new Set<string>();
  const seenActivitiesInFile = new Set<string>();
  const seenSubsInFile = new Set<string>();

  let lastOutcomeNumber = '';
  let lastOutcomeName = '';
  let lastOutcomeDesc = '';

  let lastOutputNumber = '';
  let lastOutputName = '';
  let lastOutputDesc = '';

  let lastActivityNumber = '';
  let lastActivityName = '';
  let lastActivityCode = '';
  let lastActivityDesc = '';
  let lastActivityAnticipatedInputs = '';
  let lastActivityPlannedParticipants = '';
  let lastActivityStart = defaultStart;
  let lastActivityEnd = defaultEnd;

  const previewRows: HierarchyExcelPreviewRow[] = [];

  extracted.rows.forEach(({ excelRowNumber, record: row }) => {
    const rawOcNum = findCol(
      row,
      /^(nomor\s*outcome|no\.?\s*outcome|outcome\s*number|outcome\s*no|kode\s*outcome)$/i
    );
    const rawOcLegacyName = findCol(row, /^(outcome|nama\s*outcome|outcome\s*name)$/i);
    const rawOcDesc = findCol(
      row,
      /^(description|deskripsi\s*outcome|outcome\s*description|deskripsi)$/i
    );

    const rawOcInd = findCol(
      row,
      /^(progress\s*indicator|indikator\s*outcome|outcome\s*indicator)$/i
    );
    const rawOcDataSource = findCol(
      row,
      /^(data\s*source|sumber\s*data|sumber\s*data\s*outcome)$/i
    );
    const rawOcCumulative = findCol(
      row,
      /^(cumulative\s*or\s*non-?cumulative|cumulative\s*outcome|sifat\s*indikator)$/i
    );
    const rawOcPlannedBreakdown = findCol(
      row,
      /^(planned\s*data\s*breakdown|data\s*breakdown|disagregasi\s*data)$/i
    );
    const rawOcReportingFreq = findCol(
      row,
      /^(reporting\s*frequency|frekuensi\s*pelaporan|frekuensi\s*outcome)$/i
    );
    const rawOcBase = findCol(
      row,
      /^(baseline|baseline\s*outcome|outcome\s*baseline)$/i
    );
    const rawOcTarget = findCol(
      row,
      /^(end\s*of\s*project\s*goal|target\s*outcome|outcome\s*target)$/i
    );
    const rawOcUnit = findCol(row, /^(satuan\s*outcome|unit\s*outcome|outcome\s*unit)$/i);

    const rawOpNum = findCol(
      row,
      /^(nomor\s*output|no\.?\s*output|output\s*number|output\s*no|kode\s*output)$/i
    );
    const rawOpLegacyName = findCol(row, /^(output|nama\s*output|output\s*name)$/i);
    const rawOpDesc = findCol(
      row,
      /^(description\s*output|deskripsi\s*output|output\s*description|description_1|deskripsi_1)$/i
    );
    const rawOpInd = findCol(
      row,
      /^(progress\s*indicator\s*output|indikator\s*output|output\s*indicator|progress\s*indicator_1)$/i
    );
    const rawOpDataSource = findCol(
      row,
      /^(data\s*source\s*output|sumber\s*data\s*output|data\s*source_1)$/i
    );
    const rawOpCumulative = findCol(
      row,
      /^(cumulative\s*or\s*non-?cumulative\s*output|cumulative\s*output|cumulative\s*or\s*non-?cumulative_1)$/i
    );
    const rawOpPlannedBreakdown = findCol(
      row,
      /^(planned\s*data\s*breakdown\s*output|data\s*breakdown\s*output|planned\s*data\s*breakdown_1)$/i
    );
    const rawOpReportingFreq = findCol(
      row,
      /^(reporting\s*frequency\s*output|frekuensi\s*output|reporting\s*frequency_1)$/i
    );
    const rawOpBase = findCol(row, /^(baseline\s*output|output\s*baseline|baseline_1)$/i);
    const rawOpTarget = findCol(
      row,
      /^(end\s*of\s*project\s*goal\s*output|target\s*output|output\s*target|end\s*of\s*project\s*goal_1)$/i
    );
    const rawOpUnit = findCol(row, /^(satuan\s*output|unit\s*output|output\s*unit)$/i);

    const rawActNum = findCol(
      row,
      /^(nomor\s*activity|no\.?\s*activity|activity\s*number|activity\s*no)$/i
    );
    const rawActCode = findCol(
      row,
      /^(kode\s*activity.*|kode\s*kegiatan|activity\s*code|budget\s*code|kode\s*anggaran|kode)$/i
    );
    const rawActName = findCol(
      row,
      /^(activity|nama\s*activity|nama\s*kegiatan|activity\s*name)$/i
    );
    const rawActDesc = findCol(
      row,
      /^(activity\s*description|deskripsi\s*activity|deskripsi\s*kegiatan)$/i
    );
    const rawActInputs = findCol(
      row,
      /^(anticipated\s*inputs?|input\s*kegiatan|kebutuhan\s*input)$/i
    );
    const rawActParticipants = findCol(
      row,
      /^(if\s*possible.*participants.*|planned\s*participants.*|participants\s*breakdown.*|target\s*peserta.*)$/i
    );
    const rawActStart = findCol(row, /^(tanggal\s*mulai.*|start\s*date|mulai)$/i);
    const rawActEnd = findCol(row, /^(tanggal\s*selesai.*|end\s*date|selesai)$/i);

    const rawSubName = findCol(row, /^(nama\s*sub.*|sub\s*activity|sub-activity|sub\s*kegiatan)$/i);
    const rawSubPic = findCol(row, /^(pic\s*sub.*|pic\s*activity|pic)$/i);

    if (
      !rawOcNum &&
      !rawOcLegacyName &&
      !rawOcDesc &&
      !rawOcInd &&
      !rawOpNum &&
      !rawOpLegacyName &&
      !rawOpDesc &&
      !rawOpInd &&
      !rawActName &&
      !rawSubName
    ) {
      return;
    }

    let currentOcNum = rawOcNum;
    let currentOcDesc = rawOcDesc;
    if (!currentOcNum && rawOcLegacyName) {
      const m = rawOcLegacyName.match(/^(Outcome\s*[\d.]+)\s*[:\-–]?\s*(.+)$/i);
      if (m) {
        currentOcNum = m[1].replace(/\s+/g, ' ').trim();
        if (!currentOcDesc) currentOcDesc = m[2].trim();
      }
    }

    const hasExplicitOutcomeInRow = Boolean(currentOcNum || currentOcDesc || rawOcLegacyName);
    const hasExplicitOutputInRow = Boolean(rawOpNum || rawOpDesc || rawOpLegacyName);

    if (hasExplicitOutcomeInRow) {
      const nextNum = currentOcNum || lastOutcomeNumber;
      const nextDesc = currentOcDesc || rawOcLegacyName || lastOutcomeDesc;
      const nextCombined =
        nextNum && nextDesc && !nextDesc.toLowerCase().startsWith(nextNum.toLowerCase())
          ? `${nextNum}: ${nextDesc}`
          : nextDesc || nextNum;

      // Jika baris ini mengisi kolom Outcome secara eksplisit tetapi mengosongkan kolom Output,
      // jangan mewarisi Output dari baris sebelumnya agar Activity yatim tanpa Output terdeteksi akurat.
      if (
        !hasExplicitOutputInRow ||
        (lastOutcomeName &&
          nextCombined.toLowerCase() !== lastOutcomeName.toLowerCase() &&
          (currentOcNum.toLowerCase() !== lastOutcomeNumber.toLowerCase() || !currentOcNum))
      ) {
        lastOutputNumber = '';
        lastOutputName = '';
        lastOutputDesc = '';
        lastActivityNumber = '';
        lastActivityName = '';
        lastActivityCode = '';
      }
      if (currentOcNum) lastOutcomeNumber = currentOcNum;
      if (currentOcDesc) lastOutcomeDesc = currentOcDesc;
      else if (rawOcLegacyName && !lastOutcomeDesc) lastOutcomeDesc = rawOcLegacyName;
      lastOutcomeName = nextCombined;
    }

    const outcomeNumber = lastOutcomeNumber || (lastOutcomeName ? 'Outcome 1' : '');
    const outcomeDescription = lastOutcomeDesc || lastOutcomeName;
    const outcomeName =
      lastOutcomeName ||
      (outcomeNumber && outcomeDescription
        ? `${outcomeNumber}: ${outcomeDescription}`
        : outcomeDescription);

    let currentOpNum2 = rawOpNum;
    let currentOpDesc2 = rawOpDesc;
    if (!currentOpNum2 && rawOpLegacyName) {
      const m = rawOpLegacyName.match(/^(Output\s*[\d.]+)\s*[:\-–]?\s*(.+)$/i);
      if (m) {
        currentOpNum2 = m[1].replace(/\s+/g, ' ').trim();
        if (!currentOpDesc2) currentOpDesc2 = m[2].trim();
      }
    }

    if (currentOpNum2 || currentOpDesc2 || rawOpLegacyName) {
      const nextOpNum = currentOpNum2 || lastOutputNumber;
      const nextOpDesc = currentOpDesc2 || rawOpLegacyName || lastOutputDesc;
      const nextOpCombined =
        nextOpNum && nextOpDesc && !nextOpDesc.toLowerCase().startsWith(nextOpNum.toLowerCase())
          ? `${nextOpNum}: ${nextOpDesc}`
          : nextOpDesc || nextOpNum;

      // Jika baris ini mengisi kolom Output secara eksplisit tetapi mengosongkan kolom Activity,
      // reset Activity sebelumnya agar Sub-Activity yatim tanpa Activity induk terdeteksi akurat.
      if (
        !rawActName ||
        (lastOutputName &&
          nextOpCombined.toLowerCase() !== lastOutputName.toLowerCase() &&
          (currentOpNum2.toLowerCase() !== lastOutputNumber.toLowerCase() || !currentOpNum2))
      ) {
        lastActivityNumber = '';
        lastActivityName = '';
        lastActivityCode = '';
      }
      if (currentOpNum2) lastOutputNumber = currentOpNum2;
      if (currentOpDesc2) lastOutputDesc = currentOpDesc2;
      else if (rawOpLegacyName && !lastOutputDesc) lastOutputDesc = rawOpLegacyName;
      lastOutputName = nextOpCombined;
    }

    const hasOutputInRow = Boolean(
      currentOpNum2 || currentOpDesc2 || rawOpLegacyName || rawOpInd || rawActName || rawSubName
    );
    const outputNumber = hasOutputInRow ? lastOutputNumber : '';
    const outputDescription = hasOutputInRow ? lastOutputDesc || lastOutputName : '';
    const outputName = hasOutputInRow ? lastOutputName : '';

    if (rawActName) {
      const actMatch = rawActName.match(/^(Activity\s*[\d.]+)\s*[:\-–]?\s*(.+)$/i);
      const bareNumMatch = !actMatch
        ? rawActName.match(/^(\d+(?:\.\d+)+)\s*[:\-–.)]?\s+(.+)$/)
        : null;
      const extractedActNum =
        rawActNum ||
        (actMatch
          ? actMatch[1].replace(/\s+/g, ' ').trim()
          : bareNumMatch
          ? `Activity ${bareNumMatch[1]}`
          : '');
      const cleanActTitle = actMatch
        ? actMatch[2].trim()
        : bareNumMatch
        ? bareNumMatch[2].trim()
        : rawActName.trim();
      const formattedActName = actMatch
        ? `${extractedActNum}: ${cleanActTitle}`
        : rawActName.trim();

      lastActivityNumber = extractedActNum;
      lastActivityName = formattedActName;
      lastActivityCode = rawActCode || (bareNumMatch ? bareNumMatch[1] : '');
      lastActivityDesc = rawActDesc;
      lastActivityAnticipatedInputs = rawActInputs;
      lastActivityPlannedParticipants = rawActParticipants;
      lastActivityStart = normalizeDateStr(rawActStart, defaultStart);
      lastActivityEnd = normalizeDateStr(rawActEnd, defaultEnd);
    }

    const activityNumber = rawActName ? lastActivityNumber : rawSubName ? lastActivityNumber : '';
    const activityName = rawActName ? lastActivityName : rawSubName ? lastActivityName : '';
    const activityDescription = rawActDesc || (rawActName ? '' : lastActivityDesc);
    const activityAnticipatedInputs =
      rawActInputs || (rawActName ? '' : lastActivityAnticipatedInputs);
    const activityPlannedParticipants =
      rawActParticipants || (rawActName ? '' : lastActivityPlannedParticipants);
    const activityStartDate = rawActName
      ? normalizeDateStr(rawActStart, defaultStart)
      : lastActivityStart;
    const activityEndDate = rawActName
      ? normalizeDateStr(rawActEnd, defaultEnd)
      : lastActivityEnd;

    if (!outcomeName) {
      previewRows.push({
        rowNumber: excelRowNumber,
        outcomeNumber: '',
        outcomeName: '-',
        outcomeDescription: '',
        outcomeIndicator: rawOcInd,
        outcomeDataSource: rawOcDataSource,
        outcomeCumulative: rawOcCumulative,
        outcomePlannedBreakdown: rawOcPlannedBreakdown,
        outcomeReportingFrequency: rawOcReportingFreq,
        outcomeBaseline: rawOcBase,
        outcomeTarget: rawOcTarget,
        outcomeUnit: rawOcUnit,
        outputNumber: outputNumber || '',
        outputName: outputName || '-',
        outputDescription: outputDescription || '',
        outputIndicator: rawOpInd,
        outputDataSource: rawOpDataSource,
        outputCumulative: rawOpCumulative,
        outputPlannedBreakdown: rawOpPlannedBreakdown,
        outputReportingFrequency: rawOpReportingFreq,
        outputBaseline: rawOpBase,
        outputTarget: rawOpTarget,
        outputUnit: rawOpUnit,
        activityNumber: activityNumber || '',
        activityCode: rawActCode || '-',
        activityName: activityName || '-',
        activityDescription: '',
        activityAnticipatedInputs: activityAnticipatedInputs || '',
        activityPlannedParticipants: activityPlannedParticipants || '',
        activityStartDate,
        activityEndDate,
        subActivityName: rawSubName,
        subActivityPic: rawSubPic,
        status: 'invalid',
        statusMessage: 'Kolom Outcome wajib diisi',
        isNewOutcome: false,
        isNewOutcomeIndicator: false,
        isNewOutput: false,
        isNewOutputIndicator: false,
        isNewActivity: false,
        isNewSubActivity: false,
      });
      return;
    }

    if (activityName && !outputName) {
      previewRows.push({
        rowNumber: excelRowNumber,
        outcomeNumber,
        outcomeName,
        outcomeDescription,
        outcomeIndicator: rawOcInd,
        outcomeDataSource: rawOcDataSource,
        outcomeCumulative: rawOcCumulative,
        outcomePlannedBreakdown: rawOcPlannedBreakdown,
        outcomeReportingFrequency: rawOcReportingFreq,
        outcomeBaseline: rawOcBase,
        outcomeTarget: rawOcTarget,
        outcomeUnit: rawOcUnit,
        outputNumber: '',
        outputName: '-',
        outputDescription: '',
        outputIndicator: '',
        outputDataSource: '',
        outputCumulative: '',
        outputPlannedBreakdown: '',
        outputReportingFrequency: '',
        outputBaseline: '',
        outputTarget: '',
        outputUnit: '',
        activityNumber: activityNumber || '',
        activityCode: rawActCode || '-',
        activityName,
        activityDescription,
        activityAnticipatedInputs,
        activityPlannedParticipants,
        activityStartDate,
        activityEndDate,
        subActivityName: rawSubName,
        subActivityPic: rawSubPic,
        status: 'invalid',
        statusMessage: 'Activity memerlukan kolom Output induk',
        isNewOutcome: false,
        isNewOutcomeIndicator: false,
        isNewOutput: false,
        isNewOutputIndicator: false,
        isNewActivity: false,
        isNewSubActivity: false,
      });
      return;
    }

    if (rawSubName && !activityName) {
      previewRows.push({
        rowNumber: excelRowNumber,
        outcomeNumber,
        outcomeName,
        outcomeDescription,
        outcomeIndicator: rawOcInd,
        outcomeDataSource: rawOcDataSource,
        outcomeCumulative: rawOcCumulative,
        outcomePlannedBreakdown: rawOcPlannedBreakdown,
        outcomeReportingFrequency: rawOcReportingFreq,
        outcomeBaseline: rawOcBase,
        outcomeTarget: rawOcTarget,
        outcomeUnit: rawOcUnit,
        outputNumber: outputNumber || '',
        outputName: outputName || '-',
        outputDescription: outputDescription || '',
        outputIndicator: rawOpInd,
        outputDataSource: rawOpDataSource,
        outputCumulative: rawOpCumulative,
        outputPlannedBreakdown: rawOpPlannedBreakdown,
        outputReportingFrequency: rawOpReportingFreq,
        outputBaseline: rawOpBase,
        outputTarget: rawOpTarget,
        outputUnit: rawOpUnit,
        activityNumber: '',
        activityCode: '-',
        activityName: '-',
        activityDescription: '',
        activityAnticipatedInputs: '',
        activityPlannedParticipants: '',
        activityStartDate,
        activityEndDate,
        subActivityName: rawSubName,
        subActivityPic: rawSubPic,
        status: 'invalid',
        statusMessage: 'Sub-Activity memerlukan kolom Activity induk',
        isNewOutcome: false,
        isNewOutcomeIndicator: false,
        isNewOutput: false,
        isNewOutputIndicator: false,
        isNewActivity: false,
        isNewSubActivity: false,
      });
      return;
    }

    const ocKey = getCanonicalOcKey(outcomeNumber, outcomeDescription, outcomeName);
    if (!outcomeOrder.includes(ocKey)) {
      outcomeOrder.push(ocKey);
    }
    const ocNum = outcomeOrder.indexOf(ocKey) + 1;

    let opNum = 1;
    const opNorm = outputName
      ? getCanonicalOpKey(outputNumber, outputDescription, outputName)
      : '';
    const opKey = opNorm ? `${ocKey}__${opNorm}` : '';
    if (opNorm) {
      const opList = outputOrderByOutcome.get(ocKey) || [];
      if (!opList.includes(opNorm)) {
        opList.push(opNorm);
        outputOrderByOutcome.set(ocKey, opList);
      }
      opNum = opList.indexOf(opNorm) + 1;
    }

    const ocIndKey = rawOcInd ? `${ocKey}__${rawOcInd.toLowerCase()}` : '';
    const opIndKey = rawOpInd && opKey ? `${opKey}__${rawOpInd.toLowerCase()}` : '';
    const actNorm = activityName ? getCanonicalActKey(activityNumber, activityName) : '';
    const actKey = actNorm && opKey ? `${opKey}__${actNorm}` : '';
    const subKey = rawSubName && actKey ? `${actKey}__${rawSubName.toLowerCase()}` : '';

    const isNewOutcome =
      !existingOutcomeSet.has(ocKey) &&
      !existingOutcomeSet.has(outcomeName.toLowerCase()) &&
      !seenOutcomesInFile.has(ocKey);
    const isNewOutcomeIndicator = Boolean(
      rawOcInd &&
        !existingOutcomeIndicatorSet.has(ocIndKey) &&
        !seenOutcomeIndicatorsInFile.has(ocIndKey)
    );
    const isNewOutput = Boolean(
      outputName && !existingOutputSet.has(opKey) && !seenOutputsInFile.has(opKey)
    );
    const isNewOutputIndicator = Boolean(
      rawOpInd &&
        opKey &&
        !existingOutputIndicatorSet.has(opIndKey) &&
        !seenOutputIndicatorsInFile.has(opIndKey)
    );
    const isNewActivity = Boolean(
      activityName &&
        !existingActivitySet.has(actKey) &&
        !existingActivitySet.has(`${opKey}__${activityName.trim().toLowerCase()}`) &&
        !seenActivitiesInFile.has(actKey)
    );
    const isNewSubActivity = Boolean(
      rawSubName && activityName && !existingSubSet.has(subKey) && !seenSubsInFile.has(subKey)
    );

    let resolvedActCode = rawActCode || (rawActName ? lastActivityCode : lastActivityCode);
    if (activityName && !resolvedActCode) {
      const prevCount = actCountByOutput.get(opKey) || 0;
      const nextActNum = isNewActivity ? prevCount + 1 : Math.max(1, prevCount);
      if (isNewActivity) {
        actCountByOutput.set(opKey, nextActNum);
      }
      resolvedActCode = `${ocNum}.${opNum}.${nextActNum}`;
      lastActivityCode = resolvedActCode;
    } else if (isNewActivity && opKey) {
      actCountByOutput.set(opKey, (actCountByOutput.get(opKey) || 0) + 1);
    }

    seenOutcomesInFile.add(ocKey);
    if (ocIndKey) seenOutcomeIndicatorsInFile.add(ocIndKey);
    if (opKey) seenOutputsInFile.add(opKey);
    if (opIndKey) seenOutputIndicatorsInFile.add(opIndKey);
    if (actKey) seenActivitiesInFile.add(actKey);
    if (subKey) seenSubsInFile.add(subKey);

    const nothingNewInRow =
      !isNewOutcome &&
      !isNewOutcomeIndicator &&
      !isNewOutput &&
      !isNewOutputIndicator &&
      !isNewActivity &&
      !isNewSubActivity;

    const addedParts: string[] = [];
    if (isNewOutcome) addedParts.push(outcomeNumber || `Outcome ${ocNum}`);
    if (isNewOutcomeIndicator) addedParts.push('Indikator Outcome');
    if (isNewOutput) addedParts.push(outputNumber || `Output ${ocNum}.${opNum}`);
    if (isNewOutputIndicator) addedParts.push('Indikator Output');
    if (isNewActivity) addedParts.push(activityNumber || `Activity ${ocNum}.${opNum}`);
    if (isNewSubActivity) addedParts.push('Sub-Activity');

    previewRows.push({
      rowNumber: excelRowNumber,
      outcomeNumber: outcomeNumber || `Outcome ${ocNum}`,
      outcomeName,
      outcomeDescription,
      outcomeIndicator: rawOcInd,
      outcomeDataSource: rawOcDataSource,
      outcomeCumulative: rawOcCumulative || 'Non cumulative',
      outcomePlannedBreakdown: rawOcPlannedBreakdown,
      outcomeReportingFrequency: rawOcReportingFreq || 'Annual',
      outcomeBaseline: rawOcBase,
      outcomeTarget: rawOcTarget,
      outcomeUnit: rawOcUnit,
      outputNumber: outputNumber || (outputName ? `Output ${ocNum}.${opNum}` : ''),
      outputName,
      outputDescription,
      outputIndicator: rawOpInd,
      outputDataSource: rawOpDataSource,
      outputCumulative: rawOpCumulative || 'Non cumulative',
      outputPlannedBreakdown: rawOpPlannedBreakdown,
      outputReportingFrequency: rawOpReportingFreq || 'Annual',
      outputBaseline: rawOpBase,
      outputTarget: rawOpTarget,
      outputUnit: rawOpUnit,
      activityNumber:
        activityNumber ||
        (activityName ? `Activity ${resolvedActCode || `${ocNum}.${opNum}`}` : ''),
      activityCode: resolvedActCode,
      activityName,
      activityDescription,
      activityAnticipatedInputs,
      activityPlannedParticipants,
      activityStartDate,
      activityEndDate,
      subActivityName: rawSubName,
      subActivityPic: rawSubPic,
      status: nothingNewInRow ? 'duplicate' : 'valid',
      statusMessage: nothingNewInRow
        ? 'Sudah terdaftar di Hirarki Program (Dilewati)'
        : `Siap Diimpor: ${addedParts.join(' → ')}`,
      isNewOutcome,
      isNewOutcomeIndicator,
      isNewOutput,
      isNewOutputIndicator,
      isNewActivity,
      isNewSubActivity,
    });
  });

  return {
    sheetName: chosenSheetName,
    sheetCount: workbook.SheetNames.length,
    rawRowCount: extracted.rows.length,
    headerMatched: extracted.headerMatched,
    detectedHeaders: extracted.detectedHeaders,
    rows: previewRows,
  };
}

/**
 * Menyusun rencana objek relasional (Outcome -> Output -> Activity -> SubActivity) yang siap
 * disimpan ke MySQL dalam satu transaksi atomik, lengkap dengan seluruh foreign key induk (`programId`, `outcomeId`, `outputId`, `activityId`).
 */
export function buildHierarchyImportPlan(params: {
  validRows: HierarchyExcelPreviewRow[];
  program: Program;
  existingOutcomes: Outcome[];
  existingOutputs: Output[];
  existingActivities: Activity[];
  existingSubActivities: SubActivity[];
  nowIso?: string;
}): HierarchyImportPlan {
  const {
    validRows,
    program,
    existingOutcomes,
    existingOutputs,
    existingActivities,
    existingSubActivities,
  } = params;
  const nowIso = params.nowIso || new Date().toISOString();
  let seqCounter = 0;
  const makeId = (prefix: string) => {
    seqCounter += 1;
    return `${prefix}-${Date.now()}-${seqCounter}-${Math.random().toString(36).slice(2, 6)}`;
  };

  const outcomeById = new Map<string, Outcome>();
  const outcomeIdByKey = new Map<string, string>();
  const touchedOutcomeIds = new Set<string>();

  const outputById = new Map<string, Output>();
  const outputIdByKey = new Map<string, string>();
  const touchedOutputIds = new Set<string>();

  const activityById = new Map<string, Activity>();
  const activityIdByKey = new Map<string, string>();
  const touchedActivityIds = new Set<string>();

  const subActivityById = new Map<string, SubActivity>();
  const subActivityIdByKey = new Map<string, string>();
  const touchedSubActivityIds = new Set<string>();

  const expandedOutcomeIds = new Set<string>();
  const expandedOutputIds = new Set<string>();

  const progOutcomes = existingOutcomes.filter((o) => o.programId === program.id);
  progOutcomes.forEach((oc) => {
    const clonedOc: Outcome = {
      ...oc,
      programId: program.id,
      indicators: Array.isArray(oc.indicators) ? [...oc.indicators] : [],
    };
    outcomeById.set(clonedOc.id, clonedOc);
    const ocKey = getCanonicalOcKey(
      clonedOc.outcomeNumber || '',
      clonedOc.description || '',
      clonedOc.name
    );
    outcomeIdByKey.set(ocKey, clonedOc.id);
    outcomeIdByKey.set(clonedOc.name.trim().toLowerCase(), clonedOc.id);
    if (clonedOc.outcomeNumber) {
      outcomeIdByKey.set(clonedOc.outcomeNumber.trim().toLowerCase(), clonedOc.id);
    }

    existingOutputs
      .filter((op) => op.outcomeId === clonedOc.id)
      .forEach((op) => {
        const clonedOp: Output = {
          ...op,
          programId: program.id,
          outcomeId: clonedOc.id,
          indicators: Array.isArray(op.indicators) ? [...op.indicators] : [],
        } as any;
        outputById.set(clonedOp.id, clonedOp);
        const opNorm = getCanonicalOpKey(
          clonedOp.outputNumber || '',
          clonedOp.description || '',
          clonedOp.name
        );
        const opKey = `${ocKey}__${opNorm}`;
        outputIdByKey.set(opKey, clonedOp.id);
        outputIdByKey.set(`${ocKey}__${clonedOp.name.trim().toLowerCase()}`, clonedOp.id);
        if (clonedOp.outputNumber) {
          outputIdByKey.set(`${ocKey}__${clonedOp.outputNumber.trim().toLowerCase()}`, clonedOp.id);
        }

        existingActivities
          .filter((a) => a.outputId === clonedOp.id)
          .forEach((act) => {
            const clonedAct: Activity = {
              ...act,
              programId: program.id,
              outcomeId: clonedOc.id,
              outputId: clonedOp.id,
            } as any;
            activityById.set(clonedAct.id, clonedAct);
            const actNorm = getCanonicalActKey(clonedAct.activityNumber || '', clonedAct.name);
            const actKey = `${opKey}__${actNorm}`;
            activityIdByKey.set(actKey, clonedAct.id);
            activityIdByKey.set(`${opKey}__${clonedAct.name.trim().toLowerCase()}`, clonedAct.id);

            existingSubActivities
              .filter((s) => s.activityId === clonedAct.id)
              .forEach((sub) => {
                const clonedSub: SubActivity = {
                  ...sub,
                  activityId: clonedAct.id,
                };
                subActivityById.set(clonedSub.id, clonedSub);
                subActivityIdByKey.set(
                  `${actKey}__${clonedSub.name.trim().toLowerCase()}`,
                  clonedSub.id
                );
              });
          });
      });
  });

  let createdOutcomesCount = 0;
  let updatedOutcomesCount = 0;
  let addedOutcomeIndicatorsCount = 0;
  let createdOutputsCount = 0;
  let updatedOutputsCount = 0;
  let addedOutputIndicatorsCount = 0;
  let createdActivitiesCount = 0;
  let updatedActivitiesCount = 0;
  let createdSubActivitiesCount = 0;

  let outcomeAutoIdx = progOutcomes.length;

  for (const row of validRows) {
    const ocKey = getCanonicalOcKey(row.outcomeNumber, row.outcomeDescription, row.outcomeName);
    let outcomeId =
      outcomeIdByKey.get(ocKey) ||
      outcomeIdByKey.get(row.outcomeName.trim().toLowerCase()) ||
      (row.outcomeNumber
        ? outcomeIdByKey.get(row.outcomeNumber.trim().toLowerCase())
        : undefined);

    const buildOcInd = (): Indicator | null => {
      if (!row.outcomeIndicator || !row.outcomeIndicator.trim()) return null;
      return {
        id: makeId('ind-oc'),
        name: row.outcomeIndicator.trim(),
        description: '',
        dataSource: row.outcomeDataSource || 'Laporan MEAL',
        cumulativeType: row.outcomeCumulative || 'Non cumulative',
        plannedDataBreakdown: row.outcomePlannedBreakdown || '',
        reportingFrequency: (row.outcomeReportingFrequency || 'Annual') as any,
        baseline: row.outcomeBaseline || 'TBA',
        target: row.outcomeTarget || '',
        endOfProjectGoal: row.outcomeTarget || '',
        unit: row.outcomeUnit || '',
        verificationMethod: row.outcomeDataSource || 'Laporan MEAL',
      };
    };

    if (!outcomeId) {
      outcomeAutoIdx += 1;
      outcomeId = makeId('outc');
      const ocNumber = row.outcomeNumber || `Outcome ${outcomeAutoIdx}`;
      const indicators: Indicator[] = [];
      const firstInd = buildOcInd();
      if (firstInd) {
        indicators.push(firstInd);
        addedOutcomeIndicatorsCount += 1;
      }
      const newOc: Outcome = {
        id: outcomeId,
        programId: program.id,
        outcomeNumber: ocNumber,
        code: ocNumber,
        name: row.outcomeName.trim(),
        projectName: program.name,
        description: row.outcomeDescription || row.outcomeName.trim(),
        indicators,
        status: 'Belum Dimulai',
        createdAt: nowIso,
        updatedAt: nowIso,
      } as any;
      outcomeById.set(outcomeId, newOc);
      outcomeIdByKey.set(ocKey, outcomeId);
      outcomeIdByKey.set(row.outcomeName.trim().toLowerCase(), outcomeId);
      if (row.outcomeNumber) {
        outcomeIdByKey.set(row.outcomeNumber.trim().toLowerCase(), outcomeId);
      }
      touchedOutcomeIds.add(outcomeId);
      expandedOutcomeIds.add(outcomeId);
      createdOutcomesCount += 1;
    } else {
      expandedOutcomeIds.add(outcomeId);
      const existingOc = outcomeById.get(outcomeId)!;
      const nextInd = buildOcInd();
      if (nextInd) {
        const alreadyHas = existingOc.indicators.some(
          (i) => i.name.trim().toLowerCase() === nextInd.name.toLowerCase()
        );
        if (!alreadyHas) {
          existingOc.indicators = [...existingOc.indicators, nextInd];
          (existingOc as any).updatedAt = nowIso;
          if (!touchedOutcomeIds.has(outcomeId)) {
            updatedOutcomesCount += 1;
          }
          touchedOutcomeIds.add(outcomeId);
          addedOutcomeIndicatorsCount += 1;
        }
      }
    }

    if (row.outputName && outcomeId) {
      const opNorm = getCanonicalOpKey(row.outputNumber, row.outputDescription, row.outputName);
      const opKey = `${ocKey}__${opNorm}`;
      let outputId =
        outputIdByKey.get(opKey) ||
        outputIdByKey.get(`${ocKey}__${row.outputName.trim().toLowerCase()}`) ||
        (row.outputNumber
          ? outputIdByKey.get(`${ocKey}__${row.outputNumber.trim().toLowerCase()}`)
          : undefined);

      const buildOpInd = (): Indicator | null => {
        if (!row.outputIndicator || !row.outputIndicator.trim()) return null;
        return {
          id: makeId('ind-op'),
          name: row.outputIndicator.trim(),
          description: '',
          dataSource: row.outputDataSource || 'Activity report',
          cumulativeType: row.outputCumulative || 'Non cumulative',
          plannedDataBreakdown: row.outputPlannedBreakdown || '',
          reportingFrequency: (row.outputReportingFrequency || 'Annual') as any,
          baseline: row.outputBaseline || 'TBA',
          target: row.outputTarget || '',
          endOfProjectGoal: row.outputTarget || '',
          unit: row.outputUnit || '',
          verificationMethod: row.outputDataSource || 'Activity report',
        };
      };

      if (!outputId) {
        outputId = makeId('outp');
        const siblingCount = Array.from(outputById.values()).filter(
          (o) => o.outcomeId === outcomeId
        ).length;
        const parentOc = outcomeById.get(outcomeId);
        const ocDigits =
          parentOc?.outcomeNumber?.match(/\d+/)?.[0] || String(outcomeAutoIdx || 1);
        const opNumber = row.outputNumber || `Output ${ocDigits}.${siblingCount + 1}`;
        const indicators: Indicator[] = [];
        const firstOpInd = buildOpInd();
        if (firstOpInd) {
          indicators.push(firstOpInd);
          addedOutputIndicatorsCount += 1;
        }
        const newOp: Output = {
          id: outputId,
          programId: program.id,
          outcomeId,
          outputNumber: opNumber,
          code: opNumber,
          name: row.outputName.trim(),
          description: row.outputDescription || row.outputName.trim(),
          indicators,
          status: 'Belum Dimulai',
          createdAt: nowIso,
          updatedAt: nowIso,
        } as any;
        outputById.set(outputId, newOp);
        outputIdByKey.set(opKey, outputId);
        outputIdByKey.set(`${ocKey}__${row.outputName.trim().toLowerCase()}`, outputId);
        if (row.outputNumber) {
          outputIdByKey.set(`${ocKey}__${row.outputNumber.trim().toLowerCase()}`, outputId);
        }
        touchedOutputIds.add(outputId);
        expandedOutputIds.add(outputId);
        createdOutputsCount += 1;
      } else {
        expandedOutputIds.add(outputId);
        const existingOp = outputById.get(outputId)!;
        const nextOpInd = buildOpInd();
        if (nextOpInd) {
          const alreadyHas = existingOp.indicators.some(
            (i) => i.name.trim().toLowerCase() === nextOpInd.name.toLowerCase()
          );
          if (!alreadyHas) {
            existingOp.indicators = [...existingOp.indicators, nextOpInd];
            (existingOp as any).updatedAt = nowIso;
            if (!touchedOutputIds.has(outputId)) {
              updatedOutputsCount += 1;
            }
            touchedOutputIds.add(outputId);
            addedOutputIndicatorsCount += 1;
          }
        }
      }

      if (row.activityName && outputId) {
        const actNorm = getCanonicalActKey(row.activityNumber, row.activityName);
        const actKey = `${opKey}__${actNorm}`;
        let activityId =
          activityIdByKey.get(actKey) ||
          activityIdByKey.get(`${opKey}__${row.activityName.trim().toLowerCase()}`);

        if (!activityId) {
          activityId = makeId('act');
          const siblingActCount = Array.from(activityById.values()).filter(
            (a) => a.outputId === outputId
          ).length;
          const parentOp = outputById.get(outputId);
          const opDigits = parentOp?.outputNumber?.match(/[\d.]+/)?.[0] || '1.1';
          const resolvedCode =
            row.activityCode && row.activityCode !== '-'
              ? row.activityCode
              : `${opDigits}.${siblingActCount + 1}`;
          const resolvedActNum = row.activityNumber || `Activity ${resolvedCode}`;

          const newAct: Activity = {
            id: activityId,
            programId: program.id,
            outcomeId,
            outputId,
            activityNumber: resolvedActNum,
            code: resolvedCode,
            name: row.activityName.trim(),
            description: row.activityDescription || '',
            anticipatedInputs: row.activityAnticipatedInputs || '',
            plannedParticipantsBreakdown: row.activityPlannedParticipants || '',
            startDate: row.activityStartDate || program.startDate || nowIso.slice(0, 10),
            endDate: row.activityEndDate || program.endDate || nowIso.slice(0, 10),
            status: 'Belum Dimulai',
            createdAt: nowIso,
            updatedAt: nowIso,
          } as any;
          activityById.set(activityId, newAct);
          activityIdByKey.set(actKey, activityId);
          activityIdByKey.set(`${opKey}__${row.activityName.trim().toLowerCase()}`, activityId);
          touchedActivityIds.add(activityId);
          createdActivitiesCount += 1;
        } else if (
          row.activityDescription ||
          row.activityAnticipatedInputs ||
          row.activityPlannedParticipants
        ) {
          const existingAct = activityById.get(activityId)!;
          let changed = false;
          if (row.activityDescription && row.activityDescription !== existingAct.description) {
            existingAct.description = row.activityDescription;
            changed = true;
          }
          if (
            row.activityAnticipatedInputs &&
            row.activityAnticipatedInputs !== existingAct.anticipatedInputs
          ) {
            existingAct.anticipatedInputs = row.activityAnticipatedInputs;
            changed = true;
          }
          if (
            row.activityPlannedParticipants &&
            row.activityPlannedParticipants !== existingAct.plannedParticipantsBreakdown
          ) {
            existingAct.plannedParticipantsBreakdown = row.activityPlannedParticipants;
            changed = true;
          }
          if (changed) {
            (existingAct as any).updatedAt = nowIso;
            if (!touchedActivityIds.has(activityId)) {
              updatedActivitiesCount += 1;
            }
            touchedActivityIds.add(activityId);
          }
        }

        if (row.subActivityName && activityId) {
          const subKey = `${actKey}__${row.subActivityName.trim().toLowerCase()}`;
          const existingSubId = subActivityIdByKey.get(subKey);
          if (!existingSubId) {
            const subId = makeId('sub');
            const siblingSubCount = Array.from(subActivityById.values()).filter(
              (s) => s.activityId === activityId
            ).length;
            const parentAct = activityById.get(activityId);
            const leadingSubCode = row.subActivityName.trim().match(/^(\d+(?:\.\d+)+)\b/)?.[1];
            const resolvedSubCode =
              leadingSubCode || `${parentAct?.code || '1.1.1'}.${siblingSubCount + 1}`;
            const newSub: SubActivity = {
              id: subId,
              programId: program.id,
              outcomeId,
              outputId,
              activityId,
              code: resolvedSubCode,
              name: row.subActivityName.trim(),
              description: '',
              picName: row.subActivityPic || '',
              status: 'Belum Dimulai',
              createdAt: nowIso,
              updatedAt: nowIso,
            } as any;
            subActivityById.set(subId, newSub);
            subActivityIdByKey.set(subKey, subId);
            touchedSubActivityIds.add(subId);
            createdSubActivitiesCount += 1;
          }
        }
      }
    }
  }

  return {
    outcomesToUpsert: Array.from(touchedOutcomeIds).map((id) => outcomeById.get(id)!),
    outputsToUpsert: Array.from(touchedOutputIds).map((id) => outputById.get(id)!),
    activitiesToUpsert: Array.from(touchedActivityIds).map((id) => activityById.get(id)!),
    subActivitiesToUpsert: Array.from(touchedSubActivityIds).map((id) => subActivityById.get(id)!),
    createdOutcomesCount,
    updatedOutcomesCount,
    addedOutcomeIndicatorsCount,
    createdOutputsCount,
    updatedOutputsCount,
    addedOutputIndicatorsCount,
    createdActivitiesCount,
    updatedActivitiesCount,
    createdSubActivitiesCount,
    expandedOutcomeIds: Array.from(expandedOutcomeIds),
    expandedOutputIds: Array.from(expandedOutputIds),
  };
}
