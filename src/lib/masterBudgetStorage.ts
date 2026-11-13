/**
 * Storage dan Pengelolaan Master Kode Budget Organisasi WIJNA
 * Dikelola secara manual oleh Finance di Dashboard Keuangan.
 * Terhubung langsung dengan formulir Cash Advance (Kasbon Operasional).
 */

export interface MasterBudgetItem {
  id: string;
  code: string;
  name: string;
  activityCode?: string;
  activityDescription: string;
  defaultUnitPrice?: number;
  defaultUnit?: string;
  defaultNotes?: string;
  category: 'Program' | 'Operasional' | 'Audit & Compliance' | 'Kapasitas Staf' | 'Pelaporan';
  outcomeId?: string;
  outcomeName?: string;
  outputId?: string;
  outputName?: string;
  activityId?: string;
  activityName?: string;
  isActive: boolean;
  createdBy: string;
  updatedAt: string;
  changeHistoryCount: number;
}

export const DEFAULT_MASTER_BUDGET_ITEMS: MasterBudgetItem[] = [];

const STORAGE_KEY = 'wijna_master_budget_items_v3';

export function getMasterBudgetList(): MasterBudgetItem[] {
  if (typeof window === 'undefined') return DEFAULT_MASTER_BUDGET_ITEMS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_MASTER_BUDGET_ITEMS));
      return DEFAULT_MASTER_BUDGET_ITEMS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return DEFAULT_MASTER_BUDGET_ITEMS;
  } catch (e) {
    console.error('Failed to parse master budget items from storage:', e);
    return DEFAULT_MASTER_BUDGET_ITEMS;
  }
}

export function saveMasterBudgetList(items: MasterBudgetItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('master-budget-updated', { detail: items }));
  } catch (e) {
    console.error('Failed to save master budget items to storage:', e);
  }
}

export function addMasterBudgetItem(
  data: Omit<MasterBudgetItem, 'id' | 'updatedAt' | 'changeHistoryCount'>
): MasterBudgetItem {
  const current = getMasterBudgetList();
  const newItem: MasterBudgetItem = {
    ...data,
    id: `mb-${Date.now()}`,
    updatedAt: new Date().toISOString().slice(0, 10),
    changeHistoryCount: 1,
  };
  const updated = [newItem, ...current];
  saveMasterBudgetList(updated);
  return newItem;
}

export function updateMasterBudgetItem(
  id: string,
  updates: Partial<MasterBudgetItem>
): MasterBudgetItem | null {
  const current = getMasterBudgetList();
  const idx = current.findIndex((b) => b.id === id);
  if (idx === -1) return null;

  const updatedItem: MasterBudgetItem = {
    ...current[idx],
    ...updates,
    updatedAt: new Date().toISOString().slice(0, 10),
    changeHistoryCount: (current[idx].changeHistoryCount || 0) + 1,
  };
  current[idx] = updatedItem;
  saveMasterBudgetList(current);
  return updatedItem;
}

export function deleteMasterBudgetItem(id: string): void {
  const current = getMasterBudgetList();
  const filtered = current.filter((b) => b.id !== id);
  saveMasterBudgetList(filtered);
}

export interface ResolvedMasterBudgetInfo {
  code: string;
  masterName: string;
  activityCode: string;
  outcomeName: string;
  outputName: string;
  activityDescription: string;
  formattedMasterLabel: string;
}

let serverBudgetMapRef: Record<string, any> | null = null;

export function syncMasterBudgetLookupWithServerMap(datasets: Record<string, any> | null | undefined): void {
  if (datasets && typeof datasets === 'object') {
    serverBudgetMapRef = datasets;
  }
}

const PROGRAM_BUDGET_STORAGE_KEY = 'wijna_finance_program_budgets_v3';

function findProgramBudgetCategoryByCode(
  cleanCode: string,
  programId?: string,
  programName?: string
): { code: string; budgetCategory: string; programName?: string } | null {
  if (!cleanCode || cleanCode === '-') return null;
  try {
    let all: Record<string, any> | null = serverBudgetMapRef;
    if (!all && typeof window !== 'undefined') {
      const raw = localStorage.getItem(PROGRAM_BUDGET_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          all = parsed;
        }
      }
    }
    if (!all || typeof all !== 'object') return null;

    const normCode = cleanCode.trim().toLowerCase();
    const cleanId = (programId || '').trim();
    const cleanName = (programName || '').trim().toLowerCase();

    const datasets = Object.values(all) as Array<{
      programId?: string;
      programName?: string;
      masterBudgetCodes?: Array<{ code: string; budgetCategory: string }>;
    }>;

    // If programId or programName is specified, search EXCLUSIVELY within that Program's datasets
    if (cleanId || cleanName) {
      const programDatasets = datasets.filter((ds) => {
        if (!ds) return false;
        if (cleanId && ds.programId === cleanId) return true;
        if (!cleanId && cleanName && ds.programName?.trim().toLowerCase() === cleanName) {
          return true;
        }
        return false;
      });

      for (const ds of programDatasets) {
        const found = (ds.masterBudgetCodes || []).find(
          (mc) => mc.code.trim().toLowerCase() === normCode
        );
        if (found) {
          return {
            code: found.code,
            budgetCategory: found.budgetCategory,
            programName: ds.programName,
          };
        }
      }
      return null;
    }

    // If no program context was passed, check if any dataset has this code
    for (const ds of datasets) {
      const found = (ds?.masterBudgetCodes || []).find(
        (mc) => mc.code.trim().toLowerCase() === normCode
      );
      if (found) {
        return {
          code: found.code,
          budgetCategory: found.budgetCategory,
          programName: ds.programName,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveMasterBudgetByCode(
  rawCode?: string,
  fallbackTor?: {
    programId?: string;
    programName?: string;
    activityCode?: string;
    hierarchyCode?: string;
    activityName?: string;
    outcomeName?: string;
    outputName?: string;
    title?: string;
  }
): ResolvedMasterBudgetInfo {
  const cleanCode =
    (rawCode && rawCode !== '-' ? rawCode.trim() : '') ||
    fallbackTor?.activityCode?.trim() ||
    fallbackTor?.hierarchyCode?.trim() ||
    '-';

  const derivedParent = cleanCode.includes('.')
    ? cleanCode.split('.').slice(0, 2).join('.')
    : cleanCode;

  // 1. Exclusive lookup in the selected Program's Master Budget Codes
  const matchedProgCode = findProgramBudgetCategoryByCode(
    cleanCode,
    fallbackTor?.programId,
    fallbackTor?.programName
  );

  if (matchedProgCode) {
    const outcomeDesc =
      fallbackTor?.outcomeName ||
      fallbackTor?.programName ||
      matchedProgCode.programName ||
      matchedProgCode.budgetCategory;
    return {
      code: matchedProgCode.code,
      masterName: matchedProgCode.budgetCategory,
      activityCode: derivedParent,
      outcomeName: fallbackTor?.outcomeName || '',
      outputName: fallbackTor?.outputName || '',
      activityDescription: matchedProgCode.budgetCategory,
      formattedMasterLabel: `${matchedProgCode.budgetCategory} — ${derivedParent}: ${outcomeDesc}`,
    };
  }

  // 2. Consistent fallback from the ToR's own Program -> Outcome -> Output -> Activity hierarchy
  const fallbackName =
    fallbackTor?.activityName || fallbackTor?.title || `Kode Anggaran ${cleanCode}`;
  const fallbackOutcome =
    fallbackTor?.outcomeName ||
    fallbackTor?.outputName ||
    fallbackTor?.programName ||
    fallbackName;

  return {
    code: cleanCode,
    masterName: fallbackName,
    activityCode: derivedParent,
    outcomeName: fallbackOutcome,
    outputName: fallbackTor?.outputName || '',
    activityDescription: fallbackTor?.activityName || fallbackTor?.title || fallbackName,
    formattedMasterLabel: `${fallbackName} — ${derivedParent}: ${fallbackOutcome}`,
  };
}


