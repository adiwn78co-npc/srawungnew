import { api } from './api.js';

/**
 * Pengelolaan Master Kode Budget Organisasi WIJNA
 * Tersimpan secara permanen di database server (MySQL) melalui /api/finance-workspace/budgets.
 * Bebas ketergantungan localStorage agar data konsisten lintas sesi & perangkat.
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

export const MASTER_BUDGET_ITEMS_SERVER_KEY = '__MASTER_BUDGET_ITEMS__';

let masterBudgetMemoryCache: MasterBudgetItem[] = [];
let serverBudgetMapRef: Record<string, any> | null = null;

export function getMasterBudgetList(): MasterBudgetItem[] {
  return [...masterBudgetMemoryCache];
}

export function hydrateMasterBudgetListFromServerPayload(rawPayload: any): MasterBudgetItem[] {
  if (!rawPayload) {
    return masterBudgetMemoryCache;
  }
  const items = Array.isArray(rawPayload)
    ? rawPayload
    : Array.isArray(rawPayload?.items)
    ? rawPayload.items
    : null;
  if (items) {
    masterBudgetMemoryCache = items;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('master-budget-updated', { detail: masterBudgetMemoryCache })
      );
    }
  }
  return masterBudgetMemoryCache;
}

export function saveMasterBudgetList(
  items: MasterBudgetItem[],
  persistToServer: boolean = true
): void {
  masterBudgetMemoryCache = Array.isArray(items) ? [...items] : [];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('master-budget-updated', { detail: masterBudgetMemoryCache })
    );
  }
  if (persistToServer) {
    api
      .saveFinanceProgramBudget(MASTER_BUDGET_ITEMS_SERVER_KEY, {
        id: MASTER_BUDGET_ITEMS_SERVER_KEY,
        items: masterBudgetMemoryCache,
        updatedAt: new Date().toISOString(),
      })
      .catch((err) => {
        console.warn('Could not persist master budget items to MySQL server:', err);
      });
  }
}

export async function saveMasterBudgetListAsync(
  items: MasterBudgetItem[]
): Promise<MasterBudgetItem[]> {
  const normalized = Array.isArray(items) ? [...items] : [];
  const saved = await api.saveFinanceProgramBudget(MASTER_BUDGET_ITEMS_SERVER_KEY, {
    id: MASTER_BUDGET_ITEMS_SERVER_KEY,
    items: normalized,
    updatedAt: new Date().toISOString(),
  });
  const finalItems = Array.isArray(saved?.items) ? saved.items : normalized;
  saveMasterBudgetList(finalItems, false);
  return finalItems;
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
  saveMasterBudgetList(updated, true);
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
  saveMasterBudgetList(current, true);
  return updatedItem;
}

export function deleteMasterBudgetItem(id: string): void {
  const current = getMasterBudgetList();
  const filtered = current.filter((b) => b.id !== id);
  saveMasterBudgetList(filtered, true);
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

export function syncMasterBudgetLookupWithServerMap(
  datasets: Record<string, any> | null | undefined
): void {
  if (datasets && typeof datasets === 'object') {
    serverBudgetMapRef = datasets;
    if (datasets[MASTER_BUDGET_ITEMS_SERVER_KEY]) {
      hydrateMasterBudgetListFromServerPayload(datasets[MASTER_BUDGET_ITEMS_SERVER_KEY]);
    }
  }
}

function findProgramBudgetCategoryByCode(
  cleanCode: string,
  programId?: string,
  programName?: string
): { code: string; budgetCategory: string; programName?: string } | null {
  if (!cleanCode || cleanCode === '-') return null;
  try {
    const all: Record<string, any> | null = serverBudgetMapRef;
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
