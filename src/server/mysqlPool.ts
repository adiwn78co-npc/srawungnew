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
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(__poolDir, '.env'),
  path.resolve(__poolDir, '..', '.env'),
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
    Boolean(
      process.env.MYSQL_HOST ||
        process.env.MYSQL_DATABASE ||
        process.env.MYSQL_DB ||
        process.env.MYSQL_USER ||
        process.env.MYSQL_URL ||
        process.env.DB_HOST ||
        process.env.DB_DATABASE ||
        process.env.DB_NAME ||
        process.env.DB_USER
    )
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
 * Membaca konfigurasi MySQL dari MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 * serta mendukung alias standar hosting (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE/DB_NAME, MYSQL_URL).
 */
export function resolveMysqlConfig(): ResolvedMysqlConfig {
  let urlHost = '';
  let urlPort = 0;
  let urlUser = '';
  let urlPass = '';
  let urlDb = '';

  const rawConnUrl = String(process.env.MYSQL_URL || process.env.DATABASE_URL || '').trim();
  if (rawConnUrl && /^mysql2?:\/\//i.test(rawConnUrl)) {
    try {
      const parsed = new URL(rawConnUrl);
      urlHost = parsed.hostname || '';
      urlPort = parsed.port ? Number(parsed.port) : 0;
      urlUser = decodeURIComponent(parsed.username || '');
      urlPass = decodeURIComponent(parsed.password || '');
      urlDb = decodeURIComponent((parsed.pathname || '').replace(/^\/+/, ''));
    } catch {
      // abaikan jika format URL tidak valid
    }
  }

  const mysqlHost = String(
    process.env.MYSQL_HOST || process.env.DB_HOST || urlHost || ''
  ).trim();
  const mysqlUser = String(
    process.env.MYSQL_USER ||
      process.env.DB_USER ||
      process.env.DB_USERNAME ||
      urlUser ||
      ''
  ).trim();
  const mysqlName = String(
    process.env.MYSQL_DATABASE ||
      process.env.MYSQL_DB ||
      process.env.DB_DATABASE ||
      process.env.DB_NAME ||
      urlDb ||
      ''
  ).trim();

  const rawPort = process.env.MYSQL_PORT || process.env.DB_PORT || (urlPort ? String(urlPort) : '3306');
  const port = Number(rawPort) > 0 ? Number(rawPort) : 3306;

  const rawPassword =
    process.env.MYSQL_PASSWORD ??
    process.env.DB_PASSWORD ??
    process.env.DB_PASS ??
    urlPass ??
    '';
  const password = isPlaceholderValue(String(rawPassword)) ? '' : String(rawPassword);

  const user = !isPlaceholderValue(mysqlUser) ? mysqlUser : '';
  const database = !isPlaceholderValue(mysqlName) ? mysqlName : '';

  let host = mysqlHost;
  if (!host && user && database && !isCloudRunEnvironment()) {
    host = '127.0.0.1';
  }

  const socketPath = String(
    process.env.MYSQL_SOCKET_PATH || process.env.DB_SOCKET_PATH || ''
  ).trim() || undefined;

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
  tableColumnsCache.clear();
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
  try {
    const [userRows] = await pool.query('SELECT * FROM users');
    if (!Array.isArray(userRows)) {
      return [];
    }
    const hydrated = userRows.map(hydrateMysqlUserRow).filter((u) => Boolean(u.id));
    hydrated.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return hydrated;
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      try {
        await ensureSingleMissingTableFromSchema(pool, 'users');
      } catch {
        // abaikan jika user tidak memiliki hak CREATE
      }
      return [];
    }
    throw err;
  }
}

async function safeSelectTableRows(
  pool: MysqlPoolLike,
  tableName: string,
  customSql?: string
): Promise<any[]> {
  const sql = customSql || `SELECT * FROM \`${tableName}\``;
  try {
    const [rows] = await pool.query(sql);
    return Array.isArray(rows) ? rows : [];
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      try {
        await ensureSingleMissingTableFromSchema(pool, tableName);
        const [retryRows] = await pool.query(sql);
        return Array.isArray(retryRows) ? retryRows : [];
      } catch {
        return [];
      }
    }
    throw err;
  }
}

/**
 * Membaca seluruh data aplikasi dari tabel-tabel MySQL menggunakan query SELECT secara non-destructive
 */
export async function loadDatabaseFromMysql(
  pool: MysqlPoolLike,
  _fallbackSeed?: DatabaseSchema
): Promise<DatabaseSchema | null> {
  try {
    await ensureMysqlSchema(pool);
  } catch (schemaErr: any) {
    console.warn(
      `[DB] Non-destructive schema check skipped during MySQL load: ${String(schemaErr?.message || schemaErr)}`
    );
  }

  const users = await fetchUsersFromMysql(pool);
  const programRows = await safeSelectTableRows(pool, 'programs');
  const outcomeRows = await safeSelectTableRows(pool, 'outcomes');
  const outputRows = await safeSelectTableRows(pool, 'outputs');
  const activityRows = await safeSelectTableRows(pool, 'activities');
  const subActivityRows = await safeSelectTableRows(pool, 'sub_activities');
  const torRows = await safeSelectTableRows(pool, 'tors');
  const approvalRows = await safeSelectTableRows(pool, 'approval_records');
  const caRows = await safeSelectTableRows(pool, 'cash_advances');
  const minutesRows = await safeSelectTableRows(pool, 'meeting_minutes');
  const participantRows = await safeSelectTableRows(pool, 'participants');
  const attendanceRows = await safeSelectTableRows(pool, 'attendance_records');
  const auditRows = await safeSelectTableRows(pool, 'audit_logs');
  const kvRows = await safeSelectTableRows(
    pool,
    'system_kv_store',
    'SELECT store_key, store_value FROM `system_kv_store`'
  );

  const totalExistingRecords =
    users.length +
    programRows.length +
    outcomeRows.length +
    outputRows.length +
    activityRows.length +
    subActivityRows.length +
    torRows.length +
    approvalRows.length +
    caRows.length +
    minutesRows.length +
    participantRows.length +
    attendanceRows.length +
    kvRows.length;

  if (totalExistingRecords === 0) {
    return null; // Seluruh tabel aplikasi MySQL benar-benar kosong
  }

  const kvMap: Record<string, any> = {};
  if (Array.isArray(kvRows)) {
    for (const row of kvRows) {
      if (row && row.store_key) {
        kvMap[row.store_key] = safeJsonParse(row.store_value, null);
      }
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

  const stripInternalCodePrefix = (val: unknown): string => {
    const s = String(val ?? '');
    return s.includes('::') ? s.split('::').slice(1).join('::') : s;
  };

  const outcomes = parseAndHydrateRows<any>(outcomeRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    programId: r?.program_id || raw.programId || '',
    outcomeNumber:
      raw.outcomeNumber || r?.outcome_number || stripInternalCodePrefix(r?.code) || undefined,
    code: stripInternalCodePrefix(r?.code) || raw.code || raw.outcomeNumber || '',
    name: r?.name || raw.name || raw.title || '',
    title: raw.title || r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    indicators: Array.isArray(raw.indicators)
      ? raw.indicators
      : (() => {
          const parsedInd = safeJsonParse(r?.indicators_json ?? r?.indicators, []);
          return Array.isArray(parsedInd) ? parsedInd : [];
        })(),
    status: r?.status || raw.status || 'Belum Dimulai',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || undefined,
    updatedAt: r?.updated_at || raw.updatedAt || undefined,
  }));

  const outputs = parseAndHydrateRows<any>(outputRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    programId: r?.program_id || raw.programId || '',
    outcomeId: r?.outcome_id || raw.outcomeId || '',
    outputNumber:
      raw.outputNumber || r?.output_number || stripInternalCodePrefix(r?.code) || undefined,
    code: stripInternalCodePrefix(r?.code) || raw.code || raw.outputNumber || '',
    name: r?.name || raw.name || raw.title || '',
    title: raw.title || r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    indicators: Array.isArray(raw.indicators)
      ? raw.indicators
      : (() => {
          const parsedInd = safeJsonParse(r?.indicators_json ?? r?.indicators, []);
          return Array.isArray(parsedInd) ? parsedInd : [];
        })(),
    status: r?.status || raw.status || 'Belum Dimulai',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || undefined,
    updatedAt: r?.updated_at || raw.updatedAt || undefined,
  }));

  const activities = parseAndHydrateRows<any>(activityRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    programId: r?.program_id || raw.programId || '',
    outcomeId: r?.outcome_id || raw.outcomeId || '',
    outputId: r?.output_id || raw.outputId || '',
    activityNumber: raw.activityNumber || r?.activity_number || undefined,
    code: stripInternalCodePrefix(r?.code) || raw.code || raw.activityNumber || '',
    name: r?.name || raw.name || raw.title || '',
    title: raw.title || r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    startDate: r?.start_date || raw.startDate || '',
    endDate: r?.end_date || raw.endDate || '',
    status: r?.status || raw.status || 'Belum Dimulai',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || undefined,
    updatedAt: r?.updated_at || raw.updatedAt || undefined,
  }));

  const subActivities = parseAndHydrateRows<any>(subActivityRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    programId: r?.program_id || raw.programId || '',
    outcomeId: r?.outcome_id || raw.outcomeId || '',
    outputId: r?.output_id || raw.outputId || '',
    activityId: r?.activity_id || raw.activityId || '',
    code: stripInternalCodePrefix(r?.code) || raw.code || '',
    name: r?.name || raw.name || '',
    description: r?.description ?? raw.description ?? '',
    picName: r?.pic_name || raw.picName || '',
    status: r?.status || raw.status || 'Belum Dimulai',
    budgetAllocated:
      r?.budget_allocated !== undefined && r?.budget_allocated !== null
        ? Number(r.budget_allocated)
        : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || undefined,
    updatedAt: r?.updated_at || raw.updatedAt || undefined,
  }));

  const tors = parseAndHydrateRows<any>(torRows, (r, raw) => {
    const resolvedSubmissionStatus =
      raw.submissionStatus || r?.status || raw.status || 'Draft';
    const resolvedActivityStatus =
      raw.activityStatus ||
      (resolvedSubmissionStatus === 'Disetujui' ? 'Sedang Berjalan' : 'Belum Dimulai');
    const resolvedTorNumber =
      (typeof r?.tor_number === 'string' && r.tor_number.trim()) ||
      (typeof raw.torNumber === 'string' && raw.torNumber.trim()) ||
      '';
    const resolvedCreatedById =
      raw.createdById || raw.createdByUserId || r?.created_by_user_id || raw.picId || '';
    const resolvedCreatedByName =
      r?.created_by_name || raw.createdByName || raw.picName || '';
    return {
      ...raw,
      id: String(r?.id || raw.id || ''),
      torNumber: resolvedTorNumber,
      title: r?.title || raw.title || '',
      programId: r?.program_id || raw.programId || '',
      outcomeId: r?.outcome_id || raw.outcomeId || '',
      outputId: r?.output_id || raw.outputId || '',
      activityId: r?.activity_id || raw.activityId || '',
      activityName: raw.activityName || r?.title || raw.title || '',
      picId: raw.picId || resolvedCreatedById,
      picName: raw.picName || resolvedCreatedByName,
      createdById: resolvedCreatedById,
      createdByName: resolvedCreatedByName,
      status: r?.status || resolvedSubmissionStatus,
      submissionStatus: resolvedSubmissionStatus,
      activityStatus: resolvedActivityStatus,
      background: typeof raw.background === 'string' ? raw.background : '',
      rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
      generalObjective: typeof raw.generalObjective === 'string' ? raw.generalObjective : '',
      objectives: typeof raw.objectives === 'string' ? raw.objectives : '',
      implementingTeam: Array.isArray(raw.implementingTeam) ? raw.implementingTeam : [],
      specificObjectives: Array.isArray(raw.specificObjectives) ? raw.specificObjectives : [],
      timelineItems: Array.isArray(raw.timelineItems) ? raw.timelineItems : [],
      monitoringItems: Array.isArray(raw.monitoringItems) ? raw.monitoringItems : [],
      scopeOfActivities: Array.isArray(raw.scopeOfActivities) ? raw.scopeOfActivities : [],
      implementationMechanisms: Array.isArray(raw.implementationMechanisms)
        ? raw.implementationMechanisms
        : [],
      participantRows: Array.isArray(raw.participantRows) ? raw.participantRows : [],
      participantCustomColumns: Array.isArray(raw.participantCustomColumns)
        ? raw.participantCustomColumns
        : [],
      rolesResponsibilities: Array.isArray(raw.rolesResponsibilities)
        ? raw.rolesResponsibilities
        : [],
      rundown: Array.isArray(raw.rundown) ? raw.rundown : [],
      locations: Array.isArray(raw.locations) ? raw.locations : [],
      goals: Array.isArray(raw.goals) ? raw.goals : [],
      indicators: Array.isArray(raw.indicators) ? raw.indicators : [],
      mealItems: Array.isArray(raw.mealItems) ? raw.mealItems : [],
      challengesMitigations: Array.isArray(raw.challengesMitigations)
        ? raw.challengesMitigations
        : [],
      budgetAuditLogs: Array.isArray(raw.budgetAuditLogs) ? raw.budgetAuditLogs : [],
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
    };
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

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

  const cashAdvances = parseAndHydrateRows<any>(caRows, (r, raw) => {
    const resolvedCaNumber =
      (typeof raw.advanceNumber === 'string' && raw.advanceNumber.trim()) ||
      (typeof r?.ca_number === 'string' && r.ca_number.trim()) ||
      (typeof raw.caNumber === 'string' && raw.caNumber.trim()) ||
      (typeof raw.documentNumber === 'string' && raw.documentNumber.trim()) ||
      '';
    return {
      ...raw,
      id: String(r?.id || raw.id || ''),
      advanceNumber: resolvedCaNumber,
      caNumber: resolvedCaNumber,
      documentNumber: raw.documentNumber || resolvedCaNumber,
      torId: r?.tor_id || raw.torId || '',
      torNumber: raw.torNumber || '',
      programId: r?.program_id || raw.programId || '',
      activityId: r?.activity_id || raw.activityId || '',
      activityTitle: raw.activityTitle || '',
      requesterId: raw.requesterId || r?.requester_user_id || '',
      requesterName: r?.requester_name || raw.requesterName || '',
      items: Array.isArray(raw.items) ? raw.items : [],
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
    };
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const meetingMinutes = parseAndHydrateRows<any>(minutesRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ''),
    torId: r?.tor_id || raw.torId || '',
    activityId: r?.activity_id || raw.activityId || '',
    documentNumber: raw.documentNumber || '',
    title: r?.title || raw.title || '',
    meetingDate: r?.meeting_date || raw.meetingDate || raw.date || '',
    date: raw.date || r?.meeting_date || raw.meetingDate || '',
    location: r?.location || raw.location || '',
    meetingLocation: raw.meetingLocation || r?.location || raw.location || '',
    createdById: raw.createdById || r?.created_by_user_id || '',
    status: r?.status || raw.status || 'Draft',
    participants: Array.isArray(raw.participants) ? raw.participants : [],
    discussions: Array.isArray(raw.discussions) ? raw.discussions : [],
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    actionPoints: Array.isArray(raw.actionPoints) ? raw.actionPoints : [],
    createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
  })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const participantDatabase = parseAndHydrateRows<any>(participantRows, (r, raw) => {
    const rawPtType = String(
      raw.participantType || r?.participant_type || raw.entityType || ''
    ).toUpperCase();
    const resolvedParticipantType =
      rawPtType.includes('KELOMPOK') || rawPtType.includes('ORGANISASI') || rawPtType === 'GROUP'
        ? 'KELOMPOK/ORGANISASI'
        : 'INDIVIDU';
    return {
      ...raw,
      id: String(r?.id || raw.id || ''),
      participantType: resolvedParticipantType,
      entityType:
        raw.entityType ||
        (resolvedParticipantType === 'KELOMPOK/ORGANISASI' ? 'GROUP' : 'INDIVIDUAL'),
      fullName: raw.fullName || r?.name || raw.name || '',
      groupName:
        raw.groupName ||
        (resolvedParticipantType === 'KELOMPOK/ORGANISASI'
          ? r?.name || raw.name || ''
          : undefined),
      name: r?.name || raw.name || raw.fullName || raw.groupName || '',
      gender: r?.gender || raw.gender || undefined,
      institutionName: raw.institutionName || r?.organization_or_group || undefined,
      phoneNumber: raw.phoneNumber || r?.phone || undefined,
      cityOrRegency: raw.cityOrRegency || r?.village_or_city || undefined,
      regionCommunity: raw.regionCommunity || r?.village_or_city || raw.cityOrRegency || '',
      programInvolvements: Array.isArray(raw.programInvolvements) ? raw.programInvolvements : [],
      createdAt: r?.created_at || raw.createdAt || new Date().toISOString(),
    };
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const hydratedAttendanceRecords = parseAndHydrateRows<any>(attendanceRows, (r, raw) => {
    const rawHasActiveUnclosedClock =
      Boolean(raw && typeof raw.clockInTime === 'string' && raw.clockInTime.trim() && !raw.clockInTime.startsWith('0000-00-00')) &&
      (!raw.clockOutTime || String(raw.clockOutTime).trim() === '' || String(raw.clockOutTime).startsWith('0000-00-00'));
    const normalizedClockIn = normalizeHydratedAttendanceTimestamp(r?.clock_in_time, raw?.clockInTime, false);
    const normalizedClockOut = normalizeHydratedAttendanceTimestamp(
      r?.clock_out_time,
      raw?.clockOutTime,
      rawHasActiveUnclosedClock
    );
    return {
      ...raw,
      id: String(r?.id || raw.id || ''),
      date: toMysqlDateOnlyString(raw.date || r?.record_date) || String(r?.record_date || raw.date || ''),
      userId: r?.user_id || raw.userId || '',
      userName: r?.user_name || raw.userName || '',
      recordType: normalizedClockIn ? 'ATTENDANCE' : r?.record_type || raw.recordType || 'ATTENDANCE',
      clockInTime: normalizedClockIn,
      clockOutTime: normalizedClockOut,
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
    };
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

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

  const kvAttendanceRecords = Array.isArray(attendanceSystem.records)
    ? attendanceSystem.records
    : [];
  if (hydratedAttendanceRecords.length > 0) {
    const mergedById = new Map<string, any>();
    for (const rec of hydratedAttendanceRecords) {
      if (rec && rec.id) {
        mergedById.set(String(rec.id), rec);
      }
    }
    for (const kvRec of kvAttendanceRecords) {
      if (!kvRec || !kvRec.id) continue;
      const recId = String(kvRec.id);
      const isKvActiveClock =
        Boolean(kvRec.clockInTime) &&
        !String(kvRec.clockInTime).startsWith('0000-00-00') &&
        (!kvRec.clockOutTime || String(kvRec.clockOutTime).startsWith('0000-00-00'));
      if (!mergedById.has(recId) && isKvActiveClock) {
        mergedById.set(recId, { ...kvRec, clockOutTime: undefined });
      }
    }
    attendanceSystem.records = Array.from(mergedById.values()).sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || ''))
    );
  } else {
    attendanceSystem.records = kvAttendanceRecords;
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

// ============================================================================
// MYSQL PRIVILEGE INSPECTION & ADAPTIVE WRITE ENGINE
// (Menyesuaikan kolom aktual di Hostinger MySQL, mencegah NaN/DATETIME error,
//  tidak melakukan DELETE massal, dan mencatat log diagnostik aman)
// ============================================================================

export interface MysqlPrivilegeSummary {
  checked: boolean;
  canSelect: boolean;
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  rawSummary: string;
}

interface MysqlColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  hasDefault: boolean;
  extra: string;
}

const tableColumnsCache = new Map<string, Map<string, MysqlColumnMeta>>();

function safeFiniteNumber(val: any, fallback: number | null = 0): number | null {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'boolean') return val ? 1 : 0;
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : fallback;
}

function toMysqlDateTimeString(val: any): string | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
  }
  return null;
}

function toMysqlDateOnlyString(val: any): string | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s) return null;
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeHydratedAttendanceTimestamp(
  colVal: any,
  rawVal: any,
  isExplicitlyActiveInRawJson = false
): string | undefined {
  const cleanIsoOrTime = (v: any): string | undefined => {
    if (v === null || v === undefined) return undefined;
    if (v instanceof Date) {
      return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
    }
    const s = String(v).trim();
    if (!s || s.startsWith('0000-00-00')) return undefined;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
      return `${s.replace(' ', 'T')}Z`;
    }
    return s;
  };

  const fromRaw = cleanIsoOrTime(rawVal);
  if (fromRaw) return fromRaw;
  if (isExplicitlyActiveInRawJson) return undefined;
  return cleanIsoOrTime(colVal);
}

function formatValueForMysqlColumn(val: any, colMeta: MysqlColumnMeta): any {
  const typeLower = (colMeta.type || '').toLowerCase();
  const colNameLower = (colMeta.name || '').toLowerCase();
  const isForeignIdLike =
    colNameLower !== 'id' &&
    colNameLower !== 'store_key' &&
    (colNameLower.endsWith('_id') || colNameLower.endsWith('_by'));
  const isUniqueIndexed = String(colMeta.key || '').toUpperCase() === 'UNI';
  const canLeaveNull =
    colMeta.nullable || colMeta.hasDefault || colMeta.extra.includes('auto_increment');

  const fallbackForStrictNotNull = (): any => {
    if (
      typeLower.includes('int') ||
      typeLower.includes('decimal') ||
      typeLower.includes('numeric') ||
      typeLower.includes('float') ||
      typeLower.includes('double') ||
      typeLower.includes('bit')
    ) {
      return 0;
    }
    if (typeLower.startsWith('datetime') || typeLower.startsWith('timestamp')) {
      if (colNameLower === 'clock_out_time') {
        return '0000-00-00 00:00:00';
      }
      return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    if (typeLower === 'date') {
      return new Date().toISOString().slice(0, 10);
    }
    if (typeLower.includes('json')) {
      return '{}';
    }
    return '';
  };

  // Jangan pernah mengirim string kosong '' pada kolom Foreign Key (*_id) atau kolom UNIQUE yang nullable,
  // karena '' melanggar FOREIGN KEY (ER_NO_REFERENCED_ROW_2) atau UNIQUE (ER_DUP_ENTRY) di MySQL.
  if (val === '' && (isForeignIdLike || isUniqueIndexed) && canLeaveNull) {
    return null;
  }

  if (val === undefined || val === null) {
    return canLeaveNull ? null : fallbackForStrictNotNull();
  }

  if (typeLower.startsWith('datetime') || typeLower.startsWith('timestamp')) {
    const dt = toMysqlDateTimeString(val);
    if (dt !== null) return dt;
    return canLeaveNull ? null : fallbackForStrictNotNull();
  }

  if (typeLower === 'date') {
    const d = toMysqlDateOnlyString(val);
    if (d !== null) return d;
    return canLeaveNull ? null : fallbackForStrictNotNull();
  }

  if (
    typeLower.includes('int') ||
    typeLower.includes('decimal') ||
    typeLower.includes('numeric') ||
    typeLower.includes('float') ||
    typeLower.includes('double') ||
    typeLower.includes('bit')
  ) {
    const num = safeFiniteNumber(val, null);
    if (num !== null) return num;
    return canLeaveNull ? null : 0;
  }

  if (typeLower.includes('json')) {
    if (typeof val === 'string') {
      try {
        JSON.parse(val);
        return val;
      } catch {
        return JSON.stringify(val);
      }
    }
    return JSON.stringify(val);
  }

  const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
  const lenMatch = typeLower.match(/(?:var)?char\((\d+)\)/);
  if (lenMatch) {
    const maxLen = parseInt(lenMatch[1], 10);
    if (Number.isFinite(maxLen) && maxLen > 0 && strVal.length > maxLen) {
      return strVal.slice(0, maxLen);
    }
  }
  return strVal;
}

async function ensureSingleMissingTableFromSchema(connOrPool: any, tableName: string): Promise<void> {
  const candidatePaths = [
    path.resolve(process.cwd(), 'database', 'schema.sql'),
    path.resolve(__poolDir, 'database', 'schema.sql'),
    path.resolve(__poolDir, '..', '..', 'database', 'schema.sql'),
  ];
  const schemaPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!schemaPath) return;

  const sqlContent = fs.readFileSync(schemaPath, 'utf-8');
  const cleanedSql = sqlContent.replace(/^\s*--.*$/gm, '');
  const statements = cleanedSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const targetRegex = new RegExp(
    `^CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+\`?${tableName}\`?\\b`,
    'i'
  );
  for (const stmt of statements) {
    if (targetRegex.test(stmt)) {
      await connOrPool.query(stmt);
      return;
    }
  }
}

async function describeTableColumns(
  connOrPool: any,
  tableName: string
): Promise<Map<string, MysqlColumnMeta>> {
  const cached = tableColumnsCache.get(tableName);
  if (cached && cached.size > 0) {
    return cached;
  }

  let rows: any[];
  try {
    const [res] = await connOrPool.query(`SHOW COLUMNS FROM \`${tableName}\``);
    rows = Array.isArray(res) ? res : [];
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      await ensureSingleMissingTableFromSchema(connOrPool, tableName);
      const [retryRes] = await connOrPool.query(`SHOW COLUMNS FROM \`${tableName}\``);
      rows = Array.isArray(retryRes) ? retryRes : [];
    } else {
      throw err;
    }
  }

  const colMap = new Map<string, MysqlColumnMeta>();
  for (const r of rows) {
    const fieldName = String(r.Field || r.field || '').trim();
    if (!fieldName) continue;
    colMap.set(fieldName, {
      name: fieldName,
      type: String(r.Type || r.type || 'varchar(255)'),
      nullable: String(r.Null || r.null || 'YES').toUpperCase() === 'YES',
      key: String(r.Key || r.key || ''),
      hasDefault: r.Default !== null && r.Default !== undefined,
      extra: String(r.Extra || r.extra || '').toLowerCase(),
    });
  }

  if (colMap.size > 0) {
    tableColumnsCache.set(tableName, colMap);
  }
  return colMap;
}

/**
 * Memeriksa hak akses user database MySQL secara non-destructive menggunakan SHOW GRANTS FOR CURRENT_USER().
 * Tidak pernah mengubah privilege, membuat user baru, atau mengekspos password/host sensitif.
 */
export async function checkMysqlWritePrivileges(pool: MysqlPoolLike): Promise<MysqlPrivilegeSummary> {
  try {
    const [rows]: any = await pool.query('SHOW GRANTS FOR CURRENT_USER()');
    const grantLines: string[] = Array.isArray(rows)
      ? rows.map((r: any) => String(Object.values(r || {})[0] || '').toUpperCase())
      : [];

    let canSelect = false;
    let canInsert = false;
    let canUpdate = false;
    let canDelete = false;

    for (const line of grantLines) {
      const match = line.match(/^GRANT\s+(.+?)\s+ON\s+/i);
      const privPart = match ? match[1] : line;
      if (privPart.includes('ALL PRIVILEGES') || /\bALL\b/.test(privPart)) {
        canSelect = true;
        canInsert = true;
        canUpdate = true;
        canDelete = true;
      } else {
        if (/\bSELECT\b/.test(privPart)) canSelect = true;
        if (/\bINSERT\b/.test(privPart)) canInsert = true;
        if (/\bUPDATE\b/.test(privPart)) canUpdate = true;
        if (/\bDELETE\b/.test(privPart)) canDelete = true;
      }
    }

    const summaryText = `SELECT=${canSelect}, INSERT=${canInsert}, UPDATE=${canUpdate}, DELETE=${canDelete}`;
    if (!canInsert || !canUpdate) {
      console.warn(
        `[DB] WARNING: MySQL database user may lack write privileges (${summaryText}). Ensure INSERT and UPDATE privileges are granted in Hostinger MySQL Databases.`
      );
    } else {
      console.log(`[DB] MySQL privilege verification OK (${summaryText}).`);
    }

    return {
      checked: true,
      canSelect,
      canInsert,
      canUpdate,
      canDelete,
      rawSummary: summaryText,
    };
  } catch {
    return {
      checked: false,
      canSelect: true,
      canInsert: true,
      canUpdate: true,
      canDelete: true,
      rawSummary: 'Privilege inspection skipped (SHOW GRANTS restricted by host)',
    };
  }
}

interface AdaptiveUpsertOptions {
  primaryKeyColumn?: string;
  immutableOnUpdateColumns?: string[];
  preserveNonEmptyColumns?: string[];
  coalesceIfNullColumns?: string[];
}

async function executeAdaptiveUpsert(
  connOrPool: any,
  tableName: string,
  candidateRow: Record<string, any>,
  options?: AdaptiveUpsertOptions
): Promise<number> {
  const colMetaMap = await describeTableColumns(connOrPool, tableName);
  const pkCol = options?.primaryKeyColumn || 'id';
  const immutableSet = new Set<string>([
    pkCol,
    ...(options?.immutableOnUpdateColumns || ['created_at']),
  ]);
  const preserveNonEmptySet = new Set<string>(options?.preserveNonEmptyColumns || []);
  const coalesceIfNullSet = new Set<string>(options?.coalesceIfNullColumns || []);

  const selectedCols: string[] = [];
  const params: any[] = [];

  for (const [colName, colMeta] of colMetaMap.entries()) {
    if (colMeta.extra.includes('auto_increment') && candidateRow[colName] === undefined) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(candidateRow, colName)) {
      let rawCandidateVal = candidateRow[colName];
      // Jika tabel hirarki anak di Hostinger memiliki indeks UNIQUE global pada kolom `code`
      // (mis. `Outcome 1` di dua Program berbeda), beri namespace program singkat agar bebas ER_DUP_ENTRY.
      if (
        colName === 'code' &&
        String(colMeta.key || '').toUpperCase() === 'UNI' &&
        (tableName === 'outcomes' ||
          tableName === 'outputs' ||
          tableName === 'activities' ||
          tableName === 'sub_activities')
      ) {
        const baseCode =
          typeof rawCandidateVal === 'string' && rawCandidateVal.trim() !== ''
            ? rawCandidateVal.trim()
            : String(candidateRow[pkCol] || '');
        const progTag = candidateRow.program_id ? String(candidateRow.program_id).slice(-8) : '';
        rawCandidateVal =
          progTag && !baseCode.includes('::') ? `${progTag}::${baseCode}` : baseCode;
      }
      let formatted = formatValueForMysqlColumn(rawCandidateVal, colMeta);
      if (
        (formatted === null || formatted === '') &&
        !colMeta.nullable &&
        !colMeta.hasDefault &&
        String(colMeta.key || '').toUpperCase() === 'UNI'
      ) {
        formatted = String(candidateRow[pkCol] || '').slice(0, 64);
      }
      selectedCols.push(colName);
      params.push(formatted);
    } else if (!colMeta.nullable && !colMeta.hasDefault && !colMeta.extra.includes('auto_increment')) {
      // Sediakan nilai fallback aman jika tabel produksi Hostinger memiliki kolom tambahan NOT NULL tanpa default
      let fallbackVal = formatValueForMysqlColumn(null, colMeta);
      if (
        (fallbackVal === null || fallbackVal === '') &&
        String(colMeta.key || '').toUpperCase() === 'UNI'
      ) {
        fallbackVal = String(candidateRow[pkCol] || '').slice(0, 64);
      }
      selectedCols.push(colName);
      params.push(fallbackVal);
    }
  }

  if (selectedCols.length === 0) {
    throw new Error(`No matching columns found for MySQL table '${tableName}'.`);
  }

  const quotedCols = selectedCols.map((c) => `\`${c}\``).join(', ');
  const placeholders = selectedCols.map(() => '?').join(', ');

  const updateAssignments: string[] = [];
  for (const colName of selectedCols) {
    if (immutableSet.has(colName)) continue;
    if (preserveNonEmptySet.has(colName)) {
      updateAssignments.push(
        `\`${colName}\` = COALESCE(NULLIF(VALUES(\`${colName}\`), ''), \`${tableName}\`.\`${colName}\`)`
      );
    } else if (coalesceIfNullSet.has(colName)) {
      updateAssignments.push(
        `\`${colName}\` = COALESCE(VALUES(\`${colName}\`), \`${tableName}\`.\`${colName}\`)`
      );
    } else {
      updateAssignments.push(`\`${colName}\` = VALUES(\`${colName}\`)`);
    }
  }

  if (updateAssignments.length === 0) {
    updateAssignments.push(`\`${pkCol}\` = \`${tableName}\`.\`${pkCol}\``);
  }

  const sql = `INSERT INTO \`${tableName}\` (${quotedCols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateAssignments.join(', ')}`;
  const [result]: any = await connOrPool.query(sql, params);
  return Number(result?.affectedRows || 0);
}

function buildUserCandidateRow(u: any, nowIso: string): Record<string, any> {
  const effectiveHash =
    (typeof u.passwordHash === 'string' && u.passwordHash.trim()) ||
    (typeof u.password_hash === 'string' && u.password_hash.trim()) ||
    null;
  const effectiveUsername =
    u.username || deriveUsernameFallback(u.email || '', u.name || '', String(u.id || ''));
  const permsJson = JSON.stringify(u.permissions || {});
  return {
    id: String(u.id).slice(0, 128),
    username: truncStr(effectiveUsername, 128),
    name: truncStr(u.name, 255) || '',
    email: truncStr(u.email, 255) || '',
    password_hash: truncStr(effectiveHash, 255),
    password: truncStr(effectiveHash, 255),
    role: truncStr(u.role, 64) || 'staff',
    role_title: truncStr(u.roleTitle, 255) || truncStr(u.role, 64) || 'Staff',
    department: truncStr(u.department, 255),
    is_active: u.isActive === false ? 0 : 1,
    account_status: truncStr(u.accountStatus || (u.isActive === false ? 'Nonaktif' : 'Aktif'), 64),
    must_change_password: u.mustChangePassword ? 1 : 0,
    password_updated_at: u.passwordUpdatedAt || null,
    permissions_json: permsJson,
    permissions: permsJson,
    last_login_at: u.lastLoginAt || null,
    created_at: u.createdAt || nowIso,
    updated_at: nowIso,
    raw_json: JSON.stringify(u),
  };
}

function buildProgramCandidateRow(p: any, nowIso: string): Record<string, any> {
  return {
    id: String(p.id).slice(0, 128),
    code: truncStr(p.code, 64),
    name: truncStr(p.name, 255) || '',
    location: truncStr(p.location, 255),
    description: p.description || null,
    donor: truncStr(p.donor, 255),
    start_date: truncStr(p.startDate, 32),
    end_date: truncStr(p.endDate, 32),
    total_budget: safeFiniteNumber(p.totalBudget ?? p.budget, 0),
    currency: truncStr(p.currency || 'IDR', 16),
    status: truncStr(p.status || 'Aktif', 64),
    created_at: p.createdAt || nowIso,
    updated_at: p.updatedAt || nowIso,
    raw_json: JSON.stringify(p),
  };
}

function buildOutcomeCandidateRow(oc: any, nowIso?: string): Record<string, any> {
  const ts = nowIso || new Date().toISOString();
  const effectiveName = truncStr(oc.name || oc.title, 500) || '';
  const indicatorsJson = JSON.stringify(Array.isArray(oc.indicators) ? oc.indicators : []);
  const resolvedCode = truncStr(oc.code || oc.outcomeNumber || oc.id, 64);
  return {
    id: String(oc.id).slice(0, 128),
    program_id: truncStr(oc.programId, 128),
    code: resolvedCode,
    outcome_number: truncStr(oc.outcomeNumber || oc.code || oc.id, 64),
    name: effectiveName,
    title: truncStr(oc.title || oc.name, 500) || effectiveName,
    description: oc.description || null,
    pic_id: truncStr(oc.picId, 128),
    pic_name: truncStr(oc.picName, 255),
    status: truncStr(oc.status || 'Belum Dimulai', 64),
    budget_allocated: safeFiniteNumber(oc.budgetAllocated ?? oc.budget, 0),
    indicators_json: indicatorsJson,
    indicators: indicatorsJson,
    created_at: oc.createdAt || ts,
    updated_at: oc.updatedAt || ts,
    raw_json: JSON.stringify(oc),
  };
}

function buildOutputCandidateRow(op: any, nowIso?: string): Record<string, any> {
  const ts = nowIso || new Date().toISOString();
  const effectiveName = truncStr(op.name || op.title, 500) || '';
  const indicatorsJson = JSON.stringify(Array.isArray(op.indicators) ? op.indicators : []);
  const resolvedCode = truncStr(op.code || op.outputNumber || op.id, 64);
  return {
    id: String(op.id).slice(0, 128),
    program_id: truncStr(op.programId, 128),
    outcome_id: truncStr(op.outcomeId, 128),
    code: resolvedCode,
    output_number: truncStr(op.outputNumber || op.code || op.id, 64),
    name: effectiveName,
    title: truncStr(op.title || op.name, 500) || effectiveName,
    description: op.description || null,
    pic_id: truncStr(op.picId, 128),
    pic_name: truncStr(op.picName, 255),
    status: truncStr(op.status || 'Belum Dimulai', 64),
    budget_allocated: safeFiniteNumber(op.budgetAllocated ?? op.budget, 0),
    indicators_json: indicatorsJson,
    indicators: indicatorsJson,
    created_at: op.createdAt || ts,
    updated_at: op.updatedAt || ts,
    raw_json: JSON.stringify(op),
  };
}

function buildActivityCandidateRow(ac: any, nowIso?: string): Record<string, any> {
  const ts = nowIso || new Date().toISOString();
  const effectiveName = truncStr(ac.name || ac.title, 500) || '';
  const resolvedCode = truncStr(ac.code || ac.activityNumber || ac.id, 64);
  return {
    id: String(ac.id).slice(0, 128),
    program_id: truncStr(ac.programId, 128),
    outcome_id: truncStr(ac.outcomeId, 128),
    output_id: truncStr(ac.outputId, 128),
    code: resolvedCode,
    activity_number: truncStr(ac.activityNumber || ac.code || ac.id, 64),
    name: effectiveName,
    title: truncStr(ac.title || ac.name, 500) || effectiveName,
    description: ac.description || null,
    pic_id: truncStr(ac.picId, 128),
    pic_name: truncStr(ac.picName, 255),
    start_date: truncStr(ac.startDate, 32),
    end_date: truncStr(ac.endDate, 32),
    status: truncStr(ac.status || 'Belum Dimulai', 64),
    budget_allocated: safeFiniteNumber(ac.budgetAllocated ?? ac.budget, 0),
    created_at: ac.createdAt || ts,
    updated_at: ac.updatedAt || ts,
    raw_json: JSON.stringify(ac),
  };
}

function buildSubActivityCandidateRow(sa: any, nowIso?: string): Record<string, any> {
  const ts = nowIso || new Date().toISOString();
  const effectiveName = truncStr(sa.name, 500) || '';
  const resolvedCode = truncStr(sa.code || sa.id, 64);
  return {
    id: String(sa.id).slice(0, 128),
    program_id: truncStr(sa.programId, 128),
    outcome_id: truncStr(sa.outcomeId, 128),
    output_id: truncStr(sa.outputId, 128),
    activity_id: truncStr(sa.activityId, 128),
    code: resolvedCode,
    name: effectiveName,
    title: effectiveName,
    description: sa.description || null,
    pic_name: truncStr(sa.picName, 255),
    start_date: truncStr(sa.startDate, 32),
    end_date: truncStr(sa.endDate, 32),
    status: truncStr(sa.status || 'Belum Dimulai', 64),
    budget_allocated: safeFiniteNumber(sa.budgetAllocated ?? sa.budget, 0),
    created_at: sa.createdAt || ts,
    updated_at: sa.updatedAt || ts,
    raw_json: JSON.stringify(sa),
  };
}

function buildTorCandidateRow(t: any, nowIso: string): Record<string, any> {
  return {
    id: String(t.id).slice(0, 128),
    tor_number: truncStr(t.torNumber || t.documentNumber, 128),
    title: truncStr(t.title, 500) || '',
    program_id: truncStr(t.programId, 128),
    outcome_id: truncStr(t.outcomeId, 128),
    output_id: truncStr(t.outputId, 128),
    activity_id: truncStr(t.activityId, 128),
    created_by_user_id: truncStr(t.createdByUserId || t.createdById || t.picId, 128),
    created_by_name: truncStr(t.createdByName || t.picName, 255),
    status: truncStr(t.submissionStatus || t.status || 'Draft', 128),
    current_stage: safeFiniteNumber(t.currentWorkflowStage ?? t.currentStage, 1),
    budget_requested: safeFiniteNumber(t.budgetRequested, null),
    budget_actual_spent: safeFiniteNumber(t.budgetActualSpent, null),
    start_date: truncStr(t.startDate, 32),
    end_date: truncStr(t.endDate, 32),
    location: truncStr(t.location, 255),
    created_at: t.createdAt || nowIso,
    updated_at: t.updatedAt || nowIso,
    raw_json: JSON.stringify(t),
  };
}

function buildApprovalRecordCandidateRow(ar: any, nowIso: string): Record<string, any> {
  return {
    id: String(ar.id).slice(0, 128),
    tor_id: truncStr(ar.torId, 128) || '',
    // Mendukung stage bertipe INT maupun VARCHAR tanpa pernah menghasilkan NaN
    stage: ar.stage ?? null,
    approver_user_id: truncStr(ar.approverUserId || ar.approverId || ar.reviewerId, 128),
    approver_name: truncStr(ar.approverName || ar.reviewerName, 255),
    role: truncStr(ar.role || ar.reviewerRole, 128),
    action: truncStr(ar.action || ar.decision, 128),
    notes: ar.notes ?? ar.comment ?? null,
    timestamp: ar.timestamp || nowIso,
    raw_json: JSON.stringify(ar),
  };
}

function buildCashAdvanceCandidateRow(ca: any, nowIso: string): Record<string, any> {
  return {
    id: String(ca.id).slice(0, 128),
    ca_number: truncStr(ca.advanceNumber || ca.caNumber || ca.documentNumber, 128),
    tor_id: truncStr(ca.torId, 128),
    program_id: truncStr(ca.programId, 128),
    activity_id: truncStr(ca.activityId, 128),
    requester_user_id: truncStr(ca.requesterUserId || ca.requesterId || ca.submittedByUserId, 128),
    requester_name: truncStr(ca.requesterName || ca.submittedByName, 255),
    total_amount: safeFiniteNumber(ca.totalAmount ?? ca.requestedAmount, 0),
    realized_amount: safeFiniteNumber(ca.realizedAmount ?? ca.actualSpentAmount, null),
    status: truncStr(ca.status || 'Draft', 128),
    report_approval_status: truncStr(ca.reportApprovalStatus, 128),
    created_at: ca.createdAt || nowIso,
    updated_at: ca.updatedAt || nowIso,
    raw_json: JSON.stringify(ca),
  };
}

function buildMeetingMinuteCandidateRow(mm: any, nowIso: string): Record<string, any> {
  return {
    id: String(mm.id).slice(0, 128),
    tor_id: truncStr(mm.torId, 128),
    activity_id: truncStr(mm.activityId, 128),
    title: truncStr(mm.title || mm.agenda, 500),
    meeting_date: truncStr(mm.meetingDate || mm.date, 32),
    location: truncStr(mm.location, 255),
    created_by_user_id: truncStr(mm.createdByUserId || mm.createdById, 128),
    status: truncStr(mm.status, 64),
    created_at: mm.createdAt || nowIso,
    raw_json: JSON.stringify(mm),
  };
}

function buildParticipantCandidateRow(pt: any, nowIso: string): Record<string, any> {
  return {
    id: String(pt.id).slice(0, 128),
    participant_type: truncStr(pt.entityType || pt.participantType || 'INDIVIDUAL', 64),
    name: truncStr(pt.fullName || pt.groupName || pt.name, 255) || '',
    gender: truncStr(pt.gender, 32),
    organization_or_group: truncStr(pt.institutionName || pt.groupName, 255),
    phone: truncStr(pt.phoneNumber || pt.contactPhone, 64),
    village_or_city: truncStr(pt.cityOrRegency || pt.villageOrSubdistrict, 255),
    created_at: pt.createdAt || nowIso,
    raw_json: JSON.stringify(pt),
  };
}

function buildAttendanceRecordCandidateRow(att: any, nowIso: string): Record<string, any> {
  const cleanClockIn =
    typeof att.clockInTime === 'string' && att.clockInTime.trim() && !att.clockInTime.startsWith('0000-00-00')
      ? truncStr(att.clockInTime, 64)
      : null;
  const cleanClockOut =
    typeof att.clockOutTime === 'string' && att.clockOutTime.trim() && !att.clockOutTime.startsWith('0000-00-00')
      ? truncStr(att.clockOutTime, 64)
      : null;
  return {
    id: String(att.id).slice(0, 128),
    record_date: truncStr(att.date, 32) || '',
    user_id: truncStr(att.userId, 128) || '',
    user_name: truncStr(att.userName, 255),
    record_type: truncStr(cleanClockIn ? 'ATTENDANCE' : att.recordType || 'ATTENDANCE', 64),
    clock_in_time: cleanClockIn,
    clock_out_time: cleanClockOut,
    total_work_hours: safeFiniteNumber(att.totalWorkHours, 0),
    is_outside_work_location: att.isOutsideWorkLocation ? 1 : 0,
    created_at: att.createdAt || nowIso,
    updated_at: att.updatedAt || nowIso,
    raw_json: JSON.stringify({
      ...att,
      clockInTime: cleanClockIn ?? undefined,
      clockOutTime: cleanClockOut ?? undefined,
    }),
  };
}

function buildAuditLogCandidateRow(al: any, nowIso: string): Record<string, any> {
  return {
    id: String(al.id).slice(0, 128),
    tor_id: truncStr(al.torId || (al.entityType === 'TOR' ? al.entityId : null), 128),
    user_id: truncStr(al.userId || al.actorId, 128),
    user_name: truncStr(al.userName || al.actorName, 255),
    user_role: truncStr(al.userRole || al.actorRole, 64),
    action: truncStr(al.action, 255) || '',
    details: al.details || null,
    timestamp: al.timestamp || nowIso,
    raw_json: JSON.stringify(al),
  };
}

function extractKvSnapshot(data: DatabaseSchema): Record<string, any> {
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
  return kvEntries;
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
    await executeAdaptiveUpsert(
      pool,
      'system_kv_store',
      {
        store_key: String(k).slice(0, 128),
        store_value: JSON.stringify(v),
        updated_at: nowIso,
      },
      {
        primaryKeyColumn: 'store_key',
        immutableOnUpdateColumns: [],
      }
    );
  }
}

/**
 * Menyimpan 1 baris pengguna (termasuk perubahan username, email, role, atau passwordHash)
 * secara langsung & atomik ke tabel users MySQL sesuai struktur kolom aktual di Hostinger.
 */
export async function upsertMysqlUserRow(pool: MysqlPoolLike, u: any): Promise<number> {
  if (!u || !u.id) return 0;
  const nowIso = new Date().toISOString();
  return executeAdaptiveUpsert(pool, 'users', buildUserCandidateRow(u, nowIso), {
    primaryKeyColumn: 'id',
    immutableOnUpdateColumns: ['created_at'],
    preserveNonEmptyColumns: ['password_hash', 'password'],
    coalesceIfNullColumns: ['last_login_at'],
  });
}

export async function deleteMysqlUserRow(pool: MysqlPoolLike, userId: string): Promise<number> {
  if (!userId) return 0;
  const [result]: any = await pool.query('DELETE FROM `users` WHERE `id` = ?', [
    String(userId).slice(0, 128),
  ]);
  return Number(result?.affectedRows || 0);
}

interface EntityTableSyncSpec {
  tableName: string;
  getRows: (d: DatabaseSchema) => any[];
  buildCandidate: (item: any, nowIso: string) => Record<string, any>;
  allowTargetedDelete: boolean;
  upsertOptions?: AdaptiveUpsertOptions;
}

const ENTITY_TABLE_SPECS: EntityTableSyncSpec[] = [
  {
    tableName: 'users',
    getRows: (d) => d.users || [],
    buildCandidate: buildUserCandidateRow,
    allowTargetedDelete: false, // Penghapusan user hanya boleh melalui deleteMysqlUserRow eksplisit
    upsertOptions: {
      primaryKeyColumn: 'id',
      immutableOnUpdateColumns: ['created_at'],
      preserveNonEmptyColumns: ['password_hash', 'password'],
      coalesceIfNullColumns: ['last_login_at'],
    },
  },
  {
    tableName: 'programs',
    getRows: (d) => d.programs || [],
    buildCandidate: buildProgramCandidateRow,
    allowTargetedDelete: true,
  },
  {
    tableName: 'outcomes',
    getRows: (d) => d.outcomes || [],
    buildCandidate: (oc, nowIso) => buildOutcomeCandidateRow(oc, nowIso),
    allowTargetedDelete: true,
  },
  {
    tableName: 'outputs',
    getRows: (d) => d.outputs || [],
    buildCandidate: (op, nowIso) => buildOutputCandidateRow(op, nowIso),
    allowTargetedDelete: true,
  },
  {
    tableName: 'activities',
    getRows: (d) => d.activities || [],
    buildCandidate: (ac, nowIso) => buildActivityCandidateRow(ac, nowIso),
    allowTargetedDelete: true,
  },
  {
    tableName: 'sub_activities',
    getRows: (d) => d.subActivities || [],
    buildCandidate: (sa, nowIso) => buildSubActivityCandidateRow(sa, nowIso),
    allowTargetedDelete: true,
  },
  {
    tableName: 'tors',
    getRows: (d) => d.tors || [],
    buildCandidate: buildTorCandidateRow,
    allowTargetedDelete: true,
  },
  {
    tableName: 'approval_records',
    getRows: (d) => d.approvalRecords || [],
    buildCandidate: buildApprovalRecordCandidateRow,
    allowTargetedDelete: true,
  },
  {
    tableName: 'cash_advances',
    getRows: (d) => d.cashAdvances || [],
    buildCandidate: buildCashAdvanceCandidateRow,
    allowTargetedDelete: true,
  },
  {
    tableName: 'meeting_minutes',
    getRows: (d) => d.meetingMinutes || [],
    buildCandidate: buildMeetingMinuteCandidateRow,
    allowTargetedDelete: true,
  },
  {
    tableName: 'participants',
    getRows: (d) => d.participantDatabase || [],
    buildCandidate: buildParticipantCandidateRow,
    allowTargetedDelete: true,
  },
  {
    tableName: 'attendance_records',
    getRows: (d) => d.attendanceSystem?.records || [],
    buildCandidate: buildAttendanceRecordCandidateRow,
    allowTargetedDelete: true,
  },
  {
    tableName: 'audit_logs',
    getRows: (d) => d.auditLogs || [],
    buildCandidate: buildAuditLogCandidateRow,
    allowTargetedDelete: false,
  },
];

export interface MysqlDiffSaveSummary {
  upsertedRows: number;
  deletedRows: number;
  updatedKvKeys: number;
  totalAffectedRows: number;
  touchedTables: string[];
}

/**
 * Menyimpan HANYA baris dan koleksi yang benar-benar berubah antara `prevData` dan `nextData`
 * dalam satu transaksi MySQL yang atomik:
 * - Operasi CREATE & UPDATE murni hanya mengeksekusi INSERT ... ON DUPLICATE KEY UPDATE (tanpa DELETE).
 * - Operasi DELETE hanya mengeksekusi DELETE FROM `table` WHERE `id` = ? pada ID yang benar-benar dihapus.
 * - Jika terjadi kegagalan pada satu query pun, seluruh transaksi di-rollback dan error dilempar ke pemanggil.
 */
export async function saveDiffToMysql(
  pool: MysqlPoolLike,
  prevData: DatabaseSchema,
  nextData: DatabaseSchema,
  contextLabel = 'write'
): Promise<MysqlDiffSaveSummary> {
  const nowIso = new Date().toISOString();

  interface PlannedTableOps {
    spec: EntityTableSyncSpec;
    toUpsert: any[];
    toDeleteIds: string[];
  }

  const plannedOps: PlannedTableOps[] = [];
  for (const spec of ENTITY_TABLE_SPECS) {
    const prevRows = (spec.getRows(prevData) || []).filter((r) => r && r.id);
    const nextRows = (spec.getRows(nextData) || []).filter((r) => r && r.id);

    const prevSerializedById = new Map<string, string>();
    for (const r of prevRows) {
      prevSerializedById.set(String(r.id), JSON.stringify(r));
    }

    const nextIds = new Set<string>();
    const toUpsert: any[] = [];
    for (const r of nextRows) {
      const id = String(r.id);
      nextIds.add(id);
      const serialized = JSON.stringify(r);
      if (prevSerializedById.get(id) !== serialized) {
        toUpsert.push(r);
      }
    }

    const toDeleteIds: string[] = [];
    if (spec.allowTargetedDelete) {
      for (const prevId of prevSerializedById.keys()) {
        if (!nextIds.has(prevId)) {
          toDeleteIds.push(prevId);
        }
      }
    }

    if (toUpsert.length > 0 || toDeleteIds.length > 0) {
      plannedOps.push({ spec, toUpsert, toDeleteIds });
    }
  }

  const prevKv = extractKvSnapshot(prevData);
  const nextKv = extractKvSnapshot(nextData);
  const changedKvEntries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(nextKv)) {
    if (v === undefined) continue;
    const nextSerialized = JSON.stringify(v);
    const prevSerialized = prevKv[k] !== undefined ? JSON.stringify(prevKv[k]) : undefined;
    if (nextSerialized !== prevSerialized) {
      changedKvEntries.push([k, nextSerialized]);
    }
  }

  if (plannedOps.length === 0 && changedKvEntries.length === 0) {
    return {
      upsertedRows: 0,
      deletedRows: 0,
      updatedKvKeys: 0,
      totalAffectedRows: 0,
      touchedTables: [],
    };
  }

  const touchedTables = [
    ...plannedOps.map((p) => p.spec.tableName),
    ...(changedKvEntries.length > 0 ? ['system_kv_store'] : []),
  ];

  console.log(
    `[WRITE] DATABASE QUERY STARTED (${contextLabel}) -> tables=[${touchedTables.join(', ')}]`
  );

  const conn = await pool.getConnection();
  let totalAffectedRows = 0;
  let upsertedRows = 0;
  let deletedRows = 0;
  let activeTable = '';
  let activeOperation = '';

  try {
    await conn.beginTransaction();

    // 1. Eksekusi DELETE terlebih dahulu dalam urutan terbalik (child -> parent) agar aman terhadap FOREIGN KEY
    for (const op of [...plannedOps].reverse()) {
      if (op.toDeleteIds.length === 0) continue;
      activeTable = op.spec.tableName;
      activeOperation = 'DELETE';
      for (const delId of op.toDeleteIds) {
        const [delRes]: any = await conn.query(
          `DELETE FROM \`${op.spec.tableName}\` WHERE \`id\` = ?`,
          [delId.slice(0, 128)]
        );
        deletedRows += 1;
        totalAffectedRows += Number(delRes?.affectedRows || 0);
      }
    }

    // 2. Eksekusi INSERT / UPDATE dalam urutan maju (parent -> child: programs -> outcomes -> outputs -> activities -> sub_activities)
    for (const op of plannedOps) {
      if (op.toUpsert.length === 0) continue;
      activeTable = op.spec.tableName;
      activeOperation = 'UPSERT';
      for (const item of op.toUpsert) {
        const affected = await executeAdaptiveUpsert(
          conn,
          op.spec.tableName,
          op.spec.buildCandidate(item, nowIso),
          op.spec.upsertOptions
        );
        upsertedRows += 1;
        totalAffectedRows += affected;
      }
    }

    if (changedKvEntries.length > 0) {
      activeTable = 'system_kv_store';
      activeOperation = 'UPSERT_KV';
      for (const [kvKey, kvJson] of changedKvEntries) {
        const affected = await executeAdaptiveUpsert(
          conn,
          'system_kv_store',
          {
            store_key: kvKey.slice(0, 128),
            store_value: kvJson,
            updated_at: nowIso,
          },
          {
            primaryKeyColumn: 'store_key',
            immutableOnUpdateColumns: [],
          }
        );
        totalAffectedRows += affected;
      }
    }

    activeOperation = 'COMMIT';
    await conn.commit();
    console.log(
      `[WRITE] DATABASE QUERY SUCCESS (${contextLabel}) -> upserted=${upsertedRows}, deleted=${deletedRows}, kvUpdated=${changedKvEntries.length}, affectedRows=${totalAffectedRows}`
    );

    return {
      upsertedRows,
      deletedRows,
      updatedKvKeys: changedKvEntries.length,
      totalAffectedRows,
      touchedTables,
    };
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback secondary failure
    }
    if (err && typeof err === 'object') {
      err.failedTable = activeTable || undefined;
      err.failedOperation = activeOperation || undefined;
    }
    const safeCode = err?.code ? ` [${err.code}]` : '';
    const safeMsg = String(err?.message || err || 'Unknown SQL error')
      .replace(/mysql2?:\/\/[^\s@]+@/gi, 'mysql://***@')
      .replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, '$1***');
    console.error(
      `[WRITE] DATABASE QUERY FAILED (${contextLabel}) table=${activeTable || 'unknown'} op=${activeOperation || 'unknown'}${safeCode}: ${safeMsg}`
    );
    throw err;
  } finally {
    conn.release();
  }
}

export interface MysqlHierarchyImportBatchParams {
  programId: string;
  outcomesToUpsert: any[];
  outputsToUpsert: any[];
  activitiesToUpsert: any[];
  subActivitiesToUpsert: any[];
  auditLog?: any;
}

/**
 * Menyimpan seluruh hasil Import Excel Hirarki Program dalam SATU transaksi MySQL atomik:
 * START TRANSACTION -> Verifikasi Program Induk di MySQL -> INSERT/UPDATE outcomes -> outputs -> activities -> sub_activities -> COMMIT.
 * Jika terjadi kegagalan di salah satu tahap, seluruh perubahan di-ROLLBACK sehingga tidak ada data setengah masuk (no partial import).
 */
export async function importProgramHierarchyToMysql(
  pool: MysqlPoolLike,
  params: MysqlHierarchyImportBatchParams
): Promise<{ totalAffectedRows: number }> {
  const {
    programId,
    outcomesToUpsert,
    outputsToUpsert,
    activitiesToUpsert,
    subActivitiesToUpsert,
    auditLog,
  } = params;
  const nowIso = new Date().toISOString();
  const conn = await pool.getConnection();

  let currentStage = 'DATABASE TRANSACTION STARTED';
  let currentTable = 'programs';
  let totalAffectedRows = 0;

  try {
    console.log(`[IMPORT] DATABASE TRANSACTION STARTED (programId=${programId})`);
    await conn.beginTransaction();

    // 1. Verifikasi keberadaan Program induk langsung di tabel programs MySQL
    currentStage = 'PROGRAM VERIFICATION';
    currentTable = 'programs';
    const [progRows]: any = await conn.query(
      'SELECT `id`, `name` FROM `programs` WHERE `id` = ? LIMIT 1',
      [String(programId).slice(0, 128)]
    );
    if (!Array.isArray(progRows) || progRows.length === 0) {
      throw Object.assign(
        new Error(`Parent program '${programId}' was not found in MySQL table 'programs'.`),
        {
          code: 'PROGRAM_NOT_FOUND_IN_MYSQL',
          failedTable: 'programs',
          failedStage: currentStage,
        }
      );
    }
    console.log(`[IMPORT] PROGRAM VERIFIED (programId=${programId})`);

    // 2. Simpan Outcomes terlebih dahulu (induk dari Output)
    currentStage = 'OUTCOME INSERT';
    currentTable = 'outcomes';
    console.log(`[IMPORT] OUTCOME INSERT STARTED (count=${outcomesToUpsert.length})`);
    for (const oc of outcomesToUpsert) {
      const affected = await executeAdaptiveUpsert(
        conn,
        'outcomes',
        buildOutcomeCandidateRow({ ...oc, programId }, nowIso)
      );
      totalAffectedRows += affected;
    }

    // 3. Simpan Outputs (menggunakan outcome_id dan program_id yang valid)
    currentStage = 'OUTPUT INSERT';
    currentTable = 'outputs';
    console.log(`[IMPORT] OUTPUT INSERT STARTED (count=${outputsToUpsert.length})`);
    for (const op of outputsToUpsert) {
      const affected = await executeAdaptiveUpsert(
        conn,
        'outputs',
        buildOutputCandidateRow({ ...op, programId }, nowIso)
      );
      totalAffectedRows += affected;
    }

    // 4. Simpan Activities (menggunakan output_id, outcome_id, dan program_id yang valid)
    currentStage = 'ACTIVITY INSERT';
    currentTable = 'activities';
    console.log(`[IMPORT] ACTIVITY INSERT STARTED (count=${activitiesToUpsert.length})`);
    for (const ac of activitiesToUpsert) {
      const affected = await executeAdaptiveUpsert(
        conn,
        'activities',
        buildActivityCandidateRow({ ...ac, programId }, nowIso)
      );
      totalAffectedRows += affected;
    }

    // 5. Simpan Sub-Activities jika ada
    if (subActivitiesToUpsert.length > 0) {
      currentStage = 'SUB_ACTIVITY INSERT';
      currentTable = 'sub_activities';
      console.log(`[IMPORT] SUB_ACTIVITY INSERT STARTED (count=${subActivitiesToUpsert.length})`);
      for (const sa of subActivitiesToUpsert) {
        const affected = await executeAdaptiveUpsert(
          conn,
          'sub_activities',
          buildSubActivityCandidateRow({ ...sa, programId }, nowIso)
        );
        totalAffectedRows += affected;
      }
    }

    // 6. Catat Audit Log ke tabel audit_logs dalam transaksi yang sama
    if (auditLog && auditLog.id) {
      currentStage = 'AUDIT LOG INSERT';
      currentTable = 'audit_logs';
      const affected = await executeAdaptiveUpsert(
        conn,
        'audit_logs',
        buildAuditLogCandidateRow(auditLog, nowIso)
      );
      totalAffectedRows += affected;
    }

    currentStage = 'COMMIT';
    await conn.commit();
    console.log(
      `[IMPORT] COMMIT SUCCESS (programId=${programId}, outcomes=${outcomesToUpsert.length}, outputs=${outputsToUpsert.length}, activities=${activitiesToUpsert.length}, subActivities=${subActivitiesToUpsert.length}, affectedRows=${totalAffectedRows})`
    );

    return { totalAffectedRows };
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {
      // ignore secondary rollback error
    }
    if (err && typeof err === 'object') {
      err.failedTable = err.failedTable || currentTable;
      err.failedStage = err.failedStage || currentStage;
      err.failedOperation = 'IMPORT_TRANSACTION';
    }
    const safeCode = err?.code ? ` [${err.code}]` : '';
    const safeMsg = String(err?.message || err || 'Unknown SQL error')
      .replace(/mysql2?:\/\/[^\s@]+@/gi, 'mysql://***@')
      .replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, '$1***');
    console.error(
      `[IMPORT] TRANSACTION ROLLBACK (stage=${currentStage}, table=${currentTable})${safeCode}: ${safeMsg}`
    );
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Menyimpan seluruh snapshot DatabaseSchema ke MySQL menggunakan adaptive upsert (tanpa DELETE massal).
 * Digunakan hanya saat migrasi eksplisit (CLI) atau inisialisasi database yang benar-benar kosong.
 */
export async function saveDatabaseToMysql(
  pool: MysqlPoolLike,
  data: DatabaseSchema
): Promise<void> {
  const nowIso = new Date().toISOString();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const spec of ENTITY_TABLE_SPECS) {
      const rows = (spec.getRows(data) || []).filter((r) => r && r.id);
      for (const item of rows) {
        await executeAdaptiveUpsert(
          conn,
          spec.tableName,
          spec.buildCandidate(item, nowIso),
          spec.upsertOptions
        );
      }
    }

    const kvEntries = extractKvSnapshot(data);
    for (const [k, v] of Object.entries(kvEntries)) {
      if (v === undefined) continue;
      await executeAdaptiveUpsert(
        conn,
        'system_kv_store',
        {
          store_key: k.slice(0, 128),
          store_value: JSON.stringify(v),
          updated_at: nowIso,
        },
        {
          primaryKeyColumn: 'store_key',
          immutableOnUpdateColumns: [],
        }
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

