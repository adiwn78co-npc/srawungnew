import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { DatabaseSchema } from './db.ts';

const __poolFile = fileURLToPath(import.meta.url);
const __poolDir = path.dirname(__poolFile);

for (const envCandidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '.env.production'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(__poolDir, '.env'),
  path.resolve(__poolDir, '..', '..', '.env'),
  path.resolve(__poolDir, '..', '..', '.env.production'),
]) {
  if (fs.existsSync(envCandidate)) {
    dotenv.config({ path: envCandidate, override: false });
  }
}

export interface MysqlPoolLike {
  query: (sql: string, values?: any[]) => Promise<[any, any]>;
  execute: (sql: string, values?: any[]) => Promise<[any, any]>;
  getConnection: () => Promise<{
    query: (sql: string, values?: any[]) => Promise<[any, any]>;
    execute: (sql: string, values?: any[]) => Promise<[any, any]>;
    beginTransaction: () => Promise<void>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    release: () => void;
  }>;
  end: () => Promise<void>;
}

export interface ResolvedMysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  socketPath?: string;
}

let cachedPool: MysqlPoolLike | null = null;
let cachedPoolHostOverride: string | null = null;
let loggedCloudRunLoopbackNotice = false;

export function isCloudRunEnvironment(): boolean {
  return Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);
}

export function isProductionHostingerEnvironment(): boolean {
  if (isCloudRunEnvironment()) {
    return false;
  }
  return (
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.IN_PASSENGER) ||
    Boolean(process.env.PASSENGER_APP_ENV) ||
    Boolean(process.env.MYSQL_HOST || process.env.MYSQL_DATABASE || process.env.MYSQL_USER)
  );
}

function isLoopbackMysqlHost(rawHost: string | undefined): boolean {
  const host = String(rawHost || '').trim().toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0'
  );
}

function isPlaceholderValue(val: string): boolean {
  const clean = val.trim().toLowerCase();
  return (
    !clean ||
    clean === 'your_mysql_user' ||
    clean === 'your_mysql_database' ||
    clean === 'your_mysql_password'
  );
}

/**
 * Membaca konfigurasi MySQL dari MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.
 */
export function resolveMysqlConfig(): ResolvedMysqlConfig {
  const mysqlHost = String(process.env.MYSQL_HOST || '').trim();
  const mysqlUser = String(process.env.MYSQL_USER || '').trim();
  const mysqlName = String(process.env.MYSQL_DATABASE || '').trim();

  const rawPort = process.env.MYSQL_PORT || '3306';
  const port = Number(rawPort) > 0 ? Number(rawPort) : 3306;

  const rawPassword = process.env.MYSQL_PASSWORD ?? '';
  const password = isPlaceholderValue(String(rawPassword)) ? '' : String(rawPassword);

  const user = !isPlaceholderValue(mysqlUser) ? mysqlUser : '';
  const database = !isPlaceholderValue(mysqlName) ? mysqlName : '';

  let host = mysqlHost;
  if (!host && user && database && !isCloudRunEnvironment()) {
    host = '127.0.0.1';
  }

  const socketPath = String(process.env.MYSQL_SOCKET_PATH || '').trim() || undefined;

  return {
    host,
    port,
    user,
    password,
    database,
    socketPath,
  };
}

export function validateMysqlEnvConfiguration(): {
  configured: boolean;
  missingVars: string[];
  safeSummary: string;
} {
  const cfg = resolveMysqlConfig();
  const missingVars: string[] = [];
  if (!cfg.host) missingVars.push('MYSQL_HOST');
  if (!cfg.user) missingVars.push('MYSQL_USER');
  if (!cfg.database) missingVars.push('MYSQL_DATABASE');

  if (missingVars.length > 0) {
    return {
      configured: false,
      missingVars,
      safeSummary: `unconfigured (missing: ${missingVars.join(', ')})`,
    };
  }

  return {
    configured: true,
    missingVars: [],
    safeSummary: `host=${cfg.host}, port=${cfg.port}, database=${cfg.database}, user=${cfg.user}`,
  };
}

export function isMysqlConfigured(): boolean {
  const cfg = resolveMysqlConfig();
  if (!cfg.host || !cfg.user || !cfg.database) {
    return false;
  }

  // Di container Cloud Run / AI Studio Preview tidak terdapat service MySQL lokal pada 127.0.0.1:3306.
  // Jika host bernilai localhost/127.0.0.1 pada Cloud Run Preview, gunakan penyimpanan preview,
  // sedangkan pada server Hostinger produksi (tanpa K_SERVICE) koneksi MySQL localhost tetap berjalan penuh.
  if (
    isCloudRunEnvironment() &&
    isLoopbackMysqlHost(cfg.host) &&
    process.env.MYSQL_STRICT_REQUIRED !== 'true'
  ) {
    if (!loggedCloudRunLoopbackNotice) {
      loggedCloudRunLoopbackNotice = true;
      console.log(
        `[DB] Cloud Run preview detected with local MySQL host (${cfg.host}); using preview storage.`
      );
    }
    return false;
  }

  return true;
}

export async function resetMysqlPool(): Promise<void> {
  const existing = cachedPool;
  cachedPool = null;
  if (existing) {
    try {
      await existing.end();
    } catch {
      // abaikan error penutupan pool yang gagal terhubung
    }
  }
}

/**
 * Membuat koneksi pool MySQL menggunakan mysql2/promise sesuai konfigurasi environment:
 * MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.
 */
export async function getMysqlPool(hostOverride?: string): Promise<MysqlPoolLike | null> {
  if (!isMysqlConfigured()) {
    return null;
  }
  if (cachedPool && (!hostOverride || cachedPoolHostOverride === hostOverride)) {
    return cachedPool;
  }
  if (cachedPool && hostOverride && cachedPoolHostOverride !== hostOverride) {
    await resetMysqlPool();
  }

  const cfg = resolveMysqlConfig();
  const effectiveHost = hostOverride || cachedPoolHostOverride || cfg.host;

  const modName = 'mysql2/promise';
  const mysqlModule: any = await import(/* @vite-ignore */ modName);
  const mysql = mysqlModule.default || mysqlModule;

  const poolConfig: Record<string, any> = {
    host: effectiveHost,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectTimeout: 10000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  };
  if (cfg.socketPath) {
    poolConfig.socketPath = cfg.socketPath;
  }

  cachedPoolHostOverride = effectiveHost;
  cachedPool = mysql.createPool(poolConfig);

  return cachedPool;
}

/**
 * Membuka pool MySQL dan memverifikasi koneksi dengan query ringan (SELECT 1).
 * Jika host='localhost' gagal karena resolusi IPv6 (::1) pada Linux/Hostinger, otomatis mencoba IPv4 '127.0.0.1'.
 */
export async function verifyAndGetMysqlPool(): Promise<MysqlPoolLike> {
  const cfg = resolveMysqlConfig();
  let pool = await getMysqlPool();
  if (!pool) {
    throw new Error('MySQL connection pool is unavailable.');
  }

  try {
    await pool.query('SELECT 1');
    return pool;
  } catch (err: any) {
    const code = String(err?.code || '');
    if (
      cfg.host.toLowerCase() === 'localhost' &&
      cachedPoolHostOverride !== '127.0.0.1' &&
      (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH')
    ) {
      await resetMysqlPool();
      pool = await getMysqlPool('127.0.0.1');
      if (pool) {
        await pool.query('SELECT 1');
        return pool;
      }
    }
    throw err;
  }
}

/**
 * Menjalankan DDL pembuatan tabel MySQL dari database/schema.sql secara non-destructive (CREATE TABLE IF NOT EXISTS)
 */
export async function ensureMysqlSchema(pool: MysqlPoolLike): Promise<void> {
  const candidatePaths = [
    path.resolve(process.cwd(), 'database', 'schema.sql'),
    path.resolve(__poolDir, 'database', 'schema.sql'),
    path.resolve(__poolDir, '..', '..', 'database', 'schema.sql'),
  ];
  const schemaPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!schemaPath) {
    return;
  }
  const sqlContent = fs.readFileSync(schemaPath, 'utf-8');
  const cleanedSql = sqlContent.replace(/^\s*--.*$/gm, '');
  const statements = cleanedSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    // Proteksi mutlak: jangan pernah mengeksekusi statement destruktif
    if (/^\s*(DROP|TRUNCATE|DELETE)\b/i.test(stmt)) {
      continue;
    }
    await pool.query(stmt);
  }
}

function truncStr(val: any, maxLen: number): string | null {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeJsonParse<T>(raw: any, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_PERMS_BY_ROLE: Record<string, any> = {
  admin: { canManagePrograms: false, canCreateTor: false, canApproveTor: false, canManageUsers: true, canViewAllTors: true },
  director: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
  hr: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
  finance: { canManagePrograms: false, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
  program_manager: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
  meal: { canManagePrograms: true, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
  staff: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: false },
};

function normalizeMysqlUserRole(rawRole: any): string {
  const clean = String(rawRole || '').trim().toLowerCase();
  if (clean === 'admin' || clean === 'administrator' || clean === 'system administrator' || clean === 'superadmin') {
    return 'admin';
  }
  if (clean === 'director' || clean === 'direktur' || clean === 'executive director') {
    return 'director';
  }
  if (clean === 'finance' || clean === 'keuangan' || clean === 'finance & hr manager' || clean === 'finance_hr') {
    return 'finance';
  }
  if (clean === 'hr' || clean === 'hrd' || clean === 'human resources') {
    return 'hr';
  }
  if (clean === 'program_manager' || clean === 'program manager' || clean === 'pm') {
    return 'program_manager';
  }
  if (clean === 'meal' || clean === 'meal coordinator' || clean === 'monitoring') {
    return 'meal';
  }
  if (clean === 'staff' || clean === 'staf') {
    return 'staff';
  }
  return clean || 'staff';
}

function deriveUsernameFallback(email: string, name: string, id: string): string {
  const fromEmail = (email || '').split('@')[0]?.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (fromEmail) return fromEmail;
  const fromName = (name || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return fromName || `user.${id}`;
}

/**
 * Hidrasi baris tabel `users` MySQL dengan memprioritaskan kolom relasional MySQL
 * (`id`, `username`, `name`, `email`, `password_hash`, `role`, `role_title`, `department`,
 * `is_active`, `account_status`, `permissions_json`) dan melengkapinya dengan `raw_json`.
 */
export function hydrateMysqlUserRow(r: any): any {
  const raw = safeJsonParse<Record<string, any>>(r?.raw_json, {});
  const colPerms = safeJsonParse<Record<string, any> | null>(
    r?.permissions_json ?? r?.permissions,
    null
  );
  const resolvedRole = normalizeMysqlUserRole(r?.role || raw.role || 'staff');
  const basePerms = DEFAULT_PERMS_BY_ROLE[resolvedRole] || DEFAULT_PERMS_BY_ROLE.staff;
  const rawPerms =
    raw.permissions && typeof raw.permissions === 'object'
      ? raw.permissions
      : colPerms && typeof colPerms === 'object'
      ? colPerms
      : {};
  const mergedPerms = {
    canManagePrograms:
      colPerms?.canManagePrograms ?? rawPerms.canManagePrograms ?? basePerms.canManagePrograms,
    canCreateTor: colPerms?.canCreateTor ?? rawPerms.canCreateTor ?? basePerms.canCreateTor,
    canApproveTor:
      resolvedRole === 'admin'
        ? false
        : colPerms?.canApproveTor ?? rawPerms.canApproveTor ?? basePerms.canApproveTor,
    canManageUsers:
      resolvedRole === 'admin'
        ? true
        : colPerms?.canManageUsers ?? rawPerms.canManageUsers ?? basePerms.canManageUsers,
    canViewAllTors:
      colPerms?.canViewAllTors ?? rawPerms.canViewAllTors ?? basePerms.canViewAllTors,
  };

  const sqlColPasswordHash =
    (typeof r?.password_hash === 'string' && r.password_hash.trim()) ||
    (typeof r?.password === 'string' && r.password.trim()) ||
    (typeof r?.passwordHash === 'string' && r.passwordHash.trim()) ||
    undefined;

  const rawJsonPasswordHash =
    (typeof raw.passwordHash === 'string' && raw.passwordHash.trim()) ||
    (typeof raw.password_hash === 'string' && raw.password_hash.trim()) ||
    (typeof raw.password === 'string' && raw.password.trim()) ||
    undefined;

  const resolvedPasswordHash = sqlColPasswordHash || rawJsonPasswordHash;

  // Jika password_hash di kolom SQL berbeda dengan raw_json (misal baru diubah di database),
  // jangan paksa mustChangePassword dari raw_json lama.
  const sqlHashDiffersFromRaw =
    Boolean(sqlColPasswordHash && rawJsonPasswordHash && sqlColPasswordHash !== rawJsonPasswordHash);

  const resolvedMustChangePassword =
    r?.must_change_password !== undefined && r?.must_change_password !== null
      ? Boolean(Number(r.must_change_password))
      : sqlHashDiffersFromRaw
      ? false
      : raw.mustChangePassword !== undefined
      ? Boolean(raw.mustChangePassword)
      : false;

  const resolvedIsActive =
    r?.is_active !== undefined && r?.is_active !== null
      ? Boolean(Number(r.is_active))
      : raw.isActive !== false;

  const resolvedAccountStatus =
    (typeof r?.account_status === 'string' && r.account_status.trim()) ||
    raw.accountStatus ||
    (resolvedIsActive ? 'Aktif' : 'Nonaktif');

  const id = String(r?.id || raw.id || '');
  const name = (typeof r?.name === 'string' && r.name.trim()) || raw.name || '';
  const email = (typeof r?.email === 'string' && r.email.trim()) || raw.email || '';
  const username =
    (typeof r?.username === 'string' && r.username.trim()) ||
    (typeof raw.username === 'string' && raw.username.trim()) ||
    deriveUsernameFallback(email, name, id);

  return {
    ...raw,
    id,
    username,
    name,
    email,
    passwordHash: resolvedPasswordHash,
    mustChangePassword: resolvedMustChangePassword,
    passwordUpdatedAt:
      r?.password_updated_at || raw.passwordUpdatedAt || r?.created_at || raw.createdAt || undefined,
    role: resolvedRole,
    roleTitle:
      (typeof r?.role_title === 'string' && r.role_title.trim()) ||
      raw.roleTitle ||
      resolvedRole.toUpperCase(),
    department:
      (typeof r?.department === 'string' && r.department.trim()) || raw.department || '',
    isActive: resolvedAccountStatus === 'Aktif' && resolvedIsActive,
    accountStatus: resolvedAccountStatus,
    permissions: mergedPerms,
    lastLoginAt: r?.last_login_at || raw.lastLoginAt || undefined,
    createdAt: r?.created_at || raw.createdAt || '2026-01-10T08:00:00Z',
  };
}

/**
 * Mengambil daftar pengguna langsung dari tabel `users` MySQL secara real-time.
 */
export async function fetchUsersFromMysql(pool: MysqlPoolLike): Promise<any[]> {
  const [userRows] = await pool.query('SELECT * FROM users');
  if (!Array.isArray(userRows)) {
    return [];
  }
  const hydrated = userRows.map(hydrateMysqlUserRow).filter((u) => Boolean(u.id));
  hydrated.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return hydrated;
}

/**
 * Membaca seluruh data aplikasi dari tabel-tabel MySQL menggunakan query SELECT
 */
export async function loadDatabaseFromMysql(
  pool: MysqlPoolLike,
  _fallbackSeed?: DatabaseSchema
): Promise<DatabaseSchema | null> {
  await ensureMysqlSchema(pool);

  const users = await fetchUsersFromMysql(pool);
  const hasUsers = users.length > 0;

  if (!hasUsers) {
    const [countRows] = await pool.query(
      `SELECT (
        (SELECT COUNT(*) FROM programs) +
        (SELECT COUNT(*) FROM outcomes) +
        (SELECT COUNT(*) FROM outputs) +
        (SELECT COUNT(*) FROM activities) +
        (SELECT COUNT(*) FROM tors) +
        (SELECT COUNT(*) FROM cash_advances) +
        (SELECT COUNT(*) FROM meeting_minutes) +
        (SELECT COUNT(*) FROM participants) +
        (SELECT COUNT(*) FROM attendance_records) +
        (SELECT COUNT(*) FROM system_kv_store)
      ) AS total_cnt`
    );
    const totalExistingRecords = Number(countRows?.[0]?.total_cnt || 0);

    if (totalExistingRecords === 0) {
      return null; // Seluruh tabel aplikasi MySQL benar-benar kosong
    }
  }

  const [programRows] = await pool.query('SELECT * FROM programs');
  const [outcomeRows] = await pool.query('SELECT * FROM outcomes');
  const [outputRows] = await pool.query('SELECT * FROM outputs');
  const [activityRows] = await pool.query('SELECT * FROM activities');
  const [subActivityRows] = await pool.query('SELECT * FROM sub_activities');
  const [torRows] = await pool.query('SELECT * FROM tors');
  const [approvalRows] = await pool.query('SELECT * FROM approval_records');
  const [caRows] = await pool.query('SELECT * FROM cash_advances');
  const [minutesRows] = await pool.query('SELECT * FROM meeting_minutes');
  const [participantRows] = await pool.query('SELECT * FROM participants');
  const [attendanceRows] = await pool.query('SELECT * FROM attendance_records');
  const [auditRows] = await pool.query('SELECT * FROM audit_logs');
  const [kvRows] = await pool.query('SELECT store_key, store_value FROM system_kv_store');

  const kvMap: Record<string, any> = {};
  if (Array.isArray(kvRows)) {
    for (const row of kvRows) {
      kvMap[row.store_key] = safeJsonParse(row.store_value, null);
    }
  }

  const parseAndHydrateRows = <T>(
    rows: any[],
    hydrator: (r: any, raw: Record<string, any>) => Record<string, any>
  ): T[] => {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => {
        const raw = safeJsonParse<Record<string, any>>(r?.raw_json, {});
        return hydrator(r, raw) as T;
      })
      .filter((item: any) => Boolean(item && item.id));
  };

  const programs = parseAndHydrateRows<any>(programRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    code: r?.code || raw.code || '',
    name: r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    donor: r?.donor ?? raw.donor ?? '',
    startDate: r?.start_date || raw.startDate || '',
    endDate: r?.end_date || raw.endDate || '',
    totalBudget:
      r?.total_budget !== undefined && r?.total_budget !== null
        ? Number(r.total_budget)
        : Number(raw.totalBudget ?? raw.budget ?? 0),
    budget:
      raw.budget !== undefined
        ? Number(raw.budget)
        : r?.total_budget !== undefined && r?.total_budget !== null
        ? Number(r.total_budget)
        : Number(raw.totalBudget ?? 0),
    currency: r?.currency || raw.currency || 'IDR',
    status: r?.status || raw.status || 'Active',
    createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
  })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const outcomes = parseAndHydrateRows<any>(outcomeRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    programId: r?.program_id || raw.programId || '',
    code: r?.code || raw.code || '',
    name: r?.name || raw.name || raw.title || '',
    title: raw.title || r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
  }));

  const outputs = parseAndHydrateRows<any>(outputRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    programId: r?.program_id || raw.programId || '',
    outcomeId: r?.outcome_id || raw.outcomeId || '',
    code: r?.code || raw.code || '',
    name: r?.name || raw.name || raw.title || '',
    title: raw.title || r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
  }));

  const activities = parseAndHydrateRows<any>(activityRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    programId: r?.program_id || raw.programId || '',
    outcomeId: r?.outcome_id || raw.outcomeId || '',
    outputId: r?.output_id || raw.outputId || '',
    code: r?.code || raw.code || '',
    name: r?.name || raw.name || raw.title || '',
    title: raw.title || r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
  }));

  const subActivities = parseAndHydrateRows<any>(subActivityRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    activityId: r?.activity_id || raw.activityId || '',
    code: r?.code || raw.code || '',
    name: r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
  }));

  const tors = parseAndHydrateRows<any>(torRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    torNumber: r?.tor_number ?? raw.torNumber,
    title: r?.title || raw.title || '',
    programId: r?.program_id || raw.programId || '',
    outcomeId: r?.outcome_id || raw.outcomeId || '',
    outputId: r?.output_id || raw.outputId || '',
    activityId: r?.activity_id || raw.activityId || '',
    createdById: raw.createdById || r?.created_by_user_id || '',
    createdByName: r?.created_by_name || raw.createdByName || '',
    status: r?.status || raw.status || 'Draft',
    currentWorkflowStage:
      r?.current_stage !== undefined && r?.current_stage !== null
        ? Number(r.current_stage)
        : Number(raw.currentWorkflowStage ?? 1),
    budgetRequested:
      r?.budget_requested !== undefined && r?.budget_requested !== null
        ? Number(r.budget_requested)
        : Number(raw.budgetRequested ?? 0),
    budgetActualSpent:
      r?.budget_actual_spent !== undefined && r?.budget_actual_spent !== null
        ? Number(r.budget_actual_spent)
        : Number(raw.budgetActualSpent ?? 0),
    startDate: r?.start_date || raw.startDate || '',
    endDate: r?.end_date || raw.endDate || '',
    location: r?.location || raw.location || '',
    createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
    updatedAt: r?.updated_at || raw.updatedAt || new Date().toISOString(),
  })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const approvalRecords = parseAndHydrateRows<any>(approvalRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    torId: r?.tor_id || raw.torId || '',
    stage: r?.stage ?? raw.stage ?? 1,
    approverId: raw.approverId || r?.approver_user_id || '',
    approverName: r?.approver_name || raw.approverName || '',
    role: r?.role || raw.role || '',
    action: r?.action || raw.action || '',
    notes: r?.notes ?? raw.notes ?? raw.comment ?? '',
    comment: raw.comment ?? r?.notes ?? raw.notes ?? '',
    timestamp: r?.timestamp || raw.timestamp || new Date().toISOString(),
  })).sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

  const cashAdvances = parseAndHydrateRows<any>(caRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    caNumber: r?.ca_number || raw.caNumber || raw.documentNumber || '',
    documentNumber: raw.documentNumber || r?.ca_number || raw.caNumber || '',
    torId: r?.tor_id || raw.torId || '',
    programId: r?.program_id || raw.programId || '',
    activityId: r?.activity_id || raw.activityId || '',
    requesterId: raw.requesterId || r?.requester_user_id || '',
    requesterName: r?.requester_name || raw.requesterName || '',
    totalAmount:
      r?.total_amount !== undefined && r?.total_amount !== null
        ? Number(r.total_amount)
        : Number(raw.totalAmount ?? 0),
    realizedAmount:
      r?.realized_amount !== undefined && r?.realized_amount !== null
        ? Number(r.realized_amount)
        : raw.realizedAmount !== undefined
        ? Number(raw.realizedAmount)
        : undefined,
    status: r?.status || raw.status || 'Draft',
    reportApprovalStatus: r?.report_approval_status ?? raw.reportApprovalStatus,
    createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
    updatedAt: r?.updated_at || raw.updatedAt || new Date().toISOString(),
  })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const meetingMinutes = parseAndHydrateRows<any>(minutesRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    torId: r?.tor_id || raw.torId || '',
    activityId: r?.activity_id || raw.activityId || '',
    title: r?.title || raw.title || '',
    meetingDate: r?.meeting_date || raw.meetingDate || raw.date || '',
    date: raw.date || r?.meeting_date || raw.meetingDate || '',
    location: r?.location || raw.location || '',
    createdById: raw.createdById || r?.created_by_user_id || '',
    status: r?.status || raw.status || 'Draft',
    createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
  })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const participantDatabase = parseAndHydrateRows<any>(participantRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    entityType: raw.entityType || r?.participant_type || 'INDIVIDUAL',
    fullName: raw.fullName || r?.name || raw.name || '',
    name: r?.name || raw.name || raw.fullName || '',
    gender: r?.gender || raw.gender || undefined,
    institutionName: raw.institutionName || r?.organization_or_group || undefined,
    phoneNumber: raw.phoneNumber || r?.phone || undefined,
    cityOrRegency: raw.cityOrRegency || r?.village_or_city || undefined,
    createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
  })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const hydratedAttendanceRecords = parseAndHydrateRows<any>(attendanceRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    date: r?.record_date || raw.date || '',
    userId: r?.user_id || raw.userId || '',
    userName: r?.user_name || raw.userName || '',
    recordType: r?.record_type || raw.recordType || 'ATTENDANCE',
    clockInTime: r?.clock_in_time ?? raw.clockInTime,
    clockOutTime: r?.clock_out_time ?? raw.clockOutTime,
    totalWorkHours:
      r?.total_work_hours !== undefined && r?.total_work_hours !== null
        ? Number(r.total_work_hours)
        : Number(raw.totalWorkHours ?? 0),
    isOutsideWorkLocation:
      r?.is_outside_work_location !== undefined && r?.is_outside_work_location !== null
        ? Boolean(Number(r.is_outside_work_location))
        : Boolean(raw.isOutsideWorkLocation),
    createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
    updatedAt: r?.updated_at || raw.updatedAt || new Date().toISOString(),
  })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const auditLogs = parseAndHydrateRows<any>(auditRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    torId: r?.tor_id || raw.torId || undefined,
    actorId: raw.actorId || r?.user_id || 'system',
    actorName: raw.actorName || r?.user_name || 'System',
    actorRole: raw.actorRole || r?.user_role || '',
    action: r?.action || raw.action || '',
    entityType: raw.entityType || (r?.tor_id ? 'TOR' : 'SYSTEM'),
    entityId: raw.entityId || r?.tor_id || 'system',
    details: r?.details || raw.details || '',
    timestamp: r?.timestamp || raw.timestamp || new Date().toISOString(),
  })).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  const attendanceSystem = kvMap['attendanceSystem'] || {
    locationConfig: {
      officeName: 'Kantor Pusat Yayasan WIJNA',
      address: 'Kantor WIJNA (-7.342604, 110.489848)',
      latitude: -7.342604,
      longitude: 110.489848,
      radiusMeters: 5,
      standardDailyHours: 8,
    },
    records: [],
    flextimeAssignments: [],
    leavePolicies: [],
    leaveRequests: [],
    wfaRequests: [],
    holidayRequests: [],
    employeeTrainings: [],
    employeeProfileLinks: {},
    workRecapVerifications: {},
    auditTrail: [],
  };

  if (hydratedAttendanceRecords.length > 0 || !Array.isArray(attendanceSystem.records)) {
    attendanceSystem.records = hydratedAttendanceRecords;
  }

  return {
    users: users as any,
    currentUserId: kvMap['currentUserId'] || users[0]?.id || 'user-director',
    programs,
    outcomes,
    outputs,
    activities,
    subActivities,
    tors,
    approvalRecords,
    auditLogs,
    cashAdvances,
    cashAdvanceSummaries: kvMap['cashAdvanceSummaries'] || {},
    cashAdvanceAuditLogs: kvMap['cashAdvanceAuditLogs'] || {},
    meetingMinutes,
    activityDocumentations: kvMap['activityDocumentations'] || {},
    activityDocumentationList: kvMap['activityDocumentationList'] || [],
    outputRaciRecords: kvMap['outputRaciRecords'] || {},
    activityMonitoringRecords: kvMap['activityMonitoringRecords'] || {},
    monitoringReports: kvMap['monitoringReports'] || {},
    approvalHubItems: kvMap['approvalHubItems'] || {},
    approvalWorkflowConfigs: kvMap['approvalWorkflowConfigs'] || {},
    approvalNotifications: kvMap['approvalNotifications'] || [],
    programBudgets: kvMap['programBudgets'] || {},
    participantDatabase,
    attendanceSystem,
    organizationSettings: kvMap['organizationSettings'] || undefined,
    cleanResetPrj3581V1:
      kvMap['cleanResetPrj3581V1'] !== undefined
        ? Boolean(kvMap['cleanResetPrj3581V1'])
        : undefined,
    cleanResetPrj3581V2:
      kvMap['cleanResetPrj3581V2'] !== undefined
        ? Boolean(kvMap['cleanResetPrj3581V2'])
        : undefined,
  };
}

/**
 * Menyimpan entri metadata spesifik ke system_kv_store secara non-destructive (tanpa menyentuh tabel operasional)
 */
export async function upsertMysqlKvEntries(
  pool: MysqlPoolLike,
  entries: Record<string, any>
): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined) continue;
    await pool.query(
      `INSERT INTO system_kv_store (store_key, store_value, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         store_value = VALUES(store_value),
         updated_at = VALUES(updated_at)`,
      [k, JSON.stringify(v), nowIso]
    );
  }
}

/**
 * Menyimpan 1 baris pengguna (termasuk perubahan username, email, role, atau passwordHash)
 * secara langsung & atomik ke tabel users MySQL agar tidak pernah tertunda atau ikut ter-rollback tabel lain.
 */
export async function upsertMysqlUserRow(pool: MysqlPoolLike, u: any): Promise<void> {
  if (!u || !u.id) return;
  await pool.query(
    `INSERT INTO users (
      id, username, name, email, password_hash, role, role_title, department,
      is_active, account_status, permissions_json, last_login_at, created_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      name = VALUES(name),
      email = VALUES(email),
      password_hash = COALESCE(NULLIF(VALUES(password_hash), ''), users.password_hash),
      role = VALUES(role),
      role_title = VALUES(role_title),
      department = VALUES(department),
      is_active = VALUES(is_active),
      account_status = VALUES(account_status),
      permissions_json = VALUES(permissions_json),
      last_login_at = VALUES(last_login_at),
      raw_json = VALUES(raw_json)`,
    [
      String(u.id).slice(0, 128),
      truncStr(u.username, 128),
      truncStr(u.name, 255) || '',
      truncStr(u.email, 255) || '',
      truncStr(u.passwordHash, 255),
      truncStr(u.role, 64) || 'staff',
      truncStr(u.roleTitle, 255),
      truncStr(u.department, 255),
      u.isActive === false ? 0 : 1,
      truncStr(u.accountStatus || (u.isActive === false ? 'Nonaktif' : 'Aktif'), 64),
      JSON.stringify(u.permissions || {}),
      truncStr(u.lastLoginAt, 64),
      truncStr(u.createdAt || new Date().toISOString(), 64),
      JSON.stringify(u),
    ]
  );
}

export async function deleteMysqlUserRow(pool: MysqlPoolLike, userId: string): Promise<void> {
  if (!userId) return;
  await pool.query('DELETE FROM users WHERE id = ?', [String(userId).slice(0, 128)]);
}

async function syncTableById(
  conn: any,
  tableName: string,
  rows: any[],
  insertSql: string,
  mapRowParams: (item: any) => any[],
  options?: { allowDeleteMissing?: boolean }
) {
  const safeRows = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
  const currentIds = safeRows.map((r) => String(r.id));
  const allowDelete = options?.allowDeleteMissing !== false;

  if (currentIds.length === 0) {
    if (allowDelete && tableName !== 'users') {
      await conn.query(`DELETE FROM ${tableName}`);
    }
    return;
  }

  if (allowDelete && tableName !== 'users') {
    const placeholders = currentIds.map(() => '?').join(', ');
    await conn.query(
      `DELETE FROM ${tableName} WHERE id NOT IN (${placeholders})`,
      currentIds
    );
  }

  for (const item of safeRows) {
    await conn.query(insertSql, mapRowParams(item));
  }
}

/**
 * Menyimpan seluruh perubahan data ke tabel-tabel MySQL (INSERT / UPDATE / DELETE).
 * Catatan penting untuk tabel `users`:
 * - Penghapusan baris `users` TIDAK PERNAH dilakukan secara massal di fungsi ini (hanya melalui deleteMysqlUserRow).
 * - Kolom `password_hash` yang sudah ada di MySQL dilindungi agar tidak pernah tertimpa nilai kosong,
 *   sedangkan pembaruan password dilakukan secara atomik melalui upsertMysqlUserRow.
 */
export async function saveDatabaseToMysql(
  pool: MysqlPoolLike,
  data: DatabaseSchema
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Tabel users (Protected: allowDeleteMissing = false, preserves existing password_hash)
    await syncTableById(
      conn,
      'users',
      data.users || [],
      `INSERT INTO users (
        id, username, name, email, password_hash, role, role_title, department,
        is_active, account_status, permissions_json, last_login_at, created_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        name = VALUES(name),
        email = VALUES(email),
        password_hash = COALESCE(NULLIF(users.password_hash, ''), VALUES(password_hash)),
        role = VALUES(role),
        role_title = VALUES(role_title),
        department = VALUES(department),
        is_active = VALUES(is_active),
        account_status = VALUES(account_status),
        permissions_json = VALUES(permissions_json),
        last_login_at = COALESCE(VALUES(last_login_at), users.last_login_at),
        raw_json = VALUES(raw_json)`,
      (u) => [
        String(u.id).slice(0, 128),
        truncStr(u.username, 128),
        truncStr(u.name, 255) || '',
        truncStr(u.email, 255) || '',
        truncStr(u.passwordHash, 255),
        truncStr(u.role, 64) || 'staff',
        truncStr(u.roleTitle, 255),
        truncStr(u.department, 255),
        u.isActive === false ? 0 : 1,
        truncStr(u.accountStatus || (u.isActive === false ? 'Nonaktif' : 'Aktif'), 64),
        JSON.stringify(u.permissions || {}),
        truncStr(u.lastLoginAt, 64),
        truncStr(u.createdAt || new Date().toISOString(), 64),
        JSON.stringify(u),
      ],
      { allowDeleteMissing: false }
    );

    // 2. Tabel programs
    await syncTableById(
      conn,
      'programs',
      data.programs || [],
      `INSERT INTO programs (
        id, code, name, description, donor, start_date, end_date,
        total_budget, currency, status, created_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        code = VALUES(code),
        name = VALUES(name),
        description = VALUES(description),
        donor = VALUES(donor),
        start_date = VALUES(start_date),
        end_date = VALUES(end_date),
        total_budget = VALUES(total_budget),
        currency = VALUES(currency),
        status = VALUES(status),
        raw_json = VALUES(raw_json)`,
      (p) => [
        String(p.id).slice(0, 128),
        truncStr(p.code, 64),
        truncStr(p.name, 255) || '',
        p.description || null,
        truncStr(p.donor, 255),
        truncStr(p.startDate, 32),
        truncStr(p.endDate, 32),
        Number(p.totalBudget || p.budget || 0),
        truncStr(p.currency || 'IDR', 16),
        truncStr(p.status || 'Active', 64),
        truncStr(p.createdAt || new Date().toISOString(), 64),
        JSON.stringify(p),
      ]
    );

    // 3. Tabel outcomes
    await syncTableById(
      conn,
      'outcomes',
      data.outcomes || [],
      `INSERT INTO outcomes (id, program_id, code, name, description, budget_allocated, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         program_id = VALUES(program_id),
         code = VALUES(code),
         name = VALUES(name),
         description = VALUES(description),
         budget_allocated = VALUES(budget_allocated),
         raw_json = VALUES(raw_json)`,
      (oc) => [
        oc.id,
        oc.programId || '',
        oc.code || null,
        oc.name || oc.title || '',
        oc.description || null,
        Number(oc.budgetAllocated || oc.budget || 0),
        JSON.stringify(oc),
      ]
    );

    // 4. Tabel outputs
    await syncTableById(
      conn,
      'outputs',
      data.outputs || [],
      `INSERT INTO outputs (id, program_id, outcome_id, code, name, description, budget_allocated, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         program_id = VALUES(program_id),
         outcome_id = VALUES(outcome_id),
         code = VALUES(code),
         name = VALUES(name),
         description = VALUES(description),
         budget_allocated = VALUES(budget_allocated),
         raw_json = VALUES(raw_json)`,
      (op) => [
        op.id,
        op.programId || null,
        op.outcomeId || '',
        op.code || null,
        op.name || op.title || '',
        op.description || null,
        Number(op.budgetAllocated || op.budget || 0),
        JSON.stringify(op),
      ]
    );

    // 5. Tabel activities
    await syncTableById(
      conn,
      'activities',
      data.activities || [],
      `INSERT INTO activities (id, program_id, outcome_id, output_id, code, name, description, budget_allocated, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         program_id = VALUES(program_id),
         outcome_id = VALUES(outcome_id),
         output_id = VALUES(output_id),
         code = VALUES(code),
         name = VALUES(name),
         description = VALUES(description),
         budget_allocated = VALUES(budget_allocated),
         raw_json = VALUES(raw_json)`,
      (ac) => [
        ac.id,
        ac.programId || null,
        ac.outcomeId || null,
        ac.outputId || '',
        ac.code || null,
        ac.name || ac.title || '',
        ac.description || null,
        Number(ac.budgetAllocated || ac.budget || 0),
        JSON.stringify(ac),
      ]
    );

    // 6. Tabel sub_activities
    await syncTableById(
      conn,
      'sub_activities',
      data.subActivities || [],
      `INSERT INTO sub_activities (id, activity_id, code, name, description, budget_allocated, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         activity_id = VALUES(activity_id),
         code = VALUES(code),
         name = VALUES(name),
         description = VALUES(description),
         budget_allocated = VALUES(budget_allocated),
         raw_json = VALUES(raw_json)`,
      (sa) => [
        sa.id,
        sa.activityId || '',
        sa.code || null,
        sa.name || '',
        sa.description || null,
        Number(sa.budgetAllocated || sa.budget || 0),
        JSON.stringify(sa),
      ]
    );

    // 7. Tabel tors
    await syncTableById(
      conn,
      'tors',
      data.tors || [],
      `INSERT INTO tors (
        id, tor_number, title, program_id, outcome_id, output_id, activity_id,
        created_by_user_id, created_by_name, status, current_stage,
        budget_requested, budget_actual_spent, start_date, end_date, location,
        created_at, updated_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        tor_number = VALUES(tor_number),
        title = VALUES(title),
        program_id = VALUES(program_id),
        outcome_id = VALUES(outcome_id),
        output_id = VALUES(output_id),
        activity_id = VALUES(activity_id),
        status = VALUES(status),
        current_stage = VALUES(current_stage),
        budget_requested = VALUES(budget_requested),
        budget_actual_spent = VALUES(budget_actual_spent),
        start_date = VALUES(start_date),
        end_date = VALUES(end_date),
        location = VALUES(location),
        updated_at = VALUES(updated_at),
        raw_json = VALUES(raw_json)`,
      (t) => [
        String(t.id).slice(0, 128),
        truncStr(t.torNumber, 128),
        truncStr(t.title, 500) || '',
        truncStr(t.programId, 128),
        truncStr(t.outcomeId, 128),
        truncStr(t.outputId, 128),
        truncStr(t.activityId, 128),
        truncStr(t.createdByUserId || t.createdById, 128),
        truncStr(t.createdByName || t.picName, 255),
        truncStr(t.status || 'Draft', 128),
        Number(t.currentWorkflowStage || 1),
        t.budgetRequested != null ? Number(t.budgetRequested) : null,
        t.budgetActualSpent != null ? Number(t.budgetActualSpent) : null,
        truncStr(t.startDate, 32),
        truncStr(t.endDate, 32),
        truncStr(t.location, 255),
        truncStr(t.createdAt || new Date().toISOString(), 64),
        truncStr(t.updatedAt || new Date().toISOString(), 64),
        JSON.stringify(t),
      ]
    );

    // 8. Tabel approval_records
    await syncTableById(
      conn,
      'approval_records',
      data.approvalRecords || [],
      `INSERT INTO approval_records (
        id, tor_id, stage, approver_user_id, approver_name, role, action, notes, timestamp, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        action = VALUES(action),
        notes = VALUES(notes),
        timestamp = VALUES(timestamp),
        raw_json = VALUES(raw_json)`,
      (ar) => [
        ar.id,
        ar.torId || '',
        ar.stage != null ? Number(ar.stage) : null,
        ar.approverUserId || null,
        ar.approverName || null,
        ar.role || null,
        ar.action || null,
        ar.notes || null,
        ar.timestamp || new Date().toISOString(),
        JSON.stringify(ar),
      ]
    );

    // 9. Tabel cash_advances
    await syncTableById(
      conn,
      'cash_advances',
      data.cashAdvances || [],
      `INSERT INTO cash_advances (
        id, ca_number, tor_id, program_id, activity_id, requester_user_id, requester_name,
        total_amount, realized_amount, status, report_approval_status, created_at, updated_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        ca_number = VALUES(ca_number),
        total_amount = VALUES(total_amount),
        realized_amount = VALUES(realized_amount),
        status = VALUES(status),
        report_approval_status = VALUES(report_approval_status),
        updated_at = VALUES(updated_at),
        raw_json = VALUES(raw_json)`,
      (ca) => [
        ca.id,
        ca.caNumber || ca.documentNumber || null,
        ca.torId || null,
        ca.programId || null,
        ca.activityId || null,
        ca.requesterUserId || ca.submittedByUserId || null,
        ca.requesterName || ca.submittedByName || null,
        Number(ca.totalAmount || 0),
        ca.realizedAmount != null ? Number(ca.realizedAmount) : null,
        ca.status || 'Draft',
        ca.reportApprovalStatus || null,
        ca.createdAt || new Date().toISOString(),
        ca.updatedAt || new Date().toISOString(),
        JSON.stringify(ca),
      ]
    );

    // 10. Tabel meeting_minutes
    await syncTableById(
      conn,
      'meeting_minutes',
      data.meetingMinutes || [],
      `INSERT INTO meeting_minutes (
        id, tor_id, activity_id, title, meeting_date, location, created_by_user_id, status, created_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        meeting_date = VALUES(meeting_date),
        location = VALUES(location),
        status = VALUES(status),
        raw_json = VALUES(raw_json)`,
      (mm) => [
        mm.id,
        mm.torId || null,
        mm.activityId || null,
        mm.title || mm.agenda || null,
        mm.meetingDate || mm.date || null,
        mm.location || null,
        mm.createdByUserId || null,
        mm.status || null,
        mm.createdAt || new Date().toISOString(),
        JSON.stringify(mm),
      ]
    );

    // 11. Tabel participants
    await syncTableById(
      conn,
      'participants',
      data.participantDatabase || [],
      `INSERT INTO participants (
        id, participant_type, name, gender, organization_or_group, phone, village_or_city, created_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        participant_type = VALUES(participant_type),
        name = VALUES(name),
        gender = VALUES(gender),
        organization_or_group = VALUES(organization_or_group),
        phone = VALUES(phone),
        village_or_city = VALUES(village_or_city),
        raw_json = VALUES(raw_json)`,
      (pt: any) => [
        pt.id,
        pt.entityType || pt.participantType || 'INDIVIDUAL',
        pt.fullName || pt.groupName || pt.name || '',
        pt.gender || null,
        pt.institutionName || pt.groupName || null,
        pt.phoneNumber || pt.contactPhone || null,
        pt.cityOrRegency || pt.villageOrSubdistrict || null,
        pt.createdAt || new Date().toISOString(),
        JSON.stringify(pt),
      ]
    );

    // 12. Tabel attendance_records
    await syncTableById(
      conn,
      'attendance_records',
      data.attendanceSystem?.records || [],
      `INSERT INTO attendance_records (
        id, record_date, user_id, user_name, record_type, clock_in_time, clock_out_time,
        total_work_hours, is_outside_work_location, created_at, updated_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        clock_in_time = VALUES(clock_in_time),
        clock_out_time = VALUES(clock_out_time),
        total_work_hours = VALUES(total_work_hours),
        is_outside_work_location = VALUES(is_outside_work_location),
        updated_at = VALUES(updated_at),
        raw_json = VALUES(raw_json)`,
      (att) => [
        att.id,
        att.date || '',
        att.userId || '',
        att.userName || null,
        att.recordType || 'ATTENDANCE',
        att.clockInTime || null,
        att.clockOutTime || null,
        Number(att.totalWorkHours || 0),
        att.isOutsideWorkLocation ? 1 : 0,
        att.createdAt || new Date().toISOString(),
        att.updatedAt || new Date().toISOString(),
        JSON.stringify(att),
      ]
    );

    // 13. Tabel audit_logs
    await syncTableById(
      conn,
      'audit_logs',
      data.auditLogs || [],
      `INSERT INTO audit_logs (
        id, tor_id, user_id, user_name, user_role, action, details, timestamp, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        action = VALUES(action),
        details = VALUES(details),
        raw_json = VALUES(raw_json)`,
      (al) => [
        String(al.id).slice(0, 128),
        truncStr(al.torId || (al.entityType === 'TOR' ? al.entityId : null), 128),
        truncStr(al.userId || al.actorId, 128),
        truncStr(al.userName || al.actorName, 255),
        truncStr(al.userRole || al.actorRole, 64),
        truncStr(al.action, 255) || '',
        al.details || null,
        truncStr(al.timestamp || new Date().toISOString(), 64) || new Date().toISOString(),
        JSON.stringify(al),
      ]
    );

    // 14. Tabel system_kv_store untuk koleksi terstruktur lainnya
    const nowIso = new Date().toISOString();
    const kvEntries: Record<string, any> = {
      currentUserId: data.currentUserId,
      cashAdvanceSummaries: data.cashAdvanceSummaries || {},
      cashAdvanceAuditLogs: data.cashAdvanceAuditLogs || {},
      activityDocumentations: data.activityDocumentations || {},
      activityDocumentationList: data.activityDocumentationList || [],
      outputRaciRecords: data.outputRaciRecords || {},
      activityMonitoringRecords: data.activityMonitoringRecords || {},
      monitoringReports: data.monitoringReports || {},
      approvalHubItems: data.approvalHubItems || {},
      approvalWorkflowConfigs: data.approvalWorkflowConfigs || {},
      approvalNotifications: data.approvalNotifications || [],
      programBudgets: data.programBudgets || {},
      attendanceSystem: data.attendanceSystem || {},
      cleanResetPrj3581V1: data.cleanResetPrj3581V1 ?? true,
      cleanResetPrj3581V2: data.cleanResetPrj3581V2 ?? true,
    };
    if (data.organizationSettings !== undefined) {
      kvEntries.organizationSettings = data.organizationSettings;
    }

    for (const [k, v] of Object.entries(kvEntries)) {
      await conn.query(
        `INSERT INTO system_kv_store (store_key, store_value, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           store_value = VALUES(store_value),
           updated_at = VALUES(updated_at)`,
        [k, JSON.stringify(v), nowIso]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
